/**
 * Sound: soft effects made on the fly with Web Audio (no sound files to
 * download), built after the real thing. Water is mostly bubbles: a drop or a
 * float hitting the surface rings as a tiny bubble whose pitch shoots up as it
 * closes, so plops, bites and splashes are made of those. The background is
 * not a constant hiss but sparse, natural sounds: a ripple lapping now and
 * then, birds by day, crickets at night, and rain as falling drops.
 *
 * Sound is still being tuned, so for now it is off for everyone and the
 * Settings switch can't be turned on, except on the owner's devices (where an
 * admin has signed in: see markOwnDevice in analytics.js). There it starts off
 * too and the choice is remembered. Browsers only let a page make sound after
 * a tap or a key, so nothing plays before the first one.
 */

const KEY = "doberega.sound";
const OWN_KEY = "doberega.ownDevice";
const VOLUME = 0.7;

/** Whether this device may switch sound on at all (for now, only the owner's). */
export function soundAllowed() {
  try {
    return localStorage.getItem(OWN_KEY) === "1";
  } catch {
    return false;
  }
}

let enabled = (() => {
  try {
    return soundAllowed() && localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
})();

let ctx = null;
let master = null;
let noise = null;
let brown = null;
let rainBed = null;

export function soundEnabled() {
  return enabled;
}

export function setSoundEnabled(on) {
  if (on && !soundAllowed()) return;
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Without storage the choice lasts for this visit.
  }
  // Switched on from Settings: that tap is allowed to start the sound.
  if (!ctx) {
    if (on) start();
    return;
  }
  // Fade rather than click off; while off, the audio sleeps and costs nothing.
  master.gain.setTargetAtTime(on ? VOLUME : 0, ctx.currentTime, 0.05);
  if (on) ctx.resume();
  else setTimeout(() => !enabled && ctx.suspend(), 200);
}

/** The audio graph, once started; null while sound is off or not yet allowed. */
function audio() {
  if (!enabled || !ctx) return null;
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function start() {
  if (ctx || !enabled) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = VOLUME;
  // A gentle limiter keeps a busy moment (a fight in the rain) from clipping.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.ratio.value = 6;
  master.connect(limiter).connect(ctx.destination);
  const length = ctx.sampleRate * 2;
  // White noise for clicks and swishes; brown noise (deep, soft) for water and the rain's murmur.
  noise = ctx.createBuffer(1, length, ctx.sampleRate);
  brown = ctx.createBuffer(1, length, ctx.sampleRate);
  const white = noise.getChannelData(0);
  const deep = brown.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    white[i] = Math.random() * 2 - 1;
    last = (last + 0.02 * white[i]) / 1.02;
    deep[i] = last * 3.5;
  }
}

// Sound may only start from a user gesture: the first tap or key unlocks it.
for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, start, { passive: true });
// A hidden tab goes quiet (and saves the battery).
document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden || !enabled) ctx.suspend();
  else ctx.resume();
});

const rand = (min, max) => min + Math.random() * (max - min);
const vary = (value, amount = 0.1) => value * (1 + rand(-amount, amount));

/** A gain node into the master, at `level`, panned a little left or right. */
function out(level = 1, pan = 0) {
  const gain = ctx.createGain();
  gain.gain.value = level;
  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    gain.connect(panner).connect(master);
  } else {
    gain.connect(master);
  }
  return gain;
}

/**
 * One bubble: a sine whose pitch shoots up as it closes, dying away in a few
 * hundredths of a second. The basic sound of water.
 */
