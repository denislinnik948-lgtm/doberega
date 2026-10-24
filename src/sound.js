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

/** One coin (or a small piece of metal) clinking: inharmonic partials, like real metal. */
function clink(freq, level, delay = 0, length = 0.16) {
  const base = vary(freq, 0.03);
  for (const [ratio, part] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) ping(base * ratio, level * part, length / ratio, { delay });
}

/** A soft wooden tap: a short knock with a little body under it (the interface's "Дерево" set). */
function knock(freq, level, delay = 0) {
  wash({ type: "bandpass", from: freq, q: 4, attack: 0.001, length: 0.04, volume: level, delay });
  blup({ delay, freq: freq * 0.5, rise: 0.92, length: 0.05, level: level * 0.5 });
}

export const sounds = {
  /**
   * The interface, as soft wooden taps (lab: У1 "Дерево"): a button, a tab, a
   * window opening (two taps up) or closing (two down), leafing through the
   * spots, picking gear, and a low double knock for "can't".
   */
  ui(event) {
    if (!audio()) return;
    if (event === "click") knock(vary(1100, 0.08), 0.08);
    else if (event === "tab") knock(vary(1400, 0.08), 0.06);
    else if (event === "open") {
      knock(800, 0.07);
      knock(1150, 0.06, 0.07);
    } else if (event === "close") {
      knock(1150, 0.06);
      knock(800, 0.07, 0.07);
    } else if (event === "slide") wash({ type: "bandpass", from: 700, to: 1500, q: 0.9, attack: 0.04, length: 0.18, volume: 0.05 });
    else if (event === "select") {
      knock(1250, 0.07);
      for (const [ratio, part] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) ping(2200 * ratio, 0.012 * part, 0.2 / ratio, { delay: 0.03 });
    } else if (event === "denied") {
      knock(420, 0.1);
      knock(380, 0.09, 0.1);
    }
  },
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
  /** A fish touching the bait, the float trembling (lab: Т1): a tiny high bubble, at the edge of hearing. */
  twitch() {
    if (!audio()) return;
    blup({ freq: vary(950, 0.08), rise: 1.8, length: 0.025, level: 0.05 });
  },
  /** The float dipping for a moment (lab: Н2 "Пірнув і виринув"): a muffled bubble under water, a light pop as it comes back up. */
  dip() {
    if (!audio()) return;
    blup({ freq: vary(380, 0.08), rise: 2.3, length: 0.05, level: 0.1, muffle: 0.5 });
    blup({ delay: 0.3, freq: vary(700, 0.08), rise: 1.8, length: 0.03, level: 0.05 });
  },
  /** The float ducking under (lab: К1 "Тихий бульк"): one small bubble and a smaller one after it. */
  bite() {
    if (!audio()) return;
    blup({ freq: vary(620, 0.08), rise: 2.2, length: 0.045, level: 0.16 });
    blup({ delay: 0.05, freq: vary(900, 0.08), rise: 2, length: 0.03, level: 0.06 });
  },
  /** A fish hitting a lure (lab: Х1 "Вир"): the water swirling where it struck. */
  strike() {
    if (!audio()) return;
    wash({ buffer: brown, type: "lowpass", from: vary(900, 0.08), to: 200, attack: 0.05, length: 0.4, volume: 0.22, pan: 0.15 });
    droplets(4, 0.05, 0.35, 0.05);
  },
  /** A lure landing (lab: Ш4 "Плюх і булькіт"): in it goes, and small bubbles follow as it sinks. */
  landLure() {
    if (!audio()) return;
    blup({ freq: vary(260, 0.08), rise: 2.5, length: 0.07, level: 0.24 });
    wash({ buffer: brown, type: "lowpass", from: vary(1100, 0.08), to: 250, attack: 0.006, length: 0.16, volume: 0.13 });
    for (let i = 0; i < 4; i += 1) blup({ delay: 0.15 + i * vary(0.12, 0.08), freq: vary(500 + i * 80, 0.08), rise: 2, length: 0.03, level: 0.05, muffle: 0.6 });
  },
  /** The empty rig lifted out at the bank (lab: А3 "Чмок і краплі"): the water letting go, and a couple of drops. */
  liftOut() {
    if (!audio()) return;
    blup({ freq: vary(340, 0.08), rise: 3, length: 0.06, level: 0.1 });
    droplets(2, 0.12, 0.35, 0.04);
  },
  /** A handful of groundbait hitting the water (lab: И1 "Розсип"): many little plops in one spot. */
  groundbait() {
    if (!audio()) return;
    for (let i = 0; i < 18; i += 1) blup({ delay: rand(0.1, 0.45), freq: rand(700, 1600), rise: 2, length: 0.025, level: 0.04, pan: rand(-0.2, 0.2) });
  },
  /** An old boot on the bank (lab: Ю3 "Сумний «буп»"): a wet squelch and two low notes sliding down. */
  boot() {
    if (!audio()) return;
    wash({ buffer: brown, type: "lowpass", from: 700, to: 150, attack: 0.002, length: 0.15, volume: 0.2 });
    blup({ delay: 0.2, freq: 330, rise: 0.94, length: 0.18, level: 0.07 });
    blup({ delay: 0.42, freq: 262, rise: 0.9, length: 0.3, level: 0.07 });
  },
  /** Valerka or Artem (lab: Я1 "Блиск"): little bells running up, like something magic. */
  unique() {
    if (!audio()) return;
    [784, 988, 1175, 1568].forEach((freq, i) => {
      for (const [ratio, part] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) ping(freq * ratio, 0.04 * part, 0.6 / ratio, { delay: i * 0.08 });
    });
  },
  /** The rod bending under a heavy fish (lab: Е1 "Тихий скрип"): a low, slow creak of the blank. */
  creak() {
    if (!audio()) return;
    const grinds = 15;
    for (let i = 0; i < grinds; i += 1) {
      const t = i / grinds;
      wash({ type: "bandpass", from: 300 + 350 * t, q: 8, attack: 0.001, length: 0.027, volume: 0.05 * rand(0.5, 1), delay: i * 0.03 });
    }
  },
  /** Hooked on a snag (lab: Ж3 "Дзинь волосіні"): the taut line twangs, dull and low. */
  snag() {
    if (!audio()) return;
    const freq = vary(180, 0.08);
    for (const [ratio, part] of [[1, 1], [2, 0.5], [3, 0.3], [4.2, 0.15]]) {
      const at = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq * ratio, at);
      osc.frequency.exponentialRampToValueAtTime(freq * ratio * 0.85, at + 0.5);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.1 * part, at + 0.003);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5 / ratio);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.52);
    }
  },
  /** The snag letting go (lab: Ч2 "Шурхіт і бульк"): a rustle of the branch and a bubble. */
  snagFree() {
    if (!audio()) return;
    wash({ type: "bandpass", from: 1800, to: 900, q: 0.8, attack: 0.02, length: 0.2, volume: 0.05 });
    blup({ delay: 0.15, freq: vary(420, 0.08), rise: 2.3, length: 0.05, level: 0.12 });
  },
  /** The strike to set the hook (lab: З1 "Різкий змах"): a short, quick swish of the rod going up. */
  hookset() {
    if (!audio()) return;
    swish({ duration: vary(0.16, 0.08), peakAt: 0.55, low: vary(600, 0.08), high: vary(2400, 0.08), q: 1.2, level: 0.45 });
  },
  /**
   * The drag giving line as a fish runs (lab: М3 "Рвучкі ривки"): a burst of
   * clicks that speeds up and slows with the fish's pulls; `strength` 0..1.
   */
  drag(strength = 1, seconds = 0.6) {
    if (!audio()) return;
    let t = 0;
    const phase = rand(0, 6);
    while (t < seconds) {
      const speed = 0.5 + 0.5 * Math.sin(t * 18 + phase);
      wash({ type: "bandpass", from: vary(2700, 0.07), q: 3, attack: 0.0008, length: 0.008, volume: (0.03 + 0.04 * speed) * (0.5 + 0.5 * strength), delay: t });
      t += 0.018 + 0.03 * (1 - speed);
    }
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
  /** A duck eating the bait (lab: Кз1 "Хап і кря"): a quick dabbling with the bill and a pleased quack. */
  duckEats() {
    if (!audio()) return;
    for (let i = 0; i < 4; i += 1) wash({ type: "lowpass", from: 2000, to: 600, attack: 0.002, length: 0.05, volume: 0.06, delay: i * 0.05 });
    quack({ delay: 0.3, freq: vary(420, 0.08), length: 0.15, level: 0.05 });
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
  /** The hook bending straight (lab: Г3 "Клац і ослабло"): a small metal click, a faint ring, the line going slack. */
  hookBend() {
    if (!audio()) return;
    wash({ type: "bandpass", from: vary(5200, 0.05), q: 6, attack: 0.001, length: 0.02, volume: 0.1 });
    ping(vary(3600, 0.05), 0.025, 0.12, { delay: 0.005 });
    ping(vary(3600 * 2.76, 0.05), 0.012, 0.05, { delay: 0.005 });
    wash({ type: "bandpass", from: 1500, to: 600, q: 1, attack: 0.04, length: 0.3, volume: 0.04, delay: 0.05 });
  },
  /** The line snapping (lab: О1 "Сухий тріск"): a dry crack and the slack line whipping. */
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
    clink(2350, 0.04);
    clink(2650, 0.04, 0.085);
  },
  /** A big purchase, a rod or gear (lab: Ї1 "Купа монет"): a whole cascade of coins. */
  buyBig() {
    if (!audio()) return;
    for (let i = 0; i < 9; i += 1) clink(rand(2000, 3200), 0.03, i * 0.045 + rand(0, 0.02));
  },
  /** Selling the keepnet (lab: Й2 "Садок і монети"): the net lifted dripping out of the water, then coins. */
  sell() {
    if (!audio()) return;
    droplets(8, 0, 0.4, 0.05);
    for (let i = 0; i < 6; i += 1) clink(2100 + i * 140, 0.03, 0.45 + i * 0.05);
  },
  /** A fish kept as a trophy (lab: Ц1 "Цвях"): three knocks of a hammer on a nail. */
  trophy() {
    if (!audio()) return;
    for (let i = 0; i < 3; i += 1) {
      knock(700 - i * 40, 0.09, i * 0.18);
      clink(3200, 0.008, i * 0.18, 0.08);
    }
  },
};

