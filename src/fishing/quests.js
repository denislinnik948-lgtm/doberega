import { hash2 } from "../noise.js";
import { FISH, HOOKS, LOCATIONS, RARE_FISH, RODS } from "./data.js";
import { giveGroundbaits, groundbaitFor } from "./waters.js";

/*
 * The daily quest: one for everyone, the same all day. Days are counted in
 * UTC from the Unix epoch, so every angler gets the same quest at the same
 * moment, picked from the templates below by a hash of the day's number.
 * Every quest can be done with the starting kit at the pond, the one water
 * open to all, given an hour or so; the reward follows the best rod the angler owns (about a
 * quarter of an hour of their fishing), so it matters at every stage without
 * shortening the rod ladder by much.
 *
 * `progress.quest` holds today's run at it: { day, value, kinds, done }.
 *
 * Also here, on the same days: the fish of the day, which sells dearer, and
 * the run of days in a row with a catch, each day of it bringing a gift.
 */

const DAY_MS = 86400000;

/** Species for "catch so many": common at the pond, on worm or maggot. */
const COUNT_FISH = [["karas", 5, 8], ["plitka", 6, 10], ["krasnopirka", 5, 8], ["yorzh", 4, 7], ["verkhovodka", 6, 10], ["rotan", 4, 6]];
/** Species for "one this heavy": a weight that takes some luck but no special rod. */
const HEAVY_FISH = [["karas", 0.6], ["plitka", 0.3], ["krasnopirka", 0.3], ["rotan", 0.25]];
/** Fish to land at a given water, by how lively it is: only the waters open to everyone. */
const SPOT_COUNTS = { pond: [15, 25] };

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
    const spot = pick(LOCATIONS.filter((place) => !place.unlock), 2).id;
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

/*
 * The fish of the day: one species, the same for everyone, that sells for
 * DAY_FISH_BONUS times its price when caught that day. Only a fish that is
 * hard to come by (RARE_FISH) can be it, so the bonus is worth a hunt, but
 * not the burbot (only in autumn) or the silver carp (hardly ever bites).
 */
const DAY_FISH = RARE_FISH.filter((id) => FISH[id].pricePerKg > 0 && !FISH[id].season && id !== "tovstolob");

export function fishOfDay(day = questDay()) {
  return DAY_FISH[Math.floor(hash2(day, 7, 9127) * DAY_FISH.length) % DAY_FISH.length];
}

/*
 * Days in a row: a day counts once the angler lands a fish on it (days run
 * in UTC, like the quest). Each counted day brings a gift, round a week:
 * bait, hooks, groundbait, a spare line, and money on the fourth and the
 * seventh (a share of the quest reward, so it keeps up with the angler).
 * Miss a day and the run starts again from the first.
 *
 * `progress.streak` holds { day, count, best }.
 */
export const STREAK_GIFTS = [
  { bait: "worm", count: 10 },
  { hook: "medium", count: 5 },
  { groundbait: 1 },
  { money: 0.25 },
  { lines: 1 },
  { groundbait: 2 },
  { money: 1 },
];

/** The gift for a day of the run (1, 2, …), round the week. */
export const streakGift = (count) => STREAK_GIFTS[(count - 1) % STREAK_GIFTS.length];

/** How many days in a row so far: still alive if the last counted day was today or yesterday. */
export function streakNow(progress, now = Date.now()) {
  const streak = progress.streak;
  if (!streak) return 0;
  return questDay(now) - streak.day <= 1 ? streak.count : 0;
}

/** Whether today is already counted. */
export const streakToday = (progress, now = Date.now()) => progress.streak?.day === questDay(now);

/**
 * Count today towards the run, on a landed fish. Returns { count, gift } the
 * first time on a day (the gift is given here; money paid is in `gift.paid`),
 * otherwise null.
 */
export function recordDay(progress, now = Date.now()) {
  const day = questDay(now);
  const streak = progress.streak;
  if (streak?.day === day) return null;
  const count = streak?.day === day - 1 ? streak.count + 1 : 1;
  progress.streak = { day, count, best: Math.max(streak?.best ?? 0, count) };
  const gift = { ...streakGift(count) };
  if (gift.bait) progress.baits[gift.bait] = (progress.baits[gift.bait] ?? 0) + gift.count;
  if (gift.hook && HOOKS[gift.hook]) progress.hooks[gift.hook] = (progress.hooks[gift.hook] ?? 0) + gift.count;
  if (gift.groundbait) giveGroundbaits(progress, gift.groundbait);
  if (gift.lines) progress.lines = (progress.lines ?? 0) + gift.lines;
  if (gift.money) {
    gift.paid = Math.round(questReward(progress) * gift.money);
    progress.money += gift.paid;
  }
  return { count, gift };
}

/*
 * The weekly tournament: one species, the same for everyone, from Monday
 * 00:00 to Sunday 23:59 Kyiv time, in one of three formats taking turns
 * (TOURNEY_FORMATS): the heaviest single fish, a marathon (the most kilos of
 * it all week) or the heaviest one caught at night. Middling fish, ones the
 * early rods can land too, and the pike and zander. Results of signed-in
 * anglers go to the cloud (cloud.js); the server checks the week and the
 * weight. Prizes, paid the next time the angler comes in after the week: 3×,
 * 2× and 1× the quest reward and a cup on the trophy wall for the top three,
 * and two groundbaits made for the week's fish for everyone who landed at
 * least TOURNEY_GIFT.minFish of it.
 *
 * `progress.tourney` holds { week, best, count, place, claimed, previous }:
 * this week's score (the heaviest, or the kilos in all), how many of the
 * week's fish counted, the last place seen on the board, the last week whose
 * prize has been settled, and last week's { week, count }.
 */
