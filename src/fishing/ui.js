import {
  BAITS, EXTRAS, HOOK_PRICE, LOCATIONS, RODS,
  fishPrice, formatMoney, formatWeight, handbookEntries, trophyCost,
} from "./data.js";
import {
  bagSprite, baitSprite, clockSprite, gearSprite, rainSprite, coinSprite, cupSprite, exitSprite, extraSprite, fishSprite, hookSprite, packSprite, rodSprite,
} from "./sprites.js";
import { frame, frameAll, repaint, setContent } from "./frames.js";
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
const describePlace = (traits) => `${traitValue("type", traits.type)} (${traitValue("depth", traits.depth)}, ${traitValue("bottom", traits.bottom)})`.toLowerCase();

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
    this.picker = $("#picker");
    this.rodSlot = $("#rod-slot");
    this.baitSlot = $("#bait-slot");
    this.shopQuantities = {};

    frameAll();
    document.querySelectorAll(".coin-slot").forEach((slot) => slot.append(coinSprite(3)));
    $("#shop-icon").append(bagSprite(3));
    $("#pack-icon").append(packSprite(3));
    $("#trophy-icon").append(cupSprite(3));
    $("#exit-button").append(exitSprite(3));
    $("#settings-icon").append(gearSprite(3));
    $("#hook-sprite").append(hookSprite(3));

    this.rodSlot.addEventListener("click", () => this.togglePicker("rod"));
    this.baitSlot.addEventListener("click", () => this.togglePicker("bait"));
    document.addEventListener("pointerdown", (event) => {
      if (!this.picker.hidden && !event.target.closest("#loadout")) this.closePicker();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.closePicker();
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
    for (const tab of document.querySelectorAll(".tab")) {
      tab.addEventListener("click", () => this.showShopTab(tab.dataset.tab));
    }

    this.applyLanguage();
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
    if (!this.settingsDialog.open) this.settingsDialog.showModal();
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
    this.rodSlot.disabled = busy;
    this.baitSlot.disabled = busy;
    $("#exit-button").disabled = busy;
    if (busy) this.closePicker();
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

    $("#rod-sprite").replaceChildren(rodArt(progress.rod, 3));
    $("#rod-tag").textContent = formatWeight(rod.maxKg);
    this.rodSlot.setAttribute("aria-label", `${t("a11y.rod")}: ${nameOf("rod", progress.rod)}, ${t("shop.upTo", { weight: formatWeight(rod.maxKg) })}`);

    $("#bait-sprite").replaceChildren(baitSprite(progress.bait, 3));
    $("#bait-tag").textContent = countLabel(this.baitCount);
    this.baitSlot.classList.toggle("is-empty", this.baitCount <= 0);
    this.baitSlot.setAttribute("aria-label", `${t("a11y.bait")}: ${nameOf("bait", progress.bait)}, ${countLabel(this.baitCount)}`);

    $("#hook-tag").textContent = `×${progress.hooks}`;
    $("#hook-slot").classList.toggle("is-empty", progress.hooks <= 0);
    $("#hook-slot").setAttribute("aria-label", `${t("a11y.hooks")}: ${progress.hooks} ${t("unit.pcs")}`);

    if (!this.picker.hidden) this.fillPicker(this.pickerKind);
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
    $("#spot-label").textContent = nameOf("location", spot.id);
    setContent($("#spot-traits"), ...Object.entries(spot.traits).flatMap(([key, value]) => [
      element("dt", { textContent: traitLabel(key) }),
      element("dd", { textContent: traitValue(key, value) }),
    ]));
    $("#spot-dots").replaceChildren(...LOCATIONS.map((_, index) => element("span", { className: index === this.progress.location ? "is-active" : "" })));
  }

  /* ---------- Loadout picker ---------- */

  togglePicker(kind) {
    if (this.busy) return;
    if (!this.picker.hidden && this.pickerKind === kind) {
      this.closePicker();
      return;
    }
    this.pickerKind = kind;
    this.fillPicker(kind);
    this.picker.hidden = false;
    this.picker.dataset.kind = kind;
    this.rodSlot.setAttribute("aria-expanded", String(kind === "rod"));
    this.baitSlot.setAttribute("aria-expanded", String(kind === "bait"));
    this.picker.querySelector("[aria-selected='true']")?.focus();
  }

  closePicker() {
    this.picker.hidden = true;
    this.rodSlot.setAttribute("aria-expanded", "false");
    this.baitSlot.setAttribute("aria-expanded", "false");
  }

  ownedBaits() {
    return Object.keys(BAITS).filter((id) => baitCount(this.progress, id) > 0 || id === this.progress.bait);
  }

  fillPicker(kind) {
    const { progress } = this;
    const choose = (apply) => () => {
      apply();
      this.closePicker();
      this.commit();
    };
    const items = kind === "rod"
      ? progress.rods.map((id) => ({
        selected: id === progress.rod,
        art: rodArt(id, 2),
        title: nameOf("rod", id),
        tag: formatWeight(RODS[id].maxKg),
        onclick: choose(() => { progress.rod = id; }),
      }))
      : this.ownedBaits().map((id) => ({
        selected: id === progress.bait,
        art: baitSprite(id, 2),
        title: nameOf("bait", id),
        tag: countLabel(baitCount(progress, id)),
        onclick: choose(() => { progress.bait = id; }),
      }));

    setContent(this.picker, ...items.map((item) => element("button", {
      className: `pick${item.selected ? " is-selected" : ""}`,
      type: "button",
      role: "option",
      ariaSelected: String(item.selected),
      title: item.title,
      onclick: item.onclick,
    }, [item.art, element("span", { className: "pick-tag", textContent: item.tag })])));
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
  showCatch(fish) {
    const price = fishPrice(fish);
    const cost = trophyCost(fish);
    const dialog = this.catchDialog;
    $("#catch-title").textContent = nameOf("fish", fish.species);
    setContent($("#catch-art"), fishSprite(fish.species, 4, nameOf("fish", fish.species)));
    $("#catch-weight").textContent = formatWeight(fish.weight);
    $("#catch-price").textContent = `+${price} ₴`;
    $("#catch-trophy").textContent = `−${cost} ₴`;
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
        this.progress.trophies.unshift({ ...fish, date: new Date().toISOString(), spot: this.progress.location });
        this.commit();
        finish({ type: "mount", cost });
      });
      $("#release-button").onclick = this.guarded(dialog, () => finish({ type: "release" }));
      // Escape releases the fish rather than leaving the game stuck.
      dialog.oncancel = (event) => {
        event.preventDefault();
        if (performance.now() - Number(dialog.dataset.openedAt ?? 0) >= DIALOG_GUARD_MS) finish({ type: "release" });
      };
      this.openGuarded(dialog);
    });
  }

  /* ---------- Shop ---------- */

  showShopTab(id) {
    for (const tab of document.querySelectorAll(".tab")) {
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
        element("button", {
          className: `pixel-btn${owned ? " pixel-btn-quiet" : " pixel-btn-primary"}`,
          type: "button",
          disabled: owned || progress.money < rod.price,
          onclick: pay(rod.price, () => {
            progress.rods.push(id);
            progress.rod = id;
          }),
        }, [owned ? t("shop.owned") : formatMoney(rod.price)]),
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
        element("button", {
          className: `pixel-btn${owned ? " pixel-btn-quiet" : " pixel-btn-primary"}`,
          type: "button",
          disabled: owned || progress.money < extra.price,
          onclick: pay(extra.price, () => {
            progress.extras.push(id);
          }),
        }, [owned ? t("shop.owned") : formatMoney(extra.price)]),
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
    $("#pack-extras").replaceChildren(tile(false, hookSprite(3), t("shop.hooks"), `×${progress.hooks}`, () => {}), ...progress.extras.map((id) => tile(
      false, extraSprite(id, 3), nameOf("extra", id), id === "handbook" ? t("pack.read") : "",
      id === "handbook" ? () => this.openHandbook() : () => {},
    )));
    $("#pack-extras-empty").hidden = true;
    if (!this.packDialog.open) this.packDialog.showModal();
  }

  openHandbook() {
    const rules = element("li", { className: "handbook-page handbook-rules" }, [
      element("strong", { textContent: t("handbook.rules") }),
      element("dl", {}, handbookRules().flatMap(([title, text]) => [element("dt", { textContent: title }), element("dd", { textContent: text })])),
    ]);
    frame(rules, "box", 699);
    $("#handbook-list").replaceChildren(rules, ...handbookEntries().map((entry) => {
      const page = element("li", { className: "handbook-page" }, [
        element("div", { className: "handbook-fish" }, [fishSprite(entry.id, 2)]),
        element("div", {}, [
          element("strong", { textContent: nameOf("fish", entry.id) }),
          element("small", { textContent: entry.range }),
          element("p", { textContent: t("handbook.where", { places: entry.places.map(describePlace).join("; ") || t("handbook.whereNone") }) }),
          element("p", { textContent: t("handbook.baits", { baits: entry.baits.map((id) => nameOf("bait", id).toLowerCase()).join(", ") || t("handbook.baitsNone") }) }),
          element("p", { textContent: t("handbook.active", { times: entry.times.map(periodName).join(", ") }) }),
        ]),
      ]);
      frame(page, "box", 700 + entry.id.length);
      return page;
    }));
    this.handbookDialog.showModal();
  }

  /* ---------- Trophies ---------- */

  openTrophies() {
    const { trophies } = this.progress;
    $("#trophy-empty").hidden = trophies.length > 0;
    $("#trophy-wall").replaceChildren(...trophies.map((fish, index) => {
      const tab = element("div", { className: "title-tab title-tab-small", textContent: nameOf("fish", fish.species) });
      const picture = element("div", { className: "picture" }, [fishSprite(fish.species, 3)]);
      const caption = element("div", { className: "caption" }, [
        element("strong", { textContent: formatWeight(fish.weight) }),
        element("small", { textContent: [LOCATIONS[fish.spot] ? nameOf("location", LOCATIONS[fish.spot].id) : null, new Date(fish.date).toLocaleDateString(locale(), { day: "numeric", month: "short", year: "numeric" })].filter(Boolean).join(" · ") }),
      ]);
      const card = element("li", { className: "trophy" }, [element("div", { className: "card-scene" }, [tab, picture]), caption]);
      frame(picture, "picture", 500 + index * 7);
      frame(tab, "tab");
      frame(caption, "box", 900 + index);
      return card;
    }));
    this.trophyDialog.showModal();
  }
}
