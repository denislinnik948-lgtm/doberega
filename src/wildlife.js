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
        if (isWater(x, height * 0.92)) return { x, y: height + 30, side };
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
        if (index > 0 && duck.stuck > 3) duck.solo = { x: duck.x, y: height + 180 };
        if (index === 0 && duck.stuck > 2) {
          // Give up on this waypoint; on the way out, head straight down past the bottom edge.
          if (flock.waypoints.length > 1) flock.waypoints.shift();
          else flock.exit = flock.waypoints[0] = { x: duck.x, y: height + 180, side: "bottom" };
          duck.stuck = 0;
          duck.best = Infinity;
        }
        if (Math.abs(nx - duck.x) > 0.01) duck.heading = nx > duck.x ? 1 : -1;
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