export const TOURNEY_FISH = ["karas", "okun", "lyn", "lyasch", "plitka", "krasnopirka", "shchuka", "sudak"];
// The formats and the pike and zander came in with the week starting 16 November 2026;
// the weeks before keep the fish and the format they were played for.
export const TOURNEY_RULES_FROM = 2968;
const OLD_TOURNEY_FISH = ["karas", "okun", "lyn", "lyasch", "plitka", "krasnopirka"];
export const TOURNEY_PRIZES = [3, 2, 1];
export const TOURNEY_GIFT = { groundbait: 2, minFish: 3 };
// The formats take turns by week: the heaviest every other week, a marathon and a night one in between.
export const TOURNEY_FORMATS = ["heaviest", "marathon", "heaviest", "night"];
// Night by the game's clock, the same for everyone (see daycycle.js).
export const TOURNEY_NIGHT = { from: 21, to: 5 };

export function tourneyFormat(week = tourneyWeek()) {
  if (week < TOURNEY_RULES_FROM) return "heaviest";
  return TOURNEY_FORMATS[((week % TOURNEY_FORMATS.length) + TOURNEY_FORMATS.length) % TOURNEY_FORMATS.length];
}

/** Whether a game hour is night, for the night tournament. */
export const tourneyNight = (hour) => hour >= TOURNEY_NIGHT.from || hour < TOURNEY_NIGHT.to;

// "Europe/Kiev" rather than "Europe/Kyiv": older browsers and databases know only the old name.
const KYIV = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kiev", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** Kyiv wall-clock time as if it were UTC, in milliseconds. */
function kyivWall(now) {
  const parts = Object.fromEntries(KYIV.formatToParts(now).map((part) => [part.type, Number(part.value)]));
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
}

/** The week's number: weeks start on Monday (1 Jan 1970 was a Thursday). */
export function tourneyWeek(now = Date.now()) {
  return Math.floor((Math.floor(kyivWall(now) / DAY_MS) + 3) / 7);
}

/** Milliseconds until the week ends. */
export function untilWeekEnd(now = Date.now()) {
  return ((tourneyWeek(now) + 1) * 7 - 3) * DAY_MS - kyivWall(now);
}

/** The week's fish, never the same two weeks running. */
export function tourneyFish(week = tourneyWeek()) {
  const list = (w) => (w >= TOURNEY_RULES_FROM ? TOURNEY_FISH : OLD_TOURNEY_FISH);
  const pick = (w) => list(w)[Math.floor(hash2(w, 11, 7717) * list(w).length) % list(w).length];
  const fish = pick(week);
  const own = list(week);
  return fish === pick(week - 1) ? own[(own.indexOf(fish) + 1) % own.length] : fish;
}

/** This week's run at the tournament, started afresh on a new week (last week's count kept for its gift). */
export function tourneyState(progress, week = tourneyWeek()) {
  const state = progress.tourney ?? { week, best: 0, count: 0, claimed: week - 1 };
  if (state.week !== week) {
    state.previous = { week: state.week, count: state.count ?? 0 };
    Object.assign(state, { week, best: 0, count: 0, place: null });
  }
  progress.tourney = state;
  return state;
}

/**
 * A landed fish at game hour `hour`: when it raises the week's score, returns
 * { week, species, weight, format } (weight: the score), otherwise null.
 */
export function recordTourney(progress, fish, hour = 12, now = Date.now()) {
  const week = tourneyWeek(now);
  if (fish.unique || fish.species !== tourneyFish(week)) return null;
  const format = tourneyFormat(week);
  if (format === "night" && !tourneyNight(hour)) return null;
  const state = tourneyState(progress, week);
  state.count = (state.count ?? 0) + 1;
  const score = format === "marathon" ? Math.round((state.best + fish.weight) * 1000) / 1000 : fish.weight;
  if (score <= state.best) return null;
  state.best = score;
  return { week, species: fish.species, weight: score, format };
}

/**
 * Pay out a finished week once its place is known: `place` is null when the
 * angler had no result. Returns what was given ({ place, money, gift }) or
 * null when there was nothing.
 */
export function settleTourney(progress, week, place) {
  const state = tourneyState(progress);
  if ((state.claimed ?? -1) >= week) return null;
  state.claimed = week;
  if (!place) return null;
  const share = TOURNEY_PRIZES[place - 1] ?? 0;
  const money = Math.round(questReward(progress) * share);
  progress.money += money;
  // The gift only for having really taken part: a few of the week's fish. The fish
  // weren't counted before the new rules (and an older save may not count them
  // yet): those weeks are given the benefit of the doubt.
  const counted = week >= TOURNEY_RULES_FROM && state.previous?.week === week;
  const landed = counted ? state.previous.count : TOURNEY_GIFT.minFish;
  const gift = landed >= TOURNEY_GIFT.minFish ? TOURNEY_GIFT : null;
  if (gift) giveGroundbaits(progress, gift.groundbait, groundbaitFor(tourneyFish(week)));
  progress.stats ??= {};
  if (share) {
    progress.stats.podiums = (progress.stats.podiums ?? 0) + 1;
    // A cup for the trophy wall.
    progress.cups = [...(progress.cups ?? []), { week, species: tourneyFish(week), format: tourneyFormat(week), place }];
  }
  if (place === 1) progress.stats.wins = (progress.stats.wins ?? 0) + 1;
  return { place, money, gift };
}

/** The Monday a tournament week starts on, as a date. */
export const tourneyWeekStart = (week) => new Date((week * 7 - 3) * DAY_MS);
