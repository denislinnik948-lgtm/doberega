import { BOOT_CHANCE, LOCATIONS, RODS, biteActivity, rollFish } from "./data.js";

/**
 * Fishing state machine. Positions are normalized to the viewport (0..1) so the
 * game survives resizes; the renderer converts them to pixels.
 *
 * ready → casting → waiting → nibble → bite → fight → landed
 * Pulling while waiting just reels in (bait kept). Pulling during a nibble
 * twitch, or not pulling once the float has sunk, loses the fish and the bait.
 * A pull during a brief dip in the nibble has a chance to hook.
 *
 * Fight: while pulling, the tension bar fills at rate X and the fish comes in;
 * while released it drains at 1.5X and the fish swims off at a random pace.
 * A small fish comes in within one full bar; bigger ones need several pulls.
 */

export const TUNING = {
  castDuration: 0.75,
  // Average time to strike once the float goes under; each bite varies around it.
  biteWindow: 1.35,
  dipHookChance: 0.5,
  // X: one full bar takes 1 / fillRate seconds of pulling.
  fillRate: 0.42,
  drainRatio: 1.5,
  // Cast landing band (normalized y): far edge of the water and the nearest spot.
  farY: 0.52,
  nearY: 0.9,
};

/** Rates for a fish of `weight` kg on a rod; exported for balance tests. */
export function fightRates(weight, rodId, extras = [], junk = false) {
  const rod = RODS[rodId];
  const strain = weight / rod.maxKg;
  // Past the rod's rated weight the bar fills much faster.
  const overload = Math.max(0, strain - 1);
  const fill = TUNING.fillRate * (1 + 2.5 * overload) * (extras.includes("braid") ? 0.85 : 1);
  // How many full bars of pulling it takes to bring the fish in.
  const pulls = Math.max(1, 5.2 * strain ** 1.3) / rod.reel;
  return {
    strain,
    pulls,
    fill,
    drain: fill * TUNING.drainRatio,
    reel: (fill * 1.04) / pulls,
    escape: (0.5 * fill) / pulls,
    // Bigger fish jerk the line, spiking the bar.
    // Junk is dead weight: no jerks, never swims off.
    jerkRate: !junk && strain > 0.25 ? 0.7 * Math.min(1.6, strain) : 0,
    still: junk,
    net: extras.includes("net"),
  };
}

/** How fast the fish swims off while the line is slack: still, slow, steady or bolting. */
function pickBehavior(strain, random) {
  const roll = random();
  const bolt = 0.12 + 0.3 * Math.min(1, strain);
  if (roll < bolt) return 1.7 + random() * 0.4;
  if (roll < bolt + 0.3) return 0.8 + random() * 0.4;
  if (roll < bolt + 0.58) return 0.2 + random() * 0.3;
  return 0;
}

export class FishingGame {
  constructor({ random = Math.random, onEvent = () => {} } = {}) {
    this.random = random;
    this.emit = onEvent;
    // Hour of the in-game day (0..24) and how much the weather livens the bite,
    // both kept current by the host.
    this.hour = 18;
    this.biteBoost = 1;
    this.reset();
  }

  reset() {
    this.phase = "ready";
    this.clock = 0;
    this.pulling = false;
    this.target = null;
    this.fish = null;
    this.snag = false;
    this.tension = 0;
    this.distance = 1;
    this.float = { offset: 0, sink: 0 };
    this.timeline = [];
  }

  get busy() {
    return this.phase !== "ready";
  }

  /** Cast toward a normalized water point with the chosen rod, bait, spot and extras. */
  cast(target, rodId, baitId, { location = 0, extras = [] } = {}) {
    if (this.phase !== "ready") return false;
    this.rod = rodId;
    this.bait = baitId;
    this.location = location;
    this.extras = extras;
    this.target = target;
    this.enter("casting");
    return true;
  }

  press() {
    if (this.pulling) return;
    this.pulling = true;

    switch (this.phase) {
      case "waiting": {
        // Reeling in an empty line: usually just a recast, rarely a snag or a boot.
        const roll = this.random();
        const snagChance = LOCATIONS[this.location]?.snagChance ?? 0.02;
        if (roll < snagChance) this.startSnag();
        else if (roll < snagChance + BOOT_CHANCE) {
          this.fish = { species: "boot", weight: Math.round((0.6 + this.random() * 0.8) * 1000) / 1000, junk: true };
          this.hook();
        } else this.reset();
        break;
      }
      case "nibble": {
        const dipping = this.float.sink > 0.5;
        if (dipping && this.random() < TUNING.dipHookChance) this.hook();
        else this.escape(dipping ? "missed" : "early");
        break;
      }
      case "bite":
        this.hook();
        break;
      default:
        break;
    }
  }

