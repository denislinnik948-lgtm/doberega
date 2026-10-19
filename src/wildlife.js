/**
 * Ducks. Now and then, by day, a small group paddles out from the bank,
 * wanders the water toward a couple of random spots and leaves; at dusk any
 * ducks still out head for the edge. Positions are in screen
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

  spawn(width, height, horizonY, isWater) {
    const random = this.random;
    const count = 1 + Math.floor(random() * 3);
    // Paddle out from the left or right edge, or from the far shore.
    const fromSide = random() < 0.7;
    let x;
    let y;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (fromSide) {
        x = random() < 0.5 ? -20 : width + 20;
        y = horizonY + (height - horizonY) * (0.12 + random() * 0.45);
        const probeX = x < 0 ? width * 0.08 : width * 0.92;
        if (isWater(probeX, y)) break;
      } else {
        x = width * (0.15 + random() * 0.7);
        y = horizonY + height * 0.05;
        if (isWater(x, y)) break;
      }
    }
    const waypoints = Array.from({ length: 1 + Math.floor(random() * 2) }, () => ({
      x: width * (0.15 + random() * 0.7),
      y: horizonY + (height - horizonY) * (0.15 + random() * 0.5),
    }));
    // Finally swim off past the far edge.
    waypoints.push({ x: x < width / 2 ? width + 60 : -60, y: horizonY + (height - horizonY) * (0.1 + random() * 0.5) });
    const ducks = Array.from({ length: count }, (_, i) => ({
      x: x - (x < width / 2 ? 1 : -1) * i * 34,
      y: y + (i % 2 ? 10 : -6) * Math.min(i, 1),
      heading: x < width / 2 ? 1 : -1,
      phase: random() * Math.PI * 2,
      wake: [],
    }));
    this.flocks.push({ ducks, waypoints, speed: 16 + random() * 12 });
  }

  update(dt, time, width, height, horizonY, isWater, daytime = true) {
    this.timer -= dt;
    if (!daytime) {
      // Night: no new ducks, and stragglers make for the edge.
      for (const flock of this.flocks) if (flock.waypoints.length > 1) flock.waypoints = flock.waypoints.slice(-1);
    } else if (this.timer <= 0 && this.flocks.length < 2) {
      this.timer = 60 + this.random() * 120;
      this.spawn(width, height, horizonY, isWater);
    }

    for (const flock of this.flocks) {
      const goal = flock.waypoints[0];
      flock.ducks.forEach((duck, index) => {
        // Followers trail the leader; the leader heads for the next waypoint.
        const leader = flock.ducks[0];
        const tx = index === 0 ? goal.x : leader.x - leader.heading * index * 30;
        const ty = index === 0 ? goal.y : leader.y + (index % 2 ? 10 : -8);
        const dx = tx - duck.x;
        const dy = ty - duck.y;
        const distance = Math.hypot(dx, dy) || 1;
        const speed = flock.speed * (index === 0 ? 1 : Math.min(1.4, distance / 30));
        let nx = duck.x + (dx / distance) * speed * dt;
        let ny = duck.y + (dy / distance) * speed * dt + Math.sin(time * 1.3 + duck.phase) * 3 * dt;
        // Steer around banks and rocks instead of walking over them.
        const onScreen = nx > 0 && nx < width;
        if (onScreen && !isWater(nx, ny)) {
          nx = duck.x + (dy / distance) * speed * dt;
          ny = duck.y - (dx / distance) * speed * dt;
          if (!isWater(nx, ny)) {
            nx = duck.x;
            ny = duck.y;
          }
        }
        // A leader that can't get anywhere gives up on this waypoint.
        duck.stuck = nx === duck.x && ny === duck.y ? (duck.stuck ?? 0) + dt : 0;
        if (index === 0 && duck.stuck > 2) {
          flock.waypoints.shift();
          duck.stuck = 0;
        }
        if (Math.abs(nx - duck.x) > 0.01) duck.heading = nx > duck.x ? 1 : -1;
        if (!duck.wake.length || time - duck.wake[0].t > 0.15) duck.wake.unshift({ x: duck.x, y: duck.y, t: time });
        if (duck.wake.length > 14) duck.wake.length = 14;
        duck.x = nx;
        duck.y = ny;
        if (index === 0 && distance < 12) flock.waypoints.shift();
      });
    }
    // Gone once the last waypoint (off-screen) is reached.
    this.flocks = this.flocks.filter((flock) => flock.waypoints.length > 0);
  }

  /** The first duck within `radius` px of a point, if any. */
  near(x, y, radius) {
    return this.all.find((duck) => Math.hypot(duck.x - x, (duck.y - y) * 1.6) < radius) ?? null;
  }
}
