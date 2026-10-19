import { locale, t } from "../i18n.js";

/**
 * Fishing catalog (display names live in src/i18n.js): fish, bait, rods, extras and fishing spots. Weights are in
 * kilograms, prices in hryvnia. The economy is deliberately tight: each rod
 * is a real grind away from the last.
 */

/**
 * `active` is when each fish feeds: a baseline plus peaks [hour, width, strength]
 * on a 24-hour clock.
 */
export const FISH = {
  yorzh: { min: 0.02, max: 0.2, pricePerKg: 15, active: { base: 0.6, peaks: [[6, 4, 0.5], [20, 5, 0.5]] } },
  plitka: { min: 0.05, max: 0.6, pricePerKg: 20, active: { base: 0.3, peaks: [[7, 3, 1], [18, 3, 0.8]] } },
  krasnopirka: { min: 0.05, max: 0.7, pricePerKg: 20, active: { base: 0.3, peaks: [[13, 4, 1]] } },
  karas: { min: 0.1, max: 1.5, pricePerKg: 30, active: { base: 0.25, peaks: [[6, 3, 1], [19, 3, 1]] } },
  okun: { min: 0.1, max: 1.8, pricePerKg: 40, active: { base: 0.2, peaks: [[10, 4, 1], [17, 3, 0.6]] } },
  lyn: { min: 0.3, max: 3.5, pricePerKg: 50, active: { base: 0.2, peaks: [[5, 2.5, 1], [21, 2.5, 0.8]] } },
  lyasch: { min: 0.4, max: 5, pricePerKg: 35, active: { base: 0.25, peaks: [[2, 4, 1], [22, 3, 0.8]] } },
  korop: { min: 1, max: 18, pricePerKg: 45, active: { base: 0.25, peaks: [[5, 3, 1], [23, 3, 0.8]] } },
  shchuka: { min: 1, max: 14, pricePerKg: 55, active: { base: 0.2, peaks: [[6, 2.5, 1], [19, 2.5, 1]] } },
  sudak: { min: 0.8, max: 10, pricePerKg: 70, active: { base: 0.15, peaks: [[21, 3, 1], [4, 3, 0.8]] } },
  som: { min: 5, max: 60, pricePerKg: 40, active: { base: 0.1, peaks: [[0, 4, 1], [23, 3, 0.6]] } },
  // A joke: Valerka, a clownfish that has no business in a Ukrainian pond. Priceless, trophy only.
  valerka: { min: 0.12, max: 0.28, pricePerKg: 0, unique: true, active: { base: 1, peaks: [] } },
  // Not a fish: sometimes reeled in instead of an empty hook.
  boot: { min: 0.6, max: 1.4, pricePerKg: 0, junk: true, active: { base: 0, peaks: [] } },
};

/**
 * How each fish takes the bait. `tempers` weights the four kinds of bite
 * (greedy grab, playful nibbler, wary fiddler, teaser that goes quiet);
 * `pace` stretches the gaps between twitches (above 1 is slower), `twitches`
 * scales how many there are, `strength` how hard they pull the float, and
 * `window` how long the float stays under before the fish lets go.
 */
export const NIBBLE = {
  yorzh: { tempers: [5, 4, 1, 0], pace: 0.7, twitches: 1.3, strength: 0.7, window: 1.2 },
  plitka: { tempers: [2, 6, 1, 1], pace: 0.75, twitches: 1.2, strength: 0.6, window: 0.85 },
  krasnopirka: { tempers: [2, 6, 1, 1], pace: 0.8, twitches: 1.1, strength: 0.6, window: 0.9 },
  karas: { tempers: [1, 4, 4, 2], pace: 1.15, twitches: 1.4, strength: 0.65, window: 1 },
  okun: { tempers: [6, 3, 1, 0], pace: 0.7, twitches: 0.8, strength: 1.2, window: 1.1 },
  lyn: { tempers: [0, 2, 5, 3], pace: 1.5, twitches: 0.9, strength: 0.8, window: 1.3 },
  lyasch: { tempers: [0, 3, 4, 3], pace: 1.35, twitches: 1, strength: 0.75, window: 1.2 },
  korop: { tempers: [1, 2, 5, 2], pace: 1.3, twitches: 1.1, strength: 1.1, window: 1 },
  shchuka: { tempers: [6, 1, 1, 2], pace: 0.9, twitches: 0.6, strength: 1.4, window: 1.2 },
  sudak: { tempers: [1, 3, 5, 1], pace: 1.1, twitches: 0.8, strength: 0.7, window: 0.8 },
  som: { tempers: [2, 1, 3, 4], pace: 1.6, twitches: 0.6, strength: 1.5, window: 1.4 },
  valerka: { tempers: [3, 3, 1, 3], pace: 0.6, twitches: 1.5, strength: 1.3, window: 1.6 },
  boot: { tempers: [1, 0, 0, 0], pace: 1, twitches: 0, strength: 0.5, window: 1 },
};

