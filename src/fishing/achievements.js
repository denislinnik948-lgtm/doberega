import { FISH, LOCATIONS, RODS } from "./data.js";

/**
 * Achievements: a badge, a note on screen and a little money each. The money
 * is modest (50–1000 ₴, about 12,000 ₴ for all of them, under 3% of what the
 * rods and gear cost), so they reward without upsetting the economy.
 *
 * What they need is counted in `progress.stats` (see `recordCatch` below and the
 * calls in main.js and ui.js); `progress.achievements` holds when each was
 * earned. `evaluate` is run after every change of progress and hands back the
 * ones just earned. Secret ones show only "?" until earned.
 */

/** Every species worth collecting: no jokes, no junk. */
const COLLECTABLE = Object.keys(FISH).filter((id) => !FISH[id].unique && !FISH[id].junk);

/** The fish a spot's "knows the water" badge asks for: the ones that live there, but not the protected or seasonal. */
const spotSet = (spotId) => Object.keys(LOCATIONS.find((spot) => spot.id === spotId).fish).filter((id) => !FISH[id].protected && !FISH[id].season);

const stat = (progress, key) => progress.stats?.[key] ?? 0;
const species = (progress, id) => progress.stats?.bySpecies?.[id] ?? 0;
const caughtAt = (progress, spotId) => progress.stats?.atSpot?.[spotId] ?? [];
const heaviest = (progress, id) => progress.stats?.heaviest?.[id] ?? 0;
const heaviestAny = (progress) => Math.max(0, ...Object.values(progress.stats?.heaviest ?? {}));
const hasTrophy = (progress, id) => progress.trophies.some((trophy) => trophy.species === id);

/** Count achievement: done at `target`, with its progress shown. */
const counted = (target, value) => ({ target, value: (progress) => Math.min(target, value(progress)) });
/** Yes/no achievement. */
const flag = (test) => ({ target: 1, value: (progress) => (test(progress) ? 1 : 0) });

const spotBadge = (spotId) => counted(spotSet(spotId).length, (progress) => spotSet(spotId).filter((id) => caughtAt(progress, spotId).includes(id)).length);

/*
 * The list, in the order it's shown. `group` heads a section; `reward` is in
 * hryvnia; `secret` hides the name's meaning until earned.
 */
export const ACHIEVEMENTS = [
  // First steps.
  { id: "firstCatch", group: "start", reward: 50, ...flag((p) => p.caught >= 1) },
  { id: "firstSale", group: "start", reward: 50, ...flag((p) => stat(p, "sales") >= 1) },
  { id: "realRod", group: "start", reward: 100, ...flag((p) => p.rods.length >= 2) },
  { id: "firstLure", group: "start", reward: 100, ...flag((p) => stat(p, "lureCatches") >= 1) },
  { id: "firstGroundbait", group: "start", reward: 50, ...flag((p) => stat(p, "groundbaits") >= 1) },
  // Collector.
  { id: "knowsPond", group: "collector", reward: 300, ...spotBadge("pond") },
  { id: "knowsLake", group: "collector", reward: 300, ...spotBadge("lake") },
  { id: "knowsCastle", group: "collector", reward: 300, ...spotBadge("castle") },
  { id: "knowsReservoir", group: "collector", reward: 300, ...spotBadge("reservoir") },
  { id: "knowsBridge", group: "collector", reward: 300, ...spotBadge("bridge") },
  { id: "predators", group: "collector", reward: 300, ...counted(5, (p) => ["shchuka", "sudak", "zherekh", "okun", "forel"].filter((id) => species(p, id) > 0).length) },
  { id: "ichthyologist", group: "collector", reward: 1000, ...counted(COLLECTABLE.length, (p) => COLLECTABLE.filter((id) => species(p, id) > 0 || (id === "sterliad" && (p.released?.sterliad ?? 0) > 0)).length) },
  // Weight and records.
  { id: "kilo", group: "weight", reward: 50, ...flag((p) => heaviestAny(p) >= 1) },
  { id: "heavy", group: "weight", reward: 300, ...flag((p) => heaviestAny(p) >= 10) },
  { id: "som40", group: "weight", reward: 500, ...flag((p) => heaviest(p, "som") >= 40) },
  { id: "amur20", group: "weight", reward: 500, ...flag((p) => heaviest(p, "amur") >= 20) },
  { id: "record", group: "weight", reward: 300, ...flag((p) => stat(p, "records") >= 1) },
  // Skill.
  { id: "cleanStreak", group: "skill", reward: 200, ...counted(10, (p) => stat(p, "bestStreak")) },
  { id: "patience", group: "skill", reward: 300, ...flag((p) => stat(p, "overweight") >= 1) },
  { id: "lightHand", group: "skill", reward: 200, ...counted(5, (p) => stat(p, "dipHooks")) },
  { id: "jerks", group: "skill", reward: 300, ...counted(20, (p) => stat(p, "spoonCatches")) },
  { id: "pauseMaster", group: "skill", reward: 300, ...counted(10, (p) => stat(p, "wobblerPredators")) },
  // Time and weather.
  { id: "dawn", group: "time", reward: 100, ...flag((p) => stat(p, "dawnCatches") >= 1) },
  { id: "nightWatch", group: "time", reward: 200, ...counted(10, (p) => stat(p, "nightCatches")) },
  { id: "inTheRain", group: "time", reward: 200, ...counted(10, (p) => stat(p, "rainCatches")) },
  { id: "autumnBurbot", group: "time", reward: 300, ...flag((p) => species(p, "myn") >= 1) },
  { id: "wholeDay", group: "time", reward: 300, ...flag((p) => stat(p, "wholeDay") >= 1) },
  // Numbers and money.
  { id: "hundred", group: "count", reward: 300, ...counted(100, (p) => p.caught) },
  { id: "thousand", group: "count", reward: 500, ...counted(1000, (p) => p.caught) },
  { id: "fullNet", group: "count", reward: 300, ...flag((p) => stat(p, "bigSale") >= 1) },
  { id: "wealthy", group: "count", reward: 500, ...flag((p) => p.money >= 100000) },
  { id: "allRods", group: "count", reward: 500, ...counted(Object.keys(RODS).length, (p) => p.rods.length) },
  // Special and secret.
  { id: "guardian", group: "special", reward: 500, ...flag((p) => (p.released?.sterliad ?? 0) >= 1) },
  { id: "kindHeart", group: "special", reward: 100, ...counted(10, (p) => stat(p, "releasedFromNet")) },
  { id: "oldBoot", group: "special", reward: 50, ...flag((p) => stat(p, "boots") >= 1) },
  { id: "duckThief", group: "special", reward: 100, ...counted(5, (p) => stat(p, "duckSteals")) },
  { id: "valerka", group: "special", reward: 500, secret: true, ...flag((p) => hasTrophy(p, "valerka")) },
  { id: "artem", group: "special", reward: 500, secret: true, ...flag((p) => hasTrophy(p, "artem")) },
  { id: "mutant", group: "special", reward: 500, secret: true, ...flag((p) => hasTrophy(p, "dvoholovyi")) },
  { id: "sawMavka", group: "special", reward: 200, secret: true, ...flag((p) => stat(p, "sawMavka") >= 1) },
  { id: "sawBoatman", group: "special", reward: 200, secret: true, ...flag((p) => stat(p, "sawBoat") >= 1) },
];

