import { BAITS, BOOT_CHANCE, GROUNDBAIT, HOOKS, LOCATIONS, NIBBLE, RODS, biteActivity, rollFish, straightenChance } from "./data.js";

/**
 * Fishing state machine. Positions are normalized to the viewport (0..1) so the
 * game survives resizes; the renderer converts them to pixels.
 *
 * ready → casting → waiting → nibble → bite → fight → landed
 * With the spoon: ready → casting → retrieving → bite → fight → landed
 * Pulling while waiting just reels in (bait kept). Pulling during a nibble
 * twitch, or not pulling once the float has sunk, loses the fish and the bait.
 * A pull during a brief dip in the nibble has a chance to hook.
 *
 * Fight: while pulling, the tension bar fills at rate X and the fish comes in;
 * while released it drains at 1.5X and the fish swims off at a random pace.
 * A small fish comes in within one full bar; bigger ones need several pulls.
 *
 * Spinning: after the cast, holding reels the spoon in toward the bank. A
 * fish may strike while it moves: most often just after a jerk (a short pull)
 * or as it flutters down in the pause after one, far less on a steady
 * retrieve. A strike is a bite like on the float: pull within the window. If
 * the spoon reaches the bank untouched, it's simply cast again.
 *
 * Tackle: the rod decides how hard a fish is to bring in (how fast the bar
 * fills); the hook (or, spinning, the lure) decides who can take it at all
 * and whether it holds: past its hold weight it may bend straight in the
 * fight. See HOOKS and the lures in data.js.
 *
 * Reeling in an empty line (to recast, or after a fish got away with the
 * bait) isn't instant: the float or spoon skims back across the water to the
 * bank, then the rod lifts it out (the "reeling" phase), and only then can
 * you cast again.
 */