/** Chance that any bite, anywhere, on any bait, is Valerka: next to impossible. */
export const VALERKA_CHANCE = 1 / 25000;

/** Chance that reeling in an empty line hooks an old boot. */
export const BOOT_CHANCE = 0.012;

/** How hungry a fish is at `hour` (0..24): roughly 0.1 (asleep) to 1.3 (feeding). */
export function activity(species, hour) {
  const { base, peaks } = FISH[species].active;
  return peaks.reduce((sum, [center, width, strength]) => {
    const around = (((hour - center) % 24) + 24) % 24;
    const distance = Math.min(around, 24 - around);
    return sum + strength * Math.exp(-((distance / width) ** 2));
  }, base);
}

const PERIODS = [
  { id: "night", hours: [23, 0, 1, 2, 3] },
  { id: "dawn", hours: [4, 5, 6] },
  { id: "morning", hours: [7, 8, 9, 10] },
  { id: "day", hours: [11, 12, 13, 14, 15] },
  { id: "evening", hours: [16, 17, 18, 19] },
  { id: "dusk", hours: [20, 21, 22] },
];

/** The parts of the day when a fish feeds best, for the handbook. */
export function activePeriods(species) {
  const scores = PERIODS.map((period) => period.hours.reduce((sum, hour) => sum + activity(species, hour), 0) / period.hours.length);
  const best = Math.max(...scores);
  return PERIODS.filter((_, index) => scores[index] >= best * 0.7).map((period) => period.id);
}

/**
 * `species` is how much each fish likes the bait (others nibble rarely);
 * `size` scales the chance of a big fish; `maxSize` caps the weight range
 * (bread only ever tempts tiddlers); `others` is how often fish that don't
 * favour it still bite; `price` is per piece; `free` never runs out.
 */
export const BAITS = {
  bread: { price: 0, free: true, others: 0, size: 0, maxSize: 0.22, species: { plitka: 4, krasnopirka: 4, karas: 3, yorzh: 1 } },
  worm: { price: 3, size: 0.6, species: { plitka: 3, karas: 3, okun: 3, yorzh: 3, lyn: 2, lyasch: 1 } },
  maggot: { price: 4, size: 0.5, species: { plitka: 4, krasnopirka: 3, yorzh: 2, lyasch: 2, karas: 2 } },
  bloodworm: { price: 5, size: 0.5, species: { yorzh: 3, plitka: 3, karas: 2, lyn: 3, okun: 2 } },
  barley: { price: 4, size: 0.8, species: { karas: 3, lyasch: 3, plitka: 2, korop: 2, lyn: 1 } },
  corn: { price: 7, size: 1, species: { karas: 2, lyasch: 3, korop: 4, lyn: 2 } },
  boilie: { price: 20, size: 1.6, species: { korop: 6, lyasch: 1 } },
  livebait: { price: 25, size: 1.4, species: { okun: 2, shchuka: 4, sudak: 4, som: 1 } },
  frog: { price: 45, size: 1.8, species: { som: 6, shchuka: 1 } },
};