  release() {
    if (!this.pulling) return;
    this.pulling = false;
    if (this.phase === "fight") this.behavior = pickBehavior(this.rates.strain, this.random);
  }

  enter(phase) {
    this.phase = phase;
    this.clock = 0;
  }

  /** Hooked a submerged snag: it won't come in, and pulling hard snaps the line. */
  startSnag() {
    this.snag = true;
    this.fish = null;
    this.rates = { strain: 1, fill: TUNING.fillRate * 1.7, drain: TUNING.fillRate * TUNING.drainRatio, reel: 0, escape: 0, jerkRate: 0 };
    this.tension = 0;
    this.distance = 1;
    this.slack = 0;
    this.float.sink = 1;
    this.enter("fight");
  }

  hook() {
    this.rates = fightRates(this.fish.weight, this.rod, this.extras, Boolean(this.fish.junk));
    this.tension = 0;
    this.distance = 1;
    this.behavior = 0;
    this.behaviorClock = 0;
    this.splashClock = 0;
    this.float.sink = 1;
    this.enter("fight");
    this.emit("hooked", { fish: this.fish });
    this.ripple(this.target, 0.9, 0.6);
  }

  escape(reason, hookLost = false, headline = null) {
    const at = this.phase === "fight" ? this.fishPosition() : this.target;
    this.ripple(at, 0.5, 0.4);
    this.emit("outcome", { type: "escape", reason, bait: this.bait, hookLost, headline });
    this.reset();
  }

  /** A duck paddled over the float and ate the bait (the hook is left). */
  duckSteal() {
    if (!["waiting", "nibble", "bite"].includes(this.phase)) return false;
    this.escape("duck", false, "duck");
    return true;
  }

  ripple(point, strength, size) {
    if (point) this.emit("ripple", { x: point.x, y: point.y, strength, size });
  }

  /** Where the hooked fish is: it moves from the cast point toward the angler. */
  fishPosition() {
    const landing = { x: 0.5, y: 0.98 };
    const t = 1 - this.distance;
    return {
      x: this.target.x + (landing.x - this.target.x) * t,
      y: this.target.y + (landing.y - this.target.y) * t,
    };
  }

  /** How far out the cast landed: 0 by the shore, 1 at the far edge. */
  reach() {
    const y = this.target?.y ?? TUNING.nearY;
    return Math.min(1, Math.max(0, (TUNING.nearY - y) / (TUNING.nearY - TUNING.farY)));
  }

  /** Seconds until the next bite: shorter when the local fish are feeding. */
  nextWait() {
    const hunger = biteActivity(this.bait, this.location, this.hour);
    const spotPace = LOCATIONS[this.location]?.pace ?? 1;
    const pace = Math.min(2.2, Math.max(0.3, hunger * 1.2 * spotPace * this.biteBoost));
    // Mostly a short wait, sometimes a quick one, now and then a long lull.
    const lull = this.random() < 0.1 ? 6 + this.random() * 12 : 0;
    const wait = 2.5 + 11 * this.random() ** 1.6 + lull;
    return (wait / pace) * (this.extras.includes("sonar") ? 0.55 : 1);
  }

  /**
   * Build the twitches and dips that lead up to a bite. Each fish has a
   * temper: a greedy one grabs at once, a nibbler plays a little, a wary one
   * fiddles for a long time, a teaser goes quiet before coming back. Gaps,
   * twitch strength and dip depth all vary from step to step.
   */
  planNibble() {
    const random = this.random;
    const roll = random();
    const temper = roll < 0.18 ? "greedy" : roll < 0.62 ? "nibbler" : roll < 0.87 ? "wary" : "teaser";
    const range = (from, to) => from + random() * (to - from);
    const count = { greedy: [0, 1], nibbler: [2, 6], wary: [4, 9], teaser: [3, 7] }[temper];
    const twitches = count[0] + Math.floor(random() * (count[1] - count[0] + 1));
    // Gaps skew short with the odd longer hesitation.
    const gap = () => (temper === "wary" ? 0.3 + 1.9 * random() ** 1.5 : 0.25 + 1.3 * random() ** 1.8);
    const dips = new Set();
    if (twitches && random() < 0.5) dips.add(Math.floor(random() * twitches));
    if (twitches > 3 && random() < 0.25) dips.add(Math.floor(random() * twitches));
    const pauseAt = temper === "teaser" ? 1 + Math.floor(random() * Math.max(1, twitches - 2)) : -1;

    const steps = [];
    let at = range(0.15, 0.6);
    for (let i = 0; i < twitches; i += 1) {
      if (i === pauseAt) at += range(2.5, 6);
      steps.push({ at, kind: dips.has(i) ? "dip" : "twitch", strength: range(0.45, 1.4) });
      at += gap();
    }
    if (temper === "greedy") at = Math.min(at, range(0.2, 0.9));
    steps.push({ at, kind: "bite" });
    return steps;
  }

