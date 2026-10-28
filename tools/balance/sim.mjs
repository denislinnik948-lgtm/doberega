/*
 * Balance check: a simulated angler climbs the rod ladder with the game's own
 * fishing code (FishingGame, rollFish, prices), and the script reports how
 * long each rod takes to earn.
 *
 *   node tools/balance/sim.mjs           the full run, then the checks
 *   node tools/balance/sim.mjs --quick   shorter sessions, rougher numbers
 *
 * The angler is a fair player, not a perfect one: it misses about one bite in
 * five and reacts 0.3–1.2 s late, pumps the rod in the fight (pulling to about
 * 80% tension, easing off to 35%), fishes lures in jerks and pauses, and casts
 * mostly far out. Game time, rain, wind and the moon follow the real clock, as in the game.
 * Every cast pays for its bait, every lost hook or lure and every worn-out
 * line is bought again. At each rod it tries every water, bait and hook,
 * keeps the five best in a short screen, measures those properly and fishes
 * the best until the next rod is paid for.
 *
 * Exits with code 1 when a check fails (see CHECKS), so it can guard any
 * change to the economy.
 */
import { setSeason } from "../../src/theme.js";
import { FishingGame, TUNING } from "../../src/fishing/game.js";
import { BAITS, EXTRAS, HOOKS, LINE, LOCATIONS, RODS, START_STATE, fishPrice } from "../../src/fishing/data.js";
import { dayTimeAt } from "../../src/daycycle.js";
import { rainAt } from "../../src/weather.js";
import { moonBite } from "../../src/moon.js";
import { windAt, windBite } from "../../src/wind.js";

const quick = process.argv.includes("--quick");
// Hours of fishing in the screen, and in the measurement of the best few.
const SCREEN_HOURS = quick ? 0.6 : 1.5;
const MEASURE_HOURS = quick ? 4 : 12;
const FINALISTS = 5;
// The clock fraction at the Unix epoch, as in main.js.
const WORLD_START = 0.68;

/*
 * What a healthy economy looks like: the whole ladder in about 26 hours of
 * this angler's fishing (it was 26.3 h before line wear and the moon), each
 * rod a longer climb than the one before, and the first one quick.
 */
const CHECKS = [
  { name: "full ladder, hours", value: (r) => r.total, min: 22, max: 34 },
  { name: "second rod, hours", value: (r) => r.stages[0].hours, min: 0.1, max: 1 },
  // Compared on the rods alone: the spinning reel bought on the way would blur it.
  { name: "each rod takes longer than the last", value: (r) => r.stages.slice(1).every((stage, i) => stage.rodHours >= r.stages[i].rodHours * 0.9) ? 1 : 0, min: 1, max: 1 },
];

setSeason("summer");

/** A small seeded generator, so every run gives the same numbers. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = state;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fish one setup for `hours`: what it earns and what it costs. */
function session({ rod, spot, bait, hook, hours, seed, extras = [] }) {
  const random = seeded(seed);
  const tally = { income: 0, spend: 0, landed: 0, bites: 0, lost: 0, lines: 0 };
  let line = 1;
  const game = new FishingGame({
    random,
    onEvent: (type, data) => {
      if (type === "bite" || type === "strike") tally.bites += 1;
      if (type !== "outcome") return;
      const lure = BAITS[data.bait].lure;
      if (lure) {
        if (data.hookLost) tally.spend += BAITS[data.bait].price;
      } else {
        if (!BAITS[data.bait].free) tally.spend += BAITS[data.bait].price;
        if (data.hookLost) tally.spend += HOOKS[data.hook].price;
      }
      if (data.type === "landed") {
        tally.landed += 1;
        tally.income += fishPrice(data.fish);
      } else if (data.hookLost) tally.lost += 1;
    },
  });
  game.lineHealth = () => line;
  game.onLineWear = (amount) => {
    line -= amount;
    if (line <= 0) {
      tally.spend += LINE.price;
      tally.lines += 1;
      line = 1;
    }
  };
  // Starting somewhere random in the day, so short sessions don't all fish the same hour.
  let epoch = 1.9e9 + Math.floor(random() * 86400 * 30);
  const end = hours * 3600;
  let elapsed = 0;
  let react = null;
  let pause = 0;
  let previous = "";
  while (elapsed < end) {
    game.hour = dayTimeAt(epoch, WORLD_START) * 24;
    const rain = rainAt(epoch);
    game.biteBoost = (1 + 1.15 * rain) * moonBite(epoch, game.hour) * windBite(windAt(epoch, rain).strength);
    const phase = game.phase;
    if (phase !== previous) {
      // A bite: most are struck, a little late; some are simply missed.
      if (phase === "bite") react = random() < 0.8 ? 0.3 + random() * 0.9 : Infinity;
      if (phase === "landed") pause = 3 + random() * 2;
      if (phase === "ready" && previous) pause = Math.max(pause, 1 + random());
      previous = phase;
    }
    if (phase === "ready") {
      pause -= 0.1;
      if (pause <= 0) {
        const y = TUNING.farY + (TUNING.nearY - TUNING.farY) * (0.08 + 0.35 * random());
        game.cast({ x: 0.5, y }, rod, bait, { location: spot, extras, hook });
      }
    } else if (phase === "landed") {
      pause -= 0.1;
      if (pause <= 0) game.reset();
    } else if (phase === "bite") {
      if (game.clock >= react) game.press();
    } else if (phase === "fight") {
      if (game.snag) game.release();
      else if (game.pulling && game.tension > 0.8) game.release();
      else if (!game.pulling && game.tension < 0.35) game.press();
    } else if (phase === "retrieving") {
      // Jerk and pause: a short pull, then let it flutter down.
      const beat = (elapsed * 1000) % 800;
      if (beat < 250) game.press();
      else game.release();
    } else if (game.pulling) game.release();
    // Waiting for a bite needs no fine steps.
    const dt = phase === "waiting" && game.clock < game.waitTime - 0.3 ? 0.25 : 0.05;
    game.update(dt);
    elapsed += dt;
    epoch += dt;
  }
  return { ...tally, rate: (tally.income - tally.spend) / hours };
}