/** `maxKg` is the weight a rod handles comfortably; heavier fish strain it fast. */
export const RODS = {
  willow: { tier: 1, maxKg: 0.6, price: 0, reel: 0.95 },
  hazel: { tier: 2, maxKg: 1.2, price: 150, reel: 1 },
  bamboo: { tier: 3, maxKg: 2, price: 650, reel: 1 },
  telescope: { tier: 4, maxKg: 3.5, price: 1900, reel: 1.05 },
  glass: { tier: 5, maxKg: 6, price: 5200, reel: 1.05 },
  carbon: { tier: 6, maxKg: 10, price: 14000, reel: 1.1 },
  carp: { tier: 7, maxKg: 18, price: 36000, reel: 1.15 },
  catfish: { tier: 8, maxKg: 40, price: 90000, reel: 1.2 },
};

/** Hooks are consumables; a big fish that snaps the line takes one with it. */
export const HOOK_PRICE = 6;

/** One-off upgrades that make fishing easier. */
export const EXTRAS = {
  handbook: { price: 900 },
  glowfloat: { price: 650 },
  net: { price: 2800 },
  braid: { price: 4500 },
  sonar: { price: 7500 },
};

/**
 * Fishing spots. `fish` weights who lives there; `bigChance` is the base odds
 * that a bite is a big one (before bait and cast distance); `maxKg` is the
 * heaviest fish this water can hold (small water, small fish); `pace` scales
 * how often anything bites (big water: fewer, bigger fish). `water` tints the lake.
 */
export const LOCATIONS = [
  {
    id: "pond", snagChance: 0.02, kind: "pond", water: "#4a7d66",
    traits: { type: "pond", depth: "shallow", bottom: "mud", current: "none" },
    bigChance: 1 / 100, maxKg: 6, pace: 1.1,
    fish: { karas: 5, krasnopirka: 3, plitka: 3, yorzh: 2, lyn: 1.5, korop: 0.4 },
  },
  {
    id: "lake", snagChance: 0.025, kind: "lake", water: "#3f7f86",
    traits: { type: "lake", depth: "medium", bottom: "sandWeed", current: "none" },
    bigChance: 1 / 60, maxKg: 12, pace: 1,
    fish: { plitka: 3, okun: 3, lyasch: 2, krasnopirka: 2, lyn: 2, shchuka: 1, korop: 1 },
  },
  {
    id: "castle", snagChance: 0.035, kind: "castle", water: "#3aa88c",
    traits: { type: "lake", depth: "deep", bottom: "stones", current: "none" },
    bigChance: 1 / 45, maxKg: 16, pace: 0.95,
    // Clear, deep and stony: a predator lake.
    fish: { okun: 4, plitka: 3, shchuka: 2.5, sudak: 1.5, lyasch: 1.5, yorzh: 1 },
  },
  {
    id: "reservoir", snagChance: 0.04, kind: "reservoir", water: "#356f80",
    traits: { type: "reservoir", depth: "deep", bottom: "clayLogs", current: "weak" },
    bigChance: 1 / 30, maxKg: 40, pace: 0.9,
    fish: { lyasch: 3, sudak: 2, shchuka: 2, korop: 2, okun: 2, som: 0.8 },
  },
  {
    id: "bridge", snagChance: 0.06, kind: "bridge", water: "#2f6a7a",
    traits: { type: "river", depth: "deep", bottom: "logsEddies", current: "strong" },
    bigChance: 1 / 20, maxKg: 60, pace: 0.8,
    fish: { som: 3, sudak: 2, lyasch: 2, okun: 1.5, plitka: 1.5, korop: 1, shchuka: 1 },
  },
];

export const START_STATE = {
  money: 30,
  baits: { worm: 5 },
  hooks: 5,
  rods: ["willow"],
  rod: "willow",
  bait: "worm",
  extras: [],
  trophies: [],
  caught: 0,
  location: 0,
};

export function fishPrice(fish) {
  if (FISH[fish.species].unique) return 0;
  return Math.round(fish.weight * FISH[fish.species].pricePerKg + 2);
}

/** A unique fish is mounted for free. */
export function trophyCost(fish) {
  if (FISH[fish.species].unique) return 0;
  return Math.round(fishPrice(fish) * 0.6 + 40);
}

