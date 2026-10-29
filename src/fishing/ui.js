import {
  BAITS, EXTRAS, FISH, GROUNDBAIT, HOOKS, LINE, LOCATIONS, RODS, gameHoursMs,
  baitEntries, fishPrice, formatMoney, formatWeight, handbookEntries, spotEntries, trophyCost,
} from "./data.js";
import {
  bagSprite, baitSprite, clockSprite, gearSprite, rainSprite, coinSprite, cupSprite, exitSprite, extraSprite, fishSprite, groundbaitSprite, hookSprite, keepnetSprite, lineSprite, medalSprite, packSprite, questSprite, rodSprite, windSprite,
} from "./sprites.js";
import { P } from "./palette.js";
import { ACHIEVEMENTS, GROUPS, bump, evaluate } from "./achievements.js";
import { questReward, questState, todaysQuest, untilNextQuest } from "./quests.js";
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
const countLabel = (count) => (count === Infinity ? "∞" : `×${count}`);
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
    this.keepnetDialog = $("#keepnet-dialog");
    this.packDialog = $("#pack-dialog");
    this.handbookDialog = $("#handbook-dialog");
    this.settingsDialog = $("#settings-dialog");
    this.packSlot = $("#pack-slot");
    this.baitDialog = $("#bait-dialog");
    this.baitButton = $("#bait-chip");
    this.shopQuantities = {};

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
    $("#fish-button").addEventListener("click", onFish);
    $("#exit-button").addEventListener("click", () => {
      if (!this.busy) onExit();
    });
    $("#shop-button").addEventListener("click", () => this.openShop());
    $("#pack-button").addEventListener("click", () => this.openPack());
    $("#trophy-button").addEventListener("click", () => this.openTrophies());
    $("#keepnet-chip").addEventListener("click", () => this.openKeepnet());
    $("#settings-button").addEventListener("click", () => this.openSettings());
    $("#account-button").addEventListener("click", () => this.openAccount());
    $("#quest-strip").addEventListener("click", () => this.openQuest());
    $("#quest-chip").addEventListener("click", () => this.openQuest());
    for (const tab of document.querySelectorAll("#shop-dialog .tab")) {
      tab.addEventListener("click", () => this.showShopTab(tab.dataset.tab));
    }
    for (const tab of document.querySelectorAll("#trophy-dialog .tab")) {
      tab.addEventListener("click", () => this.showTrophyTab(tab.dataset.tab));
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
  }

  openAccount() {
    this.renderAccount();
    const dialog = $("#account-dialog");
    if (!dialog.open) dialog.showModal();
  }

  /** The menu line under the buttons: where progress lives, and the way to sign in. */
  renderAccountStrip() {
    const cloud = this.cloud;
    const signedIn = Boolean(cloud?.user);
    const strip = $("#account-strip");
    strip.classList.toggle("is-safe", signedIn);
    $("#account-strip-text").textContent = signedIn ? t("account.cloudAs", { name: cloud.displayName }) : t("account.local");
    strip.title = signedIn ? t("account.cloud") : t("savePrompt.warning");
    const button = $("#account-button");
    // Without a configured backend there's nothing to sign in to; the warning still stands.
    button.hidden = !cloud?.enabled;
    button.textContent = t(signedIn ? "account.open" : "account.login");
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
    this.renderAccountStrip();
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
    if (mode === "recover" && !$("#account-dialog").open) $("#account-dialog").showModal();
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
        element("button", { className: "pixel-btn pixel-btn-primary", type: "button", textContent: t("account.done"), onclick: () => $("#account-dialog").close() }),
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

  /** Ask which of two different saves to keep; resolves "remote" or "local". */
  chooseSave({ local, remote }) {
    const dialog = $("#sync-dialog");
    const summary = (state) => t("sync.summary", { money: state.money.toLocaleString(locale()), caught: state.caught ?? 0, trophies: state.trophies?.length ?? 0 });
    $("#sync-remote-summary").textContent = summary(remote);
    $("#sync-local-summary").textContent = summary(local);
    return new Promise((resolve) => {
      const finish = (choice) => {
        dialog.close();
        resolve(choice);
      };
      $("#sync-remote").onclick = () => finish("remote");
      $("#sync-local").onclick = () => finish("local");
      // Closing without a choice keeps this device's progress.
      dialog.oncancel = (event) => {
        event.preventDefault();
        finish("local");
      };
      dialog.showModal();
    });
  }

  /** Save and redraw; any achievement newly earned is paid out and announced first. */
  commit() {
    const earned = evaluate(this.progress);
    saveProgress(this.progress);
    this.render();
    if (earned.length) this.announceAchievements(earned);
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
    const trophyCount = $("#trophy-count");
    trophyCount.textContent = String(progress.trophies.length);
    trophyCount.hidden = progress.trophies.length === 0;

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

    this.renderQuest();

    // The hook size in use and how many are left.
    const hooksLeft = progress.hooks[progress.hook] ?? 0;
    $("#pack-hook-sprite").replaceChildren(hookSprite(2));
    $("#pack-hook-count").textContent = `×${hooksLeft}`;
    $("#pack-hook-count").closest(".chip").classList.toggle("is-empty", hooksLeft <= 0);
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

  /** The quest line in the menu and the chip in game, kept to today's quest. */
  renderQuest() {
    const quest = todaysQuest();
    const state = questState(this.progress, quest);
    const done = Boolean(state.done);
    const key = `${quest.day}:${state.value}:${done}:${language()}`;
    if (key === this.questKey) return;
    this.questKey = key;
    const count = done ? t("quest.doneShort") : this.questCount(quest, state);
    $("#quest-strip-goal").textContent = this.questGoal(quest);
    $("#quest-strip-count").textContent = count;
    $("#quest-strip").classList.toggle("is-done", done);
    $("#quest-chip-count").textContent = done ? "✓" : this.questCount(quest, state);
    $("#quest-chip").classList.toggle("is-done", done);
    $("#quest-chip").setAttribute("aria-label", `${t("quest.title")}: ${this.questGoal(quest)}, ${count}`);
    $("#quest-strip-icon").replaceChildren(questSprite(3, done));
    $("#quest-chip-icon").replaceChildren(questSprite(3, done));
  }

  /** Today's quest done: the reward is already paid; say so once the catch card is closed. */
  questDone({ reward }) {
    this.renderQuest();
    const show = () => {
      if (document.querySelector("dialog[open]")) {
        setTimeout(show, 400);
        return;
      }
      sounds.coin();
      this.toast(t("quest.toast", { reward: formatMoney(reward) }), "good", 3200);
    };
    show();
  }

  /** The quest window: what it asks, how far along, the reward, and who has done it today. */
  openQuest() {
    const quest = todaysQuest();
    const state = questState(this.progress, quest);
    const dialog = $("#quest-dialog");
    $("#quest-goal").textContent = this.questGoal(quest);
    $("#quest-fill").style.width = `${Math.min(100, (state.value / quest.target) * 100)}%`;
    $("#quest-status").textContent = state.done
      ? t("quest.done", { time: new Date(state.done).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) })
      : t("quest.progress", { count: this.questCount(quest, state), reward: formatMoney(questReward(this.progress)) });
    const left = untilNextQuest();
    $("#quest-next").textContent = t("quest.next", { hours: Math.floor(left / 3600000), minutes: Math.floor((left % 3600000) / 60000) });
    const list = $("#quest-list");
    const note = $("#quest-list-note");
    const say = (text) => {
      note.textContent = text;
      note.hidden = !text;
    };
    list.replaceChildren();
    const cloud = this.cloud;
    if (!cloud?.enabled) say(t("quest.listOff"));
    else {
      say(t("trophies.loading"));
      const request = (this.questRequest = cloud.questFinishers(quest.day));
      request.then((result) => {
        if (request !== this.questRequest) return;
        if (result.error) return say(t("quest.listError"));
        const me = cloud.user?.id;
        list.replaceChildren(...result.finishers.map((row) => element("li", { className: row.user_id === me ? "is-me" : "" }, [
          row.player || t("trophies.anonymous"),
          element("small", { textContent: new Date(row.done_at).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }) }),
        ])));
        const hint = !cloud.user ? t("quest.signInHint") : "";
        say(result.finishers.length ? hint : [t("quest.nobody"), hint].filter(Boolean).join(" "));
      });
    }
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
    // A new day brings a new quest.
    this.renderQuest();
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
    const count = LOCATIONS.length;
    this.progress.location = (this.progress.location + step + count) % count;
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
    $("#spot-dots").replaceChildren(...LOCATIONS.map((_, index) => element("span", { className: index === this.progress.location ? "is-active" : "" })));
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
  showCatch(fish, { bait } = {}) {
    const dialog = this.catchDialog;
    const { progress } = this;
    $("#catch-title").textContent = nameOf("fish", fish.species);
    setContent($("#catch-art"), fishSprite(fish.species, 4, nameOf("fish", fish.species)));
    $("#catch-weight").textContent = formatWeight(fish.weight);
    const unique = Boolean(fish.unique);
    const junk = Boolean(FISH[fish.species]?.junk);
    // A Red Book fish (the sterlet) is let go at once; that counts towards its badge.
    const guarded = Boolean(FISH[fish.species]?.protected);
    $("#catch-note").hidden = false;
    $("#catch-note").textContent = unique ? t("catch.toTrophies") : junk ? t("catch.junk") : guarded ? t("catch.protected") : t("catch.toKeepnet", { price: formatMoney(fishPrice(fish)) });
    const date = new Date().toISOString();
    const record = { ...fish, id: `${date}-${fish.species}-${fish.weight}`, date, spot: progress.location, bait };
    if (unique) progress.trophies.unshift(record);
    else if (guarded) progress.released[fish.species] = (progress.released[fish.species] ?? 0) + 1;
    else if (!junk) progress.keepnet.push(record);
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
          element("span", { textContent: `${formatWeight(fish.weight)} · ${formatMoney(fishPrice(fish))}` }),
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
  }

  /** A − qty + stepper for buying bait by the piece. */
  stepper(id, unitPrice) {
    const qty = this.shopQuantities[id] ?? 1;
    const affordable = Math.max(1, Math.floor(this.progress.money / unitPrice));
    const set = (value) => {
      this.shopQuantities[id] = Math.max(1, Math.min(999, value));
      this.openShop();
    };
    return element("div", { className: "stepper" }, [
      element("button", { className: "pixel-btn pixel-btn-square", type: "button", textContent: "−", ariaLabel: t("a11y.less"), disabled: qty <= 1, onclick: () => set(qty - 1) }),
      element("span", { className: "stepper-value", textContent: String(qty) }),
      element("button", { className: "pixel-btn pixel-btn-square", type: "button", textContent: "+", ariaLabel: t("a11y.more"), disabled: qty >= affordable, onclick: () => set(qty + 1) }),
    ]);
  }

  openShop() {
    const { progress } = this;
    const pay = (price, apply) => () => {
      if (progress.money < price) return;
      progress.money -= price;
      // Rods and gear cost a lot more than a bag of bait: they sound like it.
      if (price >= 1000) sounds.buyBig();
      else sounds.coin();
      apply();
      this.commit();
      this.openShop();
    };

    // Bread is free; the spoon is sold among the extras.
    $("#bait-shop").replaceChildren(...Object.entries(BAITS).filter(([, bait]) => !bait.free && !bait.lure).map(([id, bait]) => {
      const qty = this.shopQuantities[id] ?? 1;
      const total = qty * bait.price;
      return element("li", { className: "card" }, [
        element("div", { className: "card-art" }, [baitSprite(id, 4)]),
        element("strong", { textContent: nameOf("bait", id) }),
        element("span", { className: "card-price", textContent: t("shop.each", { price: bait.price }) }),
        element("span", { className: "card-stock", textContent: t("shop.inPack", { count: progress.baits[id] ?? 0 }) }),
        this.stepper(id, bait.price),
        element("button", {
          className: "pixel-btn pixel-btn-buy",
          type: "button",
          disabled: progress.money < total,
          onclick: pay(total, () => {
            progress.baits[id] = (progress.baits[id] ?? 0) + qty;
            this.shopQuantities[id] = 1;
          }),
        }, [t("shop.buy", { total: formatMoney(total) })]),
      ]);
    }));

    $("#rod-shop").replaceChildren(...Object.entries(RODS).map(([id, rod]) => {
      const owned = progress.rods.includes(id);
      return element("li", { className: `card${owned ? " is-owned" : ""}` }, [
        element("div", { className: "card-art" }, [rodArt(id, 3)]),
        element("strong", { textContent: nameOf("rod", id) }),
        element("small", { textContent: t("shop.upTo", { weight: formatWeight(rod.maxKg) }) }),
        owned
          ? element("span", { className: "card-owned", textContent: t("shop.owned") })
          : element("button", {
            className: "pixel-btn pixel-btn-buy",
            type: "button",
            disabled: progress.money < rod.price,
            onclick: pay(rod.price, () => {
              progress.rods.push(id);
              progress.rod = id;
            }),
          }, [formatMoney(rod.price)]),
      ]);
    }));

    // Consumables sold by the piece: groundbait, hooks and lures.
    const pieceCard = (id, art, title, text, price, stock, add) => {
      const qty = this.shopQuantities[id] ?? 1;
      return element("li", { className: "card" }, [
        element("div", { className: "card-art" }, [art]),
        element("strong", { textContent: title }),
        // One line per fact, so "who bites" and "holds" read apart.
        ...[text].flat().map((line) => element("small", { className: "card-fact", textContent: line })),
        element("span", { className: "card-price", textContent: t("shop.each", { price }) }),
        element("span", { className: "card-stock", textContent: t("shop.inPack", { count: stock }) }),
        this.stepper(id, price),
        element("button", {
          className: "pixel-btn pixel-btn-buy",
          type: "button",
          disabled: progress.money < qty * price,
          onclick: pay(qty * price, () => {
            add(qty);
            this.shopQuantities[id] = 1;
          }),
        }, [t("shop.buy", { total: formatMoney(qty * price) })]),
      ]);
    };
    const groundbaitCard = pieceCard("groundbait", groundbaitSprite(4), t("shop.groundbait"), t("shop.groundbaitText"), GROUNDBAIT.price, progress.groundbait, (qty) => {
      progress.groundbait += qty;
    });
    $("#extra-shop").replaceChildren(groundbaitCard, ...Object.entries(EXTRAS).map(([id, extra]) => {
      const owned = progress.extras.includes(id);
      return element("li", { className: `card${owned ? " is-owned" : ""}` }, [
        element("div", { className: "card-art" }, [extraSprite(id, 3)]),
        element("strong", { textContent: nameOf("extra", id) }),
        element("small", { textContent: nameOf("extraText", id) }),
        owned
          ? element("span", { className: "card-owned", textContent: t("shop.owned") })
          : element("button", {
            className: "pixel-btn pixel-btn-buy",
            type: "button",
            disabled: progress.money < extra.price,
            onclick: pay(extra.price, () => {
              progress.extras.push(id);
            }),
          }, [formatMoney(extra.price)]),
      ]);
    }));

    // Tackle: what each hook or lure lets bite and what it holds, said plainly on the card.
    const reach = (gear) => [
      t("tackle.takes", { what: gear.minKg ? t("tackle.from", { weight: formatWeight(gear.minKg) }) : t("tackle.any") }),
      t("tackle.holds", { what: Number.isFinite(gear.holdKg) ? t("tackle.upTo", { weight: formatWeight(gear.holdKg) }) : t("tackle.anyWeight") }),
    ];
    const hookCards = Object.entries(HOOKS).map(([id, hook]) => pieceCard(`hook-${id}`, hookSprite(HOOK_SCALE[id] + 1), nameOf("hook", id), reach(hook), hook.price, progress.hooks[id] ?? 0, (qty) => {
      progress.hooks[id] = (progress.hooks[id] ?? 0) + qty;
    }));
    const reel = progress.extras.includes("spinreel");
    const lureCards = Object.entries(BAITS).filter(([, bait]) => bait.lure).map(([id, lure]) => pieceCard(id, baitSprite(id, 4), nameOf("bait", id),
      [...reach(lure), t(`tackle.style.${id}`), reel ? "" : t("tackle.needReel")].filter(Boolean), lure.price, progress.baits[id] ?? 0, (qty) => {
        progress.baits[id] = (progress.baits[id] ?? 0) + qty;
      }));
    // Spare line: goes on by itself when the line on the reel wears through.
    const lineCard = pieceCard("line", lineSprite(4), t("line.name"), t("line.shopText"), LINE.price, progress.lines, (qty) => {
      progress.lines += qty;
    });
    $("#tackle-shop").replaceChildren(...hookCards, lineCard, ...lureCards);

    document.querySelectorAll("#bait-shop .card, #rod-shop .card, #tackle-shop .card, #extra-shop .card").forEach((card, index) => frame(card, "well", 300 + index));
    if (!this.shopDialog.open) this.shopDialog.showModal();
  }

  /* ---------- Backpack ---------- */

  openPack() {
    const { progress } = this;
    const choose = (apply) => () => {
      apply();
      this.commit();
      this.openPack();
    };
    const tile = (selected, art, title, tag, onclick) => element("li", {}, [element("button", {
      className: `pick pack-item${selected ? " is-selected" : ""}`,
      type: "button",
      title,
      ariaPressed: String(selected),
      onclick,
    }, [art, element("span", { className: "pack-name", textContent: title }), element("span", { className: "pick-tag", textContent: tag })])]);

    $("#pack-rods").replaceChildren(...progress.rods.map((id) => tile(
      id === progress.rod, rodArt(id, 3), nameOf("rod", id), formatWeight(RODS[id].maxKg),
      choose(() => { progress.rod = id; }),
    )));
    // Hooks by size: pick the one to fish with; a size you have none of can't be picked.
    $("#pack-hooks").replaceChildren(...Object.keys(HOOKS).map((id) => {
      const left = progress.hooks[id] ?? 0;
      const item = tile(id === progress.hook, hookSprite(HOOK_SCALE[id]), nameOf("hook", id), `×${left}`, choose(() => { progress.hook = id; }));
      item.querySelector("button").disabled = left <= 0 && id !== progress.hook;
      return item;
    }));
    // The line on the reel, how much of it is left; with a spare, a tap puts a new one on.
    const worn = progress.line < LINE.weakBelow;
    const lineTile = tile(false, lineSprite(3, worn), t("line.name"), `${Math.round(progress.line * 100)}%`, () => this.renewLine(true));
    lineTile.querySelector(".pick-tag").classList.toggle("is-worn", worn);
    lineTile.querySelector("button").title = t("line.hint", { spare: progress.lines });
    $("#pack-line").replaceChildren(lineTile, ...(progress.lines > 0
      ? [tile(false, lineSprite(3), t("line.spare"), `×${progress.lines}`, () => this.renewLine(true))]
      : []));
    // Every bait you have, as in the bait picker: picking one puts it on the hook.
    const reel = progress.extras.includes("spinreel");
    $("#pack-baits").replaceChildren(...this.ownedBaits().map((id) => {
      // Lures can't be fished without a spinning reel.
      const locked = BAITS[id].lure && !reel;
      const item = tile(id === progress.bait, baitSprite(id, 3), nameOf("bait", id), locked ? t("pack.needReel") : countLabel(baitCount(progress, id)), choose(() => { progress.bait = id; }));
      const button = item.querySelector("button");
      button.disabled = locked;
      if (locked) button.title = t("toast.needReel");
      return item;
    }));
    $("#pack-extras").replaceChildren(
      // Groundbait goes into the water you're at, straight from the backpack.
      ...(progress.groundbait > 0 ? [tile(false, groundbaitSprite(3), t("shop.groundbait"), `×${progress.groundbait}`, () => this.useGroundbait())] : []),
      ...progress.extras.map((id) => tile(
        false, extraSprite(id, 3), nameOf("extra", id), id === "handbook" ? t("pack.read") : "",
        id === "handbook" ? () => this.openHandbook() : () => {},
      )),
    );
    $("#pack-extras-empty").hidden = progress.extras.length > 0 || progress.groundbait > 0;
    if (!this.packDialog.open) this.packDialog.showModal();
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

  /** Bait the water you're at: 24 game hours of livelier bites (a fresh bag tops it back up). */
  useGroundbait() {
    const { progress } = this;
    if (!this.isFishing()) {
      this.toast(t("toast.groundbaitWhere"), "bad", 1800);
      sounds.ui("denied");
      return;
    }
    if (progress.groundbait <= 0) return;
    progress.groundbait -= 1;
    bump(progress, "groundbaits");
    sounds.groundbait();
    // Wears off 24 game hours from now (a fresh bag starts the count again).
    progress.baited[LOCATIONS[progress.location].id] = Date.now() + gameHoursMs(GROUNDBAIT.hours);
    this.commit();
    this.packDialog.close();
    this.toast(t("toast.groundbaitOn"), "good", 2000);
  }

  /** The groundbait chip by the clock: shown while this water is baited, its bar the time left. */
  setGroundbait(hours) {
    const chip = $("#groundbait-chip");
    // Redraw only in tenth-of-an-hour steps.
    const step = hours > 0 ? Math.ceil(hours * 10) : 0;
    if (step === this.groundbaitStep) return;
    this.groundbaitStep = step;
    const wasHidden = chip.hidden;
    chip.hidden = step === 0;
    if (!step) return;
    $("#groundbait-fill").style.width = `${Math.min(100, (hours / GROUNDBAIT.hours) * 100)}%`;
    const label = t("hud.groundbait", { hours: Math.ceil(hours) });
    chip.setAttribute("aria-label", label);
    chip.title = label;
    // A frame painted while hidden has no size; paint it now.
    if (wasHidden) repaint(chip);
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
        [t("handbook.livesIn"), entry.spots.map((spot) => t("handbook.spotIn", { spot: nameOf("location", spot.id), abundance: nameOf("abundance", spot.abundance), kg: formatWeight(spot.maxKg) }))],
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
          [t("handbook.sizeLabel"), t("handbook.spotMax", { kg: formatWeight(spot.maxKg), odds: spot.bigOdds })],
          [t("handbook.waterLabel"), `${nameOf("pace", spot.pace)} · ${nameOf("snags", spot.snags)}`],
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

  openTrophies() {
    this.showTrophyTab("mine");
    if (!this.trophyDialog.open) this.trophyDialog.showModal();
  }

  /** Trophies come in two tabs: this player's wall and other anglers' latest catches. */
  showTrophyTab(id) {
    for (const tab of document.querySelectorAll("#trophy-dialog .tab")) {
      const active = tab.dataset.tab === id;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    const achievements = id === "achievements";
    $("#achievement-list").hidden = !achievements;
    $("#achievement-summary").hidden = !achievements;
    $("#trophy-wall").hidden = achievements;
    if (achievements) {
      $("#trophy-badges").hidden = true;
      $("#trophy-empty").hidden = true;
      $("#trophy-hint").hidden = true;
      this.fillAchievements();
      return;
    }
    // Badges for protected fish let go, above the player's own wall.
    const badges = $("#trophy-badges");
    const released = Object.entries(this.progress.released ?? {});
    badges.hidden = id !== "mine" || !released.length;
    badges.textContent = released.map(([species, count]) => t("trophies.released", { fish: nameOf("fish", species), count })).join(" · ");
    if (id === "mine") {
      const { trophies } = this.progress;
      this.fillTrophyWall(trophies, trophies.length || released.length ? "" : t("trophies.empty"));
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
      })).filter((trophy) => FISH[trophy.species]);
      this.fillTrophyWall(trophies, trophies.length ? "" : t("trophies.othersEmpty"), !cloud.user ? t("trophies.shareHint") : "");
    });
  }

  /**
   * The achievements, by group: earned ones bright with their date, the rest
   * dim with how far along they are, secret ones only a "?" until earned.
   */
  fillAchievements() {
    const { progress } = this;
    const done = (achievement) => Boolean(progress.achievements?.[achievement.id]);
    const earned = ACHIEVEMENTS.filter(done);
    $("#achievement-summary").textContent = t("achievements.summary", {
      count: earned.length,
      total: ACHIEVEMENTS.length,
      money: formatMoney(earned.reduce((sum, achievement) => sum + achievement.reward, 0)),
    });
    $("#achievement-list").replaceChildren(...GROUPS.map((group) => {
      const items = ACHIEVEMENTS.filter((achievement) => achievement.group === group).map((achievement) => {
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
  fillTrophyWall(trophies, emptyText, hint = "") {
    trophies = [...trophies].sort((a, b) => b.weight - a.weight);
    const empty = $("#trophy-empty");
    empty.textContent = emptyText;
    empty.hidden = !emptyText;
    const note = $("#trophy-hint");
    note.textContent = hint;
    note.hidden = !hint;
    $("#trophy-wall").replaceChildren(...trophies.map((fish, index) => {
      const tab = element("div", { className: "title-tab title-tab-small", textContent: nameOf("fish", fish.species) });
      const picture = element("div", { className: "picture" }, [fishSprite(fish.species, 3)]);
      const spot = LOCATIONS[fish.spot] ? nameOf("location", LOCATIONS[fish.spot].id) : null;
      const date = fish.date ? new Date(fish.date).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" }) : null;
      const caption = element("div", { className: "caption" }, [
        element("strong", { textContent: formatWeight(fish.weight) }),
        fish.player ? element("span", { className: "trophy-player", textContent: fish.player }) : "",
        element("small", { textContent: [spot, date].filter(Boolean).join(" · ") }),
        fish.bait && BAITS[fish.bait] ? element("small", { textContent: t("trophies.bait", { bait: nameOf("bait", fish.bait) }) }) : "",
      ]);
      const card = element("li", { className: "trophy" }, [element("div", { className: "card-scene" }, [tab, picture]), caption]);
      frame(picture, "picture", 500 + index * 7);
      frame(tab, "tab");
      frame(caption, "box", 900 + index);
      return card;
    }));
  }
}
