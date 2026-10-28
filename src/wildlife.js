/**
 * Ducks. Now and then, by day, a small group paddles out from the bank,
 * wanders the water toward a couple of random spots and leaves; at dusk any
 * ducks still out head for the edge. They always enter and leave across a
 * screen edge (a side or the bottom). Positions are in screen
 * pixels; `isWater(x, y)` keeps them off banks and rocks.
 */
export class Ducks {
  constructor({ random = Math.random } = {}) {
    this.random = random;
    this.flocks = [];
    this.timer = 25 + random() * 40;
  }

  get all() {
    return this.flocks.flatMap((flock) => flock.ducks);
  }

  reset() {
    this.flocks = [];
    this.timer = 25 + this.random() * 40;
  }

  /**
   * A point just off-screen where open water meets the edge: left, right or
   * bottom. Sides are skipped where a bank or cliff runs to the edge.
   */
  edgePoint(side, width, height, horizonY, isWater) {
    const random = this.random;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (side === "bottom") {
        const x = width * (0.2 + random() * 0.6);
        // Only where the water itself runs to the bottom edge (no bank of ours in the way).
        if (isWater(x, height * 0.92) && isWater(x, height - 2)) return { x, y: height + 30, side };
      } else {
        const y = horizonY + (height - horizonY) * (0.15 + random() * 0.5);
        const probeX = side === "left" ? width * 0.03 : width * 0.97;
        if (isWater(probeX, y)) return { x: side === "left" ? -30 : width + 30, y, side };
      }
    }
    return null;
  }

  spawn(width, height, horizonY, isWater) {
    const random = this.random;
    const count = 1 + Math.floor(random() * 3);
    // Paddle in from just off-screen — a side or the bottom edge — never out of thin air.
    const sides = ["left", "right", "bottom"].sort(() => random() - 0.5);
    let entry = null;
    for (const side of sides) {
      entry = this.edgePoint(side, width, height, horizonY, isWater);
      if (entry) break;
    }
    if (!entry) return;

    const waypoints = [];
    for (let i = 0, wanted = 1 + Math.floor(random() * 2); i < 20 && waypoints.length < wanted; i += 1) {
      const point = { x: width * (0.15 + random() * 0.7), y: horizonY + (height - horizonY) * (0.15 + random() * 0.5) };
      if (isWater(point.x, point.y)) waypoints.push(point);
    }
    // Finally leave past an edge — preferably a different one.
    const exitSides = ["left", "right", "bottom"].filter((side) => side !== entry.side).sort(() => random() - 0.5);
    let exit = null;
    for (const side of [...exitSides, entry.side]) {
      exit = this.edgePoint(side, width, height, horizonY, isWater);
      if (exit) break;
    }
    // Aim well past the edge so the whole flock, trailing the leader, slips out of view.
    const out = exit ?? entry;
    waypoints.push({
      x: out.side === "left" ? -180 : out.side === "right" ? width + 180 : out.x,
      y: out.side === "bottom" ? height + 180 : out.y,
      side: out.side,
    });

    // Followers start further out along the way in.
    const first = waypoints[0];
    const length = Math.hypot(first.x - entry.x, first.y - entry.y) || 1;
    const back = { x: (entry.x - first.x) / length, y: (entry.y - first.y) / length };
    const ducks = Array.from({ length: count }, (_, i) => ({
      x: entry.x + back.x * i * 34,
      y: entry.y + back.y * i * 34 + (i % 2 ? 8 : 0),
      heading: first.x >= entry.x ? 1 : -1,
      phase: random() * Math.PI * 2,
      wake: [],
    }));
    this.flocks.push({ ducks, waypoints, exit: waypoints[waypoints.length - 1], speed: 16 + random() * 12 });
  }

  update(dt, time, width, height, horizonY, isWater, daytime = true) {
    const random = this.random;
    // A way out for a duck that is stuck: the nearer side edge first, then the other, then the bottom.
    const escape = (duck) => {
      const sides = duck.x < width / 2 ? ["left", "right", "bottom"] : ["right", "left", "bottom"];
      for (const side of sides) {
        const point = this.edgePoint(side, width, height, horizonY, isWater);
        if (point) return { x: side === "left" ? -180 : side === "right" ? width + 180 : point.x, y: side === "bottom" ? height + 180 : point.y, side };
      }
      return { x: duck.x < width / 2 ? -180 : width + 180, y: duck.y, side: duck.x < width / 2 ? "left" : "right" };
    };
    this.timer -= dt;
    if (!daytime) {
      // Night: no new ducks, and stragglers make for the edge.
      for (const flock of this.flocks) if (flock.waypoints.length > 1) flock.waypoints = flock.waypoints.slice(-1);
    } else if (this.timer <= 0 && this.flocks.length < 2) {
      this.timer = 60 + this.random() * 120;
      this.spawn(width, height, horizonY, isWater);
    }

    for (const flock of this.flocks) {
      // After the last waypoint, keep paddling toward the exit until everyone is out of sight.
      const goal = flock.waypoints[0] ?? flock.exit;
      flock.ducks.forEach((duck, index) => {
        // Followers trail the leader; the leader heads for the next waypoint.
        const leader = flock.ducks[0];
        // A follower that got stuck behind a rock makes its own way out instead.
        const own = duck.solo;
        const tx = own ? own.x : index === 0 ? goal.x : leader.x - leader.heading * index * 30;
        const ty = own ? own.y : index === 0 ? goal.y : leader.y + (index % 2 ? 10 : -8);
        const dx = tx - duck.x;
        const dy = ty - duck.y;
        const distance = Math.hypot(dx, dy) || 1;
        const speed = flock.speed * (index === 0 ? 1 : Math.min(1.4, distance / 30));
        let nx = duck.x + (dx / distance) * speed * dt;
        let ny = duck.y + (dy / distance) * speed * dt + Math.sin(time * 1.3 + duck.phase) * 3 * dt;
        // Steer around banks and rocks instead of walking over them.
        // Off-screen, on the way in or out, there's nothing to steer around.
        const onScreen = nx > 0 && nx < width && ny < height;
        if (onScreen && !isWater(nx, ny)) {
          // Slide along the obstacle: try one side, then the other.
          const side = (duck.side ??= random() < 0.5 ? 1 : -1);
          const options = [side, -side].map((turn) => ({
            x: duck.x + turn * (dy / distance) * speed * dt,
            y: duck.y - turn * (dx / distance) * speed * dt,
          }));
          const free = options.find((option) => isWater(option.x, option.y));
          nx = free ? free.x : duck.x;
          ny = free ? free.y : duck.y;
        }
        // A leader that can't get anywhere gives up on this waypoint.
        duck.stuck = nx === duck.x && ny === duck.y ? (duck.stuck ?? 0) + dt : 0;
        // Circling an obstacle without getting closer counts as stuck too.
        if (distance < (duck.best ?? Infinity) - 5) {
          duck.best = distance;
          duck.circling = 0;
        } else {
          duck.circling = (duck.circling ?? 0) + dt;
        }
        if (duck.circling > 4) {
          duck.stuck = Math.max(duck.stuck, 3.5);
          duck.circling = 0;
          duck.best = Infinity;
        }
        if (index > 0 && duck.stuck > 3) duck.solo = escape(duck);
        if (index === 0 && duck.stuck > 2) {
          // Give up on this waypoint; on the way out, make for the nearest open edge.
          if (flock.waypoints.length > 1) flock.waypoints.shift();
          else flock.exit = flock.waypoints[0] = escape(duck);
          duck.stuck = 0;
          duck.best = Infinity;
        }
        // Turn round only when really swimming the other way, not while sliding along a bank.
        if (Math.abs(nx - duck.x) > speed * dt * 0.4) duck.heading = nx > duck.x ? 1 : -1;
        if (!duck.wake.length || time - duck.wake[0].t > 0.15) duck.wake.unshift({ x: duck.x, y: duck.y, t: time });
        if (duck.wake.length > 14) duck.wake.length = 14;
        duck.x = nx;
        duck.y = ny;
        if (index === 0 && distance < 12) {
          flock.waypoints.shift();
          duck.best = Infinity;
        }
      });
    }
    // Gone only once the whole flock has paddled past the edge.
    const offScreen = (duck) => duck.x < -25 || duck.x > width + 25 || duck.y > height + 25;
    this.flocks = this.flocks.filter((flock) => flock.waypoints.length > 0 || !flock.ducks.every(offScreen));
  }

  /** The first duck within `radius` px of a point, if any. */
  near(x, y, radius) {
    return this.all.find((duck) => Math.hypot(duck.x - x, (duck.y - y) * 1.6) < radius) ?? null;
  }
}

