import { LOCATIONS } from "./data.js";
import { rankAt } from "./ranks.js";

/*
 * Which waters an angler may fish (see LOCATIONS): the pond is open to
 * everyone, the next three open with a rank, the last four with a membership
 * fee, paid once; `progress.waters` holds the ids paid for. The same rules
 * hold for every save, old ones too.
 */

/** What still keeps a water shut: { rank } or { price }, or null when it is open. */
export function spotLock(progress, index) {
  const spot = LOCATIONS[index];
  const unlock = spot?.unlock;
  if (!unlock) return null;
  if (unlock.rank !== undefined) return rankAt(progress.xp ?? 0) >= unlock.rank ? null : { rank: unlock.rank };
  return (progress.waters ?? []).includes(spot.id) ? null : { price: unlock.price };
}

export const spotOpen = (progress, index) => !spotLock(progress, index);

/** Pay a water's fee: true when it is paid and the water open. */
export function joinWater(progress, index) {
  const lock = spotLock(progress, index);
  if (!lock?.price || progress.money < lock.price) return false;
  progress.money -= lock.price;
  progress.waters = [...(progress.waters ?? []), LOCATIONS[index].id];
  return true;
}

/** The waters a rank opens, between the rank before and the rank reached (`from` < rank ≤ `to`). */
export function opensWithRank(from, to) {
  return LOCATIONS.filter((spot) => spot.unlock?.rank > from && spot.unlock.rank <= to);
}

/** Standing at a shut water (an older save, or no rank yet): go back to the last open one. */
export function ensureOpenSpot(progress) {
  if (spotOpen(progress, progress.location)) return false;
  let index = progress.location;
  while (index > 0 && !spotOpen(progress, index)) index -= 1;
  progress.location = index;
  return true;
}
