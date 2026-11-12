import { ACHIEVEMENTS } from "./achievements.js";
import { RANKS, pastXp } from "./ranks.js";
import { ensureOpenSpot, giveGroundbaits } from "./waters.js";
import { AVATAR_COUNT, BAITS, SPECIAL_AVATAR, EXTRAS, FISH, GROUNDBAITS, HOOKS, LOCATIONS, OLD_GROUNDBAITS, RETIRED_BAITS, RODS, START_STATE, gameHoursMs } from "./data.js";

// The storage key keeps the game's old working name so existing saves carry over.
const KEY = "stillwater.fishing.v2";

/** Angler progress (money, gear, trophies), kept in this browser's localStorage. */
export function loadProgress() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    saved = null;
  }
  return normalizeProgress(saved);
}

/** Turn saved data (from this browser or the cloud) into a valid progress object. */
export function normalizeProgress(saved) {
  const state = structuredClone(START_STATE);
  if (saved && typeof saved === "object") {
    if (Number.isFinite(saved.money)) state.money = saved.money;
    // Hooks by size; an older save kept one count, which were all medium hooks.
    if (Number.isFinite(saved.hooks)) state.hooks = { ...state.hooks, medium: saved.hooks };
    else if (saved.hooks && typeof saved.hooks === "object") {
      for (const id of Object.keys(HOOKS)) state.hooks[id] = Number.isFinite(saved.hooks[id]) ? Math.max(0, saved.hooks[id]) : 0;
    }
    if (HOOKS[saved.hook]) state.hook = saved.hook;
    // The line on the reel and the spares (older saves start with a new line).
    if (Number.isFinite(saved.line)) state.line = Math.max(0, Math.min(1, saved.line));
    if (Number.isFinite(saved.lines)) state.lines = Math.max(0, Math.floor(saved.lines));
    if (saved.baits && typeof saved.baits === "object") {
      state.baits = Object.fromEntries(Object.entries(saved.baits).filter(([id, count]) => BAITS[id] && Number.isFinite(count)));
      // Baits taken out of the game are paid back in full.
      for (const [id, price] of Object.entries(RETIRED_BAITS)) {
        if (Number.isFinite(saved.baits[id]) && saved.baits[id] > 0) state.money += saved.baits[id] * price;
      }
    }
    if (Array.isArray(saved.rods)) state.rods = ["willow", ...saved.rods.filter((id) => RODS[id] && id !== "willow")];
    if (state.rods.includes(saved.rod)) state.rod = saved.rod;
    if (BAITS[saved.bait]) state.bait = saved.bait;
    if (Array.isArray(saved.extras)) state.extras = saved.extras.filter((id) => EXTRAS[id]);
    // The campfire was sold for a day and taken off sale: its price goes back.
    if (Array.isArray(saved.extras) && saved.extras.includes("campfire")) state.money += 600;
    if (saved.groundbaits && typeof saved.groundbaits === "object") {
      // The older kinds (carp, bream, trout, predator) became the basic and the predator one.
      state.groundbaits = {};
      for (const [old, count] of Object.entries(saved.groundbaits)) {
        const id = GROUNDBAITS[old] ? old : OLD_GROUNDBAITS[old];
        if (id && Number.isFinite(count) && count > 0) state.groundbaits[id] = (state.groundbaits[id] ?? 0) + count;
      }
    }
    // Each baited water: the moment its groundbait wears off. Older saves kept
    // game hours left instead (a small number): those start counting from now.
    if (saved.baited && typeof saved.baited === "object") {
      const now = Date.now();
      state.baited = Object.fromEntries(Object.entries(saved.baited)
        .filter(([id, value]) => LOCATIONS.some((spot) => spot.id === id) && Number.isFinite(value) && value > 0)
        .map(([id, value]) => [id, value < 1e9 ? now + gameHoursMs(value) : value])
        .filter(([, until]) => until > now));
      if (saved.baitedKind && typeof saved.baitedKind === "object") {
        state.baitedKind = Object.fromEntries(Object.entries(saved.baitedKind)
          .map(([id, kind]) => [id, GROUNDBAITS[kind] ? kind : OLD_GROUNDBAITS[kind]])
          .filter(([id, kind]) => state.baited[id] && kind));
      }
    }
    // Every trophy needs a stable id so it is published to the cloud only once.
    if (Array.isArray(saved.trophies)) state.trophies = saved.trophies.map((trophy) => ({ ...trophy, id: trophy.id ?? `${trophy.date}-${trophy.species}-${trophy.weight}` }));
    if (Number.isFinite(saved.caught)) state.caught = saved.caught;
    if (saved.released && typeof saved.released === "object") {
      state.released = Object.fromEntries(Object.entries(saved.released).filter(([id, count]) => FISH[id]?.protected && Number.isFinite(count) && count > 0));
    }
    // The keepnet: ordinary fish only (one-of-a-kind ones go straight to the trophies).
    if (Array.isArray(saved.keepnet)) {
      state.keepnet = saved.keepnet.filter((fish) => fish && FISH[fish.species] && !FISH[fish.species].unique && !FISH[fish.species].junk && Number.isFinite(fish.weight) && fish.weight > 0);
    }
    // Counters behind the achievements, and when each achievement was earned.
    if (saved.stats && typeof saved.stats === "object") state.stats = structuredClone(saved.stats);
    if (saved.achievements && typeof saved.achievements === "object") {
      state.achievements = Object.fromEntries(Object.entries(saved.achievements).filter(([id, date]) => ACHIEVEMENTS.some((item) => item.id === id) && typeof date === "string"));
    }
    if (LOCATIONS[saved.location]) state.location = saved.location;
    if (Array.isArray(saved.waters)) state.waters = [...new Set(saved.waters.filter((id) => LOCATIONS.some((spot) => spot.id === id && spot.unlock?.price)))];
    // Today's run at the daily quest (see quests.js); another day's is simply started afresh.
    if (saved.quest && Number.isFinite(saved.quest.day) && Number.isFinite(saved.quest.value)) {
      state.quest = {
        day: saved.quest.day,
        value: Math.max(0, saved.quest.value),
        kinds: Array.isArray(saved.quest.kinds) ? saved.quest.kinds.filter((id) => FISH[id]) : [],
        done: typeof saved.quest.done === "string" ? saved.quest.done : null,
      };
    }
    // Days in a row with a catch (see quests.js).
    if (saved.streak && Number.isFinite(saved.streak.day) && Number.isFinite(saved.streak.count)) {
      state.streak = { day: saved.streak.day, count: Math.max(0, saved.streak.count), best: Math.max(saved.streak.count, Number(saved.streak.best) || 0) };
    }
    // The weekly tournament (see quests.js): this week's best and the last week settled.
    if (saved.tourney && Number.isFinite(saved.tourney.week)) {
      const tourney = saved.tourney;
      state.tourney = {
        week: tourney.week,
        best: Math.max(0, Number(tourney.best) || 0),
        count: Math.max(0, Math.floor(Number(tourney.count) || 0)),
        place: Number.isFinite(tourney.place) ? tourney.place : null,
        claimed: Number.isFinite(tourney.claimed) ? tourney.claimed : tourney.week - 1,
      };
      if (tourney.previous && Number.isFinite(tourney.previous.week)) state.tourney.previous = { week: tourney.previous.week, count: Math.max(0, Math.floor(Number(tourney.previous.count) || 0)) };
    }
    // Tournament cups (see settleTourney).
    if (Array.isArray(saved.cups)) {
      state.cups = saved.cups.filter((cup) => cup && Number.isFinite(cup.week) && FISH[cup.species] && [1, 2, 3].includes(cup.place))
        .map(({ week, species, format, place }) => ({ week, species, format: ["heaviest", "marathon", "night"].includes(format) ? format : "heaviest", place }));
    }
    // Experience and the last rank whose gift was given (see ranks.js); a save
    // from before ranks gets its experience worked out from its stats.
    state.xp = Number.isFinite(saved.xp) ? Math.max(0, saved.xp) : pastXp(state);
    if (Number.isFinite(saved.rank)) state.rank = Math.max(0, Math.min(RANKS.length - 1, Math.floor(saved.rank)));
    // The picture: one of the twelve, or the author's own (99, kept to the admins by the server).
    if (Number.isInteger(saved.avatar) && ((saved.avatar >= 0 && saved.avatar < AVATAR_COUNT) || saved.avatar === SPECIAL_AVATAR)) state.avatar = saved.avatar;
    if (saved.authorAvatar === true) state.authorAvatar = true;
    if (Number.isFinite(saved.savedAt)) state.savedAt = saved.savedAt;
  }
  // A water now shut to this angler (its rank not reached, its fee not paid): back to an open one.
  ensureOpenSpot(state);
  // The plain groundbait is sold no more: bags still kept become ones made for a kind of fish, one for one.
  if (Number.isFinite(saved?.groundbait) && saved.groundbait > 0) giveGroundbaits(state, Math.floor(saved.groundbait));
  return state;
}

