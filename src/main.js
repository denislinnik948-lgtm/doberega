import { CanvasWaterRenderer } from "./canvas-renderer.js";
import { activeScene, currentAt } from "./scene.js";
import { DAY_SECONDS, dayTimeAt } from "./daycycle.js";
import { nameOf, t } from "./i18n.js";
import { Weather } from "./weather.js";
import { Ducks } from "./wildlife.js";
import { FishingGame, TUNING } from "./fishing/game.js";
import { BAITS, LOCATIONS, RODS } from "./fishing/data.js";
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
const DAY_START = 0.68;
// `?rain=1` forces rain (0..1); otherwise showers come and go on their own.
const weather = new Weather({ forced: params.has("rain") ? Number(params.get("rain")) : null });
const ducks = new Ducks();
// Mystic nights: lights over the water, a figure on the far shore, eyes by the bank.
// Each event is also announced on the window as
// "doberega:night" ({ type }) so sounds can hook in later without touching this.
const nightEvents = new NightEvents({
  onEvent: (type, data) => {
    window.dispatchEvent(new CustomEvent("doberega:night", { detail: { type } }));
    if (type === "eyesSink") {
      // The eyes slip under, leaving rings on the water.
      const x = renderer.frame.left + data.x * renderer.frame.width;
      addRipple({ ...renderer.screenToPlane(x, height * data.y), time: lastElapsed, strength: 0.5, size: 0.8 });
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

// Each spot has its own landscape and water tint, already behind the menu.
function applySpot() {
  const spot = LOCATIONS[progress.location];
  config.waterColor = spot.water;
  renderer.setScene(spot.kind, config);
  // Each spot centres a phone's view on its own point of interest.
  if (width) resize();
  ducks.reset();
  // Casts can land from just past the far shore to near the bank.
  TUNING.farY = activeScene().horizon + 0.05;
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
    ui.chooseBestBait();
    setMode("fishing");
    track("fish");
  },
  onExit: () => setMode("menu"),
  onSpotChange: applySpot,
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
// One anonymous "visit" per page open, for the stats page (see analytics.js).
track("visit");

function toScreen(point) {
  return { x: point.x * width, y: point.y * height };
}

function handleGameEvent(type, data) {
  if (type === "ripple") {
    const point = toScreen(data);
    addRipple({ ...renderer.screenToPlane(point.x, point.y), time: lastElapsed, strength: data.strength, size: data.size });
  } else if (type === "outcome") {
    // The bait is gone whether the fish escaped or was landed; a plain recast keeps it.
    if (!BAITS[data.bait].free) progress.baits[data.bait] = Math.max(0, (progress.baits[data.bait] ?? 0) - 1);
    if (data.hookLost) progress.hooks = Math.max(0, progress.hooks - 1);
    pullPointer = null;
    switchBaitIfEmpty();
    ui.commit();
    if (data.type === "escape") {
      const losses = [
        BAITS[data.bait].free ? "" : t("toast.lostBait", { bait: nameOf("bait", data.bait).toLowerCase() }),
        data.hookLost ? t("toast.lostHook") : "",
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
  if (progress.hooks <= 0) {
    ui.toast(t("toast.noHooks"), "bad", 1600);
    return;
  }
  if (game.cast({ x: x / width, y: y / height }, progress.rod, progress.bait, { location: progress.location, extras: progress.extras })) {
    // Get the pointer out of the way while watching the float.
    document.body.classList.add("cursor-hidden");
  }
}

// `?debug` exposes the game for manual testing from the console.
if (params.has("debug")) window.doberega = { game, progress, ui, cloud, nightEvents, renderNow, renderer, config, ripples, weather, ducks };

const pullable = () => ["waiting", "nibble", "bite", "fight"].includes(game.phase);

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
    castProgress: game.phase === "casting" ? Math.min(1, game.clock / TUNING.castDuration) : 1,
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

function renderNow(now = performance.now()) {
  const elapsed = getElapsed(now);
  maybeJumpFish(elapsed);
  const dt = elapsed - lastElapsed;
  lastElapsed = elapsed;
  const step = Math.max(0, Math.min(dt, 0.1));
  weather.update(step);
  game.biteBoost = weather.biteBoost;
  const dayTime = FIXED_TIME ?? dayTimeAt(elapsed, DAY_START, DAY_LENGTH);
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

/**
 * An iPhone web app with a see-through status bar lays the page out one status
 * bar short, leaving the bottom of the screen bare whatever the page asks for.
 * There, give the scene the full height of the physical screen outright.
 * Only on iOS home-screen apps; everywhere else the stylesheet's inset holds.
 */
function fillScreen() {
  // The page itself too, so nothing above the scene clips it short.
  const nodes = [document.documentElement, document.body, canvas.parentElement];
  if (window.navigator.standalone !== true) {
    for (const node of nodes) {
      node.style.height = "";
      node.style.bottom = "";
    }
    return;
  }
  const portrait = window.innerHeight >= window.innerWidth;
  const screenHeight = portrait ? Math.max(screen.width, screen.height) : Math.min(screen.width, screen.height);
  for (const node of nodes) {
    node.style.bottom = "auto";
    node.style.height = `${Math.max(screenHeight, window.innerHeight)}px`;
  }
}

function resize() {
  fillScreen();
  const bounds = canvas.parentElement.getBoundingClientRect();
  const viewWidth = Math.round(bounds.width);
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
  cancelAnimationFrame(animationFrame);
  renderNow(performance.now());
  animationFrame = requestAnimationFrame(draw);
}

function draw(now) {
  renderNow(now);
  animationFrame = requestAnimationFrame(draw);
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

window.addEventListener("resize", resize, { passive: true });
// Phones: the scene follows the visible screen (browser bars, rotation), and pinch zoom
// and long-press menus stay out of the game (double-tap zoom is off in styles.css).
window.visualViewport?.addEventListener("resize", resize, { passive: true });
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
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
}

resize();

// Installed on a phone's home screen, the game still opens without a connection (see sw.js).
// Debug sessions skip it so files are always loaded straight from the server.
if ("serviceWorker" in navigator && !params.has("debug")) navigator.serviceWorker.register("./sw.js").catch(() => {});