/*
 * The background, played as sparse events rather than a steady noise:
 * water lapping now and then while at the water, birds by day, crickets at
 * night, and rain as drops plus a deep murmur that swells with the rain.
 */
const ambient = { lap: 3, bird: 6, cricket: 2, drop: 0, jump: 25, duck: 8, owl: 60, thunder: 40 };

function lap() {
  // A small wave against the bank (lab: Хв1 "Тихий плескіт"): a soft swell of deep noise and a couple of bubbles.
  const pan = rand(-0.3, 0.3);
  wash({ buffer: brown, type: "lowpass", from: vary(380, 0.08), to: 160, attack: 0.22, length: 1, volume: 0.08, pan });
  blup({ delay: 0.3, freq: vary(500, 0.08), rise: 2, length: 0.04, level: 0.02, pan });
  blup({ delay: 0.5, freq: vary(700, 0.08), rise: 2, length: 0.03, level: 0.015, pan });
}

function fishJump() {
  // A fish jumping somewhere out on the water (lab: Рб1 "Далекий сплеск"): quiet, muffled by the distance.
  const pan = rand(-0.6, 0.6);
  wash({ buffer: brown, type: "lowpass", from: vary(900, 0.08), to: 200, attack: 0.004, length: 0.25, volume: 0.07, pan });
  droplets(2, 0.08, 0.25, 0.012);
}

