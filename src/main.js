import { CanvasWaterRenderer } from "./canvas-renderer.js";
import { activeScene, currentAt, setScene } from "./scene.js";
import { DAY_SECONDS, dayTimeAt } from "./daycycle.js";
import { nameOf, t } from "./i18n.js";
import { Weather } from "./weather.js";
import { Ducks } from "./wildlife.js";
import { FishingGame, TUNING } from "./fishing/game.js";
import { BAITS, GROUNDBAIT, HOOKS, LOCATIONS, RODS } from "./fishing/data.js";
import { baitCount, loadProgress, onProgressSaved, replaceProgress, saveProgress } from "./fishing/store.js";
import { Cloud } from "./cloud.js";
import { onSeasonChange } from "./theme.js";
import { NightEvents } from "./night-events.js";
import { track } from "./analytics.js";
import { AnglerUI } from "./fishing/ui.js";

// The water look is fixed: a still lake, gentle swell speed, soft glints.
const config = {
  spacing: 5,
  charSize: 7,
  waveSpeed: 0.1,
  waveAmplitude: 0,
  shimmer: 0.51,
  waterColor: LOCATIONS[0].water,
};

// A full day takes DAY_SECONDS (21 min 20 s): day 10 min, sunset 1.5 min,
// night 8 min 20 s, sunrise 1.5 min; it starts mid-afternoon.
// `?time=0.5` pins the clock (0 midnight, 0.25 dawn, 0.5 noon, 0.76 evening);
// `?day=60` squeezes the whole cycle into 60 seconds.
const params = new URLSearchParams(location.search);
const DAY_LENGTH = Number(params.get("day")) || DAY_SECONDS;
const FIXED_TIME = params.has("time") ? Number(params.get("time")) : null;
// The clock is the same for every angler: the day runs off real time (Unix
// seconds), with the cycle at this clock fraction at the Unix epoch.
const WORLD_START = 0.68;
const worldDayTime = () => dayTimeAt(Date.now() / 1000, WORLD_START, DAY_LENGTH);
// `?rain=1` forces rain (0..1); otherwise showers come and go on their own.
const weather = new Weather({ forced: params.has("rain") ? Number(params.get("rain")) : null });
const ducks = new Ducks();
// Mystic nights: lights over the water, an apparition by the far shore, eyes by the bank.
// Each event is also announced on the window as
// "doberega:night" ({ type }) so sounds can hook in later without touching this.
const nightEvents = new NightEvents({
  onEvent: (type, data) => {
    window.dispatchEvent(new CustomEvent("doberega:night", { detail: { type, kind: data?.kind } }));
    if (type === "eyesSink") {
      // The eyes slip under, leaving rings on the water.
      const x = renderer.frame.left + data.x * renderer.frame.width;
      addRipple({ ...renderer.screenToPlane(x, height * data.y), time: lastElapsed, strength: 0.5, size: 0.8 });
    }
    if (type === "mavkaSink") {
      // The mavka walks under at the far edge, and rings spread where she went.
      const x = renderer.frame.left + data.x * renderer.frame.width;
      addRipple({ ...renderer.screenToPlane(x, renderer.shorelineY(x) + height * 0.02), time: lastElapsed, strength: 0.4, size: 0.6 });
    }
  },
});

const canvas = document.querySelector("#water-canvas");
const renderer = new CanvasWaterRenderer(canvas);

let width = 0;
let height = 0;
let startTime = performance.now();
let pauseDuration = 0;
let animationFrame = 0;
let hiddenAt = null;
let pendingContact = null;
let pullPointer = null;
let nextFishAt = 4;
let lastElapsed = 0;
let shownPhase = "";
let spaceHeld = false;
const ripples = [];

function getElapsed(now) {
  return Math.max(0, (now - startTime - pauseDuration) / 1000);
}

function addRipple(ripple) {
  ripples.push(ripple);
  while (ripples.length > 8) ripples.shift();
}

// --- Fishing -----------------------------------------------------------------

const progress = loadProgress();
const game = new FishingGame({ onEvent: handleGameEvent });
let mode = "menu";