function bubble(freq, volume, delay = 0, pan = 0) {
  const at = ctx.currentTime + delay;
  const length = rand(0.03, 0.07);
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * rand(1.8, 2.8), at + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(out(1, pan));
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** Filtered noise shaped by an envelope: attack, then a fall to silence. */
function wash({ buffer = noise, type = "lowpass", from, to = from, q = 0.7, attack = 0.01, length, volume, delay = 0, pan = 0 }) {
  const at = ctx.currentTime + delay;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const offset = rand(0, 1.4);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(30, to), at + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  source.connect(filter).connect(gain).connect(out(1, pan));
  source.start(at, offset, length + 0.05);
}

/** A short tone with a quick decay (a ping, a clink, a chirp). */
function ping(freq, volume, length, { delay = 0, type = "sine", to = freq, pan = 0 } = {}) {
  const at = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, at + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(out(1, pan));
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/**
 * How fast the rod tip moves through a swing, 0..1: an accelerating rise to
 * the peak at `peakAt`, then a quick stop.
 */
function speedCurve(peakAt, steps = 96) {
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    curve[i] = t < peakAt ? (t / peakAt) ** 2.2 : Math.exp(-((t - peakAt) / (1 - peakAt)) * 4.5);
  }
  return curve;
}

/**
 * A swish: air rushing past the rod. Noise through a band that rises with the
 * tip's speed (faster: higher and louder), plus an optional narrow whistle of
 * the thin tip. Picked in the sound lab (tools/sound-lab).
 */
function swish({ duration, peakAt = 0.7, low, high, q = 1, whistle = 0, level = 0.5, pan = 0 }) {
  const start = ctx.currentTime;
  const speed = speedCurve(peakAt);
  const freqs = speed.map((s) => low + (high - low) * s);
  const gains = speed.map((s) => level * s);
  const destination = out(1, pan);
  const layer = (filterQ, freqScale, gainScale) => {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = filterQ;
    filter.frequency.setValueCurveAtTime(freqs.map((f) => f * freqScale), start, duration);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setValueCurveAtTime(gains.map((g) => g * gainScale), start, duration);
    source.connect(filter).connect(gain).connect(destination);
    source.start(start, rand(0, 1.4), duration + 0.05);
  };
  layer(q, 1, 1);
  if (whistle) layer(9, 1.9, whistle);
}

/** Line peeling off the spool as the bait flies: a faint, fluttering high hiss that dies away. */
function linePeel({ delay = 0, duration, level = 0.06, flutter = 45 }) {
  const start = ctx.currentTime + delay;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(5200, start);
  filter.frequency.exponentialRampToValueAtTime(3200, start + duration);
  filter.Q.value = 1.4;
  const steps = 160;
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    // The spool's flutter: the hiss pulses as each coil leaves, slowing as the bait slows.
    const pulse = 0.65 + 0.35 * Math.sin(t * duration * flutter * (1 - 0.6 * t) * Math.PI * 2);
    curve[i] = level * Math.min(1, t * 12) * (1 - t) ** 1.6 * pulse;
  }
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.setValueCurveAtTime(curve, start, duration);
  source.connect(filter).connect(gain).connect(master);
  source.start(start, rand(0, 1.4), duration + 0.05);
}

/** A bubble with a set shape (the sound lab's), optionally muffled under water. */
function blup({ freq, rise = 2.3, length = 0.05, level = 0.2, delay = 0, pan = 0, muffle = 0 }) {
  const at = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * rise, at + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  let tail = gain;
  if (muffle) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900 - 600 * muffle;
    gain.connect(filter);
    tail = filter;
  }
  osc.connect(gain);
  tail.connect(out(1, pan));
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/** A scatter of small drops falling back after a splash. */
function droplets(count, from, to, level) {
  for (let i = 0; i < count; i += 1) {
    blup({ delay: rand(from, to), freq: rand(600, 1500), rise: rand(1.8, 2.8), length: rand(0.025, 0.055), level: level * rand(0.4, 1), pan: rand(-0.2, 0.2) });
  }
}

/** A splash: a soft body of deep noise and a scatter of bubbles of falling drops. */
function splash(size, pan = 0) {
  wash({ buffer: brown, type: "lowpass", from: 900 + 900 * size, to: 220, attack: 0.008, length: 0.18 + 0.35 * size, volume: 0.35 * size, pan });
  wash({ type: "bandpass", from: 1800, to: 900, q: 0.6, attack: 0.005, length: 0.08 + 0.12 * size, volume: 0.05 * size, pan });
  const drops = Math.round(2 + 6 * size);
  for (let i = 0; i < drops; i += 1) bubble(rand(500, 1300), rand(0.015, 0.05) * size, rand(0.02, 0.18 + 0.3 * size), pan + rand(-0.15, 0.15));
}

