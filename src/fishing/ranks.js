import { FISH } from "./data.js";
import { questReward } from "./quests.js";
import { giveGroundbaits } from "./waters.js";

/*
 * Angler ranks: experience comes from every fish landed (the heavier and
 * dearer, the more, rising gently: the square root of its market worth),
 * and from the extras around the fishing: a new species for the atlas, the
 * daily quest, a day of the run, a place in the tournament. Junk gives
 * nothing. Ten ranks, the first ones quick, the last well past the whole
 * rod ladder. A rank shows by the angler's name for others to see, and each
 * new one brings a gift.
 *
 * `progress.xp` is the experience so far, `progress.rank` the highest rank
 * whose gift has been given.
 */

export const XP = { newSpecies: 25, quest: 20, day: 10, podium: [150, 100, 50] };

/** Experience for a landed fish. */
export function fishXp(fish) {
  const kind = FISH[fish.species];
  if (!kind || kind.junk) return 0;
  if (kind.legend) return 300;
  if (kind.unique) return 100;
  if (kind.protected) return 15;
  return Math.max(1, Math.round(Math.sqrt(fish.weight ** 0.88 * kind.pricePerKg)));
}

/*
 * Experience needed for each rank, and its gift (money as a share of the
 * quest reward, so it keeps up with the angler, and groundbait). Measured
 * with the balance simulator (tools/balance/sim.mjs prints experience per
 * hour): about 25 minutes, 1.5, 4, 7, 12, 20, 35, 55 and 80 hours of good
 * fishing; most anglers take longer. The third, fourth and fifth also open
 * a water (see waters.js).
 */
export const RANKS = [
  { id: "novice", xp: 0 },
  { id: "pupil", xp: 100, gift: { money: 0.5 } },
  { id: "amateur", xp: 400, gift: { money: 1 } },
  { id: "angler", xp: 1300, gift: { money: 1, groundbait: 1 } },
  { id: "seasoned", xp: 3000, gift: { money: 1.5, groundbait: 2 } },
  { id: "expert", xp: 7000, gift: { money: 2, groundbait: 2 } },
  { id: "master", xp: 14000, gift: { money: 2.5, groundbait: 3 } },
  { id: "oldHand", xp: 30000, gift: { money: 3, groundbait: 3 } },
  { id: "veteran", xp: 50000, gift: { money: 4, groundbait: 4 } },
  { id: "legend", xp: 80000, gift: { money: 5, groundbait: 5 } },
];

/** The rank (index into RANKS) for an amount of experience. */
export function rankAt(xp) {
  let rank = 0;
  while (rank + 1 < RANKS.length && xp >= RANKS[rank + 1].xp) rank += 1;
  return rank;
}

export function gainXp(progress, amount) {
  progress.xp = (progress.xp ?? 0) + amount;
}

/** Whether a rank has been reached whose gift is still to come. */
export const rankPending = (progress) => rankAt(progress.xp ?? 0) > (progress.rank ?? 0);

/**
 * Give the gifts of every rank reached since the last one given (several at
 * once for an older save). Returns { rank, from (the rank before), money, groundbait } or null.
 */
export function claimRanks(progress) {
  const reached = rankAt(progress.xp ?? 0);
  const given = progress.rank ?? 0;
  if (reached <= given) return null;
  let money = 0;
  let groundbait = 0;
  for (let rank = given + 1; rank <= reached; rank += 1) {
    money += Math.round(questReward(progress) * RANKS[rank].gift.money);
    groundbait += RANKS[rank].gift.groundbait ?? 0;
  }
  progress.money += money;
  progress.rank = reached;
  giveGroundbaits(progress, groundbait);
  return { rank: reached, from: given, money, groundbait };
}

/**
 * Experience for a save from before ranks, from what its stats remember:
 * each fish counted at a typical weight (well under the heaviest caught),
 * each species, the one-of-a-kind trophies and the quests done.
 */
export function pastXp(progress) {
  const stats = progress.stats ?? {};
  let xp = 0;
  for (const [id, count] of Object.entries(stats.bySpecies ?? {})) {
    if (!FISH[id]) continue;
    xp += count * fishXp({ species: id, weight: Math.max(FISH[id].min, (stats.heaviest?.[id] ?? 0) * 0.45) }) + XP.newSpecies;
  }
  for (const trophy of progress.trophies ?? []) if (FISH[trophy.species]?.unique) xp += fishXp(trophy);
  xp += (stats.quests ?? 0) * XP.quest;
  return Math.max(xp, (progress.caught ?? 0) * 2);
}
