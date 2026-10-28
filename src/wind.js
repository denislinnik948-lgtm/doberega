import { hash2 } from "./noise.js";

/*
 * Wind, off the real clock like the weather, so every angler feels the same
 * wind: time is cut into 8-minute slots, each with its own strength and
 * direction from a hash, blended smoothly into the next. Mostly it is calm
 * or a light breeze; now and then it blows hard for a while. Rain brings
 * some wind with it. `strength` is 0 (dead calm) .. 1 (a strong wind), `dir`
 * -1 (blowing to the left) .. 1 (to the right), `gust` the moment's flutter.
 * `?wind=0.8` pins the strength for testing.
 */
const SLOT = 480;

const forced = (() => {
  try {
    const value = new URLSearchParams(globalThis.location?.search ?? "").get("wind");
    return value === null ? null : Math.max(0, Math.min(1, Number(value) || 0));
  } catch {
    return null;
  }
})();

/** A slot's own wind: calm half the time, a breeze a third, strong one slot in six. */
function slotWind(slot) {
  const roll = hash2(slot, 1, 6203);
  const level = hash2(slot, 2, 6203);
  const strength = roll < 0.5 ? 0.05 + level * 0.2 : roll < 0.84 ? 0.3 + level * 0.3 : 0.65 + level * 0.35;
  // The wind keeps its side for a while: the direction drifts slowly over slots.
  const dir = Math.sin(slot * 0.37 + hash2(Math.floor(slot / 5), 3, 6203) * 6.28);
  return { strength, dir };
}

const ease = (k) => k * k * (3 - 2 * k);

/** The wind at a moment (seconds since the epoch), with `rain` (0..1) adding to it. */
export function windAt(seconds, rain = 0) {
  const position = seconds / SLOT;
  const slot = Math.floor(position);
  const a = slotWind(slot);
  const b = slotWind(slot + 1);
  // Hold each slot's wind most of the slot, turning to the next over its last fifth.
  const k = ease(Math.min(1, Math.max(0, (position - slot - 0.8) / 0.2)));
  const base = forced ?? a.strength + (b.strength - a.strength) * k;
  const strength = Math.min(1, base + rain * 0.25 * (1 - base));
  const dir = a.dir + (b.dir - a.dir) * k;
  // Gusts come and go every few seconds, harder in a strong wind.
  const gust = 0.75 + 0.25 * Math.sin(seconds * 0.9) * Math.sin(seconds * 0.37 + 1.3);
  // Mostly squarely to one side, turning through a still moment when it changes sides.
  return { strength, dir: Math.max(-1, Math.min(1, dir * 1.8)), gust };
}

/**
 * How the wind moves the bite: a light ripple on the water livens it a
 * little, a strong wind puts the fish off; dead calm changes nothing.
 */
export function windBite(strength) {
  const ripple = Math.exp(-(((strength - 0.45) / 0.2) ** 2));
  const gale = Math.min(1, Math.max(0, (strength - 0.7) / 0.3));
  return 1 + 0.1 * ripple - 0.15 * gale;
}
