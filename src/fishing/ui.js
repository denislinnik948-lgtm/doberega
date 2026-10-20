import {
  BAITS, EXTRAS, FISH, HOOK_PRICE, LOCATIONS, RODS,
  baitEntries, fishPrice, formatMoney, formatWeight, handbookEntries, spotEntries, trophyCost,
} from "./data.js";
import {
  bagSprite, baitSprite, clockSprite, gearSprite, rainSprite, coinSprite, cupSprite, exitSprite, extraSprite, fishSprite, hookSprite, packSprite, rodSprite,
} from "./sprites.js";
import { frame, frameAll, repaint, repaintAll, setContent } from "./frames.js";
import { THEMES, setTheme, theme } from "../theme.js";
import { validNickname } from "../cloud.js";
import { baitCount, saveProgress } from "./store.js";
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
const countLabel = (count) => (count === Infinity ? "∞" : `×${count}`);
/** "lake (medium, sand, weed)" — a fishing spot's type, depth and bottom in words. */

/** DOM side of the game: main menu, HUD, loadout, toasts and dialogs. */
export class AnglerUI {
  constructor(progress, { onFish, onExit, onSpotChange }) {
    this.progress = progress;
    this.onSpotChange = onSpotChange;
    this.busy = false;
    this.toastNode = $("#toast");
    this.fightHud = $("#fight-hud");
    this.tensionFill = $("#tension-fill");
    this.tensionMeter = $("#tension-meter");
    this.catchDialog = $("#catch-dialog");
    this.shopDialog = $("#shop-dialog");
    this.trophyDialog = $("#trophy-dialog");
    this.packDialog = $("#pack-dialog");
    this.handbookDialog = $("#handbook-dialog");
    this.settingsDialog = $("#settings-dialog");
    this.packSlot = $("#pack-slot");
    this.shopQuantities = {};

    frameAll();
    this.paintIcons();

    this.packSlot.addEventListener("click", () => {
      if (!this.busy) this.openPack();
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
    $("#settings-button").addEventListener("click", () => this.openSettings());
    $("#account-button").addEventListener("click", () => this.openAccount());
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
    $("#shop-icon").replaceChildren(bagSprite(3));
    $("#pack-icon").replaceChildren(packSprite(3));
    $("#trophy-icon").replaceChildren(cupSprite(3));
    icon("#exit-button", exitSprite(3));
    $("#settings-icon").replaceChildren(gearSprite(3));
    $("#pack-slot-sprite").replaceChildren(packSprite(3));
    $("#pack-hook-sprite").replaceChildren(hookSprite(2));
    this.clockNight = null;
  }

  /** Switch the visual style: repaint frames, icons and pictures in its palette. */
  switchTheme(id) {
    setTheme(id);
    repaintAll();
    this.paintIcons();
    this.renderSpot();
    this.render();
    this.raining = null;
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
      className: `pixel-btn${id === language() ? " pixel-btn-primary" : ""}`,
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
    $("#style-options").replaceChildren(...THEMES.map((id) => element("button", {
      className: `pixel-btn${id === theme() ? " pixel-btn-primary" : ""}`,
      type: "button",
      role: "radio",
      ariaChecked: String(id === theme()),
      textContent: t(`style.${id}`),
      onclick: () => {
        this.switchTheme(id);
        this.openSettings();
      },
    })));
    $("#style-hint").textContent = t(theme() === "dark" ? "style.darkHint" : "style.classicHint");
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
    // Rebuild only when the kind of view changes, so typing isn't lost on redraws.
    if (body.dataset.mode !== mode || !body.firstChild) {
      body.dataset.mode = mode;
      this.accountMessage = null;
      body.replaceChildren(...this.buildAccount(mode));
    }
    this.updateAccount(mode);
    // Back from a password reset email: the new-password form comes straight up.
    if (mode === "recover" && !$("#account-dialog").open) $("#account-dialog").showModal();
  }

  /** The account view's elements for one mode: off, out (sign in), in (profile) or recover. */
  buildAccount(mode) {
    const cloud = this.cloud;
    const note = (text, className = "account-note") => element("p", { className, textContent: text });
    const input = (props, label) => {
      const node = element("input", { className: "text-input", ...props, placeholder: label });
      node.setAttribute("aria-label", label);
      return node;
    };
    const message = () => element("p", { className: "account-message", role: "status" });
    const say = (text, bad = false) => {
      this.accountMessage = { text, bad };
      this.renderAccount();
    };
    const passwordOk = (field) => {
      if (field.value.length >= 6) return true;
      say(t("account.short"), true);
      return false;
    };

    if (mode === "off") return [note(t("account.unavailable"))];

    if (mode === "out") {
      const email = input({ type: "email", name: "email", autocomplete: "email" }, t("account.email"));
      const password = input({ type: "password", name: "password", autocomplete: "current-password" }, t("account.password"));
      const submit = async (action) => {
        if (!email.value.includes("@")) return say(t("account.needEmail"), true);
        if (!passwordOk(password)) return;
        password.autocomplete = action === "signUp" ? "new-password" : "current-password";
        this.accountMessage = null;
        const result = await cloud[action](email.value.trim(), password.value);
        if (result?.confirm) this.accountMessage = { text: t("account.checkEmail") };
        else if (!result?.error) password.value = "";
        this.renderAccount();
      };
      const forgot = async () => {
        if (!email.value.includes("@")) return say(t("account.needEmail"), true);
        const result = await cloud.resetPassword(email.value.trim());
        if (!result?.error) say(t("account.resetSent", { email: email.value.trim() }));
      };
      return [element("form", { className: "account-form", noValidate: true, onsubmit: (event) => { event.preventDefault(); submit("signIn"); } }, [
        note(t("account.intro")),
        email,
        password,
        element("div", { className: "account-actions" }, [
          element("button", { className: "pixel-btn pixel-btn-primary", type: "submit", textContent: t("account.signIn") }),
          element("button", { className: "pixel-btn", type: "button", textContent: t("account.signUp"), onclick: () => submit("signUp") }),
        ]),
        element("button", { className: "link-btn", type: "button", textContent: t("account.forgot"), onclick: forgot }),
        message(),
      ])];
    }

    if (mode === "recover") {
      const password = input({ type: "password", name: "new-password", autocomplete: "new-password" }, t("account.newPassword"));
      return [element("form", { className: "account-form", noValidate: true, onsubmit: async (event) => {
        event.preventDefault();
        if (!passwordOk(password)) return;
        const result = await cloud.setPassword(password.value);
        if (!result?.error) say(t("account.passwordSaved"));
      } }, [
        note(t("account.recoverIntro")),
        password,
        element("button", { className: "pixel-btn pixel-btn-primary", type: "submit", textContent: t("account.setPassword") }),
        message(),
      ])];
    }

    // Signed in: who you are, sync state, a nickname, and the way out.
    const nickname = input({ type: "text", name: "nickname", autocomplete: "nickname", maxLength: 16, value: cloud.user.user_metadata?.nickname ?? "" }, t("account.nickname"));
    return [
      note("", "account-name"),
      note("", "account-email"),
      note("", "account-status"),
      element("form", { className: "account-form nickname-form", noValidate: true, onsubmit: async (event) => {
        event.preventDefault();
        if (!validNickname(nickname.value)) return say(t("account.nickRules"), true);
        const result = await cloud.setNickname(nickname.value);
        if (!result?.error) say(t("account.nicknameSaved"));
      } }, [
        element("label", { className: "setting-label", textContent: t("account.nickname") }),
        element("div", { className: "nickname-row" }, [
          nickname,
          element("button", { className: "pixel-btn pixel-btn-primary", type: "submit", textContent: t("account.saveNickname") }),
        ]),
        note(t("account.nicknameHint"), "account-hint"),
      ]),
      message(),
      element("button", { className: "pixel-btn", type: "button", textContent: t("account.signOut"), onclick: () => cloud.signOut() }),
    ];
  }

  /** Refresh the parts of the account view that change: names, sync time, busy state, messages. */
  updateAccount(mode) {
    const cloud = this.cloud;
    const body = $("#account-body");
    if (mode === "off") return;
    for (const button of body.querySelectorAll("button")) button.disabled = cloud.busy;
    if (mode === "in") {
      const nickname = cloud.user.user_metadata?.nickname;
      const time = cloud.lastSync && new Date(cloud.lastSync).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
      body.querySelector(".account-name").textContent = t("account.signedIn", { name: cloud.displayName });
      const email = body.querySelector(".account-email");
      email.textContent = nickname ? t("account.emailLine", { email: cloud.user.email }) : "";
      email.hidden = !nickname;
      body.querySelector(".account-status").textContent = time ? t("account.synced", { time }) : t("account.notSynced");
    }
    // Common failures in plain words; anything else shows the server's message.
    const message = body.querySelector(".account-message");
    const failure = cloud.error && { text: t("account.error", { message: cloud.error }), bad: true };
    const shown = cloud.busy ? { text: t("account.working") } : failure || this.accountMessage;
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

  commit() {
    saveProgress(this.progress);
    this.render();
  }

  get baitCount() {
    return baitCount(this.progress, this.progress.bait);
  }

  /** Lock gear changes and leaving while a line is in the water. */
  setBusy(busy) {
    this.busy = busy;
    this.packSlot.disabled = busy;
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

    // The bait in use sits beside the backpack button.
    const chip = $("#bait-chip");
    $("#bait-chip-sprite").replaceChildren(baitSprite(progress.bait, 3));
    $("#bait-chip-count").textContent = countLabel(this.baitCount);
    chip.classList.toggle("is-empty", this.baitCount <= 0);
    chip.setAttribute("aria-label", `${t("a11y.bait")}: ${nameOf("bait", progress.bait)}, ${countLabel(this.baitCount)}`);
    this.packSlot.setAttribute("aria-label", `${t("menu.pack")}: ${nameOf("rod", progress.rod)}, ${t("shop.upTo", { weight: formatWeight(rod.maxKg) })}`);

    $("#pack-hook-count").textContent = `×${progress.hooks}`;
    $("#pack-hook-count").closest(".chip").classList.toggle("is-empty", progress.hooks <= 0);
  }

  /** A rain cloud beside the clock while it's raining. */
  setWeather(rain) {
    const raining = rain > 0.25;
    if (raining === this.raining) return;
    this.raining = raining;
    document.querySelectorAll(".weather-icon").forEach((node) => {
      if (!node.firstChild) node.append(rainSprite(3));
      node.hidden = !raining;
    });
  }

    /** In-game clock, e.g. "05:40", with a sun or moon beside it. */
  setClock(dayTime) {
    const minutes = Math.floor(dayTime * 24 * 60) % (24 * 60);
    const shown = minutes - (minutes % 10);
    if (shown === this.clockMinutes) return;
    this.clockMinutes = shown;
    const text = `${String(Math.floor(shown / 60)).padStart(2, "0")}:${String(shown % 60).padStart(2, "0")}`;
    const night = shown < 5 * 60 || shown >= 21 * 60;
    document.querySelectorAll(".clock-value").forEach((node) => { node.textContent = text; });
    if (night !== this.clockNight) {
      this.clockNight = night;
      document.querySelectorAll(".clock-icon").forEach((node) => node.replaceChildren(clockSprite(night, 3)));
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
      .filter(([id, bait]) => !bait.free && baitCount(progress, id) > 0)
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
  showCatch(fish, { bait } = {}) {
    const price = fishPrice(fish);
    const cost = trophyCost(fish);
    const dialog = this.catchDialog;
    $("#catch-title").textContent = nameOf("fish", fish.species);
    setContent($("#catch-art"), fishSprite(fish.species, 4, nameOf("fish", fish.species)));
    $("#catch-weight").textContent = formatWeight(fish.weight);
    $("#catch-price").textContent = `+${price} ₴`;
    // Valerka can't be sold or let go: the only choice is a free trophy.
    const unique = Boolean(fish.unique);
    $("#catch-trophy").textContent = unique ? t("catch.free") : `−${cost} ₴`;
    $("#sell-button").hidden = unique;
    $("#release-button").hidden = unique;
    $("#catch-note").hidden = !unique;
    $("#catch-note").textContent = unique ? t("catch.unique") : "";
    const mount = $("#mount-button");
    mount.disabled = this.progress.money < cost;
    mount.title = mount.disabled ? t("catch.noMoney") : "";

    return new Promise((resolve) => {
      const finish = (choice) => {
        dialog.close();
        resolve(choice);
      };
      $("#sell-button").onclick = this.guarded(dialog, () => {
        this.progress.money += price;
        this.commit();
        finish({ type: "sell", price });
      });
      mount.onclick = this.guarded(dialog, () => {
        this.progress.money -= cost;
        const date = new Date().toISOString();
        this.progress.trophies.unshift({ ...fish, id: `${date}-${fish.species}-${fish.weight}`, date, spot: this.progress.location, bait });
        this.commit();
        finish({ type: "mount", cost });
      });
      $("#release-button").onclick = this.guarded(dialog, () => finish({ type: "release" }));
      // Escape releases the fish rather than leaving the game stuck.
      dialog.oncancel = (event) => {
        event.preventDefault();
        if (unique) return;
        if (performance.now() - Number(dialog.dataset.openedAt ?? 0) >= DIALOG_GUARD_MS) finish({ type: "release" });
      };
      this.openGuarded(dialog);
    });
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
      apply();
      this.commit();
      this.openShop();
    };

    // Bread is free and never runs out, so it isn't sold.
    $("#bait-shop").replaceChildren(...Object.entries(BAITS).filter(([, bait]) => !bait.free).map(([id, bait]) => {
      const qty = this.shopQuantities[id] ?? 1;
      const total = qty * bait.price;
      return element("li", { className: "card" }, [
        element("div", { className: "card-art" }, [baitSprite(id, 4)]),
        element("strong", { textContent: nameOf("bait", id) }),
        element("span", { className: "card-price", textContent: t("shop.each", { price: bait.price }) }),
        element("span", { className: "card-stock", textContent: t("shop.inPack", { count: progress.baits[id] ?? 0 }) }),
        this.stepper(id, bait.price),
        element("button", {
          className: "pixel-btn pixel-btn-primary",
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
            className: "pixel-btn pixel-btn-primary",
            type: "button",
            disabled: progress.money < rod.price,
            onclick: pay(rod.price, () => {
              progress.rods.push(id);
              progress.rod = id;
            }),
          }, [formatMoney(rod.price)]),
      ]);
    }));

    const hookQty = this.shopQuantities.hooks ?? 1;
    const hookCard = element("li", { className: "card" }, [
      element("div", { className: "card-art" }, [hookSprite(4)]),
      element("strong", { textContent: t("shop.hooks") }),
      element("span", { className: "card-price", textContent: t("shop.each", { price: HOOK_PRICE }) }),
      element("span", { className: "card-stock", textContent: t("shop.inPack", { count: progress.hooks }) }),
      this.stepper("hooks", HOOK_PRICE),
      element("button", {
        className: "pixel-btn pixel-btn-primary",
        type: "button",
        disabled: progress.money < hookQty * HOOK_PRICE,
        onclick: pay(hookQty * HOOK_PRICE, () => {
          progress.hooks += hookQty;
          this.shopQuantities.hooks = 1;
        }),
      }, [t("shop.buy", { total: formatMoney(hookQty * HOOK_PRICE) })]),
    ]);
    $("#extra-shop").replaceChildren(hookCard, ...Object.entries(EXTRAS).map(([id, extra]) => {
      const owned = progress.extras.includes(id);
      return element("li", { className: `card${owned ? " is-owned" : ""}` }, [
        element("div", { className: "card-art" }, [extraSprite(id, 3)]),
        element("strong", { textContent: nameOf("extra", id) }),
        element("small", { textContent: nameOf("extraText", id) }),
        owned
          ? element("span", { className: "card-owned", textContent: t("shop.owned") })
          : element("button", {
            className: "pixel-btn pixel-btn-primary",
            type: "button",
            disabled: progress.money < extra.price,
            onclick: pay(extra.price, () => {
              progress.extras.push(id);
            }),
          }, [formatMoney(extra.price)]),
      ]);
    }));

    document.querySelectorAll("#bait-shop .card, #rod-shop .card, #extra-shop .card").forEach((card, index) => frame(card, "well", 300 + index));
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
    $("#pack-baits").replaceChildren(...this.ownedBaits().map((id) => tile(
      id === progress.bait, baitSprite(id, 3), nameOf("bait", id), countLabel(baitCount(progress, id)),
      choose(() => { progress.bait = id; }),
    )));
    $("#pack-extras").replaceChildren(...progress.extras.map((id) => tile(
      false, extraSprite(id, 3), nameOf("extra", id), id === "handbook" ? t("pack.read") : "",
      id === "handbook" ? () => this.openHandbook() : () => {},
    )));
    $("#pack-extras-empty").hidden = progress.extras.length > 0;
    if (!this.packDialog.open) this.packDialog.showModal();
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
      pages = handbookEntries().map((entry, index) => page(fishSprite(entry.id, FISH[entry.id].max < 4 ? 3 : 2), nameOf("fish", entry.id), t("handbook.weight", { range: entry.range, price: entry.pricePerKg }), [
        [t("handbook.livesIn"), entry.spots.map((spot) => t("handbook.spotIn", { spot: nameOf("location", spot.id), abundance: nameOf("abundance", spot.abundance), kg: formatWeight(spot.maxKg) }))],
        [t("handbook.bestBait"), entry.baits.length ? lower(list(entry.baits.map((bait) => nameOf("bait", bait)))) : t("handbook.baitsNone")],
        [t("handbook.otherBait"), lower(list(entry.alsoBaits.map((bait) => nameOf("bait", bait))))],
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
        const favourites = bait.fish.filter((fish) => fish.favourite).map((fish) => nameOf("fish", fish.id));
        const others = bait.fish.filter((fish) => !fish.favourite).map((fish) => nameOf("fish", fish.id));
        return page(baitSprite(bait.id, 3), nameOf("bait", bait.id), `${bait.free ? t("handbook.baitFree") : t("handbook.baitPrice", { price: bait.price })} · ${nameOf("baitSize", bait.size)}`, [
          [t("handbook.loves"), lower(list(favourites))],
          [t("handbook.takes"), lower(list(others))],
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
    if (id === "mine") {
      const { trophies } = this.progress;
      this.fillTrophyWall(trophies, trophies.length ? "" : t("trophies.empty"));
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

  /** Draw trophy cards: fish, weight, who caught it (for others), where, on what bait and when. */
  fillTrophyWall(trophies, emptyText, hint = "") {
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