// Each spot has its own landscape and water tint. Building one takes a moment,
// so leafing through spots in the menu only changes the picture there: the
// scene behind the menu (barely visible through it) is built once you go fishing.
let builtSpot = null;
function applySpot() {
  const spot = LOCATIONS[progress.location];
  builtSpot = progress.location;
  config.waterColor = spot.water;
  setScene(spot.kind);
  // One rebuild: resize lays the new scene out (and centres a phone's view on its point of interest).
  if (width) resize(true);
  else renderer.setScene(spot.kind, config);
  ducks.reset();
  // Casts can land from just past the far shore to near the bank.
  TUNING.farY = activeScene().horizon + 0.05;
}

/** Build the chosen spot's scene if the menu moved on since the last one. */
function ensureSpot() {
  if (builtSpot !== progress.location) applySpot();
}

function setMode(next) {
  mode = next;
  document.body.classList.toggle("in-menu", next === "menu");
  document.body.classList.toggle("in-game", next === "fishing");
  if (next === "menu") {
    game.reset();
    spaceHeld = false;
  }
}

const ui = new AnglerUI(progress, {
  onFish: () => {
    const go = () => {
      ui.chooseBestBait();
      setMode("fishing");
      track("fish");
    };
    if (builtSpot === progress.location) return go();
    // A new spot: say so on the button, let that paint, then build the scene and go.
    const button = document.querySelector("#fish-button");
    button.disabled = true;
    button.textContent = t("menu.loading");
    requestAnimationFrame(() => setTimeout(() => {
      ensureSpot();
      button.disabled = false;
      button.textContent = t("menu.fish");
      go();
    }, 0));
  },
  onExit: () => setMode("menu"),
  // In the menu only the picture changes; the scene is built on Fish.
  onSpotChange: () => {
    if (mode !== "menu") applySpot();
  },
  isFishing: () => mode === "fishing",
});
applySpot();

// Accounts: every save goes up to the cloud; signing in elsewhere brings it back.
const cloud = new Cloud({
  getProgress: () => progress,
  applyProgress: (save) => {
    replaceProgress(progress, save);
    saveProgress(progress, { quiet: true });
    ui.renderSpot();
    ui.render();
    applySpot();
  },
  chooseSave: (saves) => ui.chooseSave(saves),
  onChange: () => ui.renderAccount(),
});
ui.setCloud(cloud);
// A new season repaints the woods and the grass.
onSeasonChange(() => {
  renderer.lightKey = null;
  renderer.paletteKey = "";
  resize();
});
onProgressSaved(() => cloud.schedulePush());
window.addEventListener("pagehide", () => cloud.flush());
cloud.init();
// One anonymous "visit" per page open, for the stats page (see analytics.js),
// counted once the page has been on screen for two seconds.
track("visit", { after: 2000 });

function toScreen(point) {
  return { x: point.x * width, y: point.y * height };
}

function handleGameEvent(type, data) {
  if (type === "ripple") {
    const point = toScreen(data);
    addRipple({ ...renderer.screenToPlane(point.x, point.y), time: lastElapsed, strength: data.strength, size: data.size });
  } else if (type === "retrieved") {
    // The spoon came back untouched: cast again.
    ui.toast(t("toast.recast"), "", 900);
  } else if (type === "strike") {
    // A fish hit the spoon: a buzz in the hand on a phone.
    navigator.vibrate?.(60);
  } else if (type === "outcome") {
    if (BAITS[data.bait].lure) {
      // The spoon comes back with every fish; only a broken line loses it (and it carries its own hook).
      if (data.hookLost) progress.baits[data.bait] = Math.max(0, (progress.baits[data.bait] ?? 0) - 1);
    } else {
      // The bait is gone whether the fish escaped or was landed; a plain recast keeps it.
      if (!BAITS[data.bait].free) progress.baits[data.bait] = Math.max(0, (progress.baits[data.bait] ?? 0) - 1);
      if (data.hookLost) progress.hooks[data.hook] = Math.max(0, (progress.hooks[data.hook] ?? 0) - 1);
    }
    pullPointer = null;
    switchBaitIfEmpty();
    ui.commit();
    if (data.type === "escape") {
      const lure = BAITS[data.bait].lure;
      const losses = [
        BAITS[data.bait].free || (lure && !data.hookLost) ? "" : t("toast.lostBait", { bait: nameOf("bait", data.bait).toLowerCase() }),
        data.hookLost && !lure ? t("toast.lostHook") : "",
      ].filter(Boolean);
      const headline = t(`toast.${data.headline ?? "escape"}`);
      ui.toast(`${headline}${losses.length ? ` · ${losses.join(", ")}` : ""}`, "bad", 2400);
    } else {
      progress.caught += 1;
      track("catch");
      game.release();
      ui.showCatch(data.fish, { bait: data.bait }).then((choice) => {
        if (choice.type === "sell") ui.toast(`+${choice.price} ₴`, "good", 1200);
        else if (choice.type === "mount") ui.toast(t("toast.trophy"), "good", 1200);
        game.reset();
        // The first fish ever is the moment to suggest keeping progress safe.
        if (progress.caught === 1) ui.offerSignIn();
      });
    }
  }
}