export const TUNING = {
  // A short cast close in is swung underhand; a long one goes overhead. Both unhurried.
  castUnder: 1.4,
  castOver: 1.9,
  overheadReach: 0.45,
  // Reeling an empty line back in: seconds from mid-water (longer from far out),
  // the share of it spent skimming the water before the rod lifts it out.
  reelIn: 1.5,
  reelSkim: 0.72,
  // Average time to strike once the float goes under; each bite varies around it.
  biteWindow: 1.35,
  dipHookChance: 0.5,
  // X: one full bar takes 1 / fillRate seconds of pulling.
  fillRate: 0.42,
  drainRatio: 1.5,
  // Cast landing band (normalized y): far edge of the water and the nearest spot.
  farY: 0.52,
  nearY: 0.9,
  // Spinning: how much of the way in one second of reeling covers, and how
  // likely a strike is per second while jerking, fluttering down after a jerk
  // or reeling steadily (times how keen the fish are).
  retrieveSpeed: 0.24,
  jerkWindow: 0.45,
  flutterWindow: 0.6,
  strikeJerk: 0.15,
  strikeFlutter: 0.06,
  strikeSteady: 0.04,
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
    // Set by the host: the current at a float position, and whether a point is
    // open water the float can drift onto.
    this.currentAt = () => ({ x: 0, y: 0 });
    this.isWater = () => true;
    // Where a hooked fish is brought in: the middle of what's on screen.
    this.landingX = 0.5;
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
    // How far in the fish gets before a too-small hook bends straight (null: it holds).
    this.giveAt = null;
  }

  get busy() {
    return this.phase !== "ready";
  }

  /**
   * Cast toward a normalized water point with the chosen rod, bait, spot and
   * extras; `groundbait` is whether this water is baited.
   */
  cast(target, rodId, baitId, { location = 0, extras = [], groundbait = false, hook = "medium" } = {}) {
    if (this.phase !== "ready") return false;
    this.rod = rodId;
    this.bait = baitId;
    this.hookSize = hook;
    this.location = location;
    this.extras = extras;
    this.groundbait = groundbait;
    this.target = { ...target };
    this.castStyle = this.reach() > TUNING.overheadReach ? "over" : "under";
    this.castDuration = this.castStyle === "over" ? TUNING.castOver : TUNING.castUnder;
    this.enter("casting");
    this.emit("cast", { style: this.castStyle });
    return true;
  }

  /** Whether the bait on the line is a lure that is reeled in (the spoon). */
  get spinning() {
    return Boolean(BAITS[this.bait]?.lure);
  }

  /** What the fish has to take: the lure when spinning, otherwise the hook. */
  get gear() {
    return this.spinning ? BAITS[this.bait] : HOOKS[this.hookSize] ?? HOOKS.medium;
  }

  press() {
    if (this.pulling) return;
    this.pulling = true;

    switch (this.phase) {
      case "retrieving":
        // Each press is a jerk of the spoon.
        this.jerkAge = 0;
        break;
      case "waiting": {
        // Reeling in an empty line: usually just a recast, rarely a snag or a boot.
        const roll = this.random();
        const snagChance = LOCATIONS[this.location]?.snagChance ?? 0.02;
        if (roll < snagChance) this.startSnag();
        else if (roll < snagChance + BOOT_CHANCE) {
          this.fish = { species: "boot", weight: Math.round((0.6 + this.random() * 0.8) * 1000) / 1000, junk: true };
          this.hook();
        } else this.startReelIn();
        break;
      }
      case "nibble": {
        const dipping = this.float.sink > 0.5;
        if (dipping && this.random() < TUNING.dipHookChance) this.hook(true);
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
    // Let go after a jerk and the spoon flutters down.
    if (this.phase === "retrieving") this.pauseAge = 0;
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
    this.emit("snag");
  }

  /** `onDip`: struck during a dip in the nibble (counted for an achievement). */
  hook(onDip = false) {
    this.rates = fightRates(this.fish.weight, this.rod, this.extras, Boolean(this.fish.junk));
    // Too heavy for the hook: it may bend straight somewhere on the way in.
    this.giveAt = !this.fish.junk && this.random() < straightenChance(this.gear, this.fish.weight) ? 0.2 + this.random() * 0.6 : null;
    this.tension = 0;
    this.distance = 1;
    this.behavior = 0;
    this.behaviorClock = 0;
    this.splashClock = 0;
    this.float.sink = 1;
    this.enter("fight");
    this.emit("hooked", { fish: this.fish, onDip });
    this.ripple(this.target, 0.9, 0.6);
  }

  escape(reason, hookLost = false, headline = null) {
    const fighting = this.phase === "fight";
    const at = fighting ? this.fishPosition() : this.target;
    this.ripple(at, 0.5, 0.4);
    this.emit("outcome", { type: "escape", reason, bait: this.bait, hook: this.hookSize, hookLost, headline });
    // A snapped line has nothing to bring back; otherwise the empty rig comes in.
    if (fighting || !this.target) this.reset();
    else this.startReelIn();
  }

  /** Bring the empty float or spoon back: skim it to the bank, then lift it out. */
  startReelIn() {
    this.reelFrom = { ...this.target };
    this.reelDuration = TUNING.reelIn * (0.6 + 0.8 * this.reach());
    this.wakeClock = 0;
    this.float = { offset: 0, sink: 0 };
    this.fish = null;
    this.timeline = [];
    this.lifted = false;
    this.enter("reeling");
  }

  /** How far through reeling in: 0 just started .. 1 out of the water. */
  get reelProgress() {
    return this.phase === "reeling" ? Math.min(1, this.clock / this.reelDuration) : 0;
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

  /** Nudge the float, unless that would push it onto a bank or out of the water. */
  moveFloat(dx, dy) {
    const next = { x: this.target.x + dx, y: this.target.y + dy };
    if (this.isWater(next)) this.target = next;
  }

  /** Current carries the float along; on still water it stays exactly where it landed. */
  driftFloat(dt) {
    const flow = this.currentAt(this.target.x, this.target.y);
    if (flow.x || flow.y) this.moveFloat(flow.x * dt, flow.y * dt);
  }

  /** Where the hooked fish is: it moves from the cast point toward the angler, up to the water's edge. */
  fishPosition() {
    const landing = this.landing();
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

  /** How keen the fish here are right now on this bait: about 0.1 (dead) to 2.2. */
  keenness() {
    const hunger = biteActivity(this.bait, this.location, this.hour);
    const spotPace = LOCATIONS[this.location]?.pace ?? 1;
    // The floor is low so a bait no local fish wants really does go quiet.
    const pace = Math.min(2.2, Math.max(0.1, hunger * 1.2 * spotPace * this.biteBoost));
    // Groundbait draws the fish in.
    return pace * (this.groundbait ? GROUNDBAIT.boost : 1);
  }

  /** Seconds until the next bite: shorter when the local fish are feeding. */
  nextWait() {
    // Mostly a short wait, sometimes a quick one, now and then a long lull.
    const lull = this.random() < 0.1 ? 6 + this.random() * 12 : 0;
    const wait = 2.5 + 11 * this.random() ** 1.6 + lull;
    return (wait / this.keenness()) * (this.extras.includes("sonar") ? 0.55 : 1);
  }

  /** Where a reeled-in spoon (or a hooked fish) ends up: the water's edge below the rod. */
  landing() {
    return { x: this.landingX, y: this.landingY ?? 0.98 };
  }

  /** Spinning: reel the spoon in while pulling; a fish may strike as it moves. */
  updateRetrieve(dt) {
    const random = this.random;
    if (this.pulling) {
      this.jerkAge += dt;
      this.retrieved = Math.min(1, this.retrieved + TUNING.retrieveSpeed * dt);
      const end = this.landing();
      this.target = {
        x: this.lureFrom.x + (end.x - this.lureFrom.x) * this.retrieved,
        y: this.lureFrom.y + (end.y - this.lureFrom.y) * this.retrieved,
      };
      this.wakeClock -= dt;
      if (this.wakeClock <= 0) {
        this.wakeClock = 0.35;
        this.ripple(this.target, 0.18, 0.16);
      }
    } else {
      this.pauseAge += dt;
    }
    if (this.retrieved >= 1) {
      // Back at the bank without a touch: lift it out and cast again.
      this.emit("retrieved");
      this.startReelIn();
      return;
    }
    // Dragged along the bottom, the spoon can catch on a snag.
    const snagChance = LOCATIONS[this.location]?.snagChance ?? 0.02;
    if (this.pulling && random() < snagChance * 0.25 * dt) {
      this.startSnag();
      return;
    }
    const jerking = this.pulling && this.jerkAge < TUNING.jerkWindow;
    const fluttering = !this.pulling && this.retrieved > 0 && this.pauseAge < TUNING.flutterWindow;
    // Each lure has its own best way of being fished.
    const style = BAITS[this.bait].retrieve ?? { jerk: 1, flutter: 1, steady: 1 };
    const odds = jerking ? TUNING.strikeJerk * style.jerk : fluttering ? TUNING.strikeFlutter * style.flutter : this.pulling ? TUNING.strikeSteady * style.steady : 0;
    if (!odds || random() >= odds * this.keenness() * (this.extras.includes("sonar") ? 1.3 : 1) * dt) return;
    const fish = rollFish(this.bait, this.location, random, this.reach(), this.hour, this.gear);
    if (!fish) return;
    // A strike: from here on it's a bite like on the float. The reel stops; pull to hook it.
    this.fish = fish;
    this.pulling = false;
    this.heading = random() * Math.PI * 2;
    this.biteWindow = TUNING.biteWindow * (0.6 + random() * 0.8) * (NIBBLE[fish.species]?.window ?? 1);
    this.float.sink = 1;
    this.ripple(this.target, 0.7, 0.4);
    this.enter("bite");
    this.emit("strike");
  }

  /**
   * Build the twitches and dips that lead up to a bite. Each fish has a
   * temper: a greedy one grabs at once, a nibbler plays a little, a wary one
   * fiddles for a long time, a teaser goes quiet before coming back. Gaps,
   * twitch strength and dip depth all vary from step to step.
   */
  planNibble(species) {
    const random = this.random;
    // Each species leans toward its own kinds of bite and its own rhythm.
    const style = NIBBLE[species] ?? { tempers: [18, 44, 25, 13], pace: 1, twitches: 1, strength: 1 };
    const total = style.tempers.reduce((sum, weight) => sum + weight, 0);
    let roll = random() * total;
    const temper = ["greedy", "nibbler", "wary", "teaser"].find((_, index) => (roll -= style.tempers[index]) < 0) ?? "nibbler";
    const range = (from, to) => from + random() * (to - from);
    const count = { greedy: [0, 1], nibbler: [2, 6], wary: [4, 9], teaser: [3, 7] }[temper];
    const twitches = Math.round((count[0] + Math.floor(random() * (count[1] - count[0] + 1))) * style.twitches);
    // Gaps skew short with the odd longer hesitation.
    const gap = () => style.pace * (temper === "wary" ? 0.3 + 1.9 * random() ** 1.5 : 0.25 + 1.3 * random() ** 1.8);
    const dips = new Set();
    if (twitches && random() < 0.5) dips.add(Math.floor(random() * twitches));
    if (twitches > 3 && random() < 0.25) dips.add(Math.floor(random() * twitches));
    const pauseAt = temper === "teaser" ? 1 + Math.floor(random() * Math.max(1, twitches - 2)) : -1;

    const steps = [];
    let at = range(0.15, 0.6);
    for (let i = 0; i < twitches; i += 1) {
      if (i === pauseAt) at += range(2.5, 6);
      steps.push({ at, kind: dips.has(i) ? "dip" : "twitch", strength: range(0.45, 1.4) * style.strength });
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
        if (this.clock >= this.castDuration) {
          this.ripple(this.target, 0.65, 0.42);
          this.emit("splashdown", { lure: this.spinning });
          if (this.spinning) {
            this.lureFrom = { ...this.target };
            this.retrieved = 0;
            this.jerkAge = Infinity;
            this.pauseAge = Infinity;
            this.wakeClock = 0;
            this.enter("retrieving");
          } else {
            this.waitTime = this.nextWait();
            this.enter("waiting");
          }
        }
        break;

      case "retrieving":
        this.updateRetrieve(dt);
        break;

      case "reeling": {
        // Skimming in: slow to start as the line comes tight, quicker, then easing at the bank.
        const skim = Math.min(1, this.reelProgress / TUNING.reelSkim);
        const eased = skim * skim * (3 - 2 * skim);
        const end = this.landing();
        this.target = { x: this.reelFrom.x + (end.x - this.reelFrom.x) * eased, y: this.reelFrom.y + (end.y - this.reelFrom.y) * eased };
        // At the bank the rig leaves the water.
        if (skim >= 1 && !this.lifted) {
          this.lifted = true;
          this.emit("liftout");
        }
        if (skim < 1) {
          this.wakeClock -= dt;
          if (this.wakeClock <= 0) {
            this.wakeClock = 0.24;
            this.ripple(this.target, 0.16, 0.14);
          }
        }
        if (this.clock >= this.reelDuration) this.reset();
        break;
      }

      case "waiting":
        this.driftFloat(dt);
        if (this.clock >= this.waitTime) {
          this.fish = rollFish(this.bait, this.location, random, this.reach(), this.hour, this.gear);
          if (!this.fish) {
            // Wrong bait for this water: the float just sits there.
            this.clock = 0;
            this.waitTime = this.nextWait();
            break;
          }
          this.timeline = this.planNibble(this.fish.species);
          // The fish leads the float off in its own direction as it plays with the bait.
          this.heading = this.random() * Math.PI * 2;
          this.biteWindow = TUNING.biteWindow * (0.6 + this.random() * 0.8) * (NIBBLE[this.fish.species]?.window ?? 1);
          this.enter("nibble");
        }
        break;

      case "nibble": {
        this.driftFloat(dt);
        this.float.offset = 0;
        this.float.sink = 0;
        for (const step of this.timeline) {
          const age = this.clock - step.at;
          if (step.kind === "bite" && age >= 0) {
            this.float.sink = 1;
            this.ripple(this.target, 0.55, 0.35);
            this.enter("bite");
            this.emit("bite");
            return;
          }
          if (age < 0 || age > 0.45) continue;
          if (!step.rippled) {
            step.rippled = true;
            // Each twitch or dip tugs the float a little, wandering off the cast point.
            this.heading += (this.random() - 0.5) * 1.4;
            const tug = (step.kind === "dip" ? 0.0045 : 0.0025) * (step.strength ?? 1) * (0.5 + this.random());
            this.moveFloat(Math.cos(this.heading) * tug, Math.sin(this.heading) * tug * 0.6);
            this.ripple(this.target, step.kind === "dip" ? 0.4 : 0.22, 0.2);
            this.emit(step.kind, { strength: step.strength ?? 1 });
          }
          const strength = step.strength ?? 1;
          if (step.kind === "twitch") this.float.offset = age < 0.25 ? Math.sin((age / 0.25) * Math.PI) * 3 * strength : 0;
          else this.float.sink = age < 0.4 ? Math.min(1, Math.sin((age / 0.4) * Math.PI) * 1.6 * Math.max(0.7, strength)) : 0;
        }
        break;
      }

      case "bite":
        this.float.sink = 1;
        // Once it takes, the fish drags the sunk float steadily away.
        this.driftFloat(dt);
        this.moveFloat(Math.cos(this.heading) * 0.006 * dt, Math.sin(this.heading) * 0.0035 * dt);
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

    if (this.giveAt !== null && 1 - this.distance >= this.giveAt) {
      // The hook (or the lure's hook) bends straight: the fish is gone, and so is the hook.
      this.escape("straightened", true, "straightened");
      return;
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
