import { BAITS, EXTRAS, LOCATIONS, RODS, START_STATE } from "./data.js";

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
  const state = structuredClone(START_STATE);
  if (saved && typeof saved === "object") {
    if (Number.isFinite(saved.money)) state.money = saved.money;
    if (Number.isFinite(saved.hooks)) state.hooks = saved.hooks;
    if (saved.baits && typeof saved.baits === "object") {
      state.baits = Object.fromEntries(Object.entries(saved.baits).filter(([id, count]) => BAITS[id] && Number.isFinite(count)));
    }
    if (Array.isArray(saved.rods)) state.rods = ["willow", ...saved.rods.filter((id) => RODS[id] && id !== "willow")];
    if (state.rods.includes(saved.rod)) state.rod = saved.rod;
    if (BAITS[saved.bait]) state.bait = saved.bait;
    if (Array.isArray(saved.extras)) state.extras = saved.extras.filter((id) => EXTRAS[id]);
    if (Array.isArray(saved.trophies)) state.trophies = saved.trophies;
    if (Number.isFinite(saved.caught)) state.caught = saved.caught;
    if (LOCATIONS[saved.location]) state.location = saved.location;
  }
  return state;
}

export function saveProgress(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Private windows may block storage; progress then lasts for this visit only.
  }
}

/** How many of a bait the angler has; free bait is unlimited. */
export function baitCount(state, id) {
  return BAITS[id]?.free ? Infinity : state.baits[id] ?? 0;
}