function switchBaitIfEmpty() {
  if (baitCount(progress, progress.bait) > 0) return;
  // Bread never runs out, so there is always something to fall back on.
  progress.bait = Object.keys(BAITS).find((id) => !BAITS[id].free && (progress.baits[id] ?? 0) > 0) ?? "bread";
}

function isOnWater(x, y) {
  return y > Math.max(renderer.shorelineY(x) + height * 0.04, height * TUNING.farY)
    && y < height * TUNING.nearY
    && renderer.isOpenWater(x, y);
}

// The float drifts only where the current runs, and never onto a bank.
game.currentAt = (x, y) => currentAt(x, y);
game.isWater = (point) => isOnWater(point.x * width, point.y * height);

function tryCast(x, y) {
  if (mode !== "fishing" || !isOnWater(x, y)) return;
  if (ui.baitCount <= 0) {
    ui.toast(t("toast.noBait"), "bad", 1600);
    return;
  }
  const lure = BAITS[progress.bait].lure;
  // The spoon is fished on a spinning reel and carries its own hook.
  if (lure && !progress.extras.includes("spinreel")) {
    ui.toast(t("toast.needReel"), "bad", 1800);
    return;
  }
  if (!lure && (progress.hooks[progress.hook] ?? 0) <= 0) {
    // Out of this size: put on another size you still have, and say so.
    const spare = Object.keys(HOOKS).find((id) => (progress.hooks[id] ?? 0) > 0);
    if (!spare) {
      ui.toast(t("toast.noHooks"), "bad", 1600);
      return;
    }
    progress.hook = spare;
    ui.commit();
    ui.toast(t("toast.hookSwitched", { hook: nameOf("hook", spare).toLowerCase() }), "", 1800);
  }
  const groundbait = (progress.baited[LOCATIONS[progress.location].id] ?? 0) > 0;
  if (game.cast({ x: x / width, y: y / height }, progress.rod, progress.bait, { location: progress.location, extras: progress.extras, groundbait, hook: progress.hook })) {
    // Get the pointer out of the way while watching the float.
    document.body.classList.add("cursor-hidden");
  }
}

// `?debug` exposes the game for manual testing from the console.
if (params.has("debug")) window.doberega = { game, progress, ui, cloud, nightEvents, renderNow, renderer, config, ripples, weather, ducks };

const pullable = () => ["waiting", "retrieving", "nibble", "bite", "fight"].includes(game.phase);

function startPull() {
  if (pullable()) game.press();
}

function stopPull() {
  game.release();
}

function syncFishingUi() {
  if (game.phase !== shownPhase) {
    shownPhase = game.phase;
    ui.setBusy(game.busy);
    document.body.classList.toggle("is-fishing", game.busy);
    ui.showFight(game.phase === "fight");
  }
  if (game.phase === "fight") ui.updateFight(game.tension);
}

function anglerView(elapsed) {
  const target = game.target ? toScreen(game.target) : null;
  return {
    phase: game.phase,
    time: elapsed,
    target,
    castProgress: game.phase === "casting" ? Math.min(1, game.clock / game.castDuration) : 1,
    castStyle: game.castStyle,
    reelProgress: game.reelProgress,
    reelSkim: TUNING.reelSkim,
    // The spoon on the line from the moment it's picked, not only once it's cast.
    lure: Boolean(BAITS[game.busy ? game.bait : progress.bait]?.lure),
    float: game.float,
    bob: target ? renderer.surfaceOffset(target.x, target.y, elapsed, config, ripples) : { x: 0, y: 0 },
    fish: game.phase === "fight" ? toScreen(game.fishPosition()) : null,
    tension: game.tension,
    pulling: game.pulling,
    snag: game.snag,
    junk: Boolean(game.fish?.junk),
    distance: game.distance,
    rodTier: RODS[game.busy && game.rod ? game.rod : progress.rod].tier,
    hidden: mode === "menu",
    glowFloat: progress.extras.includes("glowfloat"),
  };
}

