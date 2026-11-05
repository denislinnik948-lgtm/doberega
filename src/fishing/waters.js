import { LOCATIONS, access, spotShown } from "./data.js";
import { rankAt } from "./ranks.js";

/*
 * Which waters an angler may fish (see LOCATIONS): the pond is open to
 * everyone, the next three open with a rank, the last four with a membership
 * fee, paid once; `progress.waters` holds the ids paid for. The same rules
 * hold for every save, old ones too. A tester has every water open, the ones
 * still being tried out too; to anyone else those stay hidden.
 */

/** What still keeps a water shut: { rank }, { price } or { hidden }, or null when it is open. */
export function spotLock(progress, index) {
  const spot = LOCATIONS[index];
  if (spot && !spotShown(spot)) return { hidden: true };
  const unlock = spot?.unlock;
  if (!unlock || access.tester) return null;
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