/** A bird's note: a sine sweeping from one pitch to another, optionally with a quick vibrato. */
function chirp({ delay = 0, from, to, length, level = 0.03, pan = 0, vibrato = 0 }) {
  const at = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + length);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const depth = ctx.createGain();
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(at);
    lfo.stop(at + length + 0.02);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + length * 0.2);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(out(1, pan));
  osc.start(at);
  osc.stop(at + length + 0.02);
}

/*
 * Songbirds by day (lab: Пт1–Пт4), one of four at random, from somewhere off
 * to one side: a chaffinch-like trill, a tit's "tsi-fee", a reed warbler's
 * chatter, an oriole's fluted call.
 */
const BIRDS = [
  (pan) => {
    for (let i = 0; i < 9; i += 1) chirp({ delay: i * 0.07, from: 4200 - i * 120, to: 3600 - i * 120, length: 0.06, level: 0.022, pan });
    chirp({ delay: 0.7, from: 3000, to: 4800, length: 0.18, level: 0.025, pan });
  },
  (pan) => {
    for (let i = 0; i < 3; i += 1) {
      chirp({ delay: i * 0.38, from: 5200, to: 5000, length: 0.1, level: 0.022, pan });
      chirp({ delay: i * 0.38 + 0.14, from: 3900, to: 3700, length: 0.14, level: 0.022, pan });
    }
  },
  (pan) => {
    let delay = 0;
    for (let i = 0; i < 12; i += 1) {
      const from = rand(2500, 5000);
      chirp({ delay, from, to: from * rand(0.7, 1.3), length: rand(0.04, 0.09), level: 0.015, pan, vibrato: Math.random() < 0.4 ? 300 : 0 });
      delay += rand(0.06, 0.13);
    }
  },
  (pan) => {
    chirp({ from: 1500, to: 2100, length: 0.18, level: 0.03, pan });
    chirp({ delay: 0.2, from: 2300, to: 1700, length: 0.16, level: 0.03, pan });
    chirp({ delay: 0.38, from: 1600, to: 1900, length: 0.28, level: 0.03, pan });
  },
];
let lastBird = -1;
function bird() {
  let pick = Math.floor(Math.random() * BIRDS.length);
  if (pick === lastBird) pick = (pick + 1) % BIRDS.length;
  lastBird = pick;
  BIRDS[pick](rand(-0.8, 0.8));
}

