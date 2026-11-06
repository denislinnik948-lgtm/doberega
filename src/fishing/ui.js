import {
  BAITS, BOTTLE_MONEY, SPECIAL_AVATAR, EXTRAS, FISH, GROUNDBAIT, GROUNDBAITS, GULL, HOOKS, LEGENDS, LINE, LOCATIONS, RODS, fishShown, gameHoursMs, spotShown,
  baitEntries, fishPrice, formatMoney, formatWeight, handbookEntries, peakPeriod, spotEntries, trophyCost,
} from "./data.js";
import {
  AVATARS, atlasSprite, avatarSprite, bagSprite, baitSprite, clockSprite, gearSprite, rainSprite, coinSprite, cupSprite, exitSprite, extraSprite, fishSprite, groundbaitSprite, hookSprite, keepnetSprite, lineSprite, medalSprite, packSprite, rodSprite, windSprite,
} from "./sprites.js";
import { P } from "./palette.js";
import { GROUPS, bump, evaluate, shownAchievements } from "./achievements.js";
import { RANKS, XP, claimRanks, rankAt } from "./ranks.js";
import { joinWater, opensWithRank, shownSpots, spotLock } from "./waters.js";
import {
  STREAK_GIFTS, TOURNEY_PRIZES, fishOfDay, questReward, questState, streakNow, streakToday, todaysQuest, tourneyFish, tourneyState, tourneyWeek, untilNextQuest, untilWeekEnd,
} from "./quests.js";
import { frame, frameAll, repaint, setContent } from "./frames.js";
import { SEASONS, isWinter, season, setSeason } from "../theme.js";
import { validNickname } from "../cloud.js";
import { track } from "../analytics.js";
import { baitCount, saveProgress } from "./store.js";
import { setSoundEnabled, setVolume, soundEnabled, sounds, volume } from "../sound.js";

// Each achievement group's ribbon colour.
const RIBBONS = { start: P.light, collector: P.soft, weight: P.ember, skill: P.mid, time: P.bone, count: P.gold, special: P.goldDark };

// Hook sprites grow with the hook's size.
const HOOK_SCALE = { small: 2, medium: 3, large: 4 };
import {
  LANGUAGES, handbookRules, language, locale, nameOf, periodName, setLanguage, t, traitLabel, traitValue,
} from "../i18n.js";

const $ = (selector) => document.querySelector(selector);
// Ignore clicks this soon after a dialog opens, so a held key or tap that
// finished the fight can't also press a button in it.
const DIALOG_GUARD_MS = 450;