export function formatWeight(kg) {
  return kg < 1 ? `${Math.round(kg * 1000)} ${t("unit.g")}` : `${Number(kg.toFixed(2))} ${t("unit.kg")}`;
}

export function formatMoney(value) {
  return `${value.toLocaleString(locale())} ₴`;
}

function pickWeighted(entries, random) {
  let roll = random() * entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [id, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

/**
 * Pick a species and weight for a bite. Species = who lives here × who likes the
 * bait (fish that don't care for it still take it now and then). Weight: most
 * bites are ordinary; with the spot's big-fish odds — scaled by bait and by how
 * far out the cast landed (`reach`, 0..1) — it's a big one. Big fish can turn
 * up anywhere; some places are just far likelier. Returns null when no fish
 * here takes this bait.
 */
/** Who here would take this bait, weighted by habitat, taste and hunger right now. */
function candidates(baitId, locationIndex, hour) {
  const bait = BAITS[baitId];
  const location = LOCATIONS[locationIndex] ?? LOCATIONS[0];
  return Object.entries(location.fish)
    .map(([id, weight]) => [id, weight * (bait.species[id] ?? bait.others ?? 0.08), activity(id, hour)])
    .filter(([, weight]) => weight > 0);
}

/**
 * How lively the bite is right now (≈0.1..1.3): the average hunger of the fish
 * that would take this bait here. Bites come sooner when it's high.
 */
export function biteActivity(baitId, locationIndex, hour) {
  const list = candidates(baitId, locationIndex, hour);
  const total = list.reduce((sum, [, weight]) => sum + weight, 0);
  if (!total) return 0;
  return list.reduce((sum, [, weight, hunger]) => sum + weight * hunger, 0) / total;
}

export function rollFish(baitId, locationIndex, random = Math.random, reach = 0.5, hour = 18) {
  const bait = BAITS[baitId];
  const location = LOCATIONS[locationIndex] ?? LOCATIONS[0];
  const entries = candidates(baitId, locationIndex, hour).map(([id, weight, hunger]) => [id, weight * hunger]);
  // Nobody here takes this bait at all.
  if (!entries.length) return null;
  if (random() < VALERKA_CHANCE) {
    const valerka = FISH.valerka;
    return { species: "valerka", weight: Math.round((valerka.min + random() * (valerka.max - valerka.min)) * 1000) / 1000, big: false, unique: true };
  }
  const species = pickWeighted(entries, random);
  const fish = FISH[species];

  const bigOdds = Math.min(0.6, location.bigChance * bait.size * (0.4 + 1.2 * Math.min(1, Math.max(0, reach))));
  const big = random() < bigOdds;
  const t = big ? 0.55 + 0.45 * random() ** 1.4 : 0.5 * random() ** 1.7;
  // Small water caps how big a fish can grow; bread only ever tempts tiddlers.
  const max = Math.min(fish.max, Math.max(fish.min, location.maxKg ?? fish.max));
  const span = (max - fish.min) * (bait.maxSize ?? 1);
  const weight = Math.round((fish.min + span * t) * 1000) / 1000;
  return { species, weight, big: big && !bait.maxSize };
}

/** Handbook entries, derived from the catalog so they never drift from the game. */
export function handbookEntries() {
  // Valerka stays a secret: the handbook never mentions it.
  return Object.entries(FISH).filter(([, fish]) => !fish.junk && !fish.unique).map(([id, fish]) => {
    // Places as trait sets (type, depth, bottom); the UI words them.
    const seen = new Set();
    const places = LOCATIONS
      .filter((spot) => (spot.fish[id] ?? 0) >= 1)
      .sort((a, b) => b.fish[id] - a.fish[id])
      .map((spot) => spot.traits)
      .filter((traits) => {
        const key = `${traits.type}|${traits.depth}|${traits.bottom}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    const baits = Object.entries(BAITS)
      .filter(([, bait]) => (bait.species[id] ?? 0) >= 3)
      .map(([baitId]) => baitId);
    return {
      id,
      places,
      baits,
      times: activePeriods(id),
      range: `${formatWeight(fish.min)} – ${formatWeight(fish.max)}`,
    };
  });
}

