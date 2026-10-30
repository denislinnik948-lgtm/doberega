import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./cloud-config.js";
import { LOCATIONS } from "./fishing/data.js";
import { hasProgress, normalizeProgress } from "./fishing/store.js";
import { markOwnDevice } from "./analytics.js";

// Loaded on demand, only when accounts are configured.
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
// Saves are batched: a burst of changes goes up once things settle.
const PUSH_DELAY_MS = 3000;
// Per account: the savedAt of the last save this device and the cloud both had.
const SYNCED_KEY = "doberega.synced.";
// This device's progress as it was before the cloud's replaced it, just in case.
const BACKUP_KEY = "doberega.backup";

const NICK_PATTERN = /^[\p{L}\p{N}_ -]{3,16}$/u;

/** A nickname is 3–16 letters (any alphabet), digits, spaces, _ or -. */
export function validNickname(nickname) {
  return NICK_PATTERN.test(nickname.trim());
}

/** Where links in auth emails (password reset) bring the player back. */
const returnUrl = () => `${location.origin}${location.pathname}`;

/**
 * Accounts and cloud saves. Signed in, every local save is pushed to the
 * player's row in the `saves` table; signing in on another device pulls it
 * back. When both sides hold different progress, the player chooses.
 */
export class Cloud {
  /**
   * `getProgress` returns the live progress, `applyProgress(save)` replaces it
   * with a save from the cloud, `onChange` redraws the account UI, `onAdmin`
   * runs once an admin account is signed in and synced.
   */
  constructor({ getProgress, applyProgress, onChange, onAdmin }) {
    this.getProgress = getProgress;
    this.applyProgress = applyProgress;
    this.onAdmin = onAdmin;
    this.onChange = onChange;
    this.client = null;
    this.user = null;
    this.lastSync = null;
    this.busy = false;
    this.error = "";
    this.pushTimer = null;
  }

  get enabled() {
    return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  }

  async init() {
    if (!this.enabled) return;
    try {
      const { createClient } = await import(SUPABASE_JS);
      this.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      const { data } = await this.client.auth.getSession();
      this.user = data.session?.user ?? null;
      this.client.auth.onAuthStateChange((event, session) => {
        this.user = session?.user ?? null;
        // Arrived from a password reset email: ask for a new password.
        if (event === "PASSWORD_RECOVERY") this.recovering = true;
        this.onChange();
        // Supabase calls back from inside its own lock; sync after it returns.
        if (event === "SIGNED_IN") setTimeout(() => this.settle(), 0);
      });
      this.onChange();
      if (this.user) await this.settle();
    } catch (error) {
      this.fail(error);
    }
  }

  async signUp(email, password) {
    return this.run(async () => {
      // The confirmation link in the email (if the project asks for one) brings the player back here.
      const { data, error } = await this.client.auth.signUp({ email, password, options: { emailRedirectTo: returnUrl() } });
      if (error) throw error;
      // Without a session the project wants the address confirmed first.
      return { confirm: !data.session };
    });
  }

  async signIn(email, password) {
    return this.run(async () => {
      const { error } = await this.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return {};
    });
  }

  /** What to call the player: their nickname once set, until then their email. */
  get displayName() {
    if (!this.user) return "";
    return this.user.user_metadata?.nickname || this.user.email;
  }

  /** Save a nickname to the account profile, so every device shows it. */
  async setNickname(nickname) {
    return this.run(async () => {
      const { data, error } = await this.client.auth.updateUser({ data: { nickname: nickname.trim() } });
      if (error) throw error;
      this.user = data.user;
      // Trophies on show carry the new name too.
      await this.publishTrophies(this.getProgress());
      return {};
    });
  }

  /** Email a link to set a new password. */
  async resetPassword(email) {
    return this.run(async () => {
      const { error } = await this.client.auth.resetPasswordForEmail(email, { redirectTo: returnUrl() });
      if (error) throw error;
      return {};
    });
  }

  /** Set a new password (after following a reset link, or any time while signed in). */
  async setPassword(password) {
    return this.run(async () => {
      const { error } = await this.client.auth.updateUser({ password });
      if (error) throw error;
      this.recovering = false;
      return {};
    });
  }

  async signOut() {
    return this.run(async () => {
      await this.flush();
      const { error } = await this.client.auth.signOut();
      if (error) throw error;
      this.lastSync = null;
      return {};
    });
  }