// Now and then a fish breaks the surface somewhere out on the lake.
function maybeJumpFish(elapsed) {
  if (elapsed < nextFishAt) return;
  nextFishAt = elapsed + 6 + Math.random() * 12;
  addRipple({ ...renderer.randomWaterPoint(), time: elapsed, strength: 0.6, size: 0.3 + Math.random() * 0.3 });
}

/**
 * Groundbait counts down in game hours as the game runs, at every baited water,
 * whether you're there or not. The countdown is saved locally now and then;
 * the cloud gets it with the next real save.
 */
let groundbaitSaveClock = 0;
function tickGroundbait(step) {
  const spots = Object.keys(progress.baited);
  if (!spots.length || step <= 0) return;
  const hours = (step * 24) / DAY_LENGTH;
  for (const id of spots) {
    progress.baited[id] -= hours;
    if (progress.baited[id] > 0) continue;
    delete progress.baited[id];
    if (mode === "fishing" && id === LOCATIONS[progress.location].id) ui.toast(t("toast.groundbaitOver"), "", 2200);
    ui.commit();
  }
  groundbaitSaveClock += step;
  if (groundbaitSaveClock > 30) {
    groundbaitSaveClock = 0;
    saveProgress(progress, { quiet: true });
  }
}

function renderNow(now = performance.now()) {
  const elapsed = getElapsed(now);
  maybeJumpFish(elapsed);
  const dt = elapsed - lastElapsed;
  lastElapsed = elapsed;
  const step = Math.max(0, Math.min(dt, 0.1));
  weather.update(step);
  game.biteBoost = weather.biteBoost;
  const dayTime = FIXED_TIME ?? worldDayTime();
  // Ducks only come out between 6:00 and 20:00.
  const hour = (dayTime * 24) % 24;
  ducks.update(step, elapsed, width, height, renderer.shorelineY(width / 2), (x, y) => renderer.isDuckWater(x, y), hour >= 6 && hour < 20);
  // A duck paddling over the float eats the bait.
  if (mode === "fishing" && game.target && ["waiting", "nibble", "bite"].includes(game.phase)) {
    const float = toScreen(game.target);
    if (ducks.near(float.x, float.y, 26)) game.duckSteal();
  }
  if (step > 0) game.update(step);
  syncFishingUi();
  game.hour = dayTime * 24;
  ui.setClock(dayTime);
  tickGroundbait(step);
  ui.setGroundbait(mode === "fishing" ? progress.baited[LOCATIONS[progress.location].id] ?? 0 : 0);
  ui.setWeather(weather.intensity);
  nightEvents.update(step, elapsed, dayTime);
  renderer.render(elapsed, config, ripples, anglerView(elapsed), dayTime, {
    rain: weather.intensity,
    ducks: ducks.all,
    night: nightEvents.visible(elapsed),
  });
}

// A phone held upright would squeeze the landscape sideways. Instead the scene
// is laid out at least this wide (relative to its height) and the screen shows
// a slice of it, centred on what the spot is about.
const MIN_ASPECT = 1.15;

/*
 * An iPhone home-screen app with a see-through status bar lays out (and clips
 * anything pinned with position: fixed to) a viewport one status bar short,
 * leaving the bottom of the screen bare. There the page drops the pinning and
 * the scene simply takes 100vh, which is the whole screen (see .ios-app in
 * styles.css).
 */
document.documentElement.classList.toggle("ios-app", window.navigator.standalone === true);

// A focused field (or a stray gesture) can scroll even a pinned page on iOS; put it back.
const unscroll = () => {
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
};
window.addEventListener("scroll", unscroll, { passive: true });
document.addEventListener("focusout", () => setTimeout(unscroll, 50));

/*
 * The on-screen keyboard covers the bottom of the screen without resizing the
 * page, so a centred window's fields end up under it. While it is up, windows
 * move into the part of the screen left visible (see .keyboard-open in
 * styles.css) and scroll, and the field being typed in is brought into view.
 */
