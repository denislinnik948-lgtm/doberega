import { hash2 } from "../noise.js";
import { FISH, LOCATIONS, RODS } from "./data.js";

/*
 * The daily quest: one for everyone, the same all day. Days are counted in
 * UTC from the Unix epoch, so every angler gets the same quest at the same
 * moment, picked from the templates below by a hash of the day's number.
 * Every quest can be done with the starting kit at the first waters, given
 * an hour or so; the reward follows the best rod the angler owns (about a
 * quarter of an hour of their fishing), so it matters at every stage without
 * shortening the rod ladder by much.
 *
 * `progress.quest` holds today's run at it: { day, value, kinds, done }.
 */

const DAY_MS = 86400000;

/** Species for "catch so many": common at the pond, the lake or the castle lake, on worm or maggot. */
const COUNT_FISH = [["karas", 5, 8], ["plitka", 6, 10], ["krasnopirka", 5, 8], ["okun", 4, 7], ["yorzh", 4, 7], ["verkhovodka", 6, 10], ["lyn", 2, 4], ["lyasch", 2, 4], ["rotan", 4, 6]];
/** Species for "one this heavy": a weight that takes some luck but no special rod. */
const HEAVY_FISH = [["karas", 0.6], ["okun", 0.5], ["lyn", 1], ["lyasch", 1.2], ["plitka", 0.3], ["krasnopirka", 0.3]];
/** Fish to land at a given water, by how lively it is. */
const SPOT_COUNTS = { pond: [15, 25], lake: [12, 20], castle: [10, 16], reservoir: [8, 12], bridge: [8, 12] };

/** Reward by the best rod owned (its tier, 1..8). */
const REWARDS = [200, 350, 500, 800, 1300, 2000, 3500, 5500];

export function questDay(now = Date.now()) {
  return Math.floor(now / DAY_MS);
}

/** Milliseconds until the next quest. */
export function untilNextQuest(now = Date.now()) {
  return (questDay(now) + 1) * DAY_MS - now;
}

/** The quest for a day: { day, kind, target, fish?, spot?, weight? }. */
export function questFor(day) {
  const roll = (k) => hash2(day, k, 4513);
  const pick = (list, k) => list[Math.floor(roll(k) * list.length) % list.length];
  const between = (from, to, k) => from + Math.floor(roll(k) * (to - from + 1));
  const kind = pick(["count", "count", "heavy", "spot", "total", "kinds"], 1);
  if (kind === "count") {
    const [fish, from, to] = pick(COUNT_FISH, 2);
    return { day, kind, fish, target: between(from, to, 3) };
  }
  if (kind === "heavy") {
    const [fish, weight] = pick(HEAVY_FISH, 2);
    return { day, kind, fish, weight, target: 1 };
  }
  if (kind === "spot") {
    const spot = pick(LOCATIONS, 2).id;
    const [from, to] = SPOT_COUNTS[spot] ?? [10, 15];
    return { day, kind, spot, target: between(from, to, 3) };
  }
  if (kind === "total") return { day, kind, target: between(4, 10, 3) };
  return { day, kind, target: between(4, 6, 3) };
}

export const todaysQuest = (now = Date.now()) => questFor(questDay(now));

/** The reward for the quest, by the best rod the angler owns. */
export function questReward(progress) {
  const tier = Math.max(1, ...progress.rods.map((id) => RODS[id]?.tier ?? 1));
  return REWARDS[Math.min(REWARDS.length, tier) - 1];
}

/** Today's run at the quest, started afresh on a new day. */
export function questState(progress, quest = todaysQuest()) {
  if (progress.quest?.day !== quest.day) progress.quest = { day: quest.day, value: 0, kinds: [], done: null };
  return progress.quest;
}

/**
 * Count a landed fish towards today's quest. Returns the quest and its reward
 * the moment it is done (the reward is paid here), otherwise null.
 */
export function recordQuest(progress, fish, spotIndex, now = Date.now()) {
  if (FISH[fish.species]?.junk || fish.unique) return null;
  const quest = todaysQuest(now);
  const state = questState(progress, quest);
  if (state.done) return null;
  const spot = LOCATIONS[spotIndex]?.id;
  if (quest.kind === "count" && fish.species === quest.fish) state.value += 1;
  else if (quest.kind === "heavy" && fish.species === quest.fish && fish.weight >= quest.weight) state.value = 1;
  else if (quest.kind === "spot" && spot === quest.spot) state.value += 1;
  else if (quest.kind === "total") state.value = Math.round((state.value + fish.weight) * 1000) / 1000;
  else if (quest.kind === "kinds" && !state.kinds.includes(fish.species)) {
    state.kinds.push(fish.species);
    state.value = state.kinds.length;
  }
  if (state.value < quest.target) return null;
  state.done = new Date(now).toISOString();
  const reward = questReward(progress);
  progress.money += reward;
  progress.stats ??= {};
  progress.stats.quests = (progress.stats.quests ?? 0) + 1;
  return { quest, reward };
}