const listeners = new Set();

/** Be told whenever progress is saved (the cloud sync uses this). */
export function onProgressSaved(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Save to this browser; `quiet` skips the listeners (used when the save came from the cloud). */
export function saveProgress(state, { quiet = false } = {}) {
  if (!quiet) state.savedAt = Date.now();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private windows may block storage; progress then lasts for this visit only.
  }
  if (!quiet) for (const listener of listeners) listener(state);
}

/** Swap the live progress object's contents for another save, keeping the same object. */
export function replaceProgress(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, structuredClone(normalizeProgress(source)));
}

/**
 * Two saves that both moved on (two devices, or the game left open on one
 * while played on the other): `kept` wins, but what was bought only in `other`
 * (rods, extras, water fees) is not lost; it comes over at its price, so it
 * is paid for once. Null when `other` has nothing `kept` lacks.
 */
export function mergePurchases(kept, other) {
  const rods = (other.rods ?? []).filter((id) => RODS[id] && !kept.rods.includes(id));
  const extras = (other.extras ?? []).filter((id) => EXTRAS[id] && !kept.extras.includes(id));
  const waters = (other.waters ?? []).filter((id) => !(kept.waters ?? []).includes(id));
  if (!rods.length && !extras.length && !waters.length) return null;
  const fee = (id) => LOCATIONS.find((spot) => spot.id === id)?.unlock?.price ?? 0;
  const cost = rods.reduce((sum, id) => sum + RODS[id].price, 0) + extras.reduce((sum, id) => sum + EXTRAS[id].price, 0) + waters.reduce((sum, id) => sum + fee(id), 0);
  return {
    ...structuredClone(kept),
    rods: [...kept.rods, ...rods],
    extras: [...kept.extras, ...extras],
    waters: [...(kept.waters ?? []), ...waters],
    money: Math.max(0, kept.money - cost),
    savedAt: Date.now(),
  };
}

/** Whether a save holds anything beyond the starting kit. */
export function hasProgress(state) {
  return (state.caught ?? 0) > 0 || (state.trophies?.length ?? 0) > 0 || (state.keepnet?.length ?? 0) > 0 || (state.rods?.length ?? 1) > 1
    || (state.extras?.length ?? 0) > 0 || state.money !== START_STATE.money;
}

/** How many of a bait the angler has; free bait is unlimited. */
export function baitCount(state, id) {
  return BAITS[id]?.free ? Infinity : state.baits[id] ?? 0;
}