/** A duck's quack: a buzzy, nasal sawtooth through two vowel-like resonances, dropping a little in pitch. */
function quack({ delay = 0, freq = 380, length = 0.16, level = 0.06, pan = 0 }) {
  const at = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.78, at + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(level, at + 0.015);
  gain.gain.setValueAtTime(level, at + length * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  for (const [formant, q, part] of [[1100, 6, 1], [2500, 8, 0.5]]) {
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = formant;
    filter.Q.value = q;
    const amount = ctx.createGain();
    amount.gain.value = part * 4;
    osc.connect(filter).connect(amount).connect(gain);
  }
  gain.connect(out(1, pan));
  osc.start(at);
  osc.stop(at + length + 0.02);
}

function duck() {
  // Ducks out on the water (lab: Кч2 or Кч3): a quiet contented mutter, or a single quack.
  const pan = rand(-0.5, 0.5);
  if (Math.random() < 0.6) for (let i = 0; i < 4; i += 1) quack({ delay: i * vary(0.14, 0.1), freq: vary(260, 0.1), length: 0.08, level: 0.03, pan });
  else quack({ freq: vary(400, 0.08), length: 0.17, level: 0.05, pan });
}

function cricket() {
  // A cricket (lab: Цв1 "Поодинокі"): a short trill of four pulses at one high pitch, somewhere off to the side.
  const pan = rand(-0.9, 0.9);
  const freq = rand(4200, 4800);
  for (let i = 0; i < 4; i += 1) chirp({ delay: i * 0.045, from: freq, to: freq, length: 0.025, level: 0.008, pan });
}

/** A soft hoot: a low sine that swells and fades, slightly breathy. */
function hoot(freq, length, level, pan, delay = 0) {
  chirp({ delay, from: freq, to: freq * 0.92, length, level, pan });
  wash({ type: "bandpass", from: freq * 2, q: 4, attack: length * 0.3, length, volume: level * 0.15, pan, delay });
}

function owl() {
  // A little owl deep in the night (lab: Св1 "Сич"): two quiet hoots.
  const pan = rand(-0.8, 0.8);
  hoot(440, 0.3, 0.05, pan);
  hoot(420, 0.35, 0.05, pan, 0.5);
}

function thunder() {
  // Far thunder in a heavy downpour (lab: Гр1 "Гуркіт"): a low rumble rolling on for a few seconds.
  const at = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = brown;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 140;
  const steps = 120;
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) curve[i] = 0.3 * Math.sin(Math.PI * (i / (steps - 1))) ** 1.5 * rand(0.6, 1);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.setValueCurveAtTime(curve, at, 3);
  source.connect(filter).connect(gain).connect(master);
  source.start(at, rand(0, 1), 3.05);
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
export function ambienceTick(step, { atWater, rain, night, ducks = 0 }) {
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
  // A fish jumping out on the water now and then, day or night.
  if (atWater && ambient.jump <= 0) {
    ambient.jump = rand(20, 60);
    fishJump();
  }
  // Ducks on the water mutter or quack once in a while.
  if (atWater && ducks > 0 && ambient.duck <= 0) {
    ambient.duck = rand(12, 30);
    duck();
  }
  if (atWater && night && rain < 0.3 && ambient.cricket <= 0) {
    ambient.cricket = rand(0.8, 3);
    cricket();
  }
  // An owl now and then deep in the night.
  if (atWater && night && rain < 0.3 && ambient.owl <= 0) {
    ambient.owl = rand(60, 150);
    owl();
  }
  // Far thunder, only in a heavy downpour.
  if (rain > 0.7 && ambient.thunder <= 0) {
    ambient.thunder = rand(40, 90);
    thunder();
  }
  // Rain: drops landing on the water all around, more as it gets heavier.
  if (rain > 0.05 && ambient.drop <= 0) {
    ambient.drop = rand(0.01, 0.06) / rain;
    bubble(rand(600, 1600), rand(0.006, 0.02) * (0.4 + rain), 0, rand(-0.9, 0.9));
  }
}

/*
 * The interface plays its taps by itself: a click on any button, a tab, a
 * pick, the spot arrows; a window opening or closing plays its own sound
 * instead of the click that opened it.
 */
let pendingClick = 0;
document.addEventListener("click", (event) => {
  const button = event.target.closest?.("button");
  if (!button || button.disabled) return;
  const kind = button.classList.contains("tab") ? "tab"
    : button.classList.contains("pick") ? "select"
    : button.classList.contains("spot-arrow") ? "slide"
    : "click";
  // Played a moment later, so a window that opens or closes from this click can take its place.
  clearTimeout(pendingClick);
  pendingClick = setTimeout(() => sounds.ui(kind), 0);
}, true);
const watchDialogs = new MutationObserver((changes) => {
  for (const change of changes) {
    if (change.attributeName !== "open") continue;
    clearTimeout(pendingClick);
    sounds.ui(change.target.open ? "open" : "close");
    return;
  }
});
const startWatching = () => document.querySelectorAll("dialog").forEach((dialog) => watchDialogs.observe(dialog, { attributes: true, attributeFilter: ["open"] }));
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startWatching);
else startWatching();