function fitKeyboard() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  const covered = window.innerHeight - viewport.height - viewport.offsetTop;
  const root = document.documentElement;
  root.classList.toggle("keyboard-open", covered > 80);
  root.style.setProperty("--visible-top", `${Math.round(viewport.offsetTop)}px`);
  root.style.setProperty("--visible-height", `${Math.round(viewport.height)}px`);
}
window.visualViewport?.addEventListener("resize", fitKeyboard, { passive: true });
window.visualViewport?.addEventListener("scroll", fitKeyboard, { passive: true });
document.addEventListener("focusin", (event) => {
  if (!event.target.matches?.("input, textarea") || !event.target.closest("dialog")) return;
  // Once the keyboard has slid up, put the field in the middle of what's left.
  setTimeout(() => {
    fitKeyboard();
    event.target.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 320);
});

/** Triple tap on the menu title: what the phone reports about its screen, to chase layout bugs. */
function layoutReport() {
  const probe = (css) => {
    const node = Object.assign(document.createElement("div"), { style: `position:absolute;visibility:hidden;height:${css}` });
    document.body.append(node);
    const value = node.getBoundingClientRect().height;
    node.remove();
    return Math.round(value);
  };
  const safe = (side) => probe(`env(safe-area-inset-${side}, 0px)`);
  const scene = canvas.parentElement.getBoundingClientRect();
  return [
    `standalone ${window.navigator.standalone === true} · display-mode ${window.matchMedia("(display-mode: standalone)").matches ? "standalone" : "browser"}`,
    `inner ${window.innerWidth}×${window.innerHeight} · screen ${screen.width}×${screen.height} · dpr ${window.devicePixelRatio}`,
    `visual ${Math.round(window.visualViewport?.width ?? 0)}×${Math.round(window.visualViewport?.height ?? 0)} @${Math.round(window.visualViewport?.offsetTop ?? 0)} · scroll ${window.scrollX},${window.scrollY}`,
    `100vh ${probe("100vh")} · 100dvh ${probe("100dvh")} · 100lvh ${probe("100lvh")} · 100svh ${probe("100svh")}`,
    `safe top ${safe("top")} bottom ${safe("bottom")} left ${safe("left")} right ${safe("right")}`,
    `html ${document.documentElement.clientHeight} · scene ${Math.round(scene.top)}..${Math.round(scene.bottom)} · canvas ${height}`,
  ].join("\n");
}
let titleTaps = [];
document.querySelector("#menu-title")?.addEventListener("click", () => {
  const now = performance.now();
  titleTaps = [...titleTaps.filter((time) => now - time < 700), now];
  if (titleTaps.length < 3) return;
  titleTaps = [];
  let panel = document.querySelector("#layout-report");
  if (panel) {
    panel.remove();
    return;
  }
  panel = Object.assign(document.createElement("pre"), { id: "layout-report", textContent: layoutReport() });
  panel.addEventListener("click", () => panel.remove());
  document.body.append(panel);
});

let laidOut = "";
function resize(force = false) {
  const bounds = canvas.parentElement.getBoundingClientRect();
  const viewWidth = Math.round(bounds.width);
  // The keyboard opening (and other visual-viewport nudges) can fire this without
  // the scene changing size: don't rebuild the whole scene for nothing.
  const key = `${viewWidth}x${Math.round(bounds.height)}`;
  if (!force && key === laidOut) return;
  laidOut = key;
  height = Math.round(bounds.height);
  width = Math.max(viewWidth, Math.round(height * MIN_ASPECT));
  const focus = activeScene().focus ?? 0.5;
  // Snap the slice to the glyph grid so the foreground lines up with the water.
  const left = Math.round(Math.min(width - viewWidth, Math.max(0, focus * width - viewWidth / 2)) / config.spacing) * config.spacing;
  for (const node of [canvas, renderer.overlay]) {
    node.style.width = `${width}px`;
    node.style.left = `${-left}px`;
  }
  game.landingX = (left + viewWidth / 2) / width;
  renderer.resize(width, height, config, { left, width: viewWidth });
  // The fish comes in to the water's edge below the rod, never up onto the bank we stand on.
  let edge = height * 0.98;
  while (edge > height * 0.6 && !renderer.isOpenWater(game.landingX * width, edge)) edge -= 4;
  game.landingY = edge / height;
  cancelAnimationFrame(animationFrame);
  renderNow(performance.now());
  animationFrame = requestAnimationFrame(draw);
}

/*
 * Frame pacing: the water moves slowly, so 60 frames a second is all it needs;
 * a 120 Hz screen would otherwise draw everything twice as often for nothing.
 * Under the menu or an open window the scene is mostly hidden: 30 is plenty.
 */
let lastDrawn = -Infinity;
function draw(now) {
  animationFrame = requestAnimationFrame(draw);
  const covered = mode === "menu" || document.querySelector("dialog[open]");
  // A little slack, so a 60 Hz screen never skips a frame it should draw.
  if (now - lastDrawn < (covered ? 1000 / 30 : 1000 / 60) - 3) return;
  lastDrawn = now;
  renderNow(now);
}

function capturePointer(target, pointerId) {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Capture is a nicety; pulling must still work without it.
  }
}