export const GROUPS = ["start", "collector", "weight", "skill", "time", "count", "special"];

/** Add to a counter in the stats. */
export function bump(progress, key, amount = 1) {
  progress.stats ??= {};
  progress.stats[key] = (progress.stats[key] ?? 0) + amount;
}

/** Keep the higher of a counter and a value (a best streak). */
function best(progress, key, value) {
  progress.stats ??= {};
  progress.stats[key] = Math.max(progress.stats[key] ?? 0, value);
}

/**
 * Count a landed fish: by species and by spot, its weight record, and what it
 * says about how, when and where it was caught. `context`: { spot (index),
 * bait, lure, hour, rain, rodMaxKg }.
 */
export function recordCatch(progress, fish, { spot, bait, lure, hour, rain, rodMaxKg }) {
  progress.stats ??= {};
  const stats = progress.stats;
  if (FISH[fish.species]?.junk) {
    bump(progress, "boots");
    return;
  }
  if (fish.unique) return;
  stats.bySpecies ??= {};
  stats.bySpecies[fish.species] = (stats.bySpecies[fish.species] ?? 0) + 1;
  const spotId = LOCATIONS[spot]?.id;
  stats.atSpot ??= {};
  if (spotId) {
    stats.atSpot[spotId] ??= [];
    if (!stats.atSpot[spotId].includes(fish.species)) stats.atSpot[spotId].push(fish.species);
  }
  stats.heaviest ??= {};
  stats.heaviest[fish.species] = Math.max(stats.heaviest[fish.species] ?? 0, fish.weight);
  // A record: within 5% of the heaviest this fish can grow in this water.
  const cap = Math.min(FISH[fish.species].max, LOCATIONS[spot]?.maxKg ?? FISH[fish.species].max);
  if (fish.weight >= cap * 0.95) bump(progress, "records");
  if (lure) {
    bump(progress, "lureCatches");
    if (bait === "spoon") bump(progress, "spoonCatches");
    if (bait === "wobbler" && !FISH[fish.species].greedy) bump(progress, "wobblerPredators");
  }
  if (hour < 5 || hour >= 21.5) bump(progress, "nightCatches");
  if (hour >= 4.5 && hour < 6.5) bump(progress, "dawnCatches");
  if (rain > 0.3) bump(progress, "rainCatches");
  if (rodMaxKg && fish.weight >= rodMaxKg * 2) bump(progress, "overweight");
  bump(progress, "streak");
  best(progress, "bestStreak", stats.streak);
}

/** A big fish lost with the hook (a snapped line or a bent hook) breaks the clean streak. */
export function breakStreak(progress) {
  progress.stats ??= {};
  progress.stats.streak = 0;
}

/** How far along an achievement is: { value, target, done }. */
export function achievementProgress(progress, achievement) {
  const value = achievement.value(progress);
  return { value, target: achievement.target, done: Boolean(progress.achievements?.[achievement.id]) };
}

/**
 * Award every achievement newly met: mark it with the date, pay its reward,
 * and return the ones just earned (to announce).
 */
export function evaluate(progress) {
  progress.achievements ??= {};
  const earned = [];
  for (const achievement of ACHIEVEMENTS) {
    if (progress.achievements[achievement.id]) continue;
    if (achievement.value(progress) < achievement.target) continue;
    progress.achievements[achievement.id] = new Date().toISOString();
    progress.money += achievement.reward;
    earned.push(achievement);
  }
  return earned;
}