/*
 * The rest of the wildlife, for the look and sound of the place only (it
 * never touches the fishing):
 *
 * - a grey heron: by day, now and then, it glides in from a side, stands in
 *   the shallows near one of the edges of the view, stabs at the water every
 *   few seconds (sometimes coming up with a fish) and flies off again;
 * - a beaver: in the evening, at the reedy waters and the river, a head with
 *   a long V of a wake swims across, and may slap its tail and dive;
 * - dragonflies: on warm days (summer, late spring), with no rain and no
 *   strong wind, a few hover by the reeds and dart from place to place.
 *
 * Positions are in screen pixels; `isWater(x, y)` keeps them on open water.
 * `onEvent(type, data)` hears a heron's call, its strike and a beaver's slap.
 */
export class Critters {
  constructor({ random = Math.random, onEvent = () => {} } = {}) {
    this.random = random;
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    const random = this.random;
    this.heron = null;
    this.beaver = null;
    this.flies = [];
    this.heronTimer = 60 + random() * 120;
    this.beaverTimer = 30 + random() * 90;
  }

  /**
   * `frame` is the visible slice ({ left, width }), `horizonY` where the far
   * water starts; `when` holds { hour, rain, wind, warm, beavers }.
   */
  update(dt, time, width, height, frame, horizonY, isWater, when) {
    const random = this.random;
    const day = when.hour >= 6 && when.hour < 19.5;
    this.updateHeron(dt, time, height, frame, horizonY, isWater, day && when.rain < 0.5);
    this.updateBeaver(dt, time, height, frame, horizonY, isWater, when.beavers && when.hour >= 18 && when.hour < 22.5);
    // Dragonflies keep to the reeds near our bank, in the bottom corners of the view.
    const flying = when.warm && day && when.hour >= 9 && when.hour < 18.5 && when.rain < 0.15 && when.wind < 0.6;
    if (flying && this.flies.length < 3 && random() < dt * 0.2) {
      const side = random() < 0.5 ? 0 : 1;
      const home = { x: frame.left + frame.width * (side ? 0.78 + random() * 0.16 : 0.06 + random() * 0.16), y: height * (0.66 + random() * 0.2) };
      this.flies.push({ x: home.x, y: home.y - 80, home, to: { ...home }, from: { x: home.x, y: home.y - 80 }, t: 0, dart: 0.4, hover: 0, life: 25 + random() * 40, heading: 1, phase: random() * 6 });
    }
    for (const fly of this.flies) {
      fly.life -= dt;
      if (fly.hover > 0) {
        fly.hover -= dt;
        continue;
      }
      fly.t += dt / fly.dart;
      const k = Math.min(1, fly.t);
      const e = 1 - (1 - k) ** 3;
      fly.x = fly.from.x + (fly.to.x - fly.from.x) * e;
      fly.y = fly.from.y + (fly.to.y - fly.from.y) * e;
      if (k >= 1) {
        // Hover a moment, then dart somewhere near home (or away, at the end of its life).
        fly.hover = 0.8 + random() * 2.5;
        fly.from = { x: fly.x, y: fly.y };
        const leaving = fly.life <= 0 || !flying;
        fly.to = leaving
          ? { x: fly.x + (random() < 0.5 ? -1 : 1) * 400, y: fly.y - 260 }
          : { x: fly.home.x + (random() - 0.5) * 160, y: fly.home.y + (random() - 0.5) * 70 };
        fly.heading = fly.to.x >= fly.x ? 1 : -1;
        fly.dart = 0.18 + random() * 0.3;
        fly.t = 0;
        if (leaving) fly.gone = true;
      }
    }
    this.flies = this.flies.filter((fly) => !(fly.gone && fly.t >= 1));
  }