/** Every setup worth trying with this rod: each water, bait and hook (lures with the spinning reel). */
function setups(rod) {
  const list = [];
  LOCATIONS.forEach((_, spot) => {
    for (const [bait, info] of Object.entries(BAITS)) {
      if (info.lure) list.push({ rod, spot, bait, hook: "medium", extras: ["spinreel"], needs: "spinreel" });
      else for (const hook of Object.keys(HOOKS)) list.push({ rod, spot, bait, hook });
    }
  });
  return list;
}

const label = (s) => `${LOCATIONS[s.spot].id} ${s.bait}${BAITS[s.bait].lure ? "" : `/${s.hook}`}`;

function bestSetup(rod, stage) {
  const screened = setups(rod)
    .map((setup, index) => ({ setup, ...session({ ...setup, hours: SCREEN_HOURS, seed: 1000 * stage + index }) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, FINALISTS);
  return screened
    .map(({ setup }, index) => ({ setup, ...session({ ...setup, hours: MEASURE_HOURS, seed: 77 + 1000 * stage + index }) }))
    .sort((a, b) => b.rate - a.rate)[0];
}

const rods = Object.keys(RODS).sort((a, b) => RODS[a].tier - RODS[b].tier);
const stages = [];
let money = START_STATE.money;
let reel = false;
const started = Date.now();
for (let i = 0; i < rods.length - 1; i += 1) {
  const best = bestSetup(rods[i], i);
  // The spinning reel is bought the first time a lure pays best.
  const extra = best.setup.needs === "spinreel" && !reel ? EXTRAS.spinreel.price : 0;
  if (extra) reel = true;
  const need = Math.max(0, RODS[rods[i + 1]].price + extra - money);
  const hours = need / Math.max(1, best.rate);
  money = Math.max(0, money - RODS[rods[i + 1]].price - extra + best.rate * hours);
  stages.push({ rod: rods[i], next: rods[i + 1], setup: label(best.setup), rate: best.rate, hours, rodHours: RODS[rods[i + 1]].price / Math.max(1, best.rate), landed: best.landed / MEASURE_HOURS, lost: best.lost / MEASURE_HOURS, lines: best.lines / MEASURE_HOURS });
}
const total = stages.reduce((sum, stage) => sum + stage.hours, 0);
const result = { stages, total };

const pad = (text, size) => String(text).padEnd(size);
console.log(pad("rod", 11) + pad("next", 11) + pad("best setup", 26) + pad("₴/h", 8) + pad("fish/h", 8) + pad("lost/h", 8) + pad("lines/h", 9) + "hours");
for (const stage of stages) {
  console.log(pad(stage.rod, 11) + pad(stage.next, 11) + pad(stage.setup, 26) + pad(Math.round(stage.rate), 8) + pad(stage.landed.toFixed(0), 8) + pad(stage.lost.toFixed(1), 8) + pad(stage.lines.toFixed(2), 9) + stage.hours.toFixed(2));
}
console.log(`\nfull ladder: ${total.toFixed(1)} h (simulated in ${((Date.now() - started) / 1000).toFixed(0)} s${quick ? ", quick" : ""})\n`);

let failed = 0;
for (const check of CHECKS) {
  const value = check.value(result);
  const ok = value >= check.min && value <= check.max;
  if (!ok) failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${check.name}: ${Number(value.toFixed(2))} (${check.min}–${check.max})`);
}
process.exit(failed ? 1 : 0);
