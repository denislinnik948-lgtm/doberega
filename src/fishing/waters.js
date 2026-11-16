import { GROUNDBAITS, LOCATIONS, PASS_MS, access, spotShown } from "./data.js";
import { rankAt } from "./ranks.js";

/*
 * Which waters an angler may fish (see LOCATIONS): the pond is open to
 * everyone, the next three open with a rank, the last four with a membership
 * fee, paid once; `progress.waters` holds the ids paid for. The last one
 * takes a ticket for a day instead, and only with the catfish rod;
 * `progress.passes` holds when each ticket runs out. The same rules hold for
 * every save, old ones too. A tester has every water open, the ones still
 * being tried out too, but buys the ticket like anyone (the rod is waived),
 * to try it; to anyone else those waters stay hidden.
 */

/** Milliseconds left on a water's ticket (0 when there is none or it has run out). */
export const passLeft = (progress, id, now = Date.now()) => Math.max(0, (progress.passes?.[id] ?? 0) - now);

/**
 * What still keeps a water shut: { rank }, { price }, { pass } (a ticket to
 * buy), { pass, rod } (the rod needed first) or { hidden }, or null when it is open.
 */
export function spotLock(progress, index) {
  const spot = LOCATIONS[index];
  if (spot && !spotShown(spot)) return { hidden: true };
  const unlock = spot?.unlock;
  if (unlock?.pass) {
    if (!access.tester && !(progress.rods ?? []).includes(unlock.rod)) return { pass: unlock.pass, rod: unlock.rod };
    return passLeft(progress, spot.id) > 0 ? null : { pass: unlock.pass };
  }
  if (!unlock || access.tester) return null;
  if (unlock.rank !== undefined) return rankAt(progress.xp ?? 0) >= unlock.rank ? null : { rank: unlock.rank };
  return (progress.waters ?? []).includes(spot.id) ? null : { price: unlock.price };
}

export const spotOpen = (progress, index) => !spotLock(progress, index);

/** Pay a water's fee, or buy its ticket for a day: true when it is paid and the water open. */
export function joinWater(progress, index, now = Date.now()) {
  const lock = spotLock(progress, index);
  const cost = lock?.price ?? (lock?.pass && !lock.rod ? lock.pass : 0);
  if (!cost || progress.money < cost) return false;
  progress.money -= cost;
  const id = LOCATIONS[index].id;
  if (lock.pass) progress.passes = { ...(progress.passes ?? {}), [id]: now + PASS_MS };
  else progress.waters = [...(progress.waters ?? []), id];
  return true;
}

/** The waters a rank opens, between the rank before and the rank reached (`from` < rank ≤ `to`). */
export function opensWithRank(from, to) {
  return LOCATIONS.filter((spot) => spotShown(spot) && spot.unlock?.rank > from && spot.unlock.rank <= to);
}

/** The places in LOCATIONS of the waters this angler sees, in order. */
export const shownSpots = () => LOCATIONS.flatMap((spot, index) => (spotShown(spot) ? [index] : []));

/** Standing at a shut water (an older save, or no rank yet): go back to the last open one. */
export function ensureOpenSpot(progress) {
  if (spotOpen(progress, progress.location)) return false;
  let index = progress.location;
  while (index > 0 && !spotOpen(progress, index)) index -= 1;
  progress.location = index;
  return true;
}

/**
 * Give groundbaits as a gift: `kind` for that one, otherwise each of a kind
 * picked at random among those whose fish live in a water this angler may
 * fish (no trout pellets for someone who has only the pond). Returns the
 * bags given, by kind.
 */
export function giveGroundbaits(progress, count, kind = null, random = Math.random) {
  const lives = new Set(LOCATIONS.filter((spot, index) => spotOpen(progress, index)).flatMap((spot) => Object.keys(spot.fish)));
  const giftable = Object.keys(GROUNDBAITS).filter((id) => GROUNDBAITS[id].gift !== false);
  const useful = giftable.filter((id) => GROUNDBAITS[id].favors.some((fish) => lives.has(fish)));
  const kinds = useful.length ? useful : giftable;
  const given = {};
  progress.groundbaits ??= {};
  for (let i = 0; i < count; i += 1) {
    const id = GROUNDBAITS[kind] ? kind : kinds[Math.floor(random() * kinds.length)];
    progress.groundbaits[id] = (progress.groundbaits[id] ?? 0) + 1;
    given[id] = (given[id] ?? 0) + 1;
  }
  return given;
}

/** The groundbait made for a fish (the tournament's prize for its week), or null. */
export const groundbaitFor = (fish) => Object.keys(GROUNDBAITS).find((id) => GROUNDBAITS[id].gift !== false && GROUNDBAITS[id].favors.includes(fish)) ?? null;