export const sounds = {
  /** The rod cutting the air, then line peeling off the spool as the bait flies. */
  cast(style = "under") {
    if (!audio()) return;
    if (style === "over") {
      // Far, overhead (lab: Д4 "Без замаху"): one strong swing and a long run of line off the spool.
      swish({ duration: vary(0.34, 0.08), peakAt: 0.74, low: vary(600, 0.08), high: vary(2200, 0.08), q: 1.1, whistle: 0.2, level: 0.62 });
      linePeel({ delay: 0.24, duration: vary(1.1, 0.08), level: 0.07, flutter: 48 });
    } else {
      // Close in, underhand (lab: Б1 "М'який"): a soft, airy swing with no sharp edge.
      swish({ duration: vary(0.3, 0.08), peakAt: 0.65, low: vary(380, 0.08), high: vary(1300, 0.08), q: 0.9, level: 0.55 });
    }
  },
  /** The float landing (lab: П2 "Чіткий «блуп»"): a deeper bubble, a soft splash and a couple of drops. */
  landFloat() {
    if (!audio()) return;
    blup({ freq: vary(280, 0.08), rise: 2.6, length: 0.07, level: 0.3 });
    wash({ type: "lowpass", from: vary(1100, 0.08), to: 250, attack: 0.006, length: 0.16, volume: 0.14 });
    droplets(2, 0.06, 0.18, 0.05);
  },
  /** The float or lure landing: a plop and a ring of small drops. */
  splash(size = 1) {
    if (!audio()) return;
    bubble(vary(380), 0.16 * size);
    splash(0.35 * size);
  },
  /** The float ducking under (lab: К1 "Тихий бульк"): one small bubble and a smaller one after it. */
  bite() {
    if (!audio()) return;
    blup({ freq: vary(620, 0.08), rise: 2.2, length: 0.045, level: 0.16 });
    blup({ delay: 0.05, freq: vary(900, 0.08), rise: 2, length: 0.03, level: 0.06 });
  },
  /** A fish hitting a lure: a swirl at the surface. */
  strike() {
    if (!audio()) return;
    splash(0.8, rand(-0.2, 0.2));
  },
  /** One click of the spinning reel's anti-reverse (lab: С4 "Дрібна тріскачка"): tiny and bright. */
  spinTick() {
    if (!audio()) return;
    wash({ type: "bandpass", from: vary(4600, 0.075), q: 3, attack: 0.0008, length: 0.006, volume: 0.045 });
  },
  /** One click of the float reel's ratchet (lab: Р1 "Тріскачка"): a dry plastic tick. */
  reelTick() {
    if (!audio()) return;
    wash({ type: "bandpass", from: vary(3200, 0.075), q: 2, attack: 0.0008, length: 0.012, volume: 0.09 });
  },
  /**
   * A fish thrashing at the surface. Small (up to 1.5 kg): light splashes
   * with drops or a quick flutter of the tail, at random (lab: Ф1 and Ф3).
   * Big: a sharp slap of the tail and a deep gulp (lab: В2).
   */
  thrash(weight = 1) {
    if (!audio()) return;
    const pan = rand(-0.3, 0.3);
    if (weight >= 1.5) {
      wash({ type: "lowpass", from: vary(3000, 0.08), to: 400, attack: 0.002, length: 0.12, volume: 0.28, pan });
      blup({ delay: 0.06, freq: vary(180, 0.08), rise: 2.6, length: 0.12, level: 0.25, muffle: 0.4, pan });
      droplets(4, 0.1, 0.4, 0.05);
    } else if (Math.random() < 0.5) {
      wash({ type: "lowpass", from: vary(2200, 0.08), to: 500, attack: 0.006, length: 0.12, volume: 0.13, pan });
      droplets(3, 0.03, 0.18, 0.05);
    } else {
      for (let i = 0; i < 6; i += 1) wash({ type: "bandpass", from: vary(1700, 0.08), to: 900, q: 0.8, attack: 0.004, length: 0.045, volume: 0.07, delay: i * vary(0.055, 0.08), pan });
      droplets(3, 0.05, 0.35, 0.04);
    }
  },
  /** The line snapping (or the hook giving): a dry crack and the slack line whipping. */
  snap() {
    if (!audio()) return;
    wash({ type: "highpass", from: 2600, q: 0.5, attack: 0.001, length: 0.04, volume: 0.22 });
    wash({ type: "bandpass", from: 2400, to: 500, q: 1.5, attack: 0.02, length: 0.25, volume: 0.06, delay: 0.03 });
  },
  /**
   * A fish lifted out onto the bank (lab: Л3 "З води"): water running off it,
   * then a soft thump. A heavier fish sheds more water and lands deeper.
   */
  landed(weight = 0.5) {
    if (!audio()) return;
    const size = Math.max(0, Math.min(1, (weight - 0.3) / 4));
    droplets(6 + Math.round(size * 6), 0, 0.45, 0.05);
    wash({ buffer: brown, type: "lowpass", from: vary(1200, 0.08), to: 200, attack: 0.003, length: 0.12 + 0.1 * size, volume: 0.16 + 0.12 * size, delay: 0.45 });
  },
  /** Coins: two small metal clinks (inharmonic partials, like real coins). */
  coin() {
    if (!audio()) return;
    for (const [delay, base] of [[0, 2350], [0.085, 2650]]) {
      ping(vary(base, 0.03), 0.04, 0.16, { delay });
      ping(vary(base * 2.76, 0.03), 0.02, 0.1, { delay });
    }
  },
};