// On the water: a tap casts; once the line is out, holding anywhere pulls.
canvas.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
  capturePointer(canvas, event.pointerId);
  if (pullable()) {
    pullPointer = event.pointerId;
    startPull();
    return;
  }
  const bounds = canvas.getBoundingClientRect();
  pendingContact = {
    pointerId: event.pointerId,
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
    startedAt: performance.now(),
  };
}, { passive: true });

canvas.addEventListener("pointerup", (event) => {
  if (event.pointerId === pullPointer) {
    pullPointer = null;
    stopPull();
    return;
  }
  if (!pendingContact || event.pointerId !== pendingContact.pointerId) return;
  const contact = pendingContact;
  pendingContact = null;
  if (game.phase === "ready" && performance.now() - contact.startedAt < 600) tryCast(contact.x, contact.y);
}, { passive: true });

canvas.addEventListener("pointercancel", (event) => {
  if (event.pointerId === pullPointer) {
    pullPointer = null;
    stopPull();
  }
  if (pendingContact?.pointerId === event.pointerId) pendingContact = null;
}, { passive: true });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
// iOS treats a long press on the scene (holding to reel in) as a gesture of its own and
// shows a blue lift highlight, the magnifier or a callout. Cancelling the touch's default
// action on the scene keeps all of that out; the pointer events above still arrive.
for (const type of ["touchstart", "touchmove", "touchend"]) {
  canvas.addEventListener(type, (event) => event.preventDefault(), { passive: false });
}

// The hidden cursor comes back as soon as the mouse actually moves.
window.addEventListener("pointermove", (event) => {
  if (event.pointerType === "mouse" && (event.movementX || event.movementY)) document.body.classList.remove("cursor-hidden");
}, { passive: true });

// Space pulls while the line is out. Captured first so a focused button doesn't
// also react to the key — including the keyup that would otherwise "click" a
// button in the catch dialog that opened mid-pull.
window.addEventListener("keydown", (event) => {
  if (event.code !== "Space") return;
  if (spaceHeld) {
    event.preventDefault();
    return;
  }
  if (mode !== "fishing" || document.querySelector("dialog[open]") || !pullable()) return;
  event.preventDefault();
  spaceHeld = true;
  startPull();
}, { capture: true });
window.addEventListener("keyup", (event) => {
  if (event.code !== "Space" || !spaceHeld) return;
  event.preventDefault();
  spaceHeld = false;
  stopPull();
}, { capture: true });
window.addEventListener("blur", () => {
  spaceHeld = false;
  stopPull();
});

window.addEventListener("resize", () => resize(), { passive: true });
// Phones: the scene follows the visible screen (browser bars, rotation), and pinch zoom
// and long-press menus stay out of the game (double-tap zoom is off in styles.css).
window.visualViewport?.addEventListener("resize", () => resize(), { passive: true });
for (const type of ["gesturestart", "gesturechange", "gestureend"]) document.addEventListener(type, (event) => event.preventDefault());
document.addEventListener("contextmenu", (event) => {
  if (!event.target.closest?.("input, textarea")) event.preventDefault();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = performance.now();
  } else if (hiddenAt !== null) {
    pauseDuration += performance.now() - hiddenAt;
    hiddenAt = null;
    cancelAnimationFrame(animationFrame);
    animationFrame = requestAnimationFrame(draw);
  }
});

if (window.ResizeObserver) {
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas);
}

resize();

// Installed on a phone's home screen, the game still opens without a connection (see sw.js).
// Debug sessions skip it so files are always loaded straight from the server.
if ("serviceWorker" in navigator && !params.has("debug")) navigator.serviceWorker.register("./sw.js").catch(() => {});
