import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./cloud-config.js";
import { hasProgress, normalizeProgress } from "./fishing/store.js";

// Loaded on demand, only when accounts are configured.
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
// Saves are batched: a burst of changes goes up once things settle.
const PUSH_DELAY_MS = 3000;
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
   * with a save from the cloud, `chooseSave({ local, remote })` asks which one
   * to keep ("local" or "remote"), `onChange` redraws the account UI.
   */
  constructor({ getProgress, applyProgress, chooseSave, onChange }) {
    this.getProgress = getProgress;
    this.applyProgress = applyProgress;
    this.chooseSave = chooseSave;
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
        if (event === "SIGNED_IN") setTimeout(() => this.reconcile(), 0);
      });
      this.onChange();
      if (this.user) await this.reconcile();
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
    const { error } = await this.client.from("saves").upsert({
      user_id: this.user.id,
      progress,
      updated_at: new Date(progress.savedAt ?? Date.now()).toISOString(),
    });
    if (error) {
      this.fail(error);
      return;
    }
    this.error = "";
    this.lastSync = Date.now();
    this.onChange();
  }

  /** On signing in: bring this device and the account to the same save. */
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
      let keep;
      if (remote.savedAt && remote.savedAt === local.savedAt) keep = "same";
      else if (!hasProgress(local)) keep = "remote";
      else if (!hasProgress(remote)) keep = "local";
      else keep = await this.chooseSave({ local, remote });
      if (keep === "remote") this.applyProgress(remote);
      if (keep === "local") await this.push();
      else {
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