  update(dt) {
    this.clock += dt;
    const random = this.random;

    switch (this.phase) {
      case "casting":
        if (this.clock >= TUNING.castDuration) {
          this.ripple(this.target, 0.65, 0.42);
          this.waitTime = this.nextWait();
          this.enter("waiting");
        }
        break;

      case "waiting":
        if (this.clock >= this.waitTime) {
          this.fish = rollFish(this.bait, this.location, random, this.reach(), this.hour);
          if (!this.fish) {
            // Wrong bait for this water: the float just sits there.
            this.clock = 0;
            this.waitTime = this.nextWait();
            break;
          }
          this.timeline = this.planNibble();
          this.biteWindow = TUNING.biteWindow * (0.6 + this.random() * 0.8);
          this.enter("nibble");
        }
        break;

      case "nibble": {
        this.float.offset = 0;
        this.float.sink = 0;
        for (const step of this.timeline) {
          const age = this.clock - step.at;
          if (step.kind === "bite" && age >= 0) {
            this.float.sink = 1;
            this.ripple(this.target, 0.55, 0.35);
            this.enter("bite");
            return;
          }
          if (age < 0 || age > 0.45) continue;
          if (!step.rippled) {
            step.rippled = true;
            this.ripple(this.target, step.kind === "dip" ? 0.4 : 0.22, 0.2);
          }
          const strength = step.strength ?? 1;
          if (step.kind === "twitch") this.float.offset = age < 0.25 ? Math.sin((age / 0.25) * Math.PI) * 3 * strength : 0;
          else this.float.sink = age < 0.4 ? Math.min(1, Math.sin((age / 0.4) * Math.PI) * 1.6 * Math.max(0.7, strength)) : 0;
        }
        break;
      }

      case "bite":
        this.float.sink = 1;
        if (this.clock >= (this.biteWindow ?? TUNING.biteWindow)) this.escape("late");
        break;

      case "fight":
        this.updateFight(dt);
        break;

      default:
        break;
    }
  }

  updateFight(dt) {
    const { rates, random } = this;

    if (this.snag) {
      if (this.pulling) {
        this.tension += rates.fill * dt;
        this.slack = 0;
      } else {
        this.tension = Math.max(0, this.tension - rates.drain * dt);
        // Left slack long enough, the hook may work itself free.
        this.slack += dt;
        if (this.slack > 0.8 && random() < 0.4 * dt) {
          this.escape("unsnagged", false, "unsnagged");
          return;
        }
      }
      if (this.tension >= 1) this.escape("snagSnap", true, "snagSnap");
      return;
    }

    // The landing net calms the fish in the last stretch to the bank.
    const calm = rates.net && this.distance < 0.25 ? 0.6 : 1;
    if (this.pulling) {
      this.tension += rates.fill * calm * dt;
      this.distance -= rates.reel * dt;
      if (random() < rates.jerkRate * dt) this.tension += 0.04 + random() * 0.1 * Math.min(1.5, rates.strain);
    } else {
      this.tension = Math.max(0, this.tension - rates.drain * dt);
      if (!rates.still) this.distance = Math.min(1, this.distance + rates.escape * this.behavior * calm * dt);
      // The fish may change pace mid-run: stop, slow down or bolt.
      this.behaviorClock += dt;
      if (this.behaviorClock > 0.8) {
        this.behaviorClock = 0;
        if (random() < 0.35) this.behavior = pickBehavior(rates.strain, random);
      }
    }

    this.splashClock -= dt;
    if (this.splashClock <= 0) {
      this.splashClock = 0.45 + random() * 0.5;
      this.ripple(this.fishPosition(), this.pulling ? 0.55 : 0.3 + this.behavior * 0.15, 0.28 + Math.min(0.4, rates.strain * 0.3));
    }

    if (this.tension >= 1) {
      // A big fish snapping the line takes the hook with it.
      this.escape(rates.strain > 1 ? "overweight" : "snap", Boolean(this.fish.big) || rates.strain > 0.8);
    } else if (this.distance <= 0) {
      const fish = this.fish;
      this.emit("outcome", { type: "landed", fish, bait: this.bait });
      this.reset();
      this.phase = "landed";
    }
  }
}