  updateHeron(dt, time, height, frame, horizonY, isWater, allowed) {
    const random = this.random;
    this.heronTimer -= dt;
    if (!this.heron && allowed && this.heronTimer <= 0) {
      this.heronTimer = 150 + random() * 240;
      // A place to stand: shallow water near one side of the view, toward our bank.
      for (let attempt = 0; attempt < 16; attempt += 1) {
        const left = random() < 0.5;
        // Clear of the reeds in the bottom corners, but off to one side of the float's water.
        const x = frame.left + frame.width * (left ? 0.2 + random() * 0.14 : 0.66 + random() * 0.14);
        const y = horizonY + (height - horizonY) * (0.2 + random() * 0.25);
        if (!isWater(x, y) || !isWater(x - 20, y) || !isWater(x + 20, y)) continue;
        const from = { x: left ? frame.left - 120 : frame.left + frame.width + 120, y: height * (0.12 + random() * 0.12) };
        this.heron = { state: "in", x: from.x, y: from.y, from, spot: { x, y }, t: 0, heading: left ? 1 : -1, stand: 30 + random() * 40, strike: 4 + random() * 6, stab: 0, catch: 0 };
        this.onEvent("heron");
        break;
      }
    }
    const heron = this.heron;
    if (!heron) return;
    if (heron.state === "in" || heron.state === "out") {
      heron.t += dt / 6.5;
      const k = Math.min(1, heron.t);
      const e = k * k * (3 - 2 * k);
      const to = heron.state === "in" ? heron.spot : heron.away;
      heron.x = heron.from.x + (to.x - heron.from.x) * e;
      // A long glide down, with a little rise just before it lands.
      heron.y = heron.from.y + (to.y - heron.from.y) * e - Math.sin(Math.PI * e) * 30;
      if (k >= 1) {
        if (heron.state === "out") this.heron = null;
        else heron.state = "stand";
      }
      return;
    }
    // Standing: still for a while, then a quick stab at the water.
    heron.stand -= dt;
    heron.strike -= dt;
    if (heron.stab > 0) heron.stab = Math.max(0, heron.stab - dt);
    if (heron.catch > 0) heron.catch = Math.max(0, heron.catch - dt);
    if (heron.strike <= 0 && heron.stab === 0) {
      heron.strike = 5 + random() * 9;
      heron.stab = 0.7;
      const caught = random() < 0.35;
      if (caught) heron.catch = 3;
      this.onEvent("heronStrike", { x: heron.x + heron.heading * 26, y: heron.y + 4, caught });
    }
    if (heron.stand <= 0 && heron.stab === 0) {
      // Off again, up and away past the other side.
      heron.state = "out";
      heron.from = { x: heron.x, y: heron.y };
      heron.heading = -heron.heading;
      heron.away = { x: heron.heading > 0 ? frame.left + frame.width + 160 : frame.left - 160, y: height * (0.08 + random() * 0.1) };
      heron.t = 0;
      if (random() < 0.6) this.onEvent("heron");
    }
  }