function element(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const rodArt = (id, scale) => rodSprite(RODS[id].tier, scale);

/** The account server's usual complaints in plain words; anything else as it came. */
function friendlyError(message) {
  const text = message.toLowerCase();
  if (text.includes("invalid login")) return t("account.err.credentials");
  if (text.includes("already registered") || text.includes("already been registered") || text.includes("already exists")) return t("account.err.exists");
  if (text.includes("rate limit") || text.includes("too many")) return t("account.err.rate");
  if (text.includes("fetch") || text.includes("network")) return t("account.err.network");
  if (text.includes("password") && text.includes("character")) return t("account.short");
  if (text.includes("email") && text.includes("invalid")) return t("account.needEmail");
  return t("account.error", { message });
}
// What a hook or lure lets bite and what it holds, said plainly.
const reachLines = (gear) => [
  t("tackle.takes", { what: gear.minKg ? t("tackle.from", { weight: formatWeight(gear.minKg) }) : t("tackle.any") }),
  t("tackle.holds", { what: Number.isFinite(gear.holdKg) ? t("tackle.upTo", { weight: formatWeight(gear.holdKg) }) : t("tackle.anyWeight") }),
];

const countLabel = (count) => (count === Infinity ? "∞" : `×${count}`);

/** A fish not found yet: only its shape, in shadow. */
function silhouette(sprite) {
  const ctx = sprite.getContext("2d");
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = P.mid;
  ctx.fillRect(0, 0, sprite.width, sprite.height);
  return sprite;
}
/** "lake (medium, sand, weed)" — a fishing spot's type, depth and bottom in words. */

/** DOM side of the game: main menu, HUD, loadout, toasts and dialogs. */
export class AnglerUI {
  constructor(progress, { onFish, onExit, onSpotChange, isFishing = () => false }) {
    this.progress = progress;
    this.onSpotChange = onSpotChange;
    // Whether we're at the water (groundbait can only go in there).
    this.isFishing = isFishing;
    this.busy = false;
    this.toastNode = $("#toast");
    this.fightHud = $("#fight-hud");
    this.tensionFill = $("#tension-fill");
    this.tensionMeter = $("#tension-meter");
    this.catchDialog = $("#catch-dialog");
    this.shopDialog = $("#shop-dialog");
    this.trophyDialog = $("#trophy-dialog");
    this.collectionDialog = $("#collection-dialog");
    this.keepnetDialog = $("#keepnet-dialog");
    this.packDialog = $("#pack-dialog");
    this.handbookDialog = $("#handbook-dialog");
    this.settingsDialog = $("#settings-dialog");
    this.packSlot = $("#pack-slot");
    this.baitDialog = $("#bait-dialog");
    this.baitButton = $("#bait-chip");
    // The shop's basket: how many of each ware (by its id) are in it.
    this.basket = {};
    // Which item is looked at in the backpack.
    this.packPick = null;

    frameAll();
    this.paintIcons();

    this.packSlot.addEventListener("click", () => {
      if (!this.busy) this.openPack();
    });
    this.baitButton.addEventListener("click", () => {
      if (!this.busy) this.openBait();
    });

    $("#spot-prev").addEventListener("click", () => this.shiftSpot(-1));
    $("#spot-next").addEventListener("click", () => this.shiftSpot(1));
    // At a shut water the button pays its fee (or waits for the rank) instead.
    $("#fish-button").addEventListener("click", () => {
      const lock = spotLock(this.progress, this.progress.location);
      if (!lock) onFish();
      else if (lock.price) this.joinSpot();
    });
    $("#exit-button").addEventListener("click", () => {
      if (!this.busy) onExit();
    });
    $("#shop-button").addEventListener("click", () => this.openShop());
    $("#pack-button").addEventListener("click", () => this.openPack());
    $("#trophy-button").addEventListener("click", () => this.openTrophies());
    $("#collection-button").addEventListener("click", () => this.openCollection());
    $("#keepnet-chip").addEventListener("click", () => this.openKeepnet());
    $("#settings-button").addEventListener("click", () => this.openSettings());
    // Each tile opens the page it sums up.
    $("#tile-profile").addEventListener("click", () => this.openProfile());
    $("#tile-today").addEventListener("click", () => this.openQuest());
    $("#tile-tourney").addEventListener("click", () => this.openTourney());
    for (const tab of document.querySelectorAll("#shop-dialog .tab")) {
      tab.addEventListener("click", () => this.showShopTab(tab.dataset.tab));
    }
    for (const tab of document.querySelectorAll("#trophy-dialog .tab")) {
      tab.addEventListener("click", () => this.showTrophyTab(tab.dataset.tab));
    }
    for (const tab of document.querySelectorAll("#collection-dialog .tab")) {
      tab.addEventListener("click", () => this.showCollectionTab(tab.dataset.tab));
    }
    for (const tab of document.querySelectorAll("#handbook-dialog .tab")) {
      tab.addEventListener("click", () => this.showHandbookTab(tab.dataset.tab));
    }

    this.applyLanguage();
  }

  /** The fixed pixel icons; drawn again when the style's palette changes. */
  paintIcons() {
    const icon = (selector, sprite) => {
      const node = $(selector);
      node.querySelector(":scope > canvas.sprite")?.remove();
      node.append(sprite);
    };
    document.querySelectorAll(".coin-slot").forEach((slot) => slot.replaceChildren(coinSprite(3)));
    $("#groundbait-icon").replaceChildren(groundbaitSprite(2));
    $("#shop-icon").replaceChildren(bagSprite(3));
    $("#pack-icon").replaceChildren(packSprite(3));
    $("#trophy-icon").replaceChildren(cupSprite(3));
    $("#collection-icon").replaceChildren(atlasSprite(3));
    icon("#exit-button", exitSprite(3));
    $("#keepnet-chip-sprite").replaceChildren(keepnetSprite(3));
    $("#settings-icon").replaceChildren(gearSprite(3));
    $("#pack-slot-sprite").replaceChildren(packSprite(3));
    $("#pack-hook-sprite").replaceChildren(hookSprite(2));
    this.clockNight = null;
  }

  /** Put every fixed text and label in the current language, then redraw the rest. */
  applyLanguage() {
    document.documentElement.lang = language();
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      const text = t(node.dataset.i18n);
      // Framed elements keep their painted frame canvas.
      if (node.classList.contains("framed")) setContent(node, text);
      else node.textContent = text;
    });
    document.querySelectorAll("[data-i18n-aria]").forEach((node) => node.setAttribute("aria-label", t(node.dataset.i18nAria)));
    document.querySelectorAll("[data-i18n-title]").forEach((node) => node.setAttribute("title", t(node.dataset.i18nTitle)));
    document.querySelectorAll("[data-i18n-roledescription]").forEach((node) => node.setAttribute("aria-roledescription", t(node.dataset.i18nRoledescription)));
    this.labelBackButtons();
    // The account form is rebuilt in the new language.
    $("#account-body")?.replaceChildren();
    this.renderAccount?.();
    this.renderSpot();
    this.render();
  }

  openSettings() {
    const options = $("#language-options");
    options.replaceChildren(...LANGUAGES.map(({ id, label }) => element("button", {
      className: `pixel-btn tab${id === language() ? " is-active" : ""}`,
      type: "button",
      role: "radio",
      ariaChecked: String(id === language()),
      lang: id,
      textContent: label,
      onclick: () => {
        setLanguage(id);
        this.applyLanguage();
        this.openSettings();
      },
    })));
    $("#season-options").replaceChildren(...SEASONS.map((id) => element("button", {
      className: `pixel-btn tab${id === season() ? " is-active" : ""}`,
      type: "button",
      role: "radio",
      ariaChecked: String(id === season()),
      textContent: t(`season.${id}`),
      onclick: () => {
        setSeason(id);
        this.openSettings();
      },
    })));
    $("#season-hint").textContent = t(`season.${season()}Hint`);
    // Sound: off until switched on here.
    $("#sound-options").replaceChildren(...[true, false].map((on) => element("button", {
      className: `pixel-btn tab${on === soundEnabled() ? " is-active" : ""}`,
      type: "button",
      role: "radio",
      ariaChecked: String(on === soundEnabled()),
      textContent: t(on ? "sound.on" : "sound.off"),
      onclick: () => {
        setSoundEnabled(on);
        this.openSettings();
      },
    })));
    // Two volume sliders, effects and music: live as you drag, remembered; faded while sound is off.
    for (const kind of ["fx", "music"]) {
      const slider = $(`#volume-${kind}`);
      const shown = $(`#volume-${kind}-value`);
      slider.value = String(Math.round(volume(kind) * 100));
      shown.textContent = `${slider.value}%`;
      slider.disabled = !soundEnabled();
      slider.oninput = () => {
        setVolume(kind, Number(slider.value) / 100);
        shown.textContent = `${slider.value}%`;
      };
      // A tap to hear the new level of the effects.
      if (kind === "fx") slider.onchange = () => sounds.ui("select");
    }
    if (!this.settingsDialog.open) this.settingsDialog.showModal();
  }

  /* ---------- Account ---------- */

  /** Hook up cloud saves; the account section redraws whenever its state changes. */
  setCloud(cloud) {
    this.cloud = cloud;
    this.renderAccount();
    this.tilesKey = null;
    this.renderTiles();
  }

  /** The account lives on the profile page. */
  openAccount() {
    this.openProfile();
  }

  /** The menu line under the buttons: where progress lives, and the way to sign in. */
  /** The profile tile's name: the nickname once signed in, until then a way in. */
  renderProfileName() {
    const cloud = this.cloud;
    const signedIn = Boolean(cloud?.user);
    $("#tile-profile-name").textContent = signedIn ? cloud.displayName : t(cloud?.enabled ? "account.login" : "account.title");
    $("#tile-profile").classList.toggle("is-safe", signedIn);
  }


  /** After the very first fish, offer once to sign in, warning what skipping means. */
  offerSignIn() {
    const cloud = this.cloud;
    const KEY = "stillwater.signInOffered";
    let offered = false;
    try {
      offered = localStorage.getItem(KEY) === "1";
      localStorage.setItem(KEY, "1");
    } catch {
      // Without storage the offer may simply come again next time.
    }
    if (offered || !cloud?.enabled || cloud.user) return;
    const dialog = $("#save-prompt");
    $("#save-prompt-login").onclick = () => {
      dialog.close();
      this.openAccount();
    };
    $("#save-prompt-skip").onclick = () => dialog.close();
    dialog.showModal();
  }

  renderAccount() {
    this.renderProfileName();
    const body = $("#account-body");
    const cloud = this.cloud;
    const mode = !cloud?.enabled ? "off" : !cloud.user ? "out" : cloud.recovering ? "recover" : "in";
    // Rebuild only when the kind of view (or the sign-in tab) changes, so typing isn't lost on redraws.
    const view = mode === "out" ? `out:${this.accountTab ?? "signIn"}` : mode;
    if (body.dataset.mode !== view || !body.firstChild) {
      body.dataset.mode = view;
      this.accountMessage = null;
      body.replaceChildren(...this.buildAccount(mode));
    }
    this.updateAccount(mode);
    // Back from a password reset email: the new-password form comes straight up.
    if (mode === "recover" && !$("#account-body").closest("dialog").open) this.openAccount();
  }

  /**
   * The account view's elements for one mode: off, out (tabs to sign in or
   * create an account, or a "forgot password" screen), recover (set a new
   * password) or in (the profile).
   */
  buildAccount(mode) {
    const cloud = this.cloud;
    const tab = this.accountTab ?? "signIn";
    const note = (text, className = "account-note") => element("p", { className, textContent: text });
    const message = () => element("p", { className: "account-message", role: "status" });
    const submitButton = (key) => element("button", { className: "pixel-btn pixel-btn-primary account-submit", type: "submit", textContent: t(key) });
    const say = (text, bad = false) => {
      this.accountMessage = { text, bad };
      this.renderAccount();
    };
    // A field with its label above it (it stays while typing); passwords can be shown.
    const field = (label, props, hint = "") => {
      const input = element("input", { className: "text-input", id: `account-${props.name}`, spellcheck: false, ...props });
      const row = [input];
      if (props.type === "password") {
        const reveal = element("button", { className: "reveal-btn", type: "button", textContent: t("account.show") });
        reveal.setAttribute("aria-pressed", "false");
        reveal.onclick = () => {
          const shown = input.type === "text";
          input.type = shown ? "password" : "text";
          reveal.textContent = t(shown ? "account.show" : "account.hide");
          reveal.setAttribute("aria-pressed", String(!shown));
          input.focus();
        };
        row.push(reveal);
      }
      const node = element("div", { className: "field" }, [
        element("label", { className: "field-label", htmlFor: input.id, textContent: label }),
        element("div", { className: "field-row" }, row),
        hint ? element("small", { className: "field-hint", textContent: hint }) : "",
      ]);
      return { node, input };
    };
    const longEnough = (password) => {
      if (password.input.value.length >= 6) return true;
      say(t("account.short"), true);
      password.input.focus();
      return false;
    };

    if (mode === "off") return [note(t("account.unavailable"))];

    if (mode === "out") {
      const switchTo = (next) => {
        this.accountTab = next;
        this.accountMessage = null;
        cloud.error = "";
        this.renderAccount();
        $("#account-body .text-input")?.focus();
      };
      // The email typed on one tab carries over to the others.
      const email = field(t("account.email"), { type: "email", name: "email", autocomplete: "email", inputMode: "email", autocapitalize: "off", value: this.accountEmail ?? "" });
      email.input.addEventListener("input", () => { this.accountEmail = email.input.value; });
      const emailOk = () => {
        if (/^\S+@\S+\.\S+$/.test(email.input.value.trim())) return true;
        say(t("account.needEmail"), true);
        email.input.focus();
        return false;
      };

      if (tab === "forgot") {
        return [element("form", { className: "account-form", noValidate: true, onsubmit: async (event) => {
          event.preventDefault();
          if (!emailOk()) return;
          const result = await cloud.resetPassword(email.input.value.trim());
          if (!result?.error) say(t("account.resetSent", { email: email.input.value.trim() }));
        } }, [
          note(t("account.forgotIntro")),
          email.node,
          submitButton("account.sendLink"),
          message(),
          element("button", { className: "link-btn", type: "button", textContent: t("account.back"), onclick: () => switchTo("signIn") }),
        ])];
      }

      const signUp = tab === "signUp";
      const password = field(t("account.password"), { type: "password", name: "password", autocomplete: signUp ? "new-password" : "current-password" }, signUp ? t("account.passwordHint") : "");
      const nickname = signUp ? field(t("account.nicknameOptional"), { type: "text", name: "nickname", autocomplete: "nickname", maxLength: 16 }, t("account.nicknameHint")) : null;
      const tabs = element("div", { className: "tabs account-tabs", role: "tablist" }, ["signIn", "signUp"].map((id) => {
        const button = element("button", { className: `pixel-btn tab${tab === id ? " is-active" : ""}`, type: "button", role: "tab", textContent: t(id === "signIn" ? "account.tabSignIn" : "account.tabSignUp"), onclick: () => switchTo(id) });
        button.setAttribute("aria-selected", String(tab === id));
        return button;
      }));
      return [
        tabs,
        element("form", { className: "account-form", noValidate: true, onsubmit: async (event) => {
          event.preventDefault();
          if (!emailOk() || !longEnough(password)) return;
          const nick = nickname ? nickname.input.value.trim() : "";
          if (nick && !validNickname(nick)) {
            say(t("account.nickRules"), true);
            nickname.input.focus();
            return;
          }
          this.accountMessage = null;
          const result = await cloud[signUp ? "signUp" : "signIn"](email.input.value.trim(), password.input.value);
          if (result?.error) return;
          if (signUp) track("signup");
          if (result?.confirm) {
            say(t("account.checkEmail"));
            return;
          }
          if (nick) await cloud.setNickname(nick);
          this.accountTab = "signIn";
          this.accountMessage = { text: t(signUp ? "account.created" : "account.welcome") };
          this.renderAccount();
        } }, [
          note(t(signUp ? "account.signUpIntro" : "account.signInIntro")),
          email.node,
          password.node,
          nickname ? nickname.node : "",
          submitButton(signUp ? "account.signUp" : "account.signIn"),
          message(),
          signUp ? "" : element("button", { className: "link-btn", type: "button", textContent: t("account.forgot"), onclick: () => switchTo("forgot") }),
        ]),
      ];
    }

    if (mode === "recover") {
      const password = field(t("account.newPassword"), { type: "password", name: "new-password", autocomplete: "new-password" }, t("account.passwordHint"));
      return [element("form", { className: "account-form", noValidate: true, onsubmit: async (event) => {
        event.preventDefault();
        if (!longEnough(password)) return;
        const result = await cloud.setPassword(password.input.value);
        if (!result?.error) say(t("account.passwordSaved"));
      } }, [
        note(t("account.recoverIntro")),
        password.node,
        submitButton("account.setPassword"),
        message(),
      ])];
    }

    // Signed in: who you are and whether progress is safe, a nickname with its
    // own Save button that says when it's saved, then Done and Sign out.
    const savedNickname = () => cloud.user?.user_metadata?.nickname ?? "";
    const nickname = field(t("account.nickname"), { type: "text", name: "nickname", autocomplete: "nickname", maxLength: 16, enterKeyHint: "done", value: savedNickname() }, t("account.nicknameHint"));
    const save = element("button", { className: "pixel-btn account-nick-save", type: "submit" });
    nickname.node.querySelector(".field-row").append(save);
    // Save is live only while the field differs from what's stored; otherwise it reads "Saved".
    this.syncNicknameButton = () => {
      const dirty = nickname.input.value.trim() !== savedNickname();
      save.disabled = cloud.busy || !dirty;
      // "Saved" only once there is a nickname to have saved.
      const saved = !dirty && Boolean(savedNickname());
      save.textContent = saved ? t("account.saved") : t("account.save");
      save.classList.toggle("is-saved", saved);
    };
    nickname.input.addEventListener("input", () => {
      if (this.accountMessage) {
        this.accountMessage = null;
        this.updateAccount("in");
      }
      this.syncNicknameButton();
    });
    const saveNickname = async () => {
      const value = nickname.input.value.trim();
      if (value === savedNickname() || cloud.busy) return;
      if (!validNickname(value)) {
        say(t("account.nickRules"), true);
        nickname.input.focus();
        return;
      }
      const result = await cloud.setNickname(value);
      if (!result?.error) say(t("account.nicknameSaved"));
    };
    return [
      element("div", { className: "account-profile" }, [
        element("span", { className: "account-avatar" }),
        element("div", { className: "account-who" }, [note("", "account-name"), note("", "account-email")]),
      ]),
      element("p", { className: "account-status" }),
      element("form", { className: "account-form", noValidate: true, onsubmit: (event) => {
        event.preventDefault();
        saveNickname();
      } }, [nickname.node, message()]),
      element("div", { className: "account-actions" }, [
        element("button", { className: "pixel-btn pixel-btn-primary", type: "button", textContent: t("account.done"), onclick: () => $("#profile-dialog").close() }),
        element("button", { className: "pixel-btn account-signout", type: "button", textContent: t("account.signOut"), onclick: () => cloud.signOut() }),
      ]),
    ];
  }

  /** Refresh the parts of the account view that change: names, sync state, busy state, messages. */
  updateAccount(mode) {
    const cloud = this.cloud;
    const body = $("#account-body");
    if (mode === "off") return;
    for (const button of body.querySelectorAll("button")) button.disabled = cloud.busy;
    if (mode === "in") this.syncNicknameButton?.();
    // The main button says it is working instead of a separate line.
    const submit = body.querySelector(".account-submit");
    if (submit) {
      submit.dataset.label ??= submit.textContent;
      submit.textContent = cloud.busy ? t("account.working") : submit.dataset.label;
    }
    if (mode === "in") {
      const nickname = cloud.user.user_metadata?.nickname ?? "";
      const time = cloud.lastSync && new Date(cloud.lastSync).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
      body.querySelector(".account-avatar").textContent = (cloud.displayName[0] ?? "?").toLocaleUpperCase(locale());
      body.querySelector(".account-name").textContent = cloud.displayName;
      const email = body.querySelector(".account-email");
      email.textContent = cloud.user.email;
      email.hidden = !nickname;
      const status = body.querySelector(".account-status");
      status.textContent = cloud.busy ? t("account.syncing") : time ? t("account.synced", { time }) : t("account.notSynced");
      status.classList.toggle("is-synced", Boolean(time) && !cloud.busy);
    }
    const message = body.querySelector(".account-message");
    const failure = cloud.error && { text: friendlyError(cloud.error), bad: true };
    const shown = failure || this.accountMessage;
    message.textContent = shown?.text ?? "";
    message.classList.toggle("is-bad", Boolean(shown?.bad));
  }

  /** Save and redraw; any achievement newly earned is paid out and announced first. */
  commit() {
    const earned = evaluate(this.progress);
    const promoted = claimRanks(this.progress);
    saveProgress(this.progress);
    this.render();
    if (earned.length) this.announceAchievements(earned);
    if (promoted) this.rankUp(promoted);
  }

  /** A new rank (or several at once): its name and the gifts, already given. */
  rankUp({ rank, from, money, groundbait }) {
    const gifts = [money ? `+${formatMoney(money)}` : "", groundbait ? `${t("shop.groundbait")} ×${groundbait}` : ""].filter(Boolean).join(" · ");
    this.notify(`${t("rank.up", { rank: this.rankName(rank) })}${gifts ? ` · ${gifts}` : ""}`);
    // A rank that opens a water says so too, in the note after.
    const opened = opensWithRank(from, rank);
    if (opened.length) this.notify(t(opened.length > 1 ? "water.openedMany" : "water.opened", { names: opened.map((spot) => nameOf("location", spot.id)).join(", ") }));
    this.renderProfileName();
  }

  rankName(rank) {
    return t(`rank.${RANKS[rank]?.id ?? "novice"}`);
  }

  /**
   * A quiet note at the top for each achievement earned, one after another,
   * held back while a dialog is open so it isn't hidden behind it.
   */
  announceAchievements(earned) {
    this.achievementQueue = [...(this.achievementQueue ?? []), ...earned];
    if (this.achievementShowing) return;
    const node = $("#achievement-toast");
    const next = () => {
      if (!this.achievementQueue.length) {
        this.achievementShowing = false;
        return;
      }
      if (document.querySelector("dialog[open]")) {
        this.achievementTimer = setTimeout(next, 500);
        return;
      }
      const achievement = this.achievementQueue.shift();
      setContent(
        node,
        element("span", { className: "achievement-toast-art" }, [medalSprite(2, RIBBONS[achievement.group])]),
        element("span", { className: "achievement-toast-text" }, [
          element("small", { textContent: t("achievements.earned") }),
          element("strong", { textContent: t(`achievements.${achievement.id}.name`) }),
        ]),
        element("span", { className: "achievement-toast-reward", textContent: `+${formatMoney(achievement.reward)}` }),
      );
      node.hidden = false;
      node.style.animation = "none";
      void node.offsetWidth;
      node.style.animation = "";
      sounds.coin();
      this.achievementTimer = setTimeout(() => {
        node.hidden = true;
        this.achievementTimer = setTimeout(next, 400);
      }, 3400);
    };
    this.achievementShowing = true;
    next();
  }

  get baitCount() {
    return baitCount(this.progress, this.progress.bait);
  }

  /** Lock gear changes and leaving while a line is in the water. */
  setBusy(busy) {
    this.busy = busy;
    this.packSlot.disabled = busy;
    this.baitButton.disabled = busy;
    $("#exit-button").disabled = busy;
  }

  render() {
    const { progress } = this;
    const rod = RODS[progress.rod];
    document.querySelectorAll(".money-value").forEach((node) => {
      node.textContent = progress.money.toLocaleString(locale());
    });
    // The rank's number on the Collection button.

    // The bait in use, bottom left; tapping it opens the bait picker.
    const chip = this.baitButton;
    $("#bait-chip-sprite").replaceChildren(baitSprite(progress.bait, 3));
    $("#bait-chip-count").textContent = countLabel(this.baitCount);
    chip.classList.toggle("is-empty", this.baitCount <= 0);
    chip.setAttribute("aria-label", `${t("a11y.chooseBait")}: ${nameOf("bait", progress.bait)}, ${countLabel(this.baitCount)}`);
    this.packSlot.setAttribute("aria-label", `${t("menu.pack")}: ${nameOf("rod", progress.rod)}, ${t("shop.upTo", { weight: formatWeight(rod.maxKg) })}`);

    // The keepnet chip, bottom left: how many fish are in it (hidden while empty).
    const netCount = progress.keepnet.length;
    $("#keepnet-chip").hidden = netCount === 0;
    $("#keepnet-chip-count").textContent = `×${netCount}`;
    $("#keepnet-chip").setAttribute("aria-label", `${t("a11y.keepnet")}: ${netCount}`);

    this.renderTiles();
    this.renderSpotLock();

    // The hook size in use and how many are left.
    const hooksLeft = progress.hooks[progress.hook] ?? 0;
    $("#pack-hook-sprite").replaceChildren(hookSprite(2));
    $("#pack-hook-count").textContent = `×${hooksLeft}`;
    $("#pack-hook-count").closest(".chip").classList.toggle("is-empty", hooksLeft <= 0);
  }

  /* ---------- Tiled menu ---------- */

  /** The tiled menu (on for everyone): the menu's windows as pages, the account and the ranks on the profile page. */
  /** Draw the tiles again from scratch (signing in or out changes the tournament tile too). */
  refreshTiles() {
    this.tileBoard = null;
    this.tilesKey = null;
    this.renderTiles();
  }


  /**
   * A page's first opening is slow: the browser works out the look of all it
   * holds for the first time. While the player looks at the menu, each page is
   * opened once out of sight, one in each idle moment, so the real first
   * opening is as quick as any after it. Only in the menu with nothing open,
   * and never the tournament (it would ask the server for its board).
   */
  warmPages() {
    const idle = window.requestIdleCallback ?? ((callback) => setTimeout(callback, 200));
    const pages = [
      () => this.openQuest(),
      () => this.openProfile(),
      () => this.openCollection(),
      () => {
        this.collectionDialog.showModal();
        this.showCollectionTab("achievements");
      },
      () => this.openShop(),
      () => this.openPack(),
      () => this.openTrophies(),
      () => this.openSettings(),
      () => $("#tourney-dialog").showModal(),
    ];
    const next = () => {
      if (!pages.length) return;
      if (this.isFishing() || document.querySelector("dialog[open]")) return void setTimeout(() => idle(next), 2000);
      const focused = document.activeElement;
      document.body.classList.add("warming");
      try {
        pages.shift()();
        void document.body.offsetHeight;
      } finally {
        document.querySelectorAll("dialog[open]").forEach((dialog) => dialog.close());
        focused?.focus?.({ preventScroll: true });
        // Off only after the dialogs' sound watcher has seen (and ignored) the opening and closing.
        setTimeout(() => document.body.classList.remove("warming"), 0);
      }
      idle(next);
    };
    idle(next);
  }

  /** Every window of the menu is a page: its ✕ says "Back" instead. */
  labelBackButtons() {
    document.querySelectorAll("dialog.page .sheet-heading form button").forEach((button) => {
      button.textContent = `← ${t("nav.back")}`;
      button.classList.remove("pixel-btn-square");
      button.classList.add("back-btn");
    });
  }


  /** The player's page: the account up top, the level and every rank under it. */
  openProfile() {
    this.renderAccount();
    this.fillRanks();
    this.fillAvatars();
    const dialog = $("#profile-dialog");
    if (!dialog.open) dialog.showModal();
  }

  /** The anglers to pick a picture from; the one picked has gold corners and shows on the profile tile. */
  fillAvatars() {
    // The author's own picture comes first, and only on an admin's account.
    const ids = [...(this.cloud?.admin ? [SPECIAL_AVATAR] : []), ...AVATARS.keys()];
    $("#avatar-grid").classList.toggle("has-own", ids[0] === SPECIAL_AVATAR);
    $("#avatar-grid").replaceChildren(...ids.map((id) => element("button", {
      className: `avatar-pick${id === this.progress.avatar ? " is-picked" : ""}${id === SPECIAL_AVATAR ? " is-own" : ""}`,
      type: "button",
      role: "radio",
      ariaChecked: String(id === this.progress.avatar),
      ariaLabel: id === SPECIAL_AVATAR ? t("profile.avatarOwn") : t("profile.avatarN", { number: id + 1 }),
      onclick: () => {
        if (id === this.progress.avatar) return;
        this.progress.avatar = id;
        sounds.ui("select");
        this.commit();
        this.fillAvatars();
      },
    }, [avatarSprite(id, 4)])));
  }

  /** The tournament's own page: the week's fish, the prizes and the board. */
  openTourney() {
    const dialog = $("#tourney-dialog");
    // Up top a card: the week's fish, the time left, your best, and the prizes.
    const week = tourneyWeek();
    const species = tourneyFish(week);
    const best = tourneyState(this.progress, week).best;
    const reward = questReward(this.progress);
    const fact = (label, value) => element("div", {}, [element("dt", { textContent: label }), element("dd", { textContent: value })]);
    const card = element("div", { className: "tourney-card" }, [
      element("span", { className: "tourney-fish" }, [fishSprite(species, 4, nameOf("fish", species))]),
      element("div", { className: "tourney-goal" }, [
        element("small", { textContent: t("tourney.heaviest") }),
        element("strong", { textContent: nameOf("fish", species) }),
        element("dl", {}, [
          fact(t("tourney.endsIn"), this.weekLeft()),
          fact(t("tourney.yours"), best ? formatWeight(best) : t("tourney.none")),
          fact(t("tourney.prizes"), TOURNEY_PRIZES.map((share) => formatMoney(Math.round(reward * share))).join(" / ")),
          fact(t("tourney.everyone"), t("tourney.gift")),
        ]),
      ]),
    ]);
    frame(card, "box", 1401);
    $("#tourney-page-head").replaceChildren(card);
    this.fillTourney({ board: $("#tourney-page-board"), empty: $("#tourney-page-empty"), shown: () => dialog.open });
    if (!dialog.open) dialog.showModal();
  }

  /** What each tile says: who is playing, today's things and the tournament (the sections along the bottom are only their names). */
  renderTiles() {
    const { progress } = this;
    const quest = todaysQuest();
    const state = questState(progress, quest);
    const week = tourneyWeek();
    const species = tourneyFish(week);
    const best = tourneyState(progress, week).best;
    const xp = Math.floor(progress.xp ?? 0);
    const key = [quest.day, state.value, state.done, streakNow(progress), streakToday(progress), week, best, xp, progress.avatar, language()].join(":");
    if (key === this.tilesKey) return;
    this.tilesKey = key;

    $("#tile-quest-count").textContent = state.done ? t("quest.doneShort") : this.questCount(quest, state);
    $("#tile-quest-goal").textContent = this.questGoal(quest);

    const dayFish = fishOfDay(quest.day);
    $("#tile-day-art").replaceChildren(fishSprite(dayFish, 3));
    $("#tile-day-text").textContent = t("level.dayFish", { fish: nameOf("fish", dayFish) });

    // Days in a row: the run, and where it stands in the week's round of gifts.
    const run = streakNow(progress);
    const lit = run ? ((run - 1) % STREAK_GIFTS.length) + 1 : 0;
    $("#tile-streak-count").textContent = t("level.days", { count: run });
    $("#tile-streak-days").replaceChildren(...STREAK_GIFTS.map((_, index) => element("span", { className: index < lit ? "" : "is-off", textContent: index < lit ? "■" : "□" })));

    // The player: their picture, name (from the account strip's drawing), rank and level, and how far to the next.
    $("#tile-avatar").replaceChildren(avatarSprite(progress.avatar, 5));
    const rank = rankAt(xp);
    const next = RANKS[rank + 1];
    const from = RANKS[rank].xp;
    $("#tile-profile-rank").textContent = t("level.rank", { rank: this.rankName(rank), number: rank + 1 });
    $("#tile-level-fill").style.width = `${(next ? (xp - from) / (next.xp - from) : 1) * 100}%`;
    $("#tile-level-next").textContent = next ? t("level.toNext", { xp: (next.xp - xp).toLocaleString(locale()) }) : t("level.top");

    this.renderTourneyTile(week, species, best);
  }

  /** The tournament tile: the week's fish, the top three, and this angler's best. */
  renderTourneyTile(week, species, best) {
    // A cell for the week's fish, the time left and your best; then one for each of the top three.
    $("#tile-tourney-fish").replaceChildren(
      element("span", { className: "tourney-cell-art" }, [fishSprite(species, 2)]),
      element("strong", { textContent: nameOf("fish", species) }),
      element("span", { className: "tile-note", textContent: this.weekLeft() }),
      element("span", { className: "tile-note", textContent: best > 0 ? t("level.yourBest", { weight: formatWeight(best) }) : t("level.noBest") }),
    );
    const board = $("#tile-tourney-board");
    const podium = (rows = []) => board.replaceChildren(...[0, 1, 2].map((index) => {
      const entry = rows[index];
      if (!entry) {
        return element("li", { className: "tourney-cell is-free" }, [
          element("span", { className: "podium-place", textContent: String(index + 1) }),
          element("span", { className: "tile-note", textContent: t("level.freePlace") }),
        ]);
      }
      // Ties share a place, as the prizes do: the place is one more than how many weighed more.
      const place = rows.findIndex((row) => row.weight === entry.weight) + 1;
      return element("li", { className: `tourney-cell is-place-${place}${entry.user_id === this.cloud?.user?.id ? " is-me" : ""}` }, [
        element("span", { className: "podium-place", textContent: String(place) }),
        element("span", { className: "podium-avatar" }, [avatarSprite(entry.avatar ?? 0, 2)]),
        element("span", { className: "podium-name", textContent: entry.player || t("trophies.anonymous") }),
        element("span", { className: "podium-weight", textContent: formatWeight(entry.weight) }),
      ]);
    }));
    const cloud = this.cloud;
    if (!cloud?.enabled) return podium();
    if (!board.children.length) podium();
    // The board is asked again at most once a minute.
    if (this.tileBoard?.week === week && Date.now() - this.tileBoard.at < 60000) return;
    this.tileBoard = { week, at: Date.now() };
    cloud.tournamentBoard(week, species, 3).then((result) => {
      if (result.error || this.tileBoard?.week !== week) return;
      podium(result.rows);
    });
  }


  /* ---------- Daily quest ---------- */

  /** What today's quest asks, in words. */
  questGoal(quest) {
    const fish = quest.fish ? nameOf("fish", quest.fish).toLocaleLowerCase(locale()) : "";
    if (quest.kind === "count") return t("quest.count", { fish, count: quest.target });
    if (quest.kind === "heavy") return t("quest.heavy", { fish, weight: formatWeight(quest.weight) });
    if (quest.kind === "spot") return t("quest.spot", { spot: nameOf("location", quest.spot), count: quest.target });
    if (quest.kind === "total") return t("quest.total", { weight: formatWeight(quest.target) });
    return t("quest.kinds", { count: quest.target });
  }

  /** "2/5", or for a weight "3.2/8 kg". */
  questCount(quest, state) {
    if (quest.kind === "total") return `${Number(Math.min(state.value, quest.target).toFixed(1))}/${formatWeight(quest.target)}`;
    return `${Math.min(state.value, quest.target)}/${quest.target}`;
  }



  /** Today's quest done: the reward is already paid; say so once the catch card is closed. */
  questDone({ reward }) {
    this.renderTiles();
    this.notify(t("quest.toast", { reward: formatMoney(reward) }));
  }

  /** The first fish of the day: it counts towards the run, and its gift is already given. */
  dayCounted({ count, gift }) {
    this.renderTiles();
    this.notify(t("streak.toast", { count, gift: this.giftText(gift) }));
  }

  /** A new best of the week's tournament; without an account it stays off the board. */
  tourneyBest({ weight }, signedIn) {
    this.notify(`${t("tourney.newBest", { weight: formatWeight(weight) })}${signedIn ? "" : ` · ${t("tourney.signIn")}`}`);
  }

  /** Last week's tournament settled: a prize for the top three, a gift for taking part. */
  tourneyPrize({ place, money, gift }) {
    const present = this.giftText(gift);
    this.notify(money ? t("tourney.prize", { place, money: formatMoney(money), gift: present }) : t("tourney.thanks", { place, gift: present }));
  }

  /** "3 d 4 h" until the tournament week ends. */
  weekLeft() {
    const left = untilWeekEnd();
    return t("tourney.left", { days: Math.floor(left / 86400000), hours: Math.floor((left % 86400000) / 3600000) });
  }

  /** Good news with a coin's ring, once no dialog is open, one after another. */
  notify(text) {
    this.notes = [...(this.notes ?? []), text];
    if (this.notesBusy) return;
    this.notesBusy = true;
    const next = () => {
      if (!this.notes.length) {
        this.notesBusy = false;
        return;
      }
      if (document.querySelector("dialog[open]")) {
        setTimeout(next, 400);
        return;
      }
      sounds.coin();
      this.toast(this.notes.shift(), "good", 3200);
      setTimeout(next, 3400);
    };
    // The catch card opens right after the news comes in: wait for it.
    setTimeout(next, 50);
  }

  /** A day's gift in words ("Worm ×10", "250 $"); money is a share of the quest reward until paid. */
  giftText(gift) {
    if (gift.money) return formatMoney(gift.paid ?? Math.round(questReward(this.progress) * gift.money));
    if (gift.bait) return `${nameOf("bait", gift.bait)} ×${gift.count}`;
    if (gift.hook) return `${nameOf("hook", gift.hook)} ×${gift.count}`;
    if (gift.groundbait) return `${t("shop.groundbait")} ×${gift.groundbait}`;
    return `${t("line.spare")} ×${gift.lines}`;
  }

  giftSprite(gift) {
    if (gift.money) return coinSprite(2);
    if (gift.bait) return baitSprite(gift.bait, 2);
    if (gift.hook) return hookSprite(2);
    if (gift.groundbait) return groundbaitSprite(2);
    return lineSprite(2);
  }

  /** The quest window: what it asks, how far along, the reward, and when the next one comes. */
  openQuest() {
    const quest = todaysQuest();
    const state = questState(this.progress, quest);
    const dialog = $("#quest-dialog");
    $("#quest-goal").textContent = this.questGoal(quest);
    $("#quest-fill").style.width = `${Math.min(100, (state.value / quest.target) * 100)}%`;
    $("#quest-status").textContent = state.done
      ? t("quest.done", { time: new Date(state.done).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })
      : t("quest.progress", { count: this.questCount(quest, state), reward: formatMoney(questReward(this.progress)) });
    const dayFish = fishOfDay(quest.day);
    $("#day-fish-big").replaceChildren(fishSprite(dayFish, 2, nameOf("fish", dayFish)));
    $("#day-fish-about").textContent = t("dayFish.about", { fish: nameOf("fish", dayFish).toLocaleLowerCase(locale()) });
    // The run: this week's round of gifts, the days done ticked and the next one marked.
    const run = streakNow(this.progress);
    const counted = streakToday(this.progress);
    $("#streak-about").textContent = counted ? t("streak.counted", { count: run }) : run ? t("streak.keep", { count: run }) : t("streak.start");
    const from = Math.floor(((counted ? run : run + 1) - 1) / STREAK_GIFTS.length) * STREAK_GIFTS.length;
    $("#streak-days").replaceChildren(...STREAK_GIFTS.map((gift, index) => {
      const day = from + index + 1;
      const state = day <= run ? " is-done" : day === run + 1 ? " is-next" : "";
      return element("li", { className: `streak-day${state}` }, [
        element("small", { textContent: t("streak.day", { day }) }),
        element("span", { className: "streak-art" }, [this.giftSprite(gift)]),
        element("span", { textContent: gift.money ? this.giftText(gift) : `×${gift.count ?? gift.groundbait ?? gift.lines}` }),
      ]);
    }));
    const left = untilNextQuest();
    $("#quest-next").textContent = t("quest.next", { hours: Math.floor(left / 3600000), minutes: Math.floor((left % 3600000) / 60000) });
    if (!dialog.open) dialog.showModal();
  }

  /** A rain cloud beside the clock while it's raining (snow in winter), and gusts while the wind blows. */
  setWeather(rain, wind = 0) {
    // A little slack each way, so a value hovering at the line doesn't redraw the icons every frame.
    const was = this.weatherLook?.split(":") ?? [];
    const raining = rain > (was[0] === "true" ? 0.2 : 0.25);
    const windy = wind > (was[1] === "true" ? 0.4 : 0.45);
    const look = `${raining}:${windy}:${isWinter()}`;
    if (look === this.weatherLook) return;
    this.weatherLook = look;
    document.querySelectorAll(".weather-icon").forEach((node) => {
      node.replaceChildren(...(raining ? [rainSprite(3, isWinter())] : []), ...(windy ? [windSprite(3)] : []));
      node.hidden = !raining && !windy;
      node.title = [raining ? t(isWinter() ? "weather.snow" : "weather.rain") : "", windy ? t(wind > 0.7 ? "weather.strongWind" : "weather.wind") : ""].filter(Boolean).join(", ");
    });
  }

  /** In-game clock, e.g. "05:40", with a sun beside it, or at night the moon in its phase. */
  setClock(dayTime, moon = null) {
    const minutes = Math.floor(dayTime * 24 * 60) % (24 * 60);
    const shown = minutes - (minutes % 10);
    if (shown === this.clockMinutes) return;
    this.clockMinutes = shown;
    // A new day brings a new quest (and the tournament's time left moves on).
    this.renderTiles();
    const text = `${String(Math.floor(shown / 60)).padStart(2, "0")}:${String(shown % 60).padStart(2, "0")}`;
    const night = shown < 5 * 60 || shown >= 21 * 60;
    document.querySelectorAll(".clock-value").forEach((node) => { node.textContent = text; });
    const look = night ? `moon:${moon?.id}` : "sun";
    if (look !== this.clockNight) {
      this.clockNight = look;
      const label = moon ? t("moon.label", { phase: t(`moon.${moon.id}`) }) : "";
      document.querySelectorAll(".clock-icon").forEach((node) => {
        node.replaceChildren(clockSprite(night, 3, moon));
        node.title = label;
      });
    }
  }

  /* ---------- Main menu ---------- */

  shiftSpot(step) {
    // Only through the waters this angler sees.
    const shown = shownSpots();
    const count = shown.length;
    const at = Math.max(0, shown.indexOf(this.progress.location));
    this.joinConfirm = null;
    this.progress.location = shown[(at + step + count) % count];
    saveProgress(this.progress);
    this.renderSpot();
    this.onSpotChange?.();
  }

  renderSpot() {
    const spot = LOCATIONS[this.progress.location];
    const picture = $("#spot-picture");
    picture.dataset.variant = spot.kind;
    repaint(picture);
    setContent($("#spot-name"), nameOf("location", spot.id));
    setContent($("#spot-traits"), ...Object.entries(spot.traits).flatMap(([key, value]) => [
      element("dt", { textContent: traitLabel(key) }),
      element("dd", { textContent: traitValue(key, value) }),
    ]));
    // The pages of the waters: one mark for each, the shown one lit; a mark takes you straight to its water.
    const shown = shownSpots();
    const at = shown.indexOf(this.progress.location);
    $("#spot-dots").replaceChildren(...shown.map((index, place) => element("button", {
      type: "button",
      tabIndex: -1,
      className: index === this.progress.location ? "is-active" : "",
      title: nameOf("location", LOCATIONS[index].id),
      onclick: () => this.shiftSpot(place - at),
    }, [element("span")])));
    this.renderSpotLock();
  }

  /** How a water is entered, for the handbook: open, by a rank, or by a fee (and whether it is paid). */
  accessText(index) {
    const unlock = LOCATIONS[index].unlock;
    if (!unlock) return t("water.openAll");
    const text = unlock.rank !== undefined ? t("water.openRank", { rank: this.rankName(unlock.rank) }) : t("water.openFee", { price: formatMoney(unlock.price) });
    return unlock.price && !spotLock(this.progress, index) ? `${text} · ${t("water.member")}` : text;
  }

  /**
   * A shut water: the picture dimmed under a note of what opens it, and the
   * Fish button turned into the fee (a first tap asks, a second pays) or
   * shut until the rank.
   */
  renderSpotLock() {
    const { progress } = this;
    const button = $("#fish-button");
    // Building the scene: the button says so until it is done.
    if (button.textContent === t("menu.loading")) return;
    const lock = spotLock(progress, progress.location);
    $("#spot-picture").classList.toggle("is-locked", Boolean(lock));
    const note = $("#spot-lock");
    note.hidden = !lock;
    if (lock) note.textContent = lock.rank !== undefined ? t("water.needRank", { rank: this.rankName(lock.rank) }) : t("water.fee", { price: formatMoney(lock.price) });
    const shown = shownSpots();
    document.querySelectorAll("#spot-dots button").forEach((dot, place) => dot.classList.toggle("is-locked", Boolean(spotLock(progress, shown[place]))));
    const short = lock?.price ? lock.price - progress.money : 0;
    button.classList.toggle("is-join", Boolean(lock?.price));
    button.disabled = Boolean(lock) && (lock.rank !== undefined || short > 0);
    button.textContent = !lock ? t("menu.fish")
      : lock.rank !== undefined ? t("water.locked")
        : short > 0 ? t("water.short", { sum: formatMoney(short) })
          : t(this.joinConfirm === progress.location ? "water.confirm" : "water.join", { price: formatMoney(lock.price) });
  }

  /** The fee: the first tap asks (for a few seconds), the second pays and opens the water. */
  joinSpot() {
    const index = this.progress.location;
    clearTimeout(this.joinTimer);
    if (this.joinConfirm !== index) {
      this.joinConfirm = index;
      this.joinTimer = setTimeout(() => {
        this.joinConfirm = null;
        this.renderSpotLock();
      }, 4000);
      this.renderSpotLock();
      return;
    }
    this.joinConfirm = null;
    if (!joinWater(this.progress, index)) return this.renderSpotLock();
    sounds.buyBig();
    this.commit();
    this.toast(t("water.joined", { name: nameOf("location", LOCATIONS[index].id) }), "good", 2600);
  }

  /* ---------- Gear ---------- */

  /** Arriving at the water, put on the priciest bait you have (bread if nothing else). */
  chooseBestBait() {
    const { progress } = this;
    const best = Object.entries(BAITS)
      // A lure is a deliberate choice, never put on for you.
      .filter(([id, bait]) => !bait.free && !bait.lure && baitCount(progress, id) > 0)
      .sort(([, a], [, b]) => b.price - a.price)[0];
    progress.bait = best ? best[0] : Object.keys(BAITS).find((id) => BAITS[id].free);
    this.commit();
  }

  ownedBaits() {
    return Object.keys(BAITS).filter((id) => baitCount(this.progress, id) > 0 || id === this.progress.bait);
  }

  /* ---------- HUD ---------- */

  toast(text, tone = "", duration = 1800) {
    clearTimeout(this.toastTimer);
    $("#toast-text").textContent = text;
    this.toastNode.classList.remove("is-bad", "is-good", "is-alert");
    if (tone) this.toastNode.classList.add(`is-${tone}`);
    this.toastNode.hidden = false;
    // Restart the entrance animation for back-to-back messages.
    this.toastNode.style.animation = "none";
    void this.toastNode.offsetWidth;
    this.toastNode.style.animation = "";
    this.toastTimer = setTimeout(() => {
      this.toastNode.hidden = true;
    }, duration);
  }

  showFight(visible) {
    this.fightHud.hidden = !visible;
  }

  updateFight(tension) {
    const level = Math.min(1, tension);
    const percent = Math.round(level * 100);
    this.tensionFill.style.width = `${percent}%`;
    this.tensionMeter.setAttribute("aria-valuenow", String(percent));
    this.tensionFill.dataset.level = level > 0.78 ? "high" : level > 0.5 ? "mid" : "low";
  }

  /* ---------- Catch ---------- */

  openGuarded(dialog) {
    dialog.showModal();
    dialog.dataset.openedAt = String(performance.now());
  }

  guarded(dialog, handler) {
    return (event) => {
      if (performance.now() - Number(dialog.dataset.openedAt ?? 0) < DIALOG_GUARD_MS) {
        event.preventDefault();
        return;
      }
      handler(event);
    };
  }

  /** Show the catch card; resolves after the angler sells, mounts or releases it. */
  /**
   * A fish on the bank: just its picture, name and weight, and OK. An ordinary
   * fish goes into the keepnet (sold or kept as a trophy when you leave the
   * water); a one-of-a-kind one goes straight to the trophies; junk is left on
   * the bank.
   */
  showCatch(fish, { bait, daylight = false } = {}) {
    const dialog = this.catchDialog;
    const { progress } = this;
    // Someone's lost lure is shown as the lure it is.
    const lure = fish.species === "lostlure" ? fish.lure ?? "spinner" : null;
    $("#catch-title").textContent = lure ? nameOf("bait", lure) : nameOf("fish", fish.species);
    setContent($("#catch-art"), lure ? baitSprite(lure, 6) : fishSprite(fish.species, 4, nameOf("fish", fish.species)));
    $("#catch-weight").textContent = formatWeight(fish.weight);
    const unique = Boolean(fish.unique);
    const junk = Boolean(FISH[fish.species]?.junk);
    // A Red Book fish (the sterlet) is let go at once; that counts towards its badge.
    const guarded = Boolean(FISH[fish.species]?.protected);
    const ordinary = !unique && !junk && !guarded;
    // By day a gull may snatch a small fish before it reaches the keepnet.
    const gull = ordinary && daylight && fish.weight < GULL.maxKg && Math.random() < GULL.chance;
    // The fish of the day sells dearer, and keeps that price in the keepnet.
    const dayFish = ordinary && !gull && fish.species === fishOfDay();
    let note;
    if (fish.legend) note = t("catch.legend");
    else if (unique) note = t("catch.toTrophies");
    else if (fish.species === "bottle") note = this.openBottle();
    else if (lure) {
      progress.baits[lure] = (progress.baits[lure] ?? 0) + 1;
      note = t("catch.foundLure");
    } else if (junk) note = t("catch.junk");
    else if (guarded) note = t("catch.protected");
    else if (gull) {
      bump(progress, "gullSteals");
      note = t("catch.gull");
    } else note = t(dayFish ? "catch.dayFish" : "catch.toKeepnet", { price: formatMoney(fishPrice({ ...fish, dayFish })) });
    $("#catch-note").hidden = false;
    $("#catch-note").textContent = note;
    const date = new Date().toISOString();
    const record = { ...fish, id: `${date}-${fish.species}-${fish.weight}`, date, spot: progress.location, bait, ...(dayFish ? { dayFish } : {}) };
    if (unique) progress.trophies.unshift(record);
    else if (guarded) progress.released[fish.species] = (progress.released[fish.species] ?? 0) + 1;
    else if (ordinary && !gull) progress.keepnet.push(record);
    this.commit();

    return new Promise((resolve) => {
      const finish = () => {
        dialog.close();
        resolve();
      };
      $("#catch-ok").onclick = this.guarded(dialog, finish);
      dialog.oncancel = (event) => {
        event.preventDefault();
        if (performance.now() - Number(dialog.dataset.openedAt ?? 0) >= DIALOG_GUARD_MS) finish();
      };
      this.openGuarded(dialog);
    });
  }

  /** What's in a bottle: now and then a little money, otherwise a note (a rumour of a legend, or an angler's word). */
  openBottle() {
    if (Math.random() < BOTTLE_MONEY.chance) {
      const money = Math.round(BOTTLE_MONEY.min + Math.random() * (BOTTLE_MONEY.max - BOTTLE_MONEY.min));
      this.progress.money += money;
      return t("catch.bottleMoney", { money: formatMoney(money) });
    }
    const notes = [...Object.values(LEGENDS).map((legend) => t(`legend.${legend.id}`)), ...[1, 2, 3, 4, 5].map((n) => t(`bottle.note${n}`))];
    return t("catch.bottleNote", { text: notes[Math.floor(Math.random() * notes.length)] });
  }

  /* ---------- Keepnet ---------- */

  /**
   * The keepnet: every fish in it with its weight and price; any can be kept
   * as a trophy or let go, and the rest sold together in one go.
   */
  openKeepnet() {
    const { progress } = this;
    const dialog = this.keepnetDialog;
    const fishList = progress.keepnet;
    const total = fishList.reduce((sum, fish) => sum + fishPrice(fish), 0);
    const weight = fishList.reduce((sum, fish) => sum + fish.weight, 0);
    const refresh = () => {
      this.commit();
      if (progress.keepnet.length) this.openKeepnet();
      else dialog.close();
    };
    $("#keepnet-list").replaceChildren(...fishList.map((fish, index) => {
      const cost = trophyCost(fish);
      const trophy = element("button", {
        className: "pixel-btn",
        type: "button",
        textContent: t("keepnet.trophy", { cost: formatMoney(cost) }),
        disabled: progress.money < cost,
        title: progress.money < cost ? t("catch.noMoney") : "",
        onclick: () => {
          progress.money -= cost;
          progress.trophies.unshift(fish);
          progress.keepnet.splice(index, 1);
          sounds.trophy();
          this.toast(t("toast.trophy"), "good", 1200);
          refresh();
        },
      });
      const release = element("button", {
        className: "pixel-btn pixel-btn-quiet",
        type: "button",
        textContent: t("keepnet.release"),
        onclick: () => {
          progress.keepnet.splice(index, 1);
          bump(progress, "releasedFromNet");
          refresh();
        },
      });
      return element("li", { className: "keepnet-row" }, [
        element("div", { className: "keepnet-art" }, [fishSprite(fish.species, 2)]),
        element("div", { className: "keepnet-info" }, [
          element("strong", { textContent: nameOf("fish", fish.species) }),
          element("span", { textContent: `${formatWeight(fish.weight)} · ${formatMoney(fishPrice(fish))}${fish.dayFish ? ` · ${t("dayFish.tag")}` : ""}` }),
        ]),
        element("div", { className: "keepnet-actions" }, [trophy, release]),
      ]);
    }));
    $("#keepnet-empty").hidden = fishList.length > 0;
    $("#keepnet-summary").textContent = t("keepnet.summary", { count: fishList.length, weight: formatWeight(weight), total: formatMoney(total) });
    const sell = $("#keepnet-sell");
    sell.textContent = t("keepnet.sellAll", { total: formatMoney(total) });
    sell.disabled = !fishList.length;
    sell.onclick = () => {
      progress.money += total;
      bump(progress, "sales");
      if (fishList.length >= 20) bump(progress, "bigSale");
      progress.keepnet = [];
      sounds.sell();
      this.commit();
      dialog.close();
      this.toast(t("keepnet.sold", { total: formatMoney(total) }), "good", 1800);
    };
    $("#keepnet-keep").onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
  }

  /* ---------- Shop ---------- */

  showShopTab(id) {
    for (const tab of document.querySelectorAll("#shop-dialog .tab")) {
      const active = tab.dataset.tab === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      $(`#${tab.dataset.tab}`).hidden = !active;
    }
    if (this.shopDialog.open) this.openShop();
  }



  /* ---------- Shop and backpack ---------- */

  /** Everything the shop sells, tab by tab: sold by the piece (with a stock) or once (owned or not). */
  shopWares() {
    const { progress } = this;
    const piece = (id, art, title, facts, price, stock, add, step = 1) => ({ id, art, title, facts: [facts].flat(), price, stock, add, step });
    const once = (id, art, title, facts, price, owned, buy) => ({ id, art, title, facts: [facts].flat(), price, owned, buy, step: 1 });
    const reel = progress.extras.includes("spinreel");
    return {
      "bait-shop": Object.entries(BAITS).filter(([, bait]) => !bait.free && !bait.lure).map(([id, bait]) => piece(
        id, () => baitSprite(id, 4), nameOf("bait", id), [], bait.price, progress.baits[id] ?? 0,
        (qty) => { progress.baits[id] = (progress.baits[id] ?? 0) + qty; },
        // Bait is sold by the ten.
        10,
      )),
      "rod-shop": Object.entries(RODS).map(([id, rod]) => once(
        id, () => rodArt(id, 3), nameOf("rod", id), t("shop.upTo", { weight: formatWeight(rod.maxKg) }), rod.price, progress.rods.includes(id),
        () => { progress.rods.push(id); progress.rod = id; },
      )),
      "tackle-shop": [
        ...Object.entries(HOOKS).map(([id, hook]) => piece(
          `hook-${id}`, () => hookSprite(HOOK_SCALE[id] + 1), nameOf("hook", id), reachLines(hook), hook.price, progress.hooks[id] ?? 0,
          (qty) => { progress.hooks[id] = (progress.hooks[id] ?? 0) + qty; },
          // Hooks too come by the ten.
          10,
        )),
        piece("line", () => lineSprite(4), t("line.name"), t("line.shopText"), LINE.price, progress.lines, (qty) => { progress.lines += qty; }),
        ...Object.entries(BAITS).filter(([, bait]) => bait.lure).map(([id, lure]) => piece(
          id, () => baitSprite(id, 4), nameOf("bait", id), [...reachLines(lure), t(`tackle.style.${id}`), reel ? "" : t("tackle.needReel")].filter(Boolean),
          lure.price, progress.baits[id] ?? 0, (qty) => { progress.baits[id] = (progress.baits[id] ?? 0) + qty; },
        )),
      ],
      "extra-shop": [
        piece("groundbait", () => groundbaitSprite(4), t("shop.groundbait"), t("shop.groundbaitText"), GROUNDBAIT.price, progress.groundbait, (qty) => { progress.groundbait += qty; }),
        // The groundbaits made for a kind of fish, each saying which fish it draws.
        ...Object.entries(GROUNDBAITS).map(([kind, bag]) => piece(
          `groundbait-${kind}`, () => groundbaitSprite(4, kind), nameOf("groundbait", kind), this.groundbaitFacts(kind), bag.price, progress.groundbaits?.[kind] ?? 0,
          (qty) => { progress.groundbaits ??= {}; progress.groundbaits[kind] = (progress.groundbaits[kind] ?? 0) + qty; },
        )),
        ...Object.entries(EXTRAS).map(([id, extra]) => once(
          id, () => extraSprite(id, 3), nameOf("extra", id), nameOf("extraText", id), extra.price, progress.extras.includes(id),
          () => { progress.extras.push(id); },
        )),
      ],
    };
  }

  /**
   * The shop as a list: each tab's wares in rows, a picture, the name, what
   * it does (not for bait) and how many are in the backpack, and a price tag
   * on the right. A tap puts a ware in the basket (bait and hooks by the ten,
   * the rest one at a time; a rod or an extra once, and a second tap takes it
   * out again). The basket
   * bar at the bottom shows what is in it and pays for it all; tapped, it
   * opens the basket's own page.
   */
  openShop() {
    const wares = this.shopWares();
    const all = Object.values(wares).flat();
    // Things bought since (a rod, an extra) leave the basket.
    for (const id of Object.keys(this.basket)) {
      const ware = all.find((item) => item.id === id);
      if (!ware || ware.owned) delete this.basket[id];
    }
    for (const [tab, list] of Object.entries(wares)) {
      $(`#${tab}`).replaceChildren(...list.map((ware) => {
        const inBasket = this.basket[ware.id] ?? 0;
        const label = ware.owned ? t("shop.owned") : !ware.add && inBasket ? t("shop.inCartOnce") : t("shop.toCart", { count: ware.step, total: formatMoney(ware.price * ware.step) });
        // Under the name: what it does (bait needs no words), and how many are in the backpack.
        const about = [...ware.facts, ware.add ? t("shop.inPack", { count: ware.stock }) : ""].filter(Boolean);
        return element("li", {}, [element("button", {
          className: `ware-row${ware.owned ? " is-owned" : ""}${inBasket ? " is-in" : ""}`,
          type: "button",
          disabled: ware.owned,
          ariaLabel: `${ware.title}: ${label}`,
          onclick: () => this.addToBasket(ware.id, ware.add ? ware.step : inBasket ? -1 : 1),
        }, [
          element("span", { className: "ware-art" }, [ware.art()]),
          element("span", { className: "ware-text" }, [
            element("strong", { textContent: ware.title }),
            ...about.map((line) => element("small", { textContent: line })),
          ]),
          // The price tag on the right: what a tap adds and for how much, or that it is yours or in the basket.
          element("span", { className: "ware-buy" }, ware.owned ? [element("span", { className: "ware-step", textContent: "✓" })] : [
            element("span", { className: "ware-step", textContent: !ware.add && inBasket ? "✓" : `+${ware.step}` }),
            element("span", { className: "ware-price", textContent: formatMoney(ware.price * ware.step) }),
          ]),
          ware.add && inBasket ? element("span", { className: "ware-in", textContent: `×${inBasket}` }) : "",
        ])]);
      }));
    }
    this.renderBasketBar($("#basket-bar"), true);
    if (!this.shopDialog.open) this.shopDialog.showModal();
  }

  /** Put more of a ware in the basket, or take some out (one of a kind: in or out). */
  addToBasket(id, count) {
    const ware = Object.values(this.shopWares()).flat().find((item) => item.id === id);
    if (!ware || ware.owned) return;
    const now = this.basket[id] ?? 0;
    const next = ware.add ? Math.max(0, Math.min(9990, now + count)) : count > 0 ? 1 : 0;
    if (next) this.basket[id] = next;
    else delete this.basket[id];
    sounds.ui("select");
    this.refreshBasket();
  }

  /** Draw the shop and, if it is open, the basket's page again after the basket changed. */
  refreshBasket() {
    if (this.shopDialog.open) this.openShop();
    if ($("#basket-dialog").open) this.openBasket();
  }

  /** What is in the basket: each ware with how many, the sum, and how much money is short. */
  basketLines() {
    const all = Object.values(this.shopWares()).flat();
    const lines = Object.entries(this.basket).map(([id, count]) => ({ ware: all.find((item) => item.id === id), count })).filter((line) => line.ware && !line.ware.owned);
    const total = lines.reduce((sum, line) => sum + line.ware.price * line.count, 0);
    return { lines, total, short: total - this.progress.money };
  }

  /** The basket's bar: how many things (in the shop, a button to the basket's page) and Pay with the sum, or what is short. */
  renderBasketBar(bar, inShop) {
    const { lines, total, short } = this.basketLines();
    const summary = element("span", { className: "basket-sum" }, [
      element("small", { textContent: t("cart.title") }),
      element("strong", { textContent: lines.length ? t("cart.summary", { count: lines.length }) : t("cart.empty") }),
    ]);
    const left = inShop
      ? element("button", { className: "basket-open", type: "button", ariaHaspopup: "dialog", onclick: () => this.openBasket() }, [
        element("span", { className: "basket-icon", textContent: "▤" }), summary,
      ])
      : element("span", { className: "basket-open" }, [summary]);
    const pay = element("button", {
      className: "pixel-btn pixel-btn-buy basket-pay",
      type: "button",
      disabled: !lines.length || short > 0,
      textContent: short > 0 && lines.length ? t("cart.short", { money: formatMoney(short) }) : t("cart.pay", { total: formatMoney(total) }),
      onclick: () => this.payBasket(),
    });
    setContent(bar, left, pay);
  }

  /** The basket's own page: each ware in it with − and + by its step (or Take out), its price, and Pay. */
  openBasket() {
    const { lines } = this.basketLines();
    $("#basket-list").replaceChildren(...(lines.length ? lines.map(({ ware, count }) => element("li", { className: "basket-line" }, [
      element("span", { className: "ware-art" }, [ware.art()]),
      element("span", { className: "basket-name" }, [
        element("strong", { textContent: ware.title }),
        element("small", { textContent: ware.add ? t("shop.each", { price: ware.price }) : formatMoney(ware.price) }),
      ]),
      ware.add ? element("div", { className: "stepper" }, [
        element("button", { className: "pixel-btn pixel-btn-square", type: "button", textContent: "−", ariaLabel: t("a11y.less"), onclick: () => this.addToBasket(ware.id, -ware.step) }),
        element("span", { className: "stepper-value", textContent: String(count) }),
        element("button", { className: "pixel-btn pixel-btn-square", type: "button", textContent: "+", ariaLabel: t("a11y.more"), onclick: () => this.addToBasket(ware.id, ware.step) }),
      ]) : element("button", { className: "link-btn", type: "button", textContent: t("shop.remove"), onclick: () => this.addToBasket(ware.id, -1) }),
      element("span", { className: "basket-price", textContent: formatMoney(ware.price * count) }),
    ])) : [element("li", { className: "empty-note", textContent: t("cart.hint") })]));
    this.renderBasketBar($("#basket-page-bar"), false);
    const dialog = $("#basket-dialog");
    if (!dialog.open) dialog.showModal();
  }

  /** Pay for the whole basket at once, then back to the shop. */
  payBasket() {
    const { progress } = this;
    const { lines, total } = this.basketLines();
    if (!lines.length || progress.money < total) return;
    progress.money -= total;
    for (const { ware, count } of lines) {
      if (ware.add) ware.add(count);
      else ware.buy();
    }
    if (total >= 1000) sounds.buyBig();
    else sounds.coin();
    this.basket = {};
    $("#basket-dialog").close();
    this.commit();
    if (this.shopDialog.open) this.openShop();
    this.toast(t("cart.bought", { total: formatMoney(total) }), "good", 2200);
  }

  /*
   * The drawer: what the picked thing is, opened right under its row (`after`:
   * a shelf, a rod's line, or the last cell on the picked cell's line), a notch
   * pointing up at it. Only one is open in a window; moving to another row
   * slides the old one shut while the new one slides open.
   */
  placeDrawer(root, after, pick, nodes, animate) {
    let drawer = root.querySelector(".drawer:not(.is-closing)");
    if (drawer && drawer.previousElementSibling !== after) {
      this.closeDrawers(root);
      drawer = null;
    }
    if (!drawer) {
      const inner = element("div", { className: "drawer-inner" });
      drawer = element(after.tagName === "LI" ? "li" : "div", { className: "drawer" }, [element("div", { className: "drawer-body" }, [inner])]);
      after.after(drawer);
      frame(inner, "box", 431);
      if (!animate) drawer.classList.add("is-instant");
      // Laid out shut first, so opening it slides.
      void drawer.offsetHeight;
      drawer.classList.add("is-open");
      // Opened near the bottom of the screen: once it has slid open, bring it into view.
      if (animate) setTimeout(() => drawer.isConnected && drawer.scrollIntoView({ block: "nearest", behavior: "smooth" }), 280);
    }
    const inner = drawer.querySelector(".drawer-inner");
    setContent(inner, ...nodes);
    const box = pick.getBoundingClientRect();
    inner.style.setProperty("--notch", `${Math.round(box.left + box.width / 2 - inner.getBoundingClientRect().left)}px`);
  }

  closeDrawers(root) {
    for (const drawer of root.querySelectorAll(".drawer:not(.is-closing)")) {
      drawer.classList.add("is-closing");
      drawer.classList.remove("is-open", "is-instant");
      setTimeout(() => drawer.remove(), 300);
    }
  }

  /** Everything in the backpack, by pocket: what it is, its count, whether it is in use, and what a tap does. */
  packItems() {
    const { progress } = this;
    const reel = progress.extras.includes("spinreel");
    const worn = progress.line < LINE.weakBelow;
    const items = [];
    const add = (section, item) => items.push({ section, ...item });
    for (const id of progress.rods) add("rods", {
      key: `rod:${id}`, art: () => rodArt(id, 2), title: nameOf("rod", id), tag: formatWeight(RODS[id].maxKg),
      facts: [t("shop.upTo", { weight: formatWeight(RODS[id].maxKg) })], on: id === progress.rod, status: t("pack.inHand"),
      take: () => { progress.rod = id; },
    });
    for (const [id, hook] of Object.entries(HOOKS)) {
      const left = progress.hooks[id] ?? 0;
      add("box", {
        key: `hook:${id}`, art: () => hookSprite(HOOK_SCALE[id]), title: nameOf("hook", id), tag: `×${left}`,
        facts: reachLines(hook), on: id === progress.hook, status: t("pack.tied"),
        take: left > 0 || id === progress.hook ? () => { progress.hook = id; } : null,
      });
    }
    add("box", {
      key: "line", art: () => lineSprite(3, worn), title: t("line.name"), tag: `${Math.round(progress.line * 100)}%`, worn,
      facts: [`${t("line.spare")}: ${progress.lines}`], action: [t("pack.newLine"), () => this.renewLine(true)],
    });
    for (const id of this.ownedBaits()) {
      const locked = BAITS[id].lure && !reel;
      add(BAITS[id].lure ? "box" : "bait", {
        key: `bait:${id}`, art: () => baitSprite(id, 3), title: nameOf("bait", id),
        tag: locked ? t("pack.needReel") : countLabel(baitCount(progress, id)),
        facts: BAITS[id].lure ? [...reachLines(BAITS[id]), t(`tackle.style.${id}`), locked ? t("tackle.needReel") : ""].filter(Boolean) : [],
        on: id === progress.bait, status: t("pack.onHook"),
        take: locked ? null : () => { progress.bait = id; },
      });
    }
    if (progress.groundbait > 0) add("pocket", {
      key: "groundbait", art: () => groundbaitSprite(3), title: t("shop.groundbait"), tag: `×${progress.groundbait}`,
      facts: [t("shop.groundbaitText")], action: [t("pack.feed"), () => this.useGroundbait()],
    });
    for (const [kind, count] of Object.entries(progress.groundbaits ?? {})) if (count > 0) add("pocket", {
      key: `groundbait-${kind}`, art: () => groundbaitSprite(3, kind), title: nameOf("groundbait", kind), tag: `×${count}`,
      facts: this.groundbaitFacts(kind), action: [t("pack.feed"), () => this.useGroundbait(kind)],
    });
    for (const id of progress.extras) add("pocket", {
      key: `extra:${id}`, art: () => extraSprite(id, 3), title: nameOf("extra", id), tag: "",
      facts: [nameOf("extraText", id)], action: id === "handbook" ? [t("pack.readIt"), () => this.openHandbook()] : null,
    });

    return items;
  }

  /**
   * The backpack laid open: a rod case, a tackle box (hooks, line, lures),
   * the bait, and a pocket for the rest. Tapping a rod, hook or bait takes
   * it up at once; a drawer under it says what it is and holds what else it
   * can do (put on a new line, bait the water, read).
   */
  openPack() {
    const items = this.packItems();
    if (!items.some((item) => item.key === this.packPick)) this.packPick = null;
    const cell = (item, className, children) => {
      const button = element("button", {
        className: `${className}${item.key === this.packPick ? " is-picked" : ""}${item.on ? " is-on" : ""}`,
        type: "button",
        title: item.title,
        ariaExpanded: String(item.key === this.packPick),
        onclick: () => this.pickPackItem(item.key),
      }, children);
      button.dataset.key = item.key;
      return button;
    };
    const section = (id, label, className) => {
      const own = items.filter((item) => item.section === id);
      return element("section", { className: `pack-pocket pack-${id}` }, [
        element("h3", { textContent: label }),
        own.length
          ? element("div", { className }, own.map((item) => (id === "rods"
            ? cell(item, "rod-row", [element("span", { className: "ware-art" }, [item.art()]), element("span", { className: "ware-name", textContent: item.title }), element("span", { className: "pick-tag", textContent: item.tag })])
            : cell(item, "pack-cell", [element("span", { className: "ware-art" }, [item.art()]), element("span", { className: `pick-tag${item.worn ? " is-worn" : ""}`, textContent: item.tag })]))))
          : element("p", { className: "empty-note", textContent: t("pack.empty") }),
      ]);
    };
    const body = $("#pack-pockets");
    body.replaceChildren(
      element("div", { className: "pack-sections" }, [
        section("rods", t("pack.rodCase"), "rod-case"),
        element("div", { className: "pack-pair" }, [
          section("box", t("pack.box"), "pack-grid"),
          section("bait", t("pack.bait"), "pack-grid"),
        ]),
        section("pocket", t("pack.pocket"), "pack-grid"),
      ]),
    );
    body.querySelectorAll(".pack-pocket").forEach((pocket, index) => frame(pocket, "well", 520 + index));
    if (!this.packDialog.open) this.packDialog.showModal();
    // Drawn again (a new line, groundbait used): what was open stays open, without sliding again.
    if (this.packPick) this.showPackItem(false);
  }

  /** A tap takes the thing in hand (a rod, a hook, a bait) and opens what it is under it; a second tap closes it. */
  pickPackItem(key) {
    const item = this.packItems().find((entry) => entry.key === key);
    const closing = this.packPick === key && !(item.take && !item.on);
    if (item.take && !item.on) {
      item.take();
      this.commit();
    } else sounds.ui("select");
    this.packPick = closing ? null : key;
    // What is in use and what is picked, marked again in place so nothing jumps.
    const now = new Map(this.packItems().map((entry) => [entry.key, entry]));
    for (const button of $("#pack-pockets").querySelectorAll("[data-key]")) {
      const entry = now.get(button.dataset.key);
      button.classList.toggle("is-on", Boolean(entry?.on));
      button.classList.toggle("is-picked", button.dataset.key === this.packPick);
      button.ariaExpanded = String(button.dataset.key === this.packPick);
      const tag = button.querySelector(".pick-tag");
      if (entry && tag) tag.textContent = entry.tag;
    }
    if (closing) this.closeDrawers(this.packDialog);
    else this.showPackItem(true);
  }

  showPackItem(animate) {
    const item = this.packItems().find((entry) => entry.key === this.packPick);
    const button = $("#pack-pockets").querySelector(`[data-key="${CSS.escape(item.key)}"]`);
    // In a grid the drawer goes after the last cell on the picked one's line.
    let after = button;
    if (button.classList.contains("pack-cell")) {
      for (let next = button.nextElementSibling; next && !next.classList.contains("drawer") && next.offsetTop === button.offsetTop; next = next.nextElementSibling) after = next;
    }
    this.placeDrawer(this.packDialog, after, button, [
      element("div", { className: "slip-head" }, [
        element("strong", { textContent: item.title }),
        element("span", { className: "slip-stock", textContent: item.on ? item.status : "" }),
      ]),
      ...item.facts.map((line) => element("small", { className: "slip-fact", textContent: line })),
      ...(item.action ? [element("div", { className: "slip-action" }, [element("button", {
        className: "pixel-btn pixel-btn-buy slip-buy", type: "button", textContent: item.action[0], onclick: item.action[1],
      })])] : []),
    ], animate);
  }


  /**
   * Put a spare line on: on its own once the old one is worn through, or
   * when asked (`now`, from the backpack) while the old one is worn at all.
   */
  renewLine(now = false) {
    const { progress } = this;
    if (progress.lines <= 0) {
      if (now) {
        this.toast(t("line.noSpare"), "bad", 1800);
        sounds.ui("denied");
      }
      return false;
    }
    if (now ? progress.line >= 0.995 : progress.line > 0.001) return false;
    progress.lines -= 1;
    progress.line = 1;
    sounds.ui("select");
    this.commit();
    if (this.packDialog.open) this.openPack();
    this.toast(t("line.renewed"), "good", 1800);
    return true;
  }

  /** The bait picker: every bait you have, with how much is left; picking one puts it on the hook. */
  openBait() {
    const { progress } = this;
    const reel = progress.extras.includes("spinreel");
    $("#bait-list").replaceChildren(...this.ownedBaits().map((id) => {
      // The spoon can't be fished without a spinning reel.
      const locked = BAITS[id].lure && !reel;
      return element("li", {}, [element("button", {
        className: `pick pack-item${id === progress.bait ? " is-selected" : ""}`,
        type: "button",
        title: locked ? t("toast.needReel") : nameOf("bait", id),
        ariaPressed: String(id === progress.bait),
        disabled: locked,
        onclick: () => {
          progress.bait = id;
          this.commit();
          this.baitDialog.close();
        },
      }, [baitSprite(id, 3), element("span", { className: "pack-name", textContent: nameOf("bait", id) }), element("span", { className: "pick-tag", textContent: locked ? t("pack.needReel") : countLabel(baitCount(progress, id)) })])]);
    }));
    if (!this.baitDialog.open) this.baitDialog.showModal();
  }

  /** What a groundbait made for a kind of fish does, and which fish it draws. */
  groundbaitFacts(kind) {
    const fish = GROUNDBAITS[kind].favors.filter((id) => fishShown(id)).map((id) => nameOf("fish", id).toLocaleLowerCase(locale()));
    return [t("shop.groundbaitDraws", { fish: fish.join(", ") })];
  }

  /**
   * Bait the water you're at: 24 game hours of livelier bites (a fresh bag tops
   * it back up). `kind`: one made for a kind of fish (see GROUNDBAITS); none, the plain one.
   */
  useGroundbait(kind = null) {
    const { progress } = this;
    if (!this.isFishing()) {
      this.toast(t("toast.groundbaitWhere"), "bad", 1800);
      sounds.ui("denied");
      return;
    }
    if (kind ? !(progress.groundbaits?.[kind] > 0) : progress.groundbait <= 0) return;
    if (kind) progress.groundbaits[kind] -= 1;
    else progress.groundbait -= 1;
    bump(progress, "groundbaits");
    sounds.groundbait();
    // Wears off 24 game hours from now (a fresh bag starts the count again).
    const spot = LOCATIONS[progress.location].id;
    progress.baited[spot] = Date.now() + gameHoursMs(GROUNDBAIT.hours);
    progress.baitedKind ??= {};
    if (kind) progress.baitedKind[spot] = kind;
    else delete progress.baitedKind[spot];
    this.commit();
    this.packDialog.close();
    this.toast(kind ? t("toast.groundbaitKindOn", { name: nameOf("groundbait", kind) }) : t("toast.groundbaitOn"), "good", 2000);
  }

  /** The groundbait chip by the clock: shown while this water is baited, its bar the time left. */
  setGroundbait(hours, kind = null) {
    const chip = $("#groundbait-chip");
    // The sack by the clock is the one that went in.
    if (kind !== this.groundbaitKind) {
      this.groundbaitKind = kind;
      $("#groundbait-icon").replaceChildren(groundbaitSprite(2, kind ?? "plain"));
    }
    // Redraw only in tenth-of-an-hour steps.
    const step = hours > 0 ? Math.ceil(hours * 10) : 0;
    if (step === this.groundbaitStep) return;
    this.groundbaitStep = step;
    const wasHidden = chip.hidden;
    chip.hidden = step === 0;
    if (!step) return;
    this.paintGroundbaitRing(Math.min(1, hours / GROUNDBAIT.hours));
    const label = t("hud.groundbait", { hours: Math.ceil(hours) });
    chip.setAttribute("aria-label", label);
    chip.title = label;
    // A frame painted while hidden has no size; paint it now.
    if (wasHidden) repaint(chip);
  }

  /** The ring round the groundbait icon: lit clockwise from the top for the share of time left, in whole pixels. */
  paintGroundbaitRing(share) {
    const canvas = $("#groundbait-ring");
    const ctx = canvas.getContext("2d");
    const size = canvas.width;
    const middle = size / 2;
    ctx.clearRect(0, 0, size, size);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = x + 0.5 - middle;
        const dy = y + 0.5 - middle;
        const distance = Math.hypot(dx, dy);
        if (distance < middle - 2.4 || distance > middle - 0.4) continue;
        const turn = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1;
        ctx.fillStyle = turn < share ? P.gold : P.dark;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  openHandbook(tab = "fish") {
    this.showHandbookTab(tab);
    if (!this.handbookDialog.open) this.handbookDialog.showModal();
  }

  /** The handbook in four tabs; the first three are built from the game's own data. */
  showHandbookTab(id) {
    for (const tab of document.querySelectorAll("#handbook-dialog .tab")) {
      const active = tab.dataset.tab === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    const lower = (text) => text.toLocaleLowerCase(locale());
    const list = (items) => items.join(", ");
    // Each page: a picture, a title and subtitle, then labelled facts (one or more lines each).
    const page = (art, title, subtitle, facts, seed) => {
      const rows = facts.filter(([, value]) => value && (!Array.isArray(value) || value.length));
      const node = element("li", { className: `handbook-page${art ? "" : " handbook-text"}` }, [
        art ? element("div", { className: "handbook-art" }, [art]) : "",
        element("div", { className: "handbook-body" }, [
          element("strong", { textContent: title }),
          subtitle ? element("small", { textContent: subtitle }) : "",
          element("dl", { className: "handbook-facts" }, rows.flatMap(([label, value]) => [
            element("dt", { textContent: label }),
            element("dd", {}, (Array.isArray(value) ? value : [value]).map((line) => element("span", { textContent: line }))),
          ])),
        ]),
      ]);
      frame(node, "box", seed);
      return node;
    };
    let pages;
    if (id === "fish") {
      // Small fish are drawn bigger so all of them read at a glance.
      pages = handbookEntries().map((entry, index) => page(fishSprite(entry.id, FISH[entry.id].max < 4 ? 3 : 2), nameOf("fish", entry.id), [
        entry.protected ? t("handbook.protected", { range: entry.range }) : t("handbook.weight", { range: entry.range, price: entry.pricePerKg }),
        entry.season === "autumn" ? t("handbook.autumnOnly") : "",
      ].filter(Boolean).join(" · "), [
        [t("handbook.livesIn"), entry.spots.map((spot) => t(spot.minKg > FISH[entry.id].min ? "handbook.spotInRange" : "handbook.spotIn", { spot: nameOf("location", spot.id), abundance: nameOf("abundance", spot.abundance), min: formatWeight(spot.minKg), kg: formatWeight(spot.maxKg) }))],
        [t("handbook.bitesOn"), lower(list(entry.baits.map((bait) => nameOf("bait", bait))))],
        [t("handbook.activeAt"), entry.times.map(periodName).join(", ")],
        [t("handbook.biteLabel"), nameOf("biteStyle", entry.style)],
      ], 700 + index));
    } else if (id === "spots") {
      pages = spotEntries().map((spot, index) => {
        const picture = element("div", { className: "handbook-spot" });
        picture.dataset.variant = LOCATIONS.find((place) => place.id === spot.id).kind;
        frame(picture, "location", 40 + index);
        return page(picture, nameOf("location", spot.id), t("handbook.spotTraits", {
          type: traitValue("type", spot.traits.type), depth: lower(traitValue("depth", spot.traits.depth)),
          bottom: lower(traitValue("bottom", spot.traits.bottom)), current: lower(traitValue("current", spot.traits.current)),
        }), [
          [t("handbook.fishLabel"), lower(list(spot.fish.map((fish) => nameOf("fish", fish))))],
          [t("handbook.sizeLabel"), t("handbook.spotSizes", {
            from: spot.minKg ? t("handbook.spotFrom", { min: formatWeight(spot.minKg) }) : "",
            typ: formatWeight(spot.typicalKg), max: formatWeight(spot.maxKg), odds: spot.bigOdds,
          }) + (spot.tailKg ? t("handbook.spotTail", { tail: formatWeight(spot.tailKg) }) : "")],
          [t("handbook.accessLabel"), this.accessText(LOCATIONS.findIndex((place) => place.id === spot.id))],
          [t("handbook.waterLabel"), `${nameOf("pace", spot.pace)} · ${nameOf("snags", spot.snags)}`],
          ...(spot.ways.length ? [[t("handbook.waysLabel"), spot.ways.map((way) => t(`handbook.way.${way}`)).join("; ")]] : []),
        ], 760 + index);
      });
    } else if (id === "baits") {
      pages = baitEntries().map((bait, index) => {
        return page(baitSprite(bait.id, 3), nameOf("bait", bait.id), `${bait.free ? t("handbook.baitFree") : t("handbook.baitPrice", { price: bait.price })} · ${nameOf("baitSize", bait.size)}`, [
          [t("handbook.takenBy"), lower(list(bait.fish.map((fish) => nameOf("fish", fish))))],
        ], 820 + index);
      });
    } else {
      const rules = element("li", { className: "handbook-page handbook-rules" }, [
        element("dl", {}, handbookRules().flatMap(([title, text]) => [element("dt", { textContent: title }), element("dd", { textContent: text })])),
      ]);
      frame(rules, "box", 699);
      pages = [rules];
    }
    const listNode = $("#handbook-list");
    listNode.replaceChildren(...pages);
    listNode.scrollTop = 0;
  }

  /* ---------- Trophies ---------- */

  openTrophies(tab = "mine") {
    this.showTrophyTab(tab);
    if (!this.trophyDialog.open) this.trophyDialog.showModal();
  }

  /** Trophies come in two tabs: this player's wall and other anglers' latest catches. */
  showTrophyTab(id) {
    for (const tab of document.querySelectorAll("#trophy-dialog .tab")) {
      const active = tab.dataset.tab === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    // Badges for protected fish let go, above the player's own wall.
    const badges = $("#trophy-badges");
    const released = Object.entries(this.progress.released ?? {});
    badges.hidden = id !== "mine" || !released.length;
    badges.textContent = released.map(([species, count]) => t("trophies.released", { fish: nameOf("fish", species), count })).join(" · ");
    if (id === "mine") {
      const { trophies } = this.progress;
      this.fillTrophyWall(trophies, trophies.length || released.length ? "" : t("trophies.empty"), "", true);
      return;
    }
    const cloud = this.cloud;
    if (!cloud?.enabled) {
      this.fillTrophyWall([], t("trophies.othersOff"));
      return;
    }
    this.fillTrophyWall([], t("trophies.loading"));
    const request = (this.trophyRequest = cloud.otherTrophies());
    request.then((result) => {
      // Ignore a slow answer if the player has moved on to another tab.
      if (request !== this.trophyRequest || !$("#trophy-dialog .tab[data-tab='others']").classList.contains("is-active")) return;
      if (result.error) return this.fillTrophyWall([], t("trophies.othersError"));
      const trophies = result.trophies.map((row) => ({
        species: row.species,
        weight: row.weight,
        spot: LOCATIONS.findIndex((spot) => spot.id === row.spot),
        bait: row.bait,
        date: row.caught_at,
        player: row.player || t("trophies.anonymous"),
        rank: row.angler_rank,
        avatar: row.avatar,
      })).filter((trophy) => FISH[trophy.species]);
      this.fillTrophyWall(trophies, trophies.length ? "" : t("trophies.othersEmpty"), !cloud.user ? t("trophies.shareHint") : "");
    });
  }

  /* ---------- Collection: the atlas and the achievements ---------- */

  openCollection() {
    this.showCollectionTab("atlas");
    if (!this.collectionDialog.open) this.collectionDialog.showModal();
  }

  showCollectionTab(id) {
    for (const tab of document.querySelectorAll("#collection-dialog .tab")) {
      const active = tab.dataset.tab === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    $("#atlas").hidden = id !== "atlas";
    $("#achievement-list").hidden = id !== "achievements";
    if (id === "atlas") this.fillAtlas();
    else this.fillAchievements();
    $("#atlas").scrollTop = 0;
    $("#achievement-list").scrollTop = 0;
  }

  /**
   * The ranks: where the angler stands, how far to the next, how experience
   * is earned, and every rank with what it takes and the gift it brings.
   */
  fillRanks() {
    const xp = Math.floor(this.progress.xp ?? 0);
    const rank = rankAt(xp);
    const next = RANKS[rank + 1];
    const reward = questReward(this.progress);
    const from = RANKS[rank].xp;
    const share = next ? (xp - from) / (next.xp - from) : 1;
    const giftText = (gift) => [formatMoney(Math.round(reward * gift.money)), gift.groundbait ? `${t("shop.groundbait")} ×${gift.groundbait}` : ""].filter(Boolean).join(" · ");
    const head = element("div", { className: "rank-head" }, [
      element("span", { className: "rank-art" }, [medalSprite(4, P.gold)]),
      element("span", { className: "rank-now" }, [
        element("strong", { textContent: this.rankName(rank) }),
        element("span", { className: "achievement-bar" }, [element("span", { style: `width: ${share * 100}%` })]),
        element("small", { textContent: next ? t("rank.toNext", { xp: xp.toLocaleString(locale()), need: next.xp.toLocaleString(locale()), rank: this.rankName(rank + 1) }) : t("rank.top", { xp: xp.toLocaleString(locale()) }) }),
      ]),
    ]);
    frame(head, "box", 1301);
    const how = element("p", { className: "rank-how", textContent: t("rank.how", { species: XP.newSpecies, quest: XP.quest, day: XP.day }) });
    const list = element("ol", { className: "rank-list" }, RANKS.map((item, index) => element("li", { className: `rank-row${index < rank ? " is-done" : index === rank ? " is-now" : ""}` }, [
      element("span", { className: "rank-number", textContent: String(index + 1) }),
      element("span", { className: "rank-name" }, [
        element("strong", { textContent: this.rankName(index) }),
        element("small", { textContent: item.gift ? giftText(item.gift) : t("rank.start") }),
      ]),
      element("span", { className: "rank-xp", textContent: item.xp.toLocaleString(locale()) }),
    ])));
    $("#ranks").replaceChildren(head, how, list);
  }

  /**
   * The atlas: every fish there is. Found ones in colour, with how many and
   * the heaviest; the rest only a dark shape.
   */
  fillAtlas() {
    const { progress } = this;
    const stats = progress.stats ?? {};
    // A sterlet is let go at once, and older saves only counted it that way.
    const count = (id) => Math.max(stats.bySpecies?.[id] ?? 0, progress.released?.[id] ?? 0);
    const cell = (id, found, lines, seed) => {
      const art = fishSprite(id, 2, found ? nameOf("fish", id) : "");
      const node = element("li", { className: `atlas-cell${found ? " is-found" : ""}` }, [
        element("div", { className: "atlas-art" }, [found ? art : silhouette(art)]),
        element("strong", { textContent: nameOf("fish", id) }),
        ...lines.filter(Boolean).map((line) => element("small", { textContent: line })),
      ]);
      frame(node, "box", seed);
      return node;
    };
    const entries = handbookEntries();
    const fish = entries.map((entry, index) => {
      const caught = count(entry.id);
      if (caught) {
        const record = stats.heaviest?.[entry.id];
        return cell(entry.id, true, [t("atlas.caught", { count: caught }), record ? t("atlas.record", { weight: formatWeight(record) }) : ""], 1100 + index);
      }
      // Not found yet: only its shape, no hint of where or when; finding out is the point.
      return cell(entry.id, false, [t("atlas.notYet")], 1100 + index);
    });
    // The legends: a rumour each until landed, then the heaviest one on the wall.
    const legends = Object.entries(LEGENDS).filter(([spotId]) => spotShown(LOCATIONS.find((spot) => spot.id === spotId))).map(([, legend], index) => {
      const best = progress.trophies.filter((trophy) => trophy.species === legend.id).sort((a, b) => b.weight - a.weight)[0];
      if (best) return cell(legend.id, true, [t("atlas.record", { weight: formatWeight(best.weight) })], 1200 + index);
      return cell(legend.id, false, [t(`legend.${legend.id}`)], 1200 + index);
    });
    const found = entries.filter((entry) => count(entry.id) > 0).length;
    const landed = legends.filter((node) => node.classList.contains("is-found")).length;
    $("#collection-summary").textContent = t("atlas.summaryLegends", { count: found, total: entries.length, legends: landed, legendTotal: legends.length });
    $("#atlas").replaceChildren(
      element("ul", { className: "atlas-grid" }, fish),
      element("section", {}, [element("h3", { textContent: t("atlas.legends") }), element("ul", { className: "atlas-grid atlas-legends" }, legends)]),
    );
  }

  /**
   * The tournament board: the week's fish and prizes, then the top twenty,
   * this angler marked (and added below with their place if further down).
   */
  fillTourney({ board, empty, shown }) {
    const week = tourneyWeek();
    const species = tourneyFish(week);
    const say = (text) => {
      board.replaceChildren();
      empty.textContent = text;
      empty.hidden = !text;
    };
    const cloud = this.cloud;
    if (!cloud?.enabled) return say(t("trophies.othersOff"));
    say(t("trophies.loading"));
    const request = (this.tourneyRequest = Promise.all([cloud.tournamentBoard(week, species), cloud.tournamentPlace(week, species).catch(() => null)]));
    request.then(([result, mine]) => {
      if (request !== this.tourneyRequest || !shown()) return;
      if (result.error) return say(t("trophies.othersError"));
      const me = cloud.user?.id;
      const row = (place, player, weight, isMe, rank, avatar) => element("li", { className: `tourney-row${isMe ? " is-me" : ""}${place <= 3 ? ` is-top is-top-${place}` : ""}` }, [
        element("span", { className: "tourney-place", textContent: String(place) }),
        element("span", { className: "tourney-avatar" }, [avatarSprite(avatar ?? 0, 2)]),
        element("span", { className: "tourney-player" }, [
          player || t("trophies.anonymous"),
          Number.isFinite(rank) ? element("small", { textContent: ` · ${this.rankName(rank)}` }) : "",
        ]),
        element("span", { className: "tourney-weight", textContent: formatWeight(weight) }),
      ]);
      // Ties share a place.
      let place = 0;
      let last = null;
      const rows = result.rows.map((entry, index) => {
        if (entry.weight !== last) place = index + 1;
        last = entry.weight;
        return row(place, entry.player, entry.weight, entry.user_id === me, entry.angler_rank, entry.avatar);
      });
      if (mine?.place && !result.rows.some((entry) => entry.user_id === me)) {
        rows.push(element("li", { className: "tourney-gap", textContent: "…" }), row(mine.place, cloud.user.user_metadata?.nickname, mine.weight, true, this.progress.rank ?? 0, this.progress.avatar));
      }
      board.replaceChildren(...rows);
      const note = !rows.length ? t("tourney.empty") : !cloud.user ? t("tourney.signIn") : !mine?.place ? t("tourney.notYet") : "";
      empty.textContent = note;
      empty.hidden = !note;
    });
  }

  /**
   * The achievements, by group: earned ones bright with their date, the rest
   * dim with how far along they are, secret ones only a "?" until earned.
   */
  fillAchievements() {
    const { progress } = this;
    const done = (achievement) => Boolean(progress.achievements?.[achievement.id]);
    const shown = shownAchievements();
    const earned = shown.filter(done);
    $("#collection-summary").textContent = t("achievements.summary", {
      count: earned.length,
      total: shown.length,
      money: formatMoney(earned.reduce((sum, achievement) => sum + achievement.reward, 0)),
    });
    $("#achievement-list").replaceChildren(...GROUPS.map((group) => {
      const items = shown.filter((achievement) => achievement.group === group).map((achievement) => {
        const got = done(achievement);
        const hidden = achievement.secret && !got;
        const value = achievement.value(progress);
        const date = got ? new Date(progress.achievements[achievement.id]).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) : "";
        const status = got ? date : hidden ? "" : achievement.target > 1 ? t("achievements.progress", { value, target: achievement.target }) : "";
        const bar = !got && !hidden && achievement.target > 1
          ? element("span", { className: "achievement-bar" }, [element("span", { style: `width: ${(value / achievement.target) * 100}%` })])
          : "";
        return element("li", { className: `achievement${got ? " is-earned" : ""}${hidden ? " is-secret" : ""}` }, [
          element("span", { className: "achievement-art" }, [medalSprite(3, got ? RIBBONS[group] : P.mid)]),
          element("span", { className: "achievement-info" }, [
            element("strong", { textContent: hidden ? "?" : t(`achievements.${achievement.id}.name`) }),
            element("span", { textContent: hidden ? t("achievements.secret") : t(`achievements.${achievement.id}.text`) }),
            bar,
            status ? element("small", { textContent: status }) : "",
          ]),
          element("span", { className: "achievement-reward", textContent: formatMoney(achievement.reward) }),
        ]);
      });
      return element("section", { className: "achievement-group" }, [
        element("h3", { textContent: t(`achievements.group.${group}`) }),
        element("ul", {}, items),
      ]);
    }));
  }

  /** Draw trophy cards, heaviest first: fish, weight, who caught it (for others), where, on what bait and when. */
  /**
   * Take a trophy off this player's own wall: a first tap asks (for a few
   * seconds), a second removes it here and from the other anglers' list.
   */
  removeTrophy(id) {
    clearTimeout(this.trophyTimer);
    if (this.trophyConfirm !== id) {
      this.trophyConfirm = id;
      this.trophyTimer = setTimeout(() => {
        this.trophyConfirm = null;
        this.showTrophyTab("mine");
      }, 4000);
      this.showTrophyTab("mine");
      return;
    }
    this.trophyConfirm = null;
    this.progress.trophies = this.progress.trophies.filter((trophy) => trophy.id !== id);
    this.commit();
    this.cloud?.deleteTrophy(id);
    this.toast(t("trophies.removed"), "", 1600);
    this.showTrophyTab("mine");
  }

  fillTrophyWall(trophies, emptyText, hint = "", removable = false) {
    trophies = [...trophies].sort((a, b) => b.weight - a.weight);
    const empty = $("#trophy-empty");
    empty.textContent = emptyText;
    empty.hidden = !emptyText;
    const note = $("#trophy-hint");
    note.textContent = hint;
    note.hidden = !hint;
    // Each fish mounted on a board as anglers hang them, a brass plate on the board: the name, and apart from it the weight.
    // Another angler's trophy says whose it is above the board.
    $("#trophy-wall").replaceChildren(...trophies.map((fish, index) => {
      const legend = Boolean(FISH[fish.species]?.legend);
      const plate = element("div", { className: "nameplate" }, [
        element("span", { className: "nameplate-name", textContent: nameOf("fish", fish.species) }),
        element("span", { className: "nameplate-weight", textContent: formatWeight(fish.weight) }),
      ]);
      const board = element("div", { className: "plaque" }, [fishSprite(fish.species, 8, nameOf("fish", fish.species)), plate]);
      if (legend) board.dataset.variant = "legend";
      const spot = LOCATIONS[fish.spot] ? nameOf("location", LOCATIONS[fish.spot].id) : null;
      const date = fish.date ? new Date(fish.date).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) : null;
      const owner = fish.player ? element("div", { className: "trophy-owner" }, [
        element("span", { className: "trophy-owner-avatar" }, [avatarSprite(fish.avatar ?? 0, 2)]),
        element("strong", { textContent: fish.player }),
        Number.isFinite(fish.rank) ? element("small", { textContent: this.rankName(fish.rank) }) : "",
      ]) : "";
      const about = element("div", { className: "trophy-about" }, [
        element("small", { textContent: [spot, date].filter(Boolean).join(" · ") }),
        fish.bait && BAITS[fish.bait] ? element("small", { textContent: t("trophies.bait", { bait: nameOf("bait", fish.bait) }) }) : "",
      ]);
      // On the player's own wall a trophy can be taken down: a small × in the board's corner,
      // which asks in words on the first tap.
      const asking = this.trophyConfirm === fish.id;
      const remove = removable ? element("button", {
        type: "button",
        className: `trophy-remove${asking ? " is-confirm" : ""}`,
        textContent: asking ? t("trophies.removeConfirm") : "×",
        title: t("trophies.remove"),
        "aria-label": t("trophies.remove"),
        onclick: () => this.removeTrophy(fish.id),
      }) : "";
      frame(board, "plaque", 500 + index * 7);
      return element("li", { className: `trophy${legend ? " is-legend" : ""}` }, [owner, board, about, remove]);
    }));
  }
}