/*
 * The background, played as sparse events rather than a steady noise:
 * water lapping now and then while at the water, birds by day, crickets at
 * night, and rain as drops plus a deep murmur that swells with the rain.
 */
const ambient = { lap: 3, bird: 6, cricket: 2, drop: 0 };

function lap() {
  // A small wave against the bank: a slow swell of deep noise and a few bubbles.
  wash({ buffer: brown, type: "lowpass", from: vary(380, 0.2), to: 160, attack: rand(0.15, 0.3), length: rand(0.7, 1.2), volume: rand(0.05, 0.09), pan: rand(-0.6, 0.6) });
  for (let i = 0; i < 3; i += 1) if (Math.random() < 0.6) bubble(rand(350, 800), rand(0.008, 0.02), rand(0.15, 0.6), rand(-0.5, 0.5));
}

function bird() {
  // A few quick whistled notes, each sliding, from somewhere off to one side.
  const pan = rand(-0.8, 0.8);
  const base = rand(2600, 4200);
  const notes = 2 + Math.floor(Math.random() * 4);
  for (let i = 0; i < notes; i += 1) {
    const from = base * rand(0.85, 1.2);
    ping(from, rand(0.008, 0.016), rand(0.06, 0.12), { delay: i * rand(0.09, 0.15), to: from * rand(0.7, 1.35), pan });
  }
}

function cricket() {
  // A chirp: a quick train of pulses at one high pitch.
  const pan = rand(-0.9, 0.9);
  const freq = rand(4200, 4800);
  const pulses = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < pulses; i += 1) ping(freq, 0.007, 0.025, { delay: i * 0.045, pan });
}

let rainLevel = 0;

/** The rain's deep murmur: a looped brown noise, low and soft, faded to the rain's strength. */
function setRainBed(level) {
  if (!rainBed && level > 0.02) {
    const source = ctx.createBufferSource();
    source.buffer = brown;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(master);
    source.start();
    rainBed = { source, gain };
  }
  if (!rainBed) return;
  rainBed.gain.gain.setTargetAtTime(0.12 * level, ctx.currentTime, 0.8);
  // Once the rain has gone, stop the loop altogether.
  if (level <= 0.02 && rainLevel <= 0.02) {
    const { source } = rainBed;
    setTimeout(() => source.stop(), 3000);
    rainBed = null;
  }
}

/**
 * Advance the background by `step` seconds: `atWater` while fishing, `rain`
 * 0..1, `night` while it's dark.
 */
export function ambienceTick(step, { atWater, rain, night }) {
  if (!audio() || step <= 0) return;
  if (Math.abs(rain - rainLevel) > 0.02 || (rain <= 0.02 && rainBed)) {
    rainLevel = rain;
    setRainBed(rain);
  }
  for (const key of Object.keys(ambient)) ambient[key] -= step;
  if (atWater && ambient.lap <= 0) {
    ambient.lap = rand(2.5, 6);
    lap();
  }
  // Birds sing by day, and not in the rain; crickets chirp on dry nights.
  if (atWater && !night && rain < 0.3 && ambient.bird <= 0) {
    ambient.bird = rand(6, 16);
    bird();
  }
  if (atWater && night && rain < 0.3 && ambient.cricket <= 0) {
    ambient.cricket = rand(0.8, 3);
    cricket();
  }
  // Rain: drops landing on the water all around, more as it gets heavier.
  if (rain > 0.05 && ambient.drop <= 0) {
    ambient.drop = rand(0.01, 0.06) / rain;
    bubble(rand(600, 1600), rand(0.006, 0.02) * (0.4 + rain), 0, rand(-0.9, 0.9));
  }
}
