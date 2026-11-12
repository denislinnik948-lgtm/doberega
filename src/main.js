import { CanvasWaterRenderer } from "./canvas-renderer.js";
import { activeScene, currentAt, setScene } from "./scene.js";
import { DAY_SECONDS, dayTimeAt, skyMoodsAt } from "./daycycle.js";
import { nameOf, t } from "./i18n.js";
import { Weather } from "./weather.js";
import { moonAt, moonBite } from "./moon.js";
import { windAt, windBite } from "./wind.js";
import { Critters, Ducks } from "./wildlife.js";
import { FishingGame, TUNING } from "./fishing/game.js";
import { BAITS, FISH, GROUNDBAIT, HOOKS, LINE, LOCATIONS, RODS, SPECIAL_AVATAR, access } from "./fishing/data.js";
import { baitCount, loadProgress, onProgressSaved, replaceProgress, saveProgress } from "./fishing/store.js";
import { Cloud } from "./cloud.js";
import { currentSeason, isWinter, onSeasonChange } from "./theme.js";
import { NightEvents } from "./night-events.js";
import { track } from "./analytics.js";
import { ambienceTick, jumpSound, musicTick, nightSound, sounds, thunderClap } from "./sound.js";
import { AnglerUI } from "./fishing/ui.js";
import { breakStreak, bump, recordCatch } from "./fishing/achievements.js";
import { XP, fishXp, gainXp, rankPending } from "./fishing/ranks.js";
import { recordDay, recordQuest, recordTourney, settleTourney, tourneyFish, tourneyFormat, tourneyState, tourneyWeek } from "./fishing/quests.js";
import { warmFishPortraits } from "./fishing/sprites.js";
import { ensureOpenSpot } from "./fishing/waters.js";

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
// Each day's sunset and dawn have their own colours (crimson, raspberry, golden...);
// `?sunset=crimson` or `?dawn=rose` pins one (see MOODS in daycycle.js).
const FORCED_MOODS = { dusk: params.get("sunset"), dawn: params.get("dawn") };
const skyMoods = () => skyMoodsAt(Date.now() / 1000, WORLD_START, DAY_LENGTH, FORCED_MOODS);
// `?rain=1` forces rain (0..1), `&storm=1` adds lightning; otherwise showers and storms come and go on their own.
const weather = new Weather({
  forced: params.has("rain") ? Number(params.get("rain")) : null,
  storm: params.get("storm") === "1",
  // Winter showers fall as snow: no thunder then.
  onThunder: ({ delay, near }) => {
    if (!isWinter()) thunderClap(delay, near);
  },
});
const ducks = new Ducks();
// A heron, a beaver and dragonflies, for the look and sound of the place (they never touch the fishing).
const critters = new Critters({
  onEvent: (type, data) => {
    if (mode !== "fishing") return;
    const pan = data ? ((data.x - renderer.frame.left) / renderer.frame.width) * 2 - 1 : 0;
    if (type === "heron") sounds.heron(Math.random() * 1.2 - 0.6);
    if (type === "finch") sounds.finch(Math.max(-0.8, Math.min(0.8, pan)));
    if (type === "heronStrike" || type === "beaverSlap") {
      addRipple({ ...renderer.screenToPlane(data.x, data.y), time: lastElapsed, strength: type === "beaverSlap" ? 0.7 : 0.35, size: type === "beaverSlap" ? 0.6 : 0.25, ambient: true });
      sounds[type](Math.max(-0.7, Math.min(0.7, pan)));
    }
  },
});
// Mystic nights: lights over the water, an apparition by the far shore, eyes by the bank.
// Each event is also announced on the window as
// "doberega:night" ({ type }) so sounds can hook in later without touching this.
const nightEvents = new NightEvents({
  onEvent: (type, data) => {
    window.dispatchEvent(new CustomEvent("doberega:night", { detail: { type, kind: data?.kind } }));
    // The apparitions and the eyes each have their sound, only while at the water.
    if (mode === "fishing") {
      if (type === "figure") nightSound(data.kind);
      else if (type === "eyes") nightSound("eyes");
      // Two of the apparitions are secret achievements.
      if (type === "figure" && (data.kind === "mavka" || data.kind === "boat")) {
        bump(progress, data.kind === "mavka" ? "sawMavka" : "sawBoat");
        ui.commit();
      }
    }
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
// Where the school of fish is jumping (see maybeJumpFish).
let school = null;
// The wind right now (see wind.js), kept current every frame.
let wind = windAt(Date.now() / 1000);
const ripples = [];

function getElapsed(now) {
  return Math.max(0, (now - startTime - pauseDuration) / 1000);
}

function addRipple(ripple) {
  ripples.push(ripple);
  while (ripples.length > 8) ripples.shift();
}
// Bubbles the renderer pops on the water leave a faint ring.
renderer.onRipple = (x, y, strength, size) => addRipple({ ...renderer.screenToPlane(x, y), time: lastElapsed, strength, size, ambient: true });

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
  critters.reset();
  // Casts can land from just past the far shore to near the bank.
  TUNING.farY = activeScene().horizon + 0.05;
  // The school finds its place on the new water.
  school = null;
}

/** Build the chosen spot's scene if the menu moved on since the last one. */
function ensureSpot() {
  if (builtSpot !== progress.location) applySpot();
// Fish left in the keepnet from last time (the game was closed at the water): offer to sell them.
if (progress.keepnet.length) setTimeout(() => ui.openKeepnet(), 800);
}

// Game hours spent at the water since leaving the menu (a whole day of it is an achievement).
let hoursAtWater = 0;

function setMode(next) {
  mode = next;
  hoursAtWater = 0;
  document.body.classList.toggle("in-menu", next === "menu");
  document.body.classList.toggle("in-game", next === "fishing");
  if (next === "menu") {
    game.reset();
    spaceHeld = false;
  }
  // Under the menu nothing was drawn: draw the water now, not an old frame for a moment.
  else renderNow();
}

const ui = new AnglerUI(progress, {
  onFish: () => {
    const go = () => {
      ui.chooseBait();
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
  // Leaving the water: the keepnet comes up to sell the catch.
  onExit: () => {
    setMode("menu");
    if (progress.keepnet.length) ui.openKeepnet();
  },
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
    // A save from before ranks: give the gifts of the ranks it has earned.
    if (rankPending(progress)) ui.commit();
  },
  onChange: () => {
    // An admin's account tests the waters still being tried out, with every water open.
    if (access.tester !== cloud.admin) {
      access.tester = cloud.admin;
      if (ensureOpenSpot(progress)) applySpot();
      ui.renderSpot();
    }
    // The author's own picture, given once when an admin's account is first recognised.
    if (cloud.admin && !progress.authorAvatar) {
      progress.authorAvatar = true;
      progress.avatar = SPECIAL_AVATAR;
      ui.commit();
    }
    ui.renderAccount();
    // Signing in or out: the tiles drawn again (the tournament's board knows who you are).
    ui.refreshTiles();
  },
  // Signed in and in step: this week's best goes up (it may have been caught
  // before signing in), and last week's tournament is settled, once.
  onSynced: async () => {
    const week = tourneyWeek();
    const state = tourneyState(progress, week);
    if (state.best > 0) cloud.submitTournament(tourneyFish(week), state.best).then(() => checkTourneyPlace());
    await backfillCups(week);
    if ((state.claimed ?? -1) >= week - 1) return;
    try {
      const result = await cloud.tournamentPlace(week - 1, tourneyFish(week - 1));
      if (!result) return;
      const prize = settleTourney(progress, week - 1, result.place);
      if (prize) gainXp(progress, XP.podium[prize.place - 1] ?? 0);
      ui.commit();
      if (prize) ui.tourneyPrize(prize);
    } catch (error) {
      console.warn("Last week's tournament could not be checked:", error.message);
    }
  },
});
ui.setCloud(cloud);

/*
 * Cups came in after the first tournaments: once per save, every earlier
 * week this angler finished in the top three gets its cup (only the cup; the
 * prize was paid then). Weeks not yet settled are left to settleTourney.
 */
async function backfillCups(week) {
  if (progress.cupsBackfilled) return;
  try {
    const rows = await cloud.myTournamentRows();
    if (!rows) return;
    const settled = tourneyState(progress, week).claimed ?? week - 1;
    const cups = [...(progress.cups ?? [])];
    for (const row of rows) {
      if (row.week >= week || row.week > settled || cups.some((cup) => cup.week === row.week)) continue;
      const result = await cloud.tournamentPlace(row.week, row.species);
      if (result?.place && result.place <= 3) cups.push({ week: row.week, species: row.species, format: tourneyFormat(row.week), place: result.place });
    }
    const added = cups.length - (progress.cups?.length ?? 0);
    progress.cups = cups;
    progress.cupsBackfilled = true;
    ui.commit();
    if (added > 0) ui.cupsGiven(added);
  } catch (error) {
    console.warn("Past tournament cups could not be checked:", error.message);
  }
}

/*
 * Where this angler stands in the week's tournament, checked after their own
 * result goes up, on coming back to the game and every few minutes while it
 * is open: having slipped down since last time, they are told so (`tell`).
 */
let placeChecked = 0;
async function checkTourneyPlace(tell = true) {
  const week = tourneyWeek();
  const state = tourneyState(progress, week);
  if (!cloud.user || !(state.best > 0)) return;
  placeChecked = Date.now();
  try {
    const result = await cloud.tournamentPlace(week, tourneyFish(week));
    if (!result?.place || tourneyWeek() !== week) return;
    if (tell && state.place && result.place > state.place) ui.tourneyOvertaken(result.place);
    if (state.place !== result.place) {
      state.place = result.place;
      ui.commit();
    }
  } catch (error) {
    console.warn("The tournament place could not be checked:", error.message);
  }
}
setInterval(() => {
  if (!document.hidden && Date.now() - placeChecked > 5 * 60000) checkTourneyPlace();
}, 60000);
// A new season repaints the woods and the grass.
onSeasonChange(() => {
  renderer.lightKey = null;
  renderer.paletteKey = "";
  resize(true);
});
onProgressSaved(() => cloud.schedulePush());
window.addEventListener("pagehide", () => cloud.flush());
// Once the saves are in step (so the cloud's isn't mistaken for the older one),
// a save from before ranks gets the gifts of the ranks it has earned.
cloud.init().then(() => {
  if (rankPending(progress)) ui.commit();
});
// One anonymous "visit" per page open, for the stats page (see analytics.js),
// counted once the page has been on screen for two seconds.
track("visit", { after: 2000 });
// Fish portraits take a moment each to shade: do them while nothing else is going on.
setTimeout(warmFishPortraits, 3000);
// So do the pages the first time they open (after the fish, which some of them show).
setTimeout(() => ui.warmPages(), 5000);

function toScreen(point) {
  return { x: point.x * width, y: point.y * height };
}

function handleGameEvent(type, data) {
  if (type === "cast") {
    // The swish comes with the forward swing, partway through the cast.
    // Timed so the swish peaks as the bait is let go.
    setTimeout(() => sounds.cast(data.style), game.castDuration * (data.style === "over" ? 0.39 : 0.34) * 1000);
  } else if (type === "splashdown") {
    if (data.lure) sounds.landLure();
    else sounds.landFloat();
  } else if (type === "twitch") {
    sounds.twitch();
    if (game.extras?.includes("bell")) sounds.jingle(0.35 * (data.strength ?? 1));
  } else if (type === "dip") {
    sounds.dip();
    if (game.extras?.includes("bell")) sounds.jingle(0.6 * (data.strength ?? 1));
  } else if (type === "bite") {
    sounds.bite();
    // The bell rings hard as the float goes under, and the phone buzzes.
    if (game.extras?.includes("bell")) {
      sounds.jingle(1);
      navigator.vibrate?.(80);
    }
  } else if (type === "feed") {
    // The feeder's load spreads where the float landed; a spot fed again and again says how full it is.
    sounds.feeder();
    if (data.level > 1) ui.toast(t("toast.feed", { level: data.level }), "", 1100);
  } else if (type === "hooked") {
    sounds.hookset();
    // Spray flung up where the float was.
    if (game.target) {
      const point = toScreen(game.target);
      renderer.splash(point.x, point.y, Math.min(1.5, 0.6 + (data.fish?.weight ?? 0) * 0.1));
    }
    if (data.onDip) bump(progress, "dipHooks");
    // A legend on the line: the angler feels it at once.
    if (data.fish?.legend) ui.toast(t("toast.legendOn"), "", 2200);
  } else if (type === "snag") {
    sounds.snag();
  } else if (type === "liftout") {
    sounds.liftOut();
  }
  if (type === "ripple") {
    const point = toScreen(data);
    addRipple({ ...renderer.screenToPlane(point.x, point.y), time: lastElapsed, strength: data.strength, size: data.size });
  } else if (type === "retrieved") {
    // The spoon came back untouched: cast again.
    ui.toast(t("toast.recast"), "", 900);
  } else if (type === "strike") {
    // A fish hit the spoon: a buzz in the hand on a phone.
    navigator.vibrate?.(60);
    sounds.strike();
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
    // Counted for the achievements: a duck at the bait; a fish lost with the hook breaks the clean streak.
    if (data.type === "escape" && data.reason === "duck") bump(progress, "duckSteals");
    if (data.type === "escape" && (data.hookLost || data.reason === "straightened")) breakStreak(progress);
    if (data.type === "landed") {
      // A species never caught before is worth extra experience (for the atlas).
      const fresh = !FISH[data.fish.species]?.junk && !data.fish.unique && !(progress.stats?.bySpecies?.[data.fish.species] > 0);
      recordCatch(progress, data.fish, {
        spot: progress.location,
        bait: data.bait,
        lure: Boolean(BAITS[data.bait].lure),
        hour: game.hour % 24,
        rain: weather.intensity,
        rodMaxKg: RODS[progress.rod].maxKg,
      });
      // Today's quest, the same for everyone: paid the moment it's done.
      const quest = recordQuest(progress, data.fish, progress.location);
      if (quest) ui.questDone(quest);
      gainXp(progress, fishXp(data.fish) + (fresh ? XP.newSpecies : 0) + (quest ? XP.quest : 0));
      // A new score in the week's tournament goes up to the board (signed in);
      // a marathon's kilos grow with every fish, so they are not announced each time.
      const best = recordTourney(progress, data.fish, game.hour % 24);
      if (best) {
        if (best.format !== "marathon") ui.tourneyBest(best, Boolean(cloud.user));
        cloud.submitTournament(best.species, best.weight).then(() => checkTourneyPlace(false));
      }
      // The first fish of a day counts towards the run of days in a row, with its gift.
      if (!FISH[data.fish.species]?.junk) {
        const day = recordDay(progress);
        if (day) {
          gainXp(progress, XP.day);
          ui.dayCounted(day);
        }
      }
    }
    ui.commit();
    if (data.type === "escape") {
      // A snapped line or a bent hook twangs; a fish that just slipped off makes a splash.
      if (data.reason === "duck") sounds.duckEats();
      else if (data.reason === "unsnagged") sounds.snagFree();
      else if (data.reason === "straightened") sounds.hookBend();
      else if (data.hookLost || data.reason === "snap") sounds.snap();
      else sounds.splash(0.5);
      const lure = BAITS[data.bait].lure;
      const losses = [
        BAITS[data.bait].free || (lure && !data.hookLost) ? "" : t("toast.lostBait", { bait: nameOf("bait", data.bait).toLowerCase() }),
        data.hookLost && !lure ? t("toast.lostHook") : "",
      ].filter(Boolean);
      const headline = data.fish?.legend ? t("toast.legendGone", { fish: nameOf("fish", data.fish.species) }) : t(`toast.${data.headline ?? "escape"}`);
      ui.toast(`${headline}${losses.length ? ` · ${losses.join(", ")}` : ""}`, "bad", 2400);
    } else {
      progress.caught += 1;
      track("catch");
      if (data.fish.unique) sounds.unique();
      else if (FISH[data.fish.species]?.junk) sounds.boot();
      else sounds.landed(data.fish.weight);
      game.release();
      // Into the keepnet (or the trophies); it's all sold on leaving the water.
      // Gulls are about by day only.
      const hour = game.hour % 24;
      ui.showCatch(data.fish, { bait: data.bait, daylight: hour >= 6 && hour < 20 }).then(() => {
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

/*
 * How far a point on the water is from the angler, who sits at the bottom
 * middle of the view, as a share of the farthest cast: the casts reach out to
 * a wide arc fitted to the screen, its top a little way below the far bank
 * (CAST_ARC.top of the water) and its sides running off the edges of what is
 * on screen about three quarters of the way down. So it reaches farther to the
 * sides than straight out, and fits a phone as well as a wide screen.
 */
const CAST_ARC = { top: 0.14, side: 1.15 };

function castDistance(x, y) {
  const { left, width: span } = renderer.frame;
  const horizon = activeScene().horizon;
  const out = (1 - horizon) * (1 - CAST_ARC.top) * height;
  const across = (span / 2) * CAST_ARC.side;
  return Math.hypot((x - (left + span / 2)) / across, (height - y) / out);
}

/** The farthest cast (the arc), and the nearest. */
const castRange = () => ({ near: castDistance(renderer.frame.left + renderer.frame.width / 2, height * TUNING.nearY), far: 1 });

/** How far out a cast lands, 0 by the bank to 1 at the farthest. */
function castReach(x, y) {
  const { near, far } = castRange();
  return Math.min(1, Math.max(0, (castDistance(x, y) - near) / (far - near)));
}

function isOnWater(x, y) {
  return y > Math.max(renderer.shorelineY(x) + height * 0.04, height * TUNING.farY)
    && y < height * TUNING.nearY
    && castDistance(x, y) <= castRange().far + 0.001
    && renderer.isOpenWater(x, y);
}

/** A tap on the water past the farthest cast lands as far as the rod throws in that direction (or nowhere, if that's not water). */
function withinReach(x, y) {
  const { far } = castRange();
  if (castDistance(x, y) <= far) return { x, y };
  const origin = { x: renderer.frame.left + renderer.frame.width / 2, y: height };
  let [inside, outside] = [0, 1];
  for (let i = 0; i < 20; i += 1) {
    const mid = (inside + outside) / 2;
    if (castDistance(origin.x + (x - origin.x) * mid, origin.y + (y - origin.y) * mid) <= far) inside = mid;
    else outside = mid;
  }
  return { x: origin.x + (x - origin.x) * inside, y: origin.y + (y - origin.y) * inside };
}

// Every fight wears the line; saying so once as it gets weak, when there's no spare to put on.
game.lineHealth = () => progress.line;
game.onLineWear = (amount) => {
  const before = progress.line;
  progress.line = Math.max(0, before - amount);
  if (before >= LINE.weakBelow && progress.line < LINE.weakBelow && progress.lines <= 0) ui.toast(t("line.weak"), "bad", 2600);
};

// The float drifts where the current runs, and on still water in a strong wind; never onto a bank.
game.currentAt = (x, y) => {
  const flow = currentAt(x, y);
  const push = Math.max(0, (wind.strength - 0.6) / 0.4) * 0.0012 * wind.dir;
  return push ? { x: flow.x + push, y: flow.y } : flow;
};
game.isWater = (point) => isOnWater(point.x * width, point.y * height);
game.reachAt = (point) => castReach(point.x * width, point.y * height);
// How big the water looks at a height, 1 at the nearest cast (see waterScaleAt).
game.scaleAt = (y) => {
  const scale = renderer.waterScaleAt;
  return scale ? scale(y * height) / scale(height * TUNING.nearY) : 1;
};
// The same for the ducks and the beaver, in screen pixels.
ducks.scaleAt = critters.scaleAt = (y) => game.scaleAt(y / height);

function tryCast(x, y) {
  // A tap past the farthest cast still casts, but only on the water itself (not the sky or a bank).
  if (!(y > renderer.shorelineY(x) && renderer.isOpenWater(x, y))) return;
  ({ x, y } = withinReach(x, y));
  // Winter shore ice is no place for a float.
  if (mode !== "fishing" || !isOnWater(x, y) || renderer.onIce(x, y)) return;
  if (ui.baitCount <= 0) {
    ui.toast(t("toast.noBait"), "bad", 1600);
    sounds.ui("denied");
    return;
  }
  // A line worn through is swapped for a spare before the cast.
  ui.renewLine();
  const lure = BAITS[progress.bait].lure;
  // The spoon is fished on a spinning reel and carries its own hook.
  if (lure && !progress.extras.includes("spinreel")) {
    ui.toast(t("toast.needReel"), "bad", 1800);
    sounds.ui("denied");
    return;
  }
  if (!lure && (progress.hooks[progress.hook] ?? 0) <= 0) {
    // Out of this size: put on another size you still have, and say so.
    const spare = Object.keys(HOOKS).find((id) => (progress.hooks[id] ?? 0) > 0);
    if (!spare) {
      ui.toast(t("toast.noHooks"), "bad", 1600);
      sounds.ui("denied");
      return;
    }
    progress.hook = spare;
    ui.commit();
    ui.toast(t("toast.hookSwitched", { hook: nameOf("hook", spare).toLowerCase() }), "", 1800);
  }
  const spotId = LOCATIONS[progress.location].id;
  const groundbait = groundbaitLeft(spotId) > 0;
  // The wind carries the bait a little downwind in flight, the more the farther the cast.
  let target = { x: x / width, y: y / height };
  const reach = castReach(x, y);
  const blown = { x: target.x + wind.dir * wind.strength * wind.gust * 0.035 * (0.4 + reach) * (0.5 + Math.random()), y: target.y };
  if (isOnWater(blown.x * width, blown.y * height) && !renderer.onIce(blown.x * width, blown.y * height)) target = blown;
  if (game.cast(target, progress.rod, progress.bait, { location: progress.location, extras: progress.extras, groundbait, groundbaitKind: progress.baitedKind?.[spotId] ?? null, hook: progress.hook, school: nearSchool(target) })) {
    // Get the pointer out of the way while watching the float.
    document.body.classList.add("cursor-hidden");
  }
}

// `?debug` exposes the game for manual testing from the console.
if (params.has("debug")) window.doberega = { game, progress, ui, cloud, nightEvents, renderNow, renderer, config, ripples, weather, ducks, critters, school: () => school, isOnWater, castReach };

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
    // Which lure, so each looks like itself on the line and in the water.
    lureId: game.busy ? game.bait : progress.bait,
    float: game.float,
    bob: target ? renderer.surfaceOffset(target.x, target.y, elapsed, config, ripples) : { x: 0, y: 0 },
    fish: game.phase === "fight" ? toScreen(game.fishPosition()) : null,
    // How big the fish on the line is, and whether it's running, for the show.
    fishWeight: game.phase === "fight" && game.fish ? game.fish.weight : 0,
    running: game.phase === "fight" && ((!game.pulling && (game.behavior ?? 0) > 1) || game.surge > 0),
    tension: game.tension,
    pulling: game.pulling,
    snag: game.snag,
    junk: Boolean(game.fish?.junk),
    distance: game.distance,
    rodTier: RODS[game.busy && game.rod ? game.rod : progress.rod].tier,
    hidden: mode === "menu",
    glowFloat: progress.extras.includes("glowfloat"),
    // The bell on the rod tip, and how hard it swings: with each twitch and dip, wildly once the float is under.
    bell: progress.extras.includes("bell"),
    bellShake: game.phase === "nibble" ? Math.min(1, Math.max(Math.abs(game.float.offset) / 3, game.float.sink))
      : game.phase === "bite" ? 1 : game.phase === "fight" ? 0.5 : 0,
  };
}

/*
 * A school of fish keeps to one place on the water for a minute or two, then
 * moves on. It shows itself only now and then, a bigger splash (sometimes
 * two in a row) every quarter to half a minute, so a watchful angler can
 * tell where it is: a cast that lands close to it bites faster
 * (TUNING.schoolBoost). Stray fish jump elsewhere too, so a single splash
 * proves nothing.
 */
const SCHOOL_REACH = 0.07;
function moveSchool(elapsed) {
  let point = null;
  for (let attempt = 0; attempt < 12 && !point; attempt += 1) {
    const candidate = renderer.randomWaterScreen();
    if (isOnWater(candidate.x, candidate.y)) point = candidate;
  }
  school = point ? { x: point.x / width, y: point.y / height, until: elapsed + 70 + Math.random() * 90, splash: elapsed + 3 + Math.random() * 8 } : null;
}

/** How far the school's patch reaches at its spot: the same on the water, so smaller far out (never under 0.6 of it by the bank, to stay hittable). */
const schoolReach = () => SCHOOL_REACH * Math.max(0.6, game.scaleAt(school.y));

/** Whether a normalized point on the water is within reach of the school (a flat ellipse). */
function nearSchool(point) {
  if (!school) return false;
  const dx = (point.x - school.x) * (width / height);
  const dy = (point.y - school.y) * 2.2;
  return Math.hypot(dx, dy) < schoolReach();
}

// Now and then a fish breaks the surface out on the water, mostly where the school is.
function maybeJumpFish(elapsed) {
  if (!school || elapsed > school.until) moveSchool(elapsed);
  if (school && elapsed >= school.splash) {
    school.splash = elapsed + 14 + Math.random() * 22;
    const jump = (delay) => {
      // The school keeps to a patch of water, which looks smaller farther out.
      const spread = schoolReach();
      const x = (school.x + (Math.random() - 0.5) * spread * (height / width)) * width;
      const y = (school.y + (Math.random() - 0.5) * spread * 0.4) * height;
      addRipple({ ...renderer.screenToPlane(x, y), time: elapsed + delay, strength: 0.7, size: 0.45 + Math.random() * 0.35, ambient: true });
      if (mode === "fishing") setTimeout(() => jumpSound(((x - renderer.frame.left) / renderer.frame.width) * 2 - 1), delay * 1000);
    };
    jump(0);
    if (Math.random() < 0.25) jump(0.5 + Math.random() * 0.6);
  }
  if (elapsed < nextFishAt) return;
  nextFishAt = elapsed + 12 + Math.random() * 20;
  addRipple({ ...renderer.randomWaterPoint(), time: elapsed, strength: 0.6, size: 0.3 + Math.random() * 0.3, ambient: true });
}

/** A leaf from the pond's oak settling on the water spreads a faint ring. */
function rippleLeaves(elapsed) {
  for (const leaf of renderer.takeLeafLandings()) addRipple({ ...renderer.screenToPlane(leaf.x, leaf.y), time: elapsed, strength: 0.25, size: 0.18, ambient: true });
}

/**
 * Groundbait wears off at a set moment of real (and so game) time, the same
 * whether the game is open, in the background or closed: 24 game hours after
 * it went in. Here it is only cleared once that moment has passed.
 */
function tickGroundbait() {
  const now = Date.now();
  for (const [id, until] of Object.entries(progress.baited)) {
    if (until > now) continue;
    delete progress.baited[id];
    delete progress.baitedKind?.[id];
    if (mode === "fishing" && id === LOCATIONS[progress.location].id) ui.toast(t("toast.groundbaitOver"), "", 2200);
    ui.commit();
  }
}

/*
 * The sounds that run on while something happens: the reel's ratchet while
 * line comes in, the odd splash of a fighting fish, and the background (water
 * lapping, birds or crickets while at the water, rain whenever it falls).
 */
let reelClock = 0;
let thrashClock = 1;
let dragClock = 0;
let creakClock = 1;
function playLoops(step, dayTime) {
  const reeling = mode === "fishing" && (game.phase === "reeling" || (game.pulling && ["fight", "retrieving"].includes(game.phase)));
  if (reeling && !game.snag) {
    reelClock -= step;
    if (reelClock <= 0) {
      // A real ratchet never clicks quite evenly. The spinning reel clicks far faster and finer.
      if (BAITS[game.bait]?.lure) {
        reelClock = 0.033 * (0.92 + Math.random() * 0.16);
        sounds.spinTick();
      } else {
        reelClock = 0.07 * (0.85 + Math.random() * 0.3);
        sounds.reelTick();
      }
    }
  }
  // Let go while the fish runs, and line goes out through the drag, in bursts.
  if (mode === "fishing" && game.phase === "fight" && !game.pulling && !game.snag && !game.fish?.junk && (game.behavior > 0.15 || game.surge > 0)) {
    dragClock -= step;
    if (dragClock <= 0) {
      dragClock = 0.6;
      sounds.drag(Math.min(1, Math.max(game.behavior, game.surge > 0 ? 1 : 0)), 0.6);
    }
  } else {
    dragClock = 0;
  }
  // A heavy fish with the line near breaking: the rod creaks now and then.
  if (mode === "fishing" && game.phase === "fight" && game.tension > 0.75 && (game.rates?.strain ?? 0) > 0.8) {
    creakClock -= step;
    if (creakClock <= 0) {
      creakClock = 1.5 + Math.random() * 1.5;
      sounds.creak();
    }
  }
  if (mode === "fishing" && game.phase === "fight" && !game.snag && !game.fish?.junk) {
    thrashClock -= step;
    if (thrashClock <= 0) {
      thrashClock = 0.5 + Math.random() * 0.9;
      sounds.thrash(game.fish?.weight);
    }
  }
  const hour = (dayTime * 24) % 24;
  // Tree frogs call from the reeds in the evening and at night, at the reedy waters only.
  const reedy = ["pond", "lake", "reservoir"].includes(LOCATIONS[progress.location].kind);
  musicTick(step, { atWater: mode === "fishing", night: hour < 5 || hour >= 21.5, fighting: game.phase === "fight" });
  // Snow falls without a sound.
  ambienceTick(step, { atWater: mode === "fishing", wind: wind.strength, windDir: wind.dir, rain: isWinter() ? 0 : weather.intensity, night: hour < 5 || hour >= 21.5, ducks: ducks.all.length, frogs: reedy && (hour >= 19 || hour < 4), deepNight: nightEvents.depth ?? 0, spot: LOCATIONS[progress.location].kind, winter: isWinter() });
}

// The float, idle on the water, now and then sends out a faint ring; a hard pull makes the line sing.
let floatRingClock = 2;
let singClock = 0;
function floatLife(step, elapsed) {
  if (mode !== "fishing") return;
  floatRingClock -= step;
  if (game.phase === "waiting" && game.target && !BAITS[game.bait]?.lure && floatRingClock <= 0) {
    floatRingClock = 2.8 + Math.random() * 2.6;
    const point = toScreen(game.target);
    addRipple({ ...renderer.screenToPlane(point.x, point.y), time: elapsed, strength: 0.16, size: 0.1, ambient: true });
  }
  singClock -= step;
  if (game.phase === "fight" && game.tension > 0.8 && !game.snag && singClock <= 0) {
    singClock = 1.2 + Math.random();
    sounds.lineSing(Math.min(1, (game.tension - 0.8) * 5));
  }
}

/** Game hours of groundbait left at a water (0 if none). */
const groundbaitLeft = (id) => Math.max(0, ((progress.baited[id] ?? 0) - Date.now()) / (DAY_LENGTH * 1000) * 24);

/** Whether the scene is hidden under the menu or a full-screen page (windows like the catch card let it show). */
function sceneCovered() {
  return mode === "menu" || Boolean(document.querySelector("dialog.page[open]"));
}

function renderNow(now = performance.now()) {
  const elapsed = getElapsed(now);
  maybeJumpFish(elapsed);
  rippleLeaves(elapsed);
  const dt = elapsed - lastElapsed;
  lastElapsed = elapsed;
  const step = Math.max(0, Math.min(dt, 0.1));
  weather.update(step);
  const dayTime = FIXED_TIME ?? worldDayTime();
  // Rain livens the bite; so does a full moon at night (and a new moon by day), and a light ripple of wind.
  const moon = moonAt(Date.now() / 1000);
  wind = windAt(Date.now() / 1000, weather.intensity);
  config.waveAmplitude = wind.strength * 1.1;
  config.ruffle = wind.strength;
  game.biteBoost = weather.biteBoost * moonBite(Date.now() / 1000, (dayTime * 24) % 24) * windBite(wind.strength);
  // Ducks only come out between 6:00 and 20:00.
  const hour = (dayTime * 24) % 24;
  ducks.update(step, elapsed, width, height, renderer.shorelineY(width / 2), (x, y) => renderer.isDuckWater(x, y), hour >= 6 && hour < 20, renderer.frame);
  critters.update(step, elapsed, width, height, renderer.frame, renderer.shorelineY(width / 2), (x, y) => renderer.isDuckWater(x, y), {
    hour,
    rain: weather.intensity,
    wind: wind.strength,
    warm: ["summer", "spring"].includes(currentSeason()),
    beavers: LOCATIONS[progress.location].kind !== "castle",
    winter: isWinter(),
    perches: renderer.perches,
  });
  // A duck paddling over the float eats the bait.
  if (mode === "fishing" && game.target && ["waiting", "nibble", "bite"].includes(game.phase)) {
    const float = toScreen(game.target);
    if (ducks.near(float.x, float.y, 26)) game.duckSteal();
  }
  if (step > 0) game.update(step);
  if (mode === "fishing" && hoursAtWater < 24) {
    hoursAtWater += (step / DAY_LENGTH) * 24;
    if (hoursAtWater >= 24) {
      bump(progress, "wholeDay");
      ui.commit();
    }
  }
  syncFishingUi();
  game.hour = dayTime * 24;
  ui.setClock(dayTime, moon);
  tickGroundbait();
  ui.setGroundbait(mode === "fishing" ? groundbaitLeft(LOCATIONS[progress.location].id) : 0, progress.baitedKind?.[LOCATIONS[progress.location].id] ?? null);
  ui.setWeather(weather.intensity, wind.strength);
  nightEvents.update(step, elapsed, dayTime);
  playLoops(step, dayTime);
  const winter = isWinter();
  floatLife(step, elapsed);
  // The menu and the pages cover the whole screen: the world keeps going (time,
  // the fish, the sounds) but there is no point drawing a scene nobody sees.
  if (sceneCovered()) return;
  renderer.render(elapsed, config, ripples, anglerView(elapsed), dayTime, {
    rain: weather.intensity,
    // Snow in winter brings no lightning.
    flash: winter ? 0 : weather.flash,
    storm: winter ? 0 : weather.storm,
    bolt: winter ? null : weather.bolt,
    moods: skyMoods(),
    moon,
    wind,
    ducks: ducks.all,
    critters,
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
 * Frame pacing, to keep a laptop cool. The water drifts slowly, so while you
 * simply wait at the water 30 frames a second look the same as 60; the full
 * 60 come only when things move fast: a cast, a fight, reeling in, a fresh
 * splash, or your finger on the screen. Under the menu or a window the scene
 * barely shows (12 frames, and under the menu or a page nothing is drawn at
 * all, see sceneCovered), and in a window you aren't looking at, 20.
 */
let lastDrawn = -Infinity;
let lastFast = -Infinity;
function frameRate(now) {
  if (mode === "menu" || document.querySelector("dialog[open]")) return 12;
  if (!document.hasFocus()) return 20;
  const fast = ["casting", "fight", "reeling", "landed"].includes(game.phase) || game.pulling || pullPointer !== null
    || ripples.some((ripple) => !ripple.ambient && lastElapsed - ripple.time < 1);
  // Stay smooth a moment after the action ends, so it eases out rather than steps down.
  if (fast) lastFast = now;
  // Waiting for a bite, the slow water reads fine at 24 frames, and the laptop stays cooler.
  return now - lastFast < 800 ? 60 : 24;
}
function draw(now) {
  animationFrame = requestAnimationFrame(draw);
  // A little slack, so a 60 Hz screen never skips a frame it should draw.
  if (now - lastDrawn < 1000 / frameRate(now) - 3) return;
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
    // Back after a while away: the cloud may hold what was done on another device since,
    // and others may have overtaken this angler in the tournament.
    if (cloud.user && !game.busy) cloud.reconcile();
    if (Date.now() - placeChecked > 60000) checkTourneyPlace();
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