  updateBeaver(dt, time, height, frame, horizonY, isWater, allowed) {
    const random = this.random;
    this.beaverTimer -= dt;
    if (!this.beaver && allowed && this.beaverTimer <= 0) {
      this.beaverTimer = 120 + random() * 200;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const y = horizonY + (height - horizonY) * (0.12 + random() * 0.35);
        const fromLeft = random() < 0.5;
        const startX = frame.left + (fromLeft ? frame.width * 0.02 : frame.width * 0.98);
        if (!isWater(startX, y)) continue;
        this.beaver = { x: fromLeft ? frame.left - 20 : frame.left + frame.width + 20, y, heading: fromLeft ? 1 : -1, speed: 14 + random() * 8, dive: random() < 0.5 ? 6 + random() * 14 : Infinity, under: 0, wake: [] };
        break;
      }
    }
    const beaver = this.beaver;
    if (!beaver) return;
    if (beaver.under > 0) {
      // Under water after the slap: gone for good after a moment.
      beaver.under += dt;
      if (beaver.under > 1.2) this.beaver = null;
      return;
    }
    const nx = beaver.x + beaver.heading * beaver.speed * dt;
    const onScreen = nx > frame.left && nx < frame.left + frame.width;
    if (onScreen && !isWater(nx, beaver.y)) beaver.dive = 0;
    else beaver.x = nx;
    if (!beaver.wake.length || time - beaver.wake[0].t > 0.3) beaver.wake.unshift({ x: beaver.x, y: beaver.y, t: time });
    if (beaver.wake.length > 12) beaver.wake.length = 12;
    beaver.dive -= dt;
    if (beaver.dive <= 0) {
      // A slap of the tail, and it's under.
      beaver.under = 0.01;
      this.onEvent("beaverSlap", { x: beaver.x - beaver.heading * 10, y: beaver.y });
    }
    if (beaver.x < frame.left - 40 || beaver.x > frame.left + frame.width + 40) this.beaver = null;
  }
}