  /** Called after every local save: push it up shortly. */
  schedulePush() {
    if (!this.user) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.push(), PUSH_DELAY_MS);
  }

  /** Push a pending save right away (before signing out or leaving the page). */
  async flush() {
    if (!this.pushTimer) return;
    clearTimeout(this.pushTimer);
    this.pushTimer = null;
    await this.push();
  }

  async push() {
    this.pushTimer = null;
    if (!this.user) return;
    const progress = this.getProgress();
    // The save can change while it goes up; remember the one that was sent.
    const { savedAt } = progress;
    const { error } = await this.client.from("saves").upsert({
      user_id: this.user.id,
      progress,
      updated_at: new Date(savedAt ?? Date.now()).toISOString(),
    });
    if (error) {
      this.fail(error);
      return;
    }
    this.error = "";
    this.lastSync = Date.now();
    this.markSynced(savedAt);
    this.onChange();
    await this.publishTrophies(progress);
  }

  /** Put this player's trophies on show for everyone (each only once, refreshed under a new nickname). */
  async publishTrophies(progress) {
    if (!this.user || !progress.trophies.length) return;
    const player = this.user.user_metadata?.nickname ?? "";
    const rows = progress.trophies.map((trophy) => ({
      user_id: this.user.id,
      trophy_id: String(trophy.id),
      player,
      species: trophy.species,
      weight: trophy.weight,
      spot: LOCATIONS[trophy.spot]?.id ?? null,
      bait: trophy.bait ?? null,
      caught_at: trophy.date,
    }));
    // A missing trophies table must not get in the way of saving progress.
    const { error } = await this.client.from("trophies").upsert(rows, { onConflict: "user_id,trophy_id" });
    if (error) console.warn("Trophies were not published:", error.message);
  }

  /** The biggest trophies of other anglers, heaviest first (anyone can look, signed in or not). */
  async otherTrophies(limit = 60) {
    if (!this.client) return { error: "unavailable" };
    let query = this.client.from("trophies").select("user_id, trophy_id, player, species, weight, spot, bait, caught_at").order("weight", { ascending: false }).order("caught_at", { ascending: false }).limit(limit);
    if (this.user) query = query.neq("user_id", this.user.id);
    const { data, error } = await query;
    return error ? { error: error.message } : { trophies: data };
  }

  /** Bring the saves together, then check for an admin (after, so a gift isn't undone by the cloud's save). */
  async settle() {
    await this.reconcile();
    if (await markOwnDevice(this.client)) this.onAdmin?.();
  }

  /** The savedAt of the last save this device and the cloud both had, for this account. */
  syncedAt() {
    try {
      return Number(localStorage.getItem(SYNCED_KEY + this.user.id)) || null;
    } catch {
      return null;
    }
  }

  markSynced(savedAt) {
    try {
      if (this.user && savedAt) localStorage.setItem(SYNCED_KEY + this.user.id, String(savedAt));
    } catch {
      // Without storage the next sign-in falls back to comparing the two saves.
    }
  }

  /**
   * On signing in or opening the game: bring this device and the account to
   * the same save, without asking. If only one side moved on since they last
   * matched, that side wins. If both did (or this device never synced), the
   * one that has caught more fish wins, the newer on a tie. Progress replaced
   * by the cloud's is kept aside under BACKUP_KEY.
   */
  async reconcile() {
    if (!this.user) return;
    try {
      const { data, error } = await this.client.from("saves").select("progress").eq("user_id", this.user.id).maybeSingle();
      if (error) throw error;
      const local = this.getProgress();
      if (!data) {
        await this.push();
        return;
      }
      const remote = normalizeProgress(data.progress);
      const synced = this.syncedAt();
      let keep;
      if (remote.savedAt && remote.savedAt === local.savedAt) keep = "same";
      else if (!hasProgress(local)) keep = "remote";
      else if (!hasProgress(remote)) keep = "local";
      else if (synced && remote.savedAt === synced) keep = "local";
      else if (synced && local.savedAt === synced) keep = "remote";
      else if ((remote.caught ?? 0) !== (local.caught ?? 0)) keep = (remote.caught ?? 0) > (local.caught ?? 0) ? "remote" : "local";
      else keep = (remote.savedAt ?? 0) > (local.savedAt ?? 0) ? "remote" : "local";
      if (keep === "remote") {
        if (hasProgress(local)) {
          try {
            localStorage.setItem(BACKUP_KEY, JSON.stringify(local));
          } catch {
            // No room for a backup: the cloud's save still goes on.
          }
        }
        this.applyProgress(remote);
      }
      if (keep === "local") await this.push();
      else {
        this.markSynced(remote.savedAt);
        this.lastSync = Date.now();
        this.onChange();
      }
    } catch (error) {
      this.fail(error);
    }
  }

  async run(task) {
    if (!this.client) return { error: "unavailable" };
    this.busy = true;
    this.error = "";
    this.onChange();
    try {
      return await task();
    } catch (error) {
      this.fail(error);
      return { error: this.error };
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  fail(error) {
    this.error = error?.message ?? String(error);
    this.onChange();
  }
}
