import { BAITS, EXTRAS, HOOKS, LOCATIONS, RETIRED_BAITS, RODS, START_STATE } from "./data.js";

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
    if (Number.isFinite(saved.groundbait)) state.groundbait = Math.max(0, saved.groundbait);
    if (saved.baited && typeof saved.baited === "object") {
      state.baited = Object.fromEntries(Object.entries(saved.baited).filter(([id, hours]) => LOCATIONS.some((spot) => spot.id === id) && Number.isFinite(hours) && hours > 0));
    }
    // Every trophy needs a stable id so it is published to the cloud only once.
    if (Array.isArray(saved.trophies)) state.trophies = saved.trophies.map((trophy) => ({ ...trophy, id: trophy.id ?? `${trophy.date}-${trophy.species}-${trophy.weight}` }));
    if (Number.isFinite(saved.caught)) state.caught = saved.caught;
    if (LOCATIONS[saved.location]) state.location = saved.location;
    if (Number.isFinite(saved.savedAt)) state.savedAt = saved.savedAt;
  }
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

/** Whether a save holds anything beyond the starting kit. */
export function hasProgress(state) {
  return (state.caught ?? 0) > 0 || (state.trophies?.length ?? 0) > 0 || (state.rods?.length ?? 1) > 1
    || (state.extras?.length ?? 0) > 0 || state.money !== START_STATE.money;
}

/** How many of a bait the angler has; free bait is unlimited. */
export function baitCount(state, id) {
  return BAITS[id]?.free ? Infinity : state.baits[id] ?? 0;
}
