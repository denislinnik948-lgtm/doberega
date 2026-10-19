import { CanvasWaterRenderer } from "./canvas-renderer.js";
import { activeScene } from "./scene.js";
import { nameOf, t } from "./i18n.js";
import { Weather } from "./weather.js";
import { Ducks } from "./wildlife.js";
import { FishingGame, TUNING } from "./fishing/game.js";
import { BAITS, LOCATIONS, RODS } from "./fishing/data.js";
import { baitCount, loadProgress } from "./fishing/store.js";
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

// 24 in-game hours pass in DAY_LENGTH seconds (20 real minutes), starting mid-afternoon.
// `?time=0.5` pins the clock (0 midnight, 0.25 dawn, 0.5 noon, 0.76 evening);
// `?day=60` shortens the day to 60 seconds.
const params = new URLSearchParams(location.search);
const DAY_LENGTH = Number(params.get("day")) || 1200;
const FIXED_TIME = params.has("time") ? Number(params.get("time")) : null;
const DAY_START = 0.68;
// `?rain=1` forces rain (0..1); otherwise showers come and go on their own.
const weather = new Weather({ forced: params.has("rain") ? Number(params.get("rain")) : null });
const ducks = new Ducks();

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
  onFish: () => setMode("fishing"),
  onExit: () => setMode("menu"),
  onSpotChange: applySpot,
});
applySpot();

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
      game.release();
      ui.showCatch(data.fish).then((choice) => {
        if (choice.type === "sell") ui.toast(`+${choice.price} ₴`, "good", 1200);
        else if (choice.type === "mount") ui.toast(t("toast.trophy"), "good", 1200);
        game.reset();
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
if (params.has("debug")) window.stillwater = { game, progress, ui, renderNow, renderer, config, ripples, weather, ducks };

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
  // Ducks only come out between 6:00 and 20:00.
  const hour = ((FIXED_TIME ?? (DAY_START + elapsed / DAY_LENGTH) % 1) * 24) % 24;
  ducks.update(step, elapsed, width, height, renderer.shorelineY(width / 2), (x, y) => renderer.isOpenWater(x, y), hour >= 6 && hour < 20);
  // A duck paddling over the float eats the bait.
  if (mode === "fishing" && game.target && ["waiting", "nibble", "bite"].includes(game.phase)) {
    const float = toScreen(game.target);
    if (ducks.near(float.x, float.y, 26)) game.duckSteal();
  }
  if (step > 0) game.update(step);
  syncFishingUi();
  const dayTime = FIXED_TIME ?? (DAY_START + elapsed / DAY_LENGTH) % 1;
  game.hour = dayTime * 24;
  ui.setClock(dayTime);
  ui.setWeather(weather.intensity);
  renderer.render(elapsed, config, ripples, anglerView(elapsed), dayTime, { rain: weather.intensity, ducks: ducks.all });
}

function resize() {
  const bounds = canvas.getBoundingClientRect();
  width = Math.round(bounds.width);
  height = Math.round(bounds.height);
  renderer.resize(width, height, config);
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
