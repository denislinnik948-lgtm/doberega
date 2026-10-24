/*
 * Sound lab: candidates for each game sound, synthesized live with Web Audio,
 * to listen to side by side and pick. Each section is one sound from the list
 * (by its id); each candidate has a number to name when choosing.
 */

let ctx = null;
let master = null;
let noise = null;
let brown = null;

function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = Number(document.querySelector("#volume").value);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    master.connect(limiter).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    brown = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const data = noise.getChannelData(0);
    const deep = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.random() * 2 - 1;
      // Brown noise: deep and soft, the body of water.
      last = (last + 0.02 * data[i]) / 1.02;
      deep[i] = last * 3.5;
    }
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

document.querySelector("#volume").addEventListener("input", (event) => {
  if (master) master.gain.value = Number(event.target.value);
});

const varied = () => document.querySelector("#vary").checked;
const jitter = (value, amount = 0.08) => (varied() ? value * (1 + (Math.random() * 2 - 1) * amount) : value);

/**
 * How fast the rod tip moves through a swing, 0..1 over `steps` points:
 * an accelerating rise to the peak at `peakAt`, then a quick stop.
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
 * the thin tip on top.
 */
function swish({ at = 0, duration, peakAt = 0.7, low, high, q = 1, whistle = 0, level = 0.5, pan = 0 }) {
  const start = ctx.currentTime + at;
  const speed = speedCurve(peakAt);
  const freqs = speed.map((s) => low + (high - low) * s);
  const gains = speed.map((s) => level * s);
  const out = ctx.createStereoPanner();
  out.pan.value = pan;
  out.connect(master);
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
    source.connect(filter).connect(gain).connect(out);
    source.start(start, Math.random() * 2, duration + 0.05);
  };
  layer(q, 1, 1);
  if (whistle) layer(9, 1.9, whistle);
}

/** Line peeling off the spool as the bait flies: a faint, fluttering high hiss that dies away. */
function linePeel({ at = 0, duration, level = 0.06, flutter = 45 }) {
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(5200, start);
  filter.frequency.exponentialRampToValueAtTime(3200, start + duration);
  filter.Q.value = 1.4;
  const gain = ctx.createGain();
  const steps = 160;
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    // The spool's flutter: the hiss pulses as each coil leaves, slowing as the bait slows.
    const pulse = 0.65 + 0.35 * Math.sin(t * duration * flutter * (1 - 0.6 * t) * Math.PI * 2);
    curve[i] = level * Math.min(1, t * 12) * (1 - t) ** 1.6 * pulse;
  }
  gain.gain.value = 0;
  gain.gain.setValueCurveAtTime(curve, start, duration);
  source.connect(filter).connect(gain).connect(master);
  source.start(start, Math.random() * 2, duration + 0.05);
}

/**
 * One bubble: a sine whose pitch shoots up as it closes, gone in a few
 * hundredths of a second. The basic sound of water. `muffle` puts it under water.
 */
function bubble({ at = 0, freq, rise = 2.3, length = 0.05, level = 0.2, pan = 0, muffle = 0 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(freq * rise, start + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  let tail = gain;
  if (muffle) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900 - 600 * muffle;
    gain.connect(filter);
    tail = filter;
  }
  osc.connect(gain);
  tail.connect(panner).connect(master);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** Filtered noise with a quick rise and a fall to silence: the body of a splash or a slap. */
function wash({ at = 0, type = "lowpass", from, to = from, q = 0.7, attack = 0.006, length, level, pan = 0, deep = false }) {
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = deep ? brown : noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), start + length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  source.connect(filter).connect(gain).connect(panner).connect(master);
  source.start(start, Math.random() * 2, length + 0.05);
}

/** A scatter of small drops falling back after a splash. */
function droplets({ count, from = 0.04, to = 0.3, level = 0.05 }) {
  for (let i = 0; i < count; i += 1) {
    bubble({ at: from + Math.random() * (to - from), freq: 600 + Math.random() * 900, rise: 1.8 + Math.random(), length: 0.025 + Math.random() * 0.03, level: level * (0.4 + Math.random() * 0.6), pan: Math.random() * 0.4 - 0.2 });
  }
}

/**
 * A stretch of reeling, for listening: `click(at)` is one click of the
 * ratchet, played every `interval` seconds (a little uneven, as a real reel
 * is) for `seconds`, with an optional soft hum of the gears under it.
 */
function reeling({ seconds = 1.6, interval, unevenness = 0.15, click, hum = 0, humFreq = 90 }) {
  let at = 0;
  while (at < seconds) {
    click(at);
    at += interval * (1 + (Math.random() * 2 - 1) * unevenness);
  }
  if (hum) {
    const start = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = humFreq * 4;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(hum, start + 0.15);
    gain.gain.setValueAtTime(hum, start + seconds - 0.2);
    gain.gain.linearRampToValueAtTime(0, start + seconds);
    // The gears' rhythm: the hum swells and dips with each turn of the handle.
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 3.2;
    const depth = ctx.createGain();
    depth.gain.value = hum * 0.5;
    wobble.connect(depth).connect(gain.gain);
    source.connect(filter).connect(gain).connect(master);
    source.start(start, Math.random(), seconds + 0.1);
    wobble.start(start);
    wobble.stop(start + seconds + 0.1);
  }
}

/**
 * A whir: a spinning reel's rotor and gears, as filtered noise whose loudness
 * pulses with the turning (`rate` times a second), for `seconds`.
 */
function whir({ seconds = 1.6, freq, q = 1.5, level, rate, depth = 0.5, type = "bandpass" }) {
  const start = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.12);
  gain.gain.setValueAtTime(level, start + seconds - 0.18);
  gain.gain.linearRampToValueAtTime(0, start + seconds);
  const pulse = ctx.createGain();
  pulse.gain.value = 1;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = rate;
  const amount = ctx.createGain();
  amount.gain.value = depth;
  lfo.connect(amount).connect(pulse.gain);
  source.connect(filter).connect(pulse).connect(gain).connect(master);
  source.start(start, Math.random(), seconds + 0.1);
  lfo.start(start);
  lfo.stop(start + seconds + 0.1);
}

/** One short click: a burst of noise through a narrow band (bright for metal, low for wood). */
function tick(at, { freq, q = 3, length = 0.012, level = 0.1, ring = 0 }) {
  wash({ at, type: "bandpass", from: freq * (1 + (Math.random() - 0.5) * 0.15), q, attack: 0.0008, length, level });
  if (ring) bubble({ at, freq: freq * 1.6, rise: 1.02, length: 0.04, level: ring });
}

/** A few of the same sound in a row, at roughly `gap` seconds apart, as they come in a fight. */
function series(count, gap, play) {
  for (let i = 0; i < count; i += 1) play(i * gap * (0.8 + Math.random() * 0.4));
}

/** A plucked string: a tone with bright overtones that die fast, as taut line twangs. */
function pluck({ at = 0, freq, length, level }) {
  const start = ctx.currentTime + at;
  for (const [ratio, part] of [[1, 1], [2, 0.5], [3, 0.3], [4.2, 0.15]]) {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq * ratio, start);
    osc.frequency.exponentialRampToValueAtTime(freq * ratio * 0.85, start + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level * part, start + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length / ratio);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }
}

/** A small piece of metal ringing: inharmonic partials that fade at different speeds. */
function bell({ at = 0, freq, level, length }) {
  const start = ctx.currentTime + at;
  for (const [ratio, part] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level * part, start + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length / ratio);
    osc.connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + length + 0.02);
  }
}

/** Metal bending under strain: a rough, rising creak of quick little grinds. */
function creak({ at = 0, length, level, low = 900, high = 2300, step = 0.018 }) {
  const grinds = Math.round(length / step);
  for (let i = 0; i < grinds; i += 1) {
    const t = i / grinds;
    wash({ at: at + i * step, type: "bandpass", from: low + (high - low) * t, q: 8, attack: 0.001, length: step * 0.9, level: level * (0.5 + 0.5 * Math.random()) });
  }
}

/** Line or a drag zipping: a narrow band of noise sliding from one pitch to another. */
function zip({ at = 0, length, from, to, level, q = 4 }) {
  wash({ at, type: "bandpass", from, to, q, attack: Math.min(0.02, length * 0.2), length, level });
}

/** A soft wooden tap: a short knock with a little body under it. */
function knock({ at = 0, freq, level }) {
  wash({ at, type: "bandpass", from: freq, q: 4, attack: 0.001, length: 0.04, level });
  bubble({ at, freq: freq * 0.5, rise: 0.92, length: 0.05, level: level * 0.5 });
}

/** A soft, rounded blip (a square tone, filtered so it isn't harsh), for the pixel set. */
function blip({ at = 0, freq, to = freq, length = 0.06, level }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(freq, start);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, start + length);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(filter).connect(gain).connect(master);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/*
 * Interface sounds come as whole sets, so they sound like one family: each
 * set has the same seven events. Pick one set.
 */
const UI_EVENTS = [
  ["click", "Кнопка"],
  ["tab", "Вкладка"],
  ["open", "Відкрити вікно"],
  ["close", "Закрити вікно"],
  ["slide", "Гортання локацій"],
  ["select", "Вибір (вудка, гачок)"],
  ["denied", "Не можна"],
];

const UI_SETS = [
  {
    id: "ui.wood",
    prefix: "У1.",
    title: "Інтерфейс · Дерево",
    note: "М'які дерев'яні постукування, як дерев'яний ящик зі снастями.",
    play: {
      click: () => knock({ freq: jitter(1100), level: 0.08 }),
      tab: () => knock({ freq: jitter(1400), level: 0.06 }),
      open: () => { knock({ freq: 800, level: 0.07 }); knock({ at: 0.07, freq: 1150, level: 0.06 }); },
      close: () => { knock({ freq: 1150, level: 0.06 }); knock({ at: 0.07, freq: 800, level: 0.07 }); },
      slide: () => wash({ type: "bandpass", from: 700, to: 1500, q: 0.9, attack: 0.04, length: 0.18, level: 0.05 }),
      select: () => { knock({ freq: 1250, level: 0.07 }); bell({ at: 0.03, freq: 2200, level: 0.012, length: 0.2 }); },
      denied: () => { knock({ freq: 420, level: 0.1 }); knock({ at: 0.1, freq: 380, level: 0.09 }); },
    },
  },
  {
    id: "ui.paper",
    prefix: "У2.",
    title: "Інтерфейс · Папір і трава",
    note: "Тихі шелести й шурхоти, як блокнот рибалки.",
    play: {
      click: () => wash({ type: "highpass", from: jitter(3800), q: 0.7, attack: 0.001, length: 0.02, level: 0.06 }),
      tab: () => wash({ type: "bandpass", from: 2200, to: 3600, q: 1, attack: 0.01, length: 0.08, level: 0.05 }),
      open: () => wash({ type: "bandpass", from: 900, to: 2600, q: 0.8, attack: 0.06, length: 0.22, level: 0.06 }),
      close: () => wash({ type: "bandpass", from: 2600, to: 900, q: 0.8, attack: 0.03, length: 0.18, level: 0.06 }),
      slide: () => wash({ type: "bandpass", from: 1500, to: 3000, q: 0.7, attack: 0.05, length: 0.2, level: 0.05 }),
      select: () => { wash({ type: "highpass", from: 3500, q: 0.7, attack: 0.001, length: 0.02, level: 0.05 }); bubble({ at: 0.01, freq: 900, rise: 1.6, length: 0.03, level: 0.04 }); },
      denied: () => wash({ type: "lowpass", from: 500, to: 180, attack: 0.002, length: 0.12, level: 0.14, deep: true }),
    },
  },
  {
    id: "ui.pixel",
    prefix: "У3.",
    title: "Інтерфейс · Піксель",
    note: "М'які ретро-«біпи», як у піксельних іграх, але приглушені.",
    play: {
      click: () => blip({ freq: 880, length: 0.04, level: 0.04 }),
      tab: () => blip({ freq: 1175, length: 0.035, level: 0.03 }),
      open: () => { blip({ freq: 660, length: 0.05, level: 0.035 }); blip({ at: 0.05, freq: 990, length: 0.07, level: 0.035 }); },
      close: () => { blip({ freq: 990, length: 0.05, level: 0.035 }); blip({ at: 0.05, freq: 660, length: 0.07, level: 0.035 }); },
      slide: () => blip({ freq: 520, to: 780, length: 0.09, level: 0.03 }),
      select: () => { blip({ freq: 1047, length: 0.04, level: 0.035 }); blip({ at: 0.045, freq: 1568, length: 0.06, level: 0.03 }); },
      denied: () => { blip({ freq: 220, length: 0.08, level: 0.05 }); blip({ at: 0.1, freq: 196, length: 0.1, level: 0.05 }); },
    },
  },
];

function uiPacks() {
  return UI_SETS.map((set) => ({
    id: set.id,
    prefix: set.prefix,
    chosen: set.id === "ui.wood" ? UI_EVENTS.map((_, i) => i) : [],
    // The other interface sets lost to "Дерево": decided, so they sit with the done ones.
    settled: set.id !== "ui.wood",
    title: set.title,
    note: `${set.note} Обери набір цілком.`,
    sounds: UI_EVENTS.map(([event, name]) => ({ name, text: event, play: set.play[event] })),
  }));
}

/** One coin clinking: inharmonic partials, like real metal. */
function coin({ at = 0, freq, level = 0.04 }) {
  bell({ at, freq: jitter(freq, 0.03), level, length: 0.16 });
}

/**
 * A bird's note: a sine whose pitch sweeps from `from` to `to`, with a quick
 * vibrato, as small songbirds sing.
 */
function chirp({ at = 0, from, to, length, level = 0.03, pan = 0, vibrato = 0 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, start);
  osc.frequency.exponentialRampToValueAtTime(to, start + length);
  if (vibrato) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 38;
    const depth = ctx.createGain();
    depth.gain.value = vibrato;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(start + length + 0.02);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + length * 0.2);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  osc.connect(gain).connect(panner).connect(master);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/**
 * A duck's quack: a buzzy, nasal tone (a sawtooth through two vowel-like
 * resonances) that drops a little in pitch.
 */
function quack({ at = 0, freq = 380, length = 0.16, level = 0.06, pan = 0 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.78, start + length);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.015);
  gain.gain.setValueAtTime(level, start + length * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  for (const [formant, q, part] of [[1100, 6, 1], [2500, 8, 0.5]]) {
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = formant;
    filter.Q.value = q;
    const amount = ctx.createGain();
    amount.gain.value = part * 4;
    osc.connect(filter).connect(amount).connect(gain);
  }
  gain.connect(panner).connect(master);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** A croak: a low buzzy tone pulsed many times a second, through a throat-like resonance. */
function croak({ at = 0, freq = 140, pulses = 22, length = 0.35, level = 0.05, bend = 1, pan = 0, formant = 700 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(freq, start);
  osc.frequency.linearRampToValueAtTime(freq * bend, start + length);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = formant;
  filter.Q.value = 3;
  const pulse = ctx.createGain();
  pulse.gain.value = 0.5;
  const lfo = ctx.createOscillator();
  lfo.type = "square";
  lfo.frequency.value = pulses;
  const depth = ctx.createGain();
  depth.gain.value = 0.5;
  lfo.connect(depth).connect(pulse.gain);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.03);
  gain.gain.setValueAtTime(level, start + length * 0.75);
  gain.gain.linearRampToValueAtTime(0, start + length);
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  osc.connect(filter).connect(pulse).connect(gain).connect(panner).connect(master);
  osc.start(start);
  osc.stop(start + length + 0.05);
  lfo.start(start);
  lfo.stop(start + length + 0.05);
}

/**
 * One croak of a marsh frog: a dry rattle of quick pulses, each a click with a
 * throaty resonance. Notes come faster and faster, like a laugh.
 */
function rattle({ at = 0, notes = 6, from = 0.12, to = 0.07, level = 1, pan = 0 }) {
  let time = at;
  for (let n = 0; n < notes; n += 1) {
    const pulses = 5 + Math.floor(Math.random() * 3);
    const base = 520 + Math.random() * 120;
    for (let p = 0; p < pulses; p += 1) {
      const t = time + p * 0.011;
      wash({ at: t, type: "bandpass", from: 1300, q: 5, attack: 0.0008, length: 0.008, level: 0.05 * level, pan });
      bubble({ at: t, freq: base, rise: 0.95, length: 0.014, level: 0.05 * level, pan });
    }
    time += from + (to - from) * (n / Math.max(1, notes - 1));
  }
}

/** One "kek" of a tree frog: a short high note buzzing at a low rate inside. */
function kek({ at = 0, freq, pan = 0 }) {
  for (let p = 0; p < 5; p += 1) chirp({ at: at + p * 0.007, from: freq, to: freq * 0.97, length: 0.006, level: 0.03, pan });
}

/** A ghostly echo: whatever is connected fades back again and again, off to the sides. */
function echoBus(delay = 0.32, feedback = 0.45, wet = 0.6) {
  const input = ctx.createGain();
  const echo = ctx.createDelay(2);
  echo.delayTime.value = delay;
  const back = ctx.createGain();
  back.gain.value = feedback;
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 2200;
  const out = ctx.createGain();
  out.gain.value = wet;
  input.connect(master);
  input.connect(echo).connect(damp).connect(back).connect(echo);
  damp.connect(out).connect(master);
  return input;
}

/** A sung, wordless note: a sine with a slow vibrato through a soft vowel resonance. */
function hum({ at = 0, freq, length, level, destination = master }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5;
  const depth = ctx.createGain();
  depth.gain.value = freq * 0.012;
  lfo.connect(depth).connect(osc.frequency);
  const vowel = ctx.createBiquadFilter();
  vowel.type = "bandpass";
  vowel.frequency.value = 800;
  vowel.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + length * 0.3);
  gain.gain.linearRampToValueAtTime(0, start + length);
  osc.connect(vowel).connect(gain).connect(destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
  lfo.start(start);
  lfo.stop(start + length + 0.05);
}

/** A voiced animal call: a buzzy tone with a pitch contour, through one or two vowel-like resonances. */
function voice({ at = 0, contour, length, level, formants = [[700, 4]], type = "sawtooth", pan = 0, muffle = 0 }) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueCurveAtTime(Float32Array.from(contour), start, length);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + Math.min(0.03, length * 0.2));
  gain.gain.setValueAtTime(level, start + length * 0.7);
  gain.gain.linearRampToValueAtTime(0, start + length);
  const mix = ctx.createGain();
  for (const [freq, q] of formants) {
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    osc.connect(filter).connect(mix);
  }
  let tail = mix;
  if (muffle) {
    // Far away: the highs are lost to the distance.
    const far = ctx.createBiquadFilter();
    far.type = "lowpass";
    far.frequency.value = 1800 - 1200 * muffle;
    mix.connect(far);
    tail = far;
  }
  const panner = ctx.createStereoPanner();
  panner.pan.value = pan;
  tail.connect(gain).connect(panner).connect(master);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

/** A big bell far away: low inharmonic partials with a long, uneven fade. */
function bigBell({ at = 0, freq = 220, level = 0.05, length = 4 }) {
  for (const [ratio, part, decay] of [[0.5, 0.6, 1], [1, 1, 0.8], [1.19, 0.5, 0.6], [1.5, 0.35, 0.45], [2, 0.3, 0.35], [2.74, 0.2, 0.25]]) {
    const start = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq * ratio;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level * part, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length * decay);
    const far = ctx.createBiquadFilter();
    far.type = "lowpass";
    far.frequency.value = 1400;
    osc.connect(far).connect(gain).connect(master);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }
}

/* ---------- Music: generated lo-fi, scheduled bar by bar into its own fader ---------- */

const NOTE = (name) => {
  const names = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
  const [, pitch, octave] = name.match(/^([A-G][#b]?)(-?\d)$/);
  return 440 * 2 ** ((names[pitch] + (Number(octave) + 1) * 12 - 69) / 12);
};

/** A music track's own output: a fader (to stop it) with a soft lowpass and a little tape warble. */
function musicBus() {
  const fader = ctx.createGain();
  fader.gain.value = 0.9;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3200;
  fader.connect(tone).connect(master);
  return fader;
}

/** Electric piano: a bell-ish sine with a soft second partial, fading, with a slight tremolo. */
function epiano(bus, freq, at, length, level = 0.03) {
  const start = ctx.currentTime + at;
  for (const [ratio, part, decay] of [[1, 1, 1], [2, 0.25, 0.4], [3.01, 0.08, 0.15]]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq * ratio;
    osc.detune.value = (Math.random() - 0.5) * 8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level * part, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length * decay + 0.05);
    osc.connect(gain).connect(bus);
    osc.start(start);
    osc.stop(start + length + 0.1);
  }
}

/** A plucked nylon string: a bright attack that mellows and dies away. */
function guitar(bus, freq, at, length = 1.6, level = 0.035) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = freq;
  const body = ctx.createOscillator();
  body.type = "sawtooth";
  body.frequency.value = freq;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(3000, start);
  filter.frequency.exponentialRampToValueAtTime(500, start + 0.4);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  const bodyGain = ctx.createGain();
  bodyGain.gain.value = 0.25;
  osc.connect(filter);
  body.connect(bodyGain).connect(filter);
  filter.connect(gain).connect(bus);
  for (const o of [osc, body]) {
    o.start(start);
    o.stop(start + length + 0.05);
  }
}

/** A warm pad: detuned soft saws, slowly swelling in and out. */
function pad(bus, freqs, at, length, level = 0.012) {
  const start = ctx.currentTime + at;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + length * 0.35);
  gain.gain.linearRampToValueAtTime(0, start + length);
  filter.connect(gain).connect(bus);
  for (const freq of freqs) {
    for (const detune of [-7, 7]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(start);
      osc.stop(start + length + 0.05);
    }
  }
}

/** A round, soft bass note. */
function bass(bus, freq, at, length, level = 0.07) {
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.02);
  gain.gain.setValueAtTime(level * 0.8, start + length * 0.6);
  gain.gain.linearRampToValueAtTime(0, start + length);
  osc.connect(gain).connect(bus);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

/** Soft lo-fi drums: a muffled kick, a brushed snare and a quiet hat. */
function drum(bus, kind, at) {
  const start = ctx.currentTime + at;
  if (kind === "kick") {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(110, start);
    osc.frequency.exponentialRampToValueAtTime(45, start + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    osc.connect(gain).connect(bus);
    osc.start(start);
    osc.stop(start + 0.32);
    return;
  }
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = kind === "hat" ? "highpass" : "bandpass";
  filter.frequency.value = kind === "hat" ? 7000 : 1800;
  filter.Q.value = kind === "hat" ? 0.7 : 0.8;
  const gain = ctx.createGain();
  const length = kind === "hat" ? 0.04 : 0.18;
  gain.gain.setValueAtTime(kind === "hat" ? 0.025 : 0.06, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  source.connect(filter).connect(gain).connect(bus);
  source.start(start, Math.random() * 2, length + 0.02);
}

/** Vinyl: a faint hiss and the odd crackle, under everything. */
function vinyl(bus, seconds) {
  const start = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = brown;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 1500;
  const gain = ctx.createGain();
  gain.gain.value = 0.02;
  source.connect(filter).connect(gain).connect(bus);
  source.start(start);
  source.stop(start + seconds);
  let t = 0;
  while (t < seconds) {
    const click = ctx.createBufferSource();
    click.buffer = noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02 + Math.random() * 0.03, start + t);
    g.gain.exponentialRampToValueAtTime(0.0001, start + t + 0.004);
    click.connect(g).connect(bus);
    click.start(start + t, Math.random() * 2, 0.006);
    t += -Math.log(Math.random()) * 0.25;
  }
}

/** Play a track: schedules everything, returns a function that fades it out and stops. */
function track(build) {
  const bus = musicBus();
  build(bus);
  return () => {
    bus.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
    setTimeout(() => bus.disconnect(), 1500);
  };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** A soft hoot: a low sine that swells and fades, slightly breathy. */
function hoot({ at = 0, freq = 420, to = freq * 0.92, length = 0.35, level = 0.05, pan = 0 }) {
  chirp({ at, from: freq, to, length, level, pan });
  wash({ at, type: "bandpass", from: freq * 2, q: 4, attack: length * 0.3, length, level: level * 0.15, pan });
}

/** A long swell of filtered noise: wind, a rustle, a rumble. */
function swell({ at = 0, type = "bandpass", freq, q = 0.8, length, level, deep = false, flutter = 0 }) {
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = deep ? brown : noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  const steps = 120;
  const curve = new Float32Array(steps);
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const shape = Math.sin(Math.PI * t) ** 1.5;
    curve[i] = level * shape * (flutter ? 1 - flutter + flutter * Math.random() : 1);
  }
  gain.gain.value = 0;
  gain.gain.setValueCurveAtTime(curve, start, length);
  source.connect(filter).connect(gain).connect(master);
  source.start(start, Math.random(), length + 0.05);
}

/** The same sound for a small fish, then (a second later) a big one. */
function bothSizes(play) {
  play(0, 0);
  play(1.1, 1);
}

/** A little to the left or right, as a fish moves about. */
const pan = () => Math.random() * 0.6 - 0.3;

/*
 * The candidates. `play` builds the sound fresh each time; with variation on,
 * pitch and length shift a little, as they will in the game.
 */
const SECTIONS = [
  {
    id: "cast.whoosh.short",
    prefix: "Б",
    chosen: [0],
    title: "Закид близько (знизу)",
    note: "Короткий змах знизу, наживка летить низько.",
    sounds: [
      {
        name: "М'який",
        text: "Тихий, повітряний, без різкого краю",
        play: () => swish({ duration: jitter(0.3), peakAt: 0.65, low: jitter(380), high: jitter(1300), q: 0.9, level: 0.55 }),
      },
      {
        name: "Хльосткий",
        text: "Швидкий змах із тонким свистом кінчика",
        play: () => swish({ duration: jitter(0.22), peakAt: 0.78, low: jitter(700), high: jitter(2800), q: 1.3, whistle: 0.35, level: 0.6 }),
      },
      {
        name: "Легкий і волосінь",
        text: "М'який змах, потім ледь чутно сходить волосінь",
        play: () => {
          swish({ duration: jitter(0.26), peakAt: 0.7, low: jitter(450), high: jitter(1600), q: 1, level: 0.5 });
          linePeel({ at: 0.18, duration: jitter(0.45), level: 0.045, flutter: 38 });
        },
      },
      {
        name: "Глухий",
        text: "Нижчий, ніби товста вудка, коротко",
        play: () => swish({ duration: jitter(0.28), peakAt: 0.7, low: jitter(250), high: jitter(900), q: 0.8, level: 0.65 }),
      },
    ],
  },
  {
    id: "cast.whoosh.long",
    prefix: "Д",
    chosen: [3],
    title: "Закид далеко (з-за голови)",
    note: "Замах назад, потім сильний змах уперед, і волосінь довго сходить, поки летить наживка.",
    sounds: [
      {
        name: "Плавний",
        text: "Тихий замах, рівний змах, волосінь",
        play: () => {
          swish({ duration: jitter(0.45), peakAt: 0.6, low: jitter(300), high: jitter(900), q: 0.9, level: 0.22, pan: -0.15 });
          swish({ at: 0.55, duration: jitter(0.38), peakAt: 0.72, low: jitter(500), high: jitter(1800), q: 1, level: 0.6 });
          linePeel({ at: 0.82, duration: jitter(0.75), level: 0.06, flutter: 46 });
        },
      },
      {
        name: "Різкий",
        text: "Короткий замах, хльосткий змах зі свистом",
        play: () => {
          swish({ duration: jitter(0.3), peakAt: 0.6, low: jitter(350), high: jitter(1100), q: 1, level: 0.2, pan: -0.15 });
          swish({ at: 0.38, duration: jitter(0.26), peakAt: 0.8, low: jitter(800), high: jitter(3200), q: 1.3, whistle: 0.45, level: 0.65 });
          linePeel({ at: 0.6, duration: jitter(0.8), level: 0.065, flutter: 52 });
        },
      },
      {
        name: "Важка вудка",
        text: "Нижчий, повільніший, більше повітря",
        play: () => {
          swish({ duration: jitter(0.55), peakAt: 0.6, low: jitter(220), high: jitter(700), q: 0.8, level: 0.25, pan: -0.15 });
          swish({ at: 0.65, duration: jitter(0.48), peakAt: 0.7, low: jitter(300), high: jitter(1100), q: 0.75, level: 0.7 });
          linePeel({ at: 1.0, duration: jitter(0.6), level: 0.05, flutter: 34 });
        },
      },
      {
        name: "Без замаху",
        text: "Один сильний змах і довга волосінь",
        play: () => {
          swish({ duration: jitter(0.34), peakAt: 0.74, low: jitter(600), high: jitter(2200), q: 1.1, whistle: 0.2, level: 0.62 });
          linePeel({ at: 0.24, duration: jitter(1.1), level: 0.07, flutter: 48 });
        },
      },
    ],
  },
  {
    id: "land.float",
    prefix: "П",
    chosen: [1],
    title: "Поплавок падає на воду",
    note: "Легкий поплавок із наживкою торкається води після закиду.",
    sounds: [
      {
        name: "Тихий плюп",
        text: "Одна маленька бульбашка й ледь чутний сплеск",
        play: () => {
          bubble({ freq: jitter(420), rise: 2.2, length: 0.05, level: 0.22 });
          wash({ type: "lowpass", from: jitter(1400), to: 300, length: 0.14, level: 0.12 });
        },
      },
      {
        name: "Чіткий «блуп»",
        text: "Глибша бульбашка, виразніше, пара крапель",
        play: () => {
          bubble({ freq: jitter(280), rise: 2.6, length: 0.07, level: 0.3 });
          wash({ type: "lowpass", from: jitter(1100), to: 250, length: 0.16, level: 0.14 });
          droplets({ count: 2, from: 0.06, to: 0.18, level: 0.05 });
        },
      },
      {
        name: "З бризками",
        text: "М'який плюп і кілька крапель, що падають назад",
        play: () => {
          bubble({ freq: jitter(380), rise: 2.3, length: 0.05, level: 0.2 });
          wash({ type: "lowpass", from: jitter(1700), to: 350, length: 0.2, level: 0.15 });
          wash({ type: "bandpass", from: 2400, to: 1200, q: 0.7, length: 0.09, level: 0.04 });
          droplets({ count: 5, from: 0.05, to: 0.32, level: 0.06 });
        },
      },
      {
        name: "Поплавок і грузило",
        text: "Плюп поплавка, а за мить глухий бульк грузила під водою",
        play: () => {
          bubble({ freq: jitter(480), rise: 2.2, length: 0.045, level: 0.2 });
          wash({ type: "lowpass", from: jitter(1300), to: 300, length: 0.12, level: 0.1 });
          bubble({ at: jitter(0.13), freq: jitter(230), rise: 2.4, length: 0.08, level: 0.22, muffle: 0.6 });
        },
      },
      {
        name: "М'який шльоп",
        text: "Більше «шльоп», ніж «блуп»: плоский удар об воду",
        play: () => {
          wash({ type: "lowpass", from: jitter(2200), to: 260, attack: 0.003, length: 0.17, level: 0.22 });
          bubble({ at: 0.03, freq: jitter(520), rise: 1.9, length: 0.035, level: 0.08 });
        },
      },
    ],
  },
  {
    id: "float.sink",
    prefix: "К",
    chosen: [0],
    title: "Кльов: поплавок іде під воду",
    note: "Риба взяла, поплавок пірнає. Сигнал підсікати: має бути чутним, але тихим і природним.",
    sounds: [
      {
        name: "Тихий бульк",
        text: "Маленька бульбашка, коротко",
        play: () => {
          bubble({ freq: jitter(620), rise: 2.2, length: 0.045, level: 0.16 });
          bubble({ at: 0.05, freq: jitter(900), rise: 2, length: 0.03, level: 0.06 });
        },
      },
      {
        name: "Затягнуло",
        text: "Поплавок втягує під воду: глибше, з повітрям, що виходить",
        play: () => {
          bubble({ freq: jitter(340), rise: 2.6, length: 0.08, level: 0.22, muffle: 0.3 });
          wash({ type: "lowpass", from: jitter(700), to: 180, length: 0.18, level: 0.08 });
          bubble({ at: 0.09, freq: jitter(700), rise: 2, length: 0.03, level: 0.06 });
        },
      },
      {
        name: "Два бульки",
        text: "Смикнуло й пішов: дві бульбашки одна за одною",
        play: () => {
          bubble({ freq: jitter(560), rise: 2.3, length: 0.04, level: 0.14 });
          bubble({ at: jitter(0.11), freq: jitter(430), rise: 2.6, length: 0.06, level: 0.2 });
        },
      },
      {
        name: "Тук і бульк",
        text: "Ледь чутний стук поплавка і бульбашка: чіткіший сигнал",
        play: () => {
          wash({ type: "bandpass", from: 1800, to: 1200, q: 2.5, attack: 0.001, length: 0.03, level: 0.12 });
          bubble({ at: 0.03, freq: jitter(500), rise: 2.4, length: 0.05, level: 0.18 });
        },
      },
      {
        name: "Шльоп і глухий бульк",
        text: "Легкий шльоп по воді, потім бульбашка вже з-під води",
        play: () => {
          wash({ type: "lowpass", from: jitter(1600), to: 300, attack: 0.003, length: 0.1, level: 0.12 });
          bubble({ at: 0.07, freq: jitter(300), rise: 2.5, length: 0.08, level: 0.2, muffle: 0.6 });
        },
      },
    ],
  },
  {
    id: "reel.float",
    prefix: "Р",
    chosen: [0],
    title: "Звичайна котушка (поплавочна вудка)",
    note: "Грає, поки змотуєш волосінь або тягнеш рибу. Тут 1,6 секунди змотування; у грі звук іде, доки тримаєш.",
    sounds: [
      {
        name: "Тріскачка",
        text: "Сухі пластикові клацання, часті й трохи нерівні",
        play: () => reeling({ interval: 0.07, click: (at) => tick(at, { freq: 3200, q: 2, level: 0.09 }) }),
      },
      {
        name: "Металеві клацання",
        text: "Дзвінкіші, рідші, з ледь чутним дзеньком",
        play: () => reeling({ interval: 0.1, click: (at) => tick(at, { freq: 4200, q: 4, level: 0.08, ring: 0.012 }) }),
      },
      {
        name: "Гул шестерень",
        text: "М'яке гудіння механізму й тихі клацання під ним",
        play: () => reeling({ interval: 0.09, unevenness: 0.1, click: (at) => tick(at, { freq: 2600, q: 2, level: 0.035 }), hum: 0.05, humFreq: 110 }),
      },
      {
        name: "Інерційна котушка",
        text: "Повільні глухі «тук» старої дерев'яної котушки",
        play: () => reeling({ interval: 0.16, unevenness: 0.2, click: (at) => tick(at, { freq: 900, q: 3, length: 0.02, level: 0.12 }) }),
      },
      {
        name: "Майже тиха",
        text: "Ледь чутний шелест механізму, рідкі клацання",
        play: () => reeling({ interval: 0.22, click: (at) => tick(at, { freq: 3000, q: 2, level: 0.03 }), hum: 0.025, humFreq: 140 }),
      },
    ],
  },
  {
    id: "reel.spin",
    prefix: "С",
    chosen: [3],
    title: "Спінінгова котушка",
    note: "Грає, поки ведеш приманку або тягнеш рибу на спінінгу. Гладша за звичайну: більше дзижчання ротора, менше клацань.",
    sounds: [
      {
        name: "Гладке дзижчання",
        text: "Рівний ротор, що пульсує з обертами, і дрібні тихі клацання",
        play: () => {
          whir({ freq: 1500, q: 1.6, level: 0.07, rate: 3.2, depth: 0.45 });
          reeling({ interval: 0.04, unevenness: 0.1, click: (at) => tick(at, { freq: 5200, q: 3, length: 0.006, level: 0.02 }) });
        },
      },
      {
        name: "Тихий шовк",
        text: "Високе м'яке шелестіння, без клацань",
        play: () => whir({ freq: 3200, q: 1.2, level: 0.05, rate: 3.5, depth: 0.35 }),
      },
      {
        name: "Шестерні",
        text: "Дзижчання з глибшим гулом передачі",
        play: () => {
          whir({ freq: 1200, q: 1.4, level: 0.06, rate: 3, depth: 0.5 });
          whir({ freq: 180, q: 4, level: 0.07, rate: 6, depth: 0.6 });
        },
      },
      {
        name: "Дрібна тріскачка",
        text: "Дуже часті крихітні клацання стопора, дзвінко",
        play: () => reeling({ interval: 0.033, unevenness: 0.08, click: (at) => tick(at, { freq: 4600, q: 3, length: 0.006, level: 0.045 }) }),
      },
      {
        name: "Ротор у повітрі",
        text: "Швидкі «вжик-вжик» ротора, що обертається",
        play: () => whir({ freq: 2000, q: 0.9, level: 0.08, rate: 9, depth: 0.85 }),
      },
    ],
  },
  {
    id: "fish.splash.small",
    prefix: "Ф",
    chosen: [0, 2],
    title: "Дрібна риба б'ється",
    note: "Сплески під час виведення дрібної риби (до кілограма). Тут коротка серія, як у бою.",
    sounds: [
      {
        name: "Дрібні хлюпи",
        text: "Легкі сплески з краплями",
        play: () => series(3, 0.35, (at) => {
          wash({ at, type: "lowpass", from: jitter(2200), to: 500, length: 0.12, level: 0.13, pan: pan() });
          droplets({ count: 3, from: at + 0.03, to: at + 0.18, level: 0.05 });
        }),
      },
      {
        name: "Бульбашки й плескіт",
        text: "Більше «бульк», риба крутиться під поверхнею",
        play: () => series(3, 0.4, (at) => {
          bubble({ at, freq: jitter(520), rise: 2.3, length: 0.05, level: 0.14 });
          bubble({ at: at + 0.05, freq: jitter(760), rise: 2, length: 0.035, level: 0.08 });
          wash({ at, type: "lowpass", from: jitter(1500), to: 400, length: 0.1, level: 0.08 });
        }),
      },
      {
        name: "Тріпотіння",
        text: "Швидкі удари хвостиком по воді",
        play: () => series(2, 0.55, (at) => {
          for (let i = 0; i < 6; i += 1) wash({ at: at + i * jitter(0.055), type: "bandpass", from: jitter(1700), to: 900, q: 0.8, length: 0.045, level: 0.07 });
          droplets({ count: 3, from: at + 0.05, to: at + 0.35, level: 0.04 });
        }),
      },
    ],
  },
  {
    id: "fish.splash.big",
    prefix: "В",
    chosen: [1],
    title: "Велика риба б'ється",
    note: "Сплески великої риби: важчі, глибші, рідші. Тут коротка серія, як у бою.",
    sounds: [
      {
        name: "Важкі сплески",
        text: "Глибоке тіло сплеску й великі краплі",
        play: () => series(2, 0.7, (at) => {
          wash({ at, type: "lowpass", from: jitter(1500), to: 160, length: 0.45, level: 0.32, deep: true, pan: pan() });
          wash({ at, type: "bandpass", from: 1800, to: 700, q: 0.6, length: 0.18, level: 0.06 });
          droplets({ count: 7, from: at + 0.06, to: at + 0.5, level: 0.07 });
        }),
      },
      {
        name: "Удар хвостом",
        text: "Різкий ляпас по воді й глибокий бульк",
        play: () => series(2, 0.8, (at) => {
          wash({ at, type: "lowpass", from: jitter(3000), to: 400, attack: 0.002, length: 0.12, level: 0.28, pan: pan() });
          bubble({ at: at + 0.06, freq: jitter(180), rise: 2.6, length: 0.12, level: 0.25, muffle: 0.4 });
          droplets({ count: 4, from: at + 0.1, to: at + 0.4, level: 0.05 });
        }),
      },
      {
        name: "Бурун",
        text: "Риба перевертається біля поверхні: довгий плескіт",
        play: () => series(2, 0.9, (at) => {
          wash({ at, type: "lowpass", from: jitter(900), to: 200, attack: 0.12, length: 0.7, level: 0.24, deep: true, pan: pan() });
          wash({ at: at + 0.1, type: "bandpass", from: 1400, to: 800, q: 0.7, attack: 0.08, length: 0.4, level: 0.05 });
          droplets({ count: 5, from: at + 0.2, to: at + 0.7, level: 0.05 });
        }),
      },
      {
        name: "Глибокий бульк",
        text: "Риба йде вглиб: великий глухий бульк і хвиля",
        play: () => series(2, 0.8, (at) => {
          bubble({ at, freq: jitter(150), rise: 2.8, length: 0.16, level: 0.3, muffle: 0.5 });
          wash({ at, type: "lowpass", from: jitter(800), to: 150, length: 0.35, level: 0.18, deep: true });
          bubble({ at: at + 0.12, freq: jitter(400), rise: 2.2, length: 0.06, level: 0.08 });
        }),
      },
    ],
  },
  {
    id: "fish.landed",
    prefix: "Л",
    chosen: [2],
    title: "Риба на березі",
    note: "Рибу витягли на берег. Кожен варіант грає двічі: спершу дрібна риба, потім велика.",
    sounds: [
      {
        name: "Шльоп на траву",
        text: "Мокрий шльоп і шелест трави",
        play: () => bothSizes((at, size) => {
          wash({ at, type: "lowpass", from: jitter(1800), to: 300, attack: 0.002, length: 0.1 + 0.08 * size, level: 0.18 + 0.12 * size, deep: size > 0.5 });
          wash({ at: at + 0.02, type: "highpass", from: 3500, to: 2500, attack: 0.02, length: 0.25, level: 0.03 });
        }),
      },
      {
        name: "Тріпається",
        text: "Кілька шльопків, що слабшають: риба б'ється на траві",
        play: () => bothSizes((at, size) => {
          const flops = 3 + Math.round(size * 2);
          for (let i = 0; i < flops; i += 1) wash({ at: at + i * jitter(0.13 + 0.05 * size), type: "lowpass", from: jitter(1600 - 500 * size), to: 250, attack: 0.002, length: 0.08 + 0.06 * size, level: (0.16 + 0.1 * size) * (1 - i / (flops + 1)), deep: size > 0.5 });
        }),
      },
      {
        name: "З води",
        text: "Вода стікає з риби, коли її піднімають, і м'який удар",
        play: () => bothSizes((at, size) => {
          droplets({ count: 6 + Math.round(size * 6), from: at, to: at + 0.45, level: 0.05 });
          wash({ at: at + 0.45, type: "lowpass", from: jitter(1200), to: 200, attack: 0.003, length: 0.12 + 0.1 * size, level: 0.16 + 0.12 * size, deep: true });
        }),
      },
      {
        name: "Глухий удар",
        text: "Лише м'який глухий удар об берег",
        play: () => bothSizes((at, size) => {
          wash({ at, type: "lowpass", from: jitter(700), to: 120, attack: 0.002, length: 0.12 + 0.12 * size, level: 0.25 + 0.15 * size, deep: true });
        }),
      },
    ],
  },
  {
    id: "line.snap",
    prefix: "О",
    chosen: [0],
    title: "Обрив волосіні",
    note: "Риба або корч порвали волосінь. Неприємний момент, але без гучного удару по вухах.",
    sounds: [
      {
        name: "Сухий тріск",
        text: "Різкий тріск і хльост ослаблої волосіні",
        play: () => {
          wash({ type: "highpass", from: 2600, q: 0.5, attack: 0.001, length: 0.04, level: 0.22 });
          wash({ at: 0.03, type: "bandpass", from: 2400, to: 500, q: 1.5, attack: 0.02, length: 0.25, level: 0.06 });
        },
      },
      {
        name: "Дзень волосіні",
        text: "Натягнута волосінь дзенькає, як струна, і обривається",
        play: () => {
          pluck({ freq: jitter(330), length: 0.45, level: 0.14 });
          wash({ type: "highpass", from: 3000, q: 0.5, attack: 0.001, length: 0.03, level: 0.12 });
        },
      },
      {
        name: "Ляск і сплеск",
        text: "Тріск, а вдалині риба б'є хвостом і йде",
        play: () => {
          wash({ type: "highpass", from: 2800, q: 0.5, attack: 0.001, length: 0.035, level: 0.18 });
          wash({ at: 0.25, type: "lowpass", from: 1600, to: 300, attack: 0.004, length: 0.2, level: 0.1, pan: 0.3 });
          droplets({ count: 3, from: 0.3, to: 0.5, level: 0.03 });
        },
      },
      {
        name: "Тихий обрив",
        text: "Ледь чутне «клац» і тиша",
        play: () => {
          wash({ type: "bandpass", from: 3200, q: 2, attack: 0.001, length: 0.025, level: 0.12 });
          wash({ at: 0.02, type: "highpass", from: 4000, to: 2500, attack: 0.03, length: 0.3, level: 0.025 });
        },
      },
    ],
  },
  {
    id: "hook.bend",
    prefix: "Г",
    chosen: [2],
    title: "Гачок розігнуло",
    note: "Риба заважка для гачка, і він розгинається: метал, а не волосінь.",
    sounds: [
      {
        name: "Металевий дзень",
        text: "Короткий високий дзенькіт металу",
        play: () => {
          bell({ freq: jitter(2400), level: 0.06, length: 0.35 });
          wash({ at: 0.02, type: "highpass", from: 3500, to: 2500, attack: 0.02, length: 0.25, level: 0.02 });
        },
      },
      {
        name: "Скрип і дзень",
        text: "Метал скрипить, гнучись, і відпускає з дзеньком",
        play: () => {
          creak({ length: 0.3, level: 0.06 });
          bell({ at: 0.3, freq: jitter(2100), level: 0.05, length: 0.3 });
        },
      },
      {
        name: "Клац і ослабло",
        text: "Тихе металеве «клац», і волосінь провисає",
        play: () => {
          wash({ type: "bandpass", from: 5200, q: 6, attack: 0.001, length: 0.02, level: 0.1 });
          bell({ at: 0.005, freq: jitter(3600), level: 0.025, length: 0.12 });
          wash({ at: 0.05, type: "bandpass", from: 1500, to: 600, q: 1, attack: 0.04, length: 0.3, level: 0.04 });
        },
      },
    ],
  },
  {
    id: "float.twitch",
    prefix: "Т",
    chosen: [0],
    title: "Поплавок смикається",
    note: "Риба торкається наживки: поплавок ледь здригається. Має бути зовсім тихо, на межі чутності. Тут три смикання поспіль.",
    sounds: [
      {
        name: "Ледь чутний «тік»",
        text: "Крихітна висока бульбашка",
        play: () => series(3, 0.45, (at) => bubble({ at, freq: jitter(950), rise: 1.8, length: 0.025, level: 0.05 })),
      },
      {
        name: "Брижі",
        text: "Тихий плескіт води біля поплавка",
        play: () => series(3, 0.45, (at) => wash({ at, type: "lowpass", from: jitter(1300), to: 500, attack: 0.01, length: 0.09, level: 0.05 })),
      },
      {
        name: "Тук поплавка",
        text: "Легкий стук пластикового поплавка",
        play: () => series(3, 0.45, (at) => wash({ at, type: "bandpass", from: jitter(1400), q: 3, attack: 0.001, length: 0.025, level: 0.06 })),
      },
    ],
  },
  {
    id: "float.dip",
    prefix: "Н",
    chosen: [1],
    title: "Поплавок пірнає на мить",
    note: "Поплавок занурився й виринув: тут уже можна пробувати підсікати. Трохи чутніше за смикання, тихіше за кльов. Тут два пірнання.",
    sounds: [
      {
        name: "Короткий бульк",
        text: "Одна бульбашка, коротко",
        play: () => series(2, 0.7, (at) => bubble({ at, freq: jitter(520), rise: 2.2, length: 0.04, level: 0.1 })),
      },
      {
        name: "Пірнув і виринув",
        text: "Глухий бульк під водою і легкий «пум», коли спливає",
        play: () => series(2, 0.7, (at) => {
          bubble({ at, freq: jitter(380), rise: 2.3, length: 0.05, level: 0.1, muffle: 0.5 });
          bubble({ at: at + 0.3, freq: jitter(700), rise: 1.8, length: 0.03, level: 0.05 });
        }),
      },
      {
        name: "Шльоп",
        text: "Маленький шльоп по воді",
        play: () => series(2, 0.7, (at) => wash({ at, type: "lowpass", from: jitter(1700), to: 400, attack: 0.003, length: 0.08, level: 0.09 })),
      },
    ],
  },
  {
    id: "land.lure",
    prefix: "Ш",
    chosen: [3],
    title: "Приманка падає на воду",
    note: "Блешня чи воблер після закиду: важча й щільніша за поплавок, входить у воду і йде вглиб.",
    sounds: [
      {
        name: "Важкий плюх",
        text: "Глибша бульбашка, сплеск і кілька крапель",
        play: () => {
          bubble({ freq: jitter(220), rise: 2.6, length: 0.08, level: 0.28 });
          wash({ type: "lowpass", from: jitter(1300), to: 220, length: 0.2, level: 0.18, deep: true });
          droplets({ count: 3, from: 0.06, to: 0.22, level: 0.05 });
        },
      },
      {
        name: "Шльоп",
        text: "Різкий шльоп металу об воду й бульбашка",
        play: () => {
          wash({ type: "lowpass", from: jitter(3200), to: 500, attack: 0.002, length: 0.09, level: 0.2 });
          bubble({ at: 0.03, freq: jitter(330), rise: 2.4, length: 0.06, level: 0.16 });
        },
      },
      {
        name: "Цюк",
        text: "Вузька приманка пірнає майже без сплеску: коротке «цюк»",
        play: () => {
          wash({ type: "bandpass", from: jitter(2400), to: 1200, q: 1.2, attack: 0.001, length: 0.04, level: 0.12 });
          bubble({ at: 0.01, freq: jitter(440), rise: 2.5, length: 0.05, level: 0.18 });
        },
      },
      {
        name: "Плюх і булькіт",
        text: "Входить у воду, і тихі бульбашки, поки тоне",
        play: () => {
          bubble({ freq: jitter(260), rise: 2.5, length: 0.07, level: 0.24 });
          wash({ type: "lowpass", from: jitter(1100), to: 250, length: 0.16, level: 0.13, deep: true });
          for (let i = 0; i < 4; i += 1) bubble({ at: 0.15 + i * jitter(0.12), freq: jitter(500 + i * 80), rise: 2, length: 0.03, level: 0.05, muffle: 0.6 });
        },
      },
    ],
  },
  {
    id: "lure.strike",
    prefix: "Х",
    chosen: [0],
    title: "Риба б'є приманку",
    note: "Хижак атакує блешню чи воблер під час проводки: різко, але не гучно, сигнал підсікати.",
    sounds: [
      {
        name: "Вир",
        text: "Вода закручується там, де вдарила риба",
        play: () => {
          wash({ type: "lowpass", from: jitter(900), to: 200, attack: 0.05, length: 0.4, level: 0.22, deep: true, pan: 0.15 });
          droplets({ count: 4, from: 0.05, to: 0.35, level: 0.05 });
        },
      },
      {
        name: "Удар",
        text: "Різкий сплеск і ковток",
        play: () => {
          wash({ type: "lowpass", from: jitter(2600), to: 350, attack: 0.002, length: 0.14, level: 0.24, pan: 0.15 });
          bubble({ at: 0.05, freq: jitter(200), rise: 2.7, length: 0.11, level: 0.22, muffle: 0.3 });
        },
      },
      {
        name: "Вибух на поверхні",
        text: "Щука вистрибує на приманку: багато бризок",
        play: () => {
          wash({ type: "lowpass", from: jitter(2200), to: 260, attack: 0.002, length: 0.3, level: 0.28, deep: true, pan: 0.15 });
          wash({ type: "bandpass", from: 2000, to: 900, q: 0.6, attack: 0.002, length: 0.15, level: 0.07 });
          droplets({ count: 9, from: 0.04, to: 0.55, level: 0.06 });
        },
      },
    ],
  },
  {
    id: "hookset",
    prefix: "З",
    chosen: [0],
    title: "Підсічка",
    note: "Мить, коли смикаєш вудку й засікаєш рибу: короткий рух і натяг.",
    sounds: [
      {
        name: "Різкий змах",
        text: "Короткий швидкий свист вудки вгору",
        play: () => swish({ duration: jitter(0.16), peakAt: 0.55, low: jitter(600), high: jitter(2400), q: 1.2, level: 0.45 }),
      },
      {
        name: "Натяг волосіні",
        text: "Волосінь різко натягується: коротке «ззіп»",
        play: () => zip({ length: 0.14, from: 900, to: 2600, level: 0.08 }),
      },
      {
        name: "Змах і розріз води",
        text: "Змах, і волосінь розрізає поверхню",
        play: () => {
          swish({ duration: jitter(0.18), peakAt: 0.55, low: jitter(500), high: jitter(1900), q: 1, level: 0.35 });
          wash({ at: 0.08, type: "bandpass", from: 2600, to: 1400, q: 1.3, attack: 0.01, length: 0.18, level: 0.06 });
        },
      },
      {
        name: "Змах і натяг",
        text: "Свист вудки й одразу «ззіп» волосіні",
        play: () => {
          swish({ duration: jitter(0.16), peakAt: 0.55, low: jitter(600), high: jitter(2200), q: 1.2, level: 0.35 });
          zip({ at: 0.09, length: 0.12, from: 1000, to: 2800, level: 0.06 });
        },
      },
    ],
  },
  {
    id: "reel.drag",
    prefix: "М",
    chosen: [2],
    title: "Фрикціон котушки",
    note: "Сильна риба тягне, і котушка стравлює волосінь з характерним тріском. Грає ривками, поки риба йде. Тут два ривки.",
    sounds: [
      {
        name: "Тріск фрикціону",
        text: "Дуже часті клацання, рівним «тррр»",
        play: () => series(2, 0.9, (at) => {
          for (let t = 0; t < 0.5; t += jitter(0.022, 0.1)) tick(at + t, { freq: 2900, q: 3, length: 0.008, level: 0.06 });
        }),
      },
      {
        name: "Вищання",
        text: "Гладке високе вищання з легким тріском під ним",
        play: () => series(2, 0.9, (at) => {
          zip({ at, length: 0.5, from: 2300, to: 2100, level: 0.05, q: 6 });
          for (let t = 0; t < 0.5; t += 0.03) tick(at + t, { freq: 3400, q: 3, length: 0.006, level: 0.02 });
        }),
      },
      {
        name: "Рвучкі ривки",
        text: "Риба тягне поштовхами: тріск то частішає, то стихає",
        play: () => series(2, 0.9, (at) => {
          let t = 0;
          while (t < 0.6) {
            const speed = 0.5 + 0.5 * Math.sin(t * 18);
            tick(at + t, { freq: 2700, q: 3, length: 0.008, level: 0.03 + 0.04 * speed });
            t += 0.018 + 0.03 * (1 - speed);
          }
        }),
      },
    ],
  },
  {
    id: "rod.creak",
    prefix: "Е",
    chosen: [0],
    title: "Вудка рипить під навантаженням",
    note: "Важка риба гне вудку до межі: рідкий тихий звук, коли натяг високий.",
    sounds: [
      {
        name: "Тихий скрип",
        text: "Низький скрип бланку, повільно",
        play: () => creak({ length: 0.45, level: 0.05, low: 300, high: 650, step: 0.03 }),
      },
      {
        name: "Потріскування",
        text: "Дрібні сухі тріски, ніби вудка от-от не витримає",
        play: () => {
          for (let i = 0; i < 6; i += 1) wash({ at: Math.random() * 0.5, type: "bandpass", from: 1500 + Math.random() * 1500, q: 5, attack: 0.001, length: 0.01, level: 0.06 });
        },
      },
      {
        name: "Стогін",
        text: "Довгий глухий стогін, як дерево під вагою",
        play: () => zip({ length: 0.7, from: 180, to: 260, level: 0.12, q: 12 }),
      },
    ],
  },
  {
    id: "snag.stuck",
    prefix: "Ж",
    chosen: [2],
    title: "Зачепився за корч",
    note: "Гачок зачепився під водою: замість риби глухий опір.",
    sounds: [
      {
        name: "Глухий натяг",
        text: "Глухий удар і низький натяг волосіні",
        play: () => {
          wash({ type: "lowpass", from: 500, to: 120, attack: 0.002, length: 0.12, level: 0.2, deep: true });
          zip({ at: 0.04, length: 0.3, from: 500, to: 700, level: 0.06, q: 6 });
        },
      },
      {
        name: "Тріск під водою",
        text: "Приглушений скрип гілки там, внизу",
        play: () => creak({ length: 0.35, level: 0.07, low: 250, high: 500, step: 0.025 }),
      },
      {
        name: "Дзинь волосіні",
        text: "Натягнута волосінь глухо дзенькає",
        play: () => pluck({ freq: jitter(180), length: 0.5, level: 0.1 }),
      },
    ],
  },
  {
    id: "snag.free",
    prefix: "Ч",
    chosen: [1],
    title: "Корч відпустив",
    note: "Дав слабину, і гачок відчепився: полегшення.",
    sounds: [
      {
        name: "Відпустило",
        text: "М'яке «пум» і кілька бульбашок угору",
        play: () => {
          bubble({ freq: jitter(260), rise: 2.2, length: 0.07, level: 0.14, muffle: 0.5 });
          for (let i = 0; i < 3; i += 1) bubble({ at: 0.1 + i * 0.09, freq: 500 + i * 120, rise: 2, length: 0.03, level: 0.05 });
        },
      },
      {
        name: "Шурхіт і бульк",
        text: "Шурхіт гілки й бульбашка",
        play: () => {
          wash({ type: "bandpass", from: 1800, to: 900, q: 0.8, attack: 0.02, length: 0.2, level: 0.05 });
          bubble({ at: 0.15, freq: jitter(420), rise: 2.3, length: 0.05, level: 0.12 });
        },
      },
    ],
  },
  {
    id: "lift.out",
    prefix: "А",
    chosen: [2],
    title: "Наживку підняли з води",
    note: "Порожню снасть змотали до берега й піднімають із води перед новим закидом.",
    sounds: [
      {
        name: "Капає",
        text: "Наживка виходить із води, з неї капає",
        play: () => {
          bubble({ freq: jitter(700), rise: 1.6, length: 0.03, level: 0.06 });
          droplets({ count: 4, from: 0.08, to: 0.5, level: 0.04 });
        },
      },
      {
        name: "Чмок",
        text: "Тихе «чмок», коли вода відпускає наживку",
        play: () => bubble({ freq: jitter(320), rise: 3, length: 0.06, level: 0.12 }),
      },
      {
        name: "Чмок і краплі",
        text: "«Чмок» і пара крапель слідом",
        play: () => {
          bubble({ freq: jitter(340), rise: 3, length: 0.06, level: 0.1 });
          droplets({ count: 2, from: 0.12, to: 0.35, level: 0.04 });
        },
      },
    ],
  },
  {
    id: "groundbait",
    prefix: "И",
    chosen: [0],
    title: "Кидок прикормки",
    note: "Жменя прикормки летить у воду й розсипається по поверхні.",
    sounds: [
      {
        name: "Розсип",
        text: "Багато дрібних плюскотів, як дощ у одному місці",
        play: () => {
          for (let i = 0; i < 18; i += 1) bubble({ at: 0.1 + Math.random() * 0.35, freq: 700 + Math.random() * 900, rise: 2, length: 0.025, level: 0.04, pan: Math.random() * 0.4 - 0.2 });
        },
      },
      {
        name: "Кулька",
        text: "Важка кулька прикормки: глухий плюх",
        play: () => {
          wash({ at: 0.1, type: "lowpass", from: 900, to: 180, attack: 0.003, length: 0.25, level: 0.22, deep: true });
          bubble({ at: 0.12, freq: jitter(200), rise: 2.6, length: 0.09, level: 0.16, muffle: 0.4 });
        },
      },
      {
        name: "Кулька й хмарка",
        text: "Плюх, а потім тихий шелест: прикормка розходиться у воді",
        play: () => {
          wash({ at: 0.1, type: "lowpass", from: 1000, to: 200, attack: 0.003, length: 0.22, level: 0.18, deep: true });
          for (let i = 0; i < 8; i += 1) bubble({ at: 0.3 + i * 0.07, freq: 600 + Math.random() * 500, rise: 1.9, length: 0.025, level: 0.025, muffle: 0.4 });
        },
      },
    ],
  },
  {
    id: "boot",
    prefix: "Ю",
    chosen: [2],
    title: "Старий чобіт",
    note: "Замість риби витягнув старий чобіт: трохи кумедно.",
    sounds: [
      {
        name: "Чвак",
        text: "Мокрий важкий «чвак» на березі",
        play: () => {
          wash({ type: "lowpass", from: 700, to: 150, attack: 0.002, length: 0.18, level: 0.25, deep: true });
          bubble({ at: 0.03, freq: 160, rise: 0.6, length: 0.12, level: 0.12 });
        },
      },
      {
        name: "Вода з чобота",
        text: "З чобота довго виливається вода",
        play: () => {
          for (let i = 0; i < 14; i += 1) bubble({ at: i * 0.05 + Math.random() * 0.03, freq: 300 + Math.random() * 400, rise: 1.7, length: 0.04, level: 0.06 });
          wash({ type: "lowpass", from: 800, to: 300, attack: 0.05, length: 0.7, level: 0.05 });
        },
      },
      {
        name: "Сумний «буп»",
        text: "Чвак і два низькі ноти, що сповзають донизу",
        play: () => {
          wash({ type: "lowpass", from: 700, to: 150, attack: 0.002, length: 0.15, level: 0.2, deep: true });
          bubble({ at: 0.2, freq: 330, rise: 0.94, length: 0.18, level: 0.07 });
          bubble({ at: 0.42, freq: 262, rise: 0.9, length: 0.3, level: 0.07 });
        },
      },
    ],
  },
  {
    id: "unique.catch",
    prefix: "Я",
    chosen: [0],
    title: "Валерка чи Артем",
    note: "Рідкісний жартівливий улов, один на десятки годин: коротка радісна несподіванка.",
    sounds: [
      {
        name: "Блиск",
        text: "Дзвіночки вгору, ніби щось чарівне",
        play: () => [784, 988, 1175, 1568].forEach((f, i) => bell({ at: i * 0.08, freq: f, level: 0.04, length: 0.6 })),
      },
      {
        name: "Ого!",
        text: "Тон, що здивовано злітає вгору, і дзвіночок",
        play: () => {
          bubble({ freq: 300, rise: 2.4, length: 0.35, level: 0.08 });
          bell({ at: 0.32, freq: 1568, level: 0.05, length: 0.7 });
        },
      },
      {
        name: "Маленька мелодія",
        text: "Три веселі ноти, як знахідка в грі",
        play: () => [[523, 0], [659, 0.12], [1047, 0.24]].forEach(([f, at]) => bell({ at, freq: f, level: 0.05, length: 0.5 })),
      },
    ],
  },
  {
    id: "frog",
    prefix: "Жб",
    chosen: [1],
    title: "Жаби (нова спроба)",
    note: "Біля ставка ввечері й теплої ночі. Тепер за справжніми видами: це не гудіння, а торохтіння з окремих імпульсів, писк чи тихе «уук».",
    sounds: [
      {
        name: "Озерна жаба",
        text: "Торохтливе «ке-ке-ке-ке», що прискорюється, як сміх",
        play: () => series(2, 1.1, (at) => rattle({ at, notes: 7, from: 0.12, to: 0.07, pan: pan() })),
      },
      {
        name: "Квакша",
        text: "Високе швидке «кек-кек-кек»",
        play: () => series(2, 1, (at) => { const side = pan(); for (let i = 0; i < 6; i += 1) kek({ at: at + i * 0.14, freq: jitter(1900, 0.03), pan: side }); }),
      },
      {
        name: "Жерлянка",
        text: "Тихе сумне «уук… уук…», як нічний ставок",
        play: () => { const side = pan(); for (let i = 0; i < 4; i += 1) hoot({ at: i * jitter(0.9, 0.1), freq: jitter(470, 0.03), to: 455, length: 0.22, level: 0.045, pan: side }); },
      },
      {
        name: "Хор озерних жаб",
        text: "Кілька озерних жаб перегукуються вдалині",
        play: () => { for (let k = 0; k < 4; k += 1) rattle({ at: Math.random() * 1.4, notes: 4 + Math.floor(Math.random() * 4), from: 0.13, to: 0.08, level: 0.5, pan: Math.random() * 1.4 - 0.7 }); },
      },
    ],
  },
  {
    id: "crickets",
    prefix: "Цв",
    chosen: [0],
    title: "Цвіркуни вночі",
    note: "Сухої ночі. Тут дві секунди.",
    sounds: [
      {
        name: "Поодинокі",
        text: "Окремі цвіркуни: короткі трелі тут і там",
        play: () => { for (let k = 0; k < 4; k += 1) { const at = Math.random() * 1.5; const f = 4200 + Math.random() * 600; const side = pan() * 2; for (let i = 0; i < 4; i += 1) chirp({ at: at + i * 0.045, from: f, to: f, length: 0.025, level: 0.008, pan: side }); } },
      },
      {
        name: "Хор цвіркунів",
        text: "Мерехтливий суцільний спів, далеко",
        play: () => { for (let k = 0; k < 6; k += 1) { const f = 4000 + Math.random() * 1200; const side = Math.random() * 1.6 - 0.8; for (let t = Math.random() * 0.1; t < 2; t += 0.05) chirp({ at: t, from: f, to: f, length: 0.022, level: 0.004, pan: side }); } },
      },
      {
        name: "Коник",
        text: "Високе тихе сюрчання",
        play: () => swell({ type: "bandpass", freq: 7000, q: 6, length: 2, level: 0.02, flutter: 0.6 }),
      },
    ],
  },
  {
    id: "owl",
    prefix: "Св",
    chosen: [0],
    title: "Сова",
    note: "Глибокої ночі, рідко.",
    sounds: [
      {
        name: "Сич",
        text: "Два тихі «ху-ху»",
        play: () => { const side = pan() * 2; hoot({ freq: 440, length: 0.3, pan: side }); hoot({ at: 0.5, freq: 420, length: 0.35, pan: side }); },
      },
      {
        name: "Сіра сова",
        text: "Протяжне «у-ху-у-у-у» з тремтінням",
        play: () => { const side = pan() * 2; hoot({ freq: 380, length: 0.5, pan: side }); for (let i = 0; i < 4; i += 1) hoot({ at: 0.9 + i * 0.13, freq: 360, length: 0.12, level: 0.035, pan: side }); hoot({ at: 1.5, freq: 380, to: 330, length: 0.6, pan: side }); },
      },
    ],
  },
  {
    id: "rain",
    prefix: "Дщ",
    chosen: [0],
    title: "Дощ",
    note: "Фон, поки йде дощ. Тут дві секунди помірного дощу.",
    sounds: [
      {
        name: "Краплі й гул",
        text: "Окремі краплі на воду й глибокий тихий гул (як зараз у грі)",
        play: () => { swell({ type: "lowpass", freq: 700, length: 2, level: 0.08, deep: true }); for (let t = 0; t < 2; t += 0.03 + Math.random() * 0.05) bubble({ at: t, freq: 600 + Math.random() * 1000, rise: 2, length: 0.025, level: 0.012, pan: Math.random() * 1.6 - 0.8 }); },
      },
      {
        name: "Шелест дощу",
        text: "М'який шелест по листю й траві, з краплями",
        play: () => { swell({ type: "bandpass", freq: 3000, q: 0.5, length: 2, level: 0.035, flutter: 0.3 }); for (let t = 0; t < 2; t += 0.05 + Math.random() * 0.08) bubble({ at: t, freq: 700 + Math.random() * 900, rise: 2, length: 0.025, level: 0.01, pan: Math.random() * 1.6 - 0.8 }); },
      },
      {
        name: "Злива",
        text: "Густий дощ: багато крапель і сильніший шум",
        play: () => { swell({ type: "lowpass", freq: 1200, length: 2, level: 0.12, deep: true }); swell({ type: "bandpass", freq: 2500, q: 0.5, length: 2, level: 0.03 }); for (let t = 0; t < 2; t += 0.012 + Math.random() * 0.02) bubble({ at: t, freq: 600 + Math.random() * 1200, rise: 2, length: 0.02, level: 0.01, pan: Math.random() * 1.8 - 0.9 }); },
      },
    ],
  },
  {
    id: "thunder.far",
    prefix: "Гр",
    chosen: [0],
    title: "Далекий грім",
    note: "Рідко, лише в сильну зливу.",
    sounds: [
      {
        name: "Гуркіт",
        text: "Низький далекий гуркіт, що котиться",
        play: () => { swell({ type: "lowpass", freq: 140, length: 3, level: 0.3, deep: true, flutter: 0.4 }); },
      },
      {
        name: "Розкат",
        text: "Приглушений тріск і довгий розкат",
        play: () => { wash({ type: "lowpass", from: 900, to: 150, attack: 0.01, length: 0.5, level: 0.15, deep: true }); swell({ at: 0.2, type: "lowpass", freq: 120, length: 3, level: 0.28, deep: true, flutter: 0.5 }); },
      },
    ],
  },
  {
    id: "wind",
    prefix: "Вт",
    chosen: [],
    // Not wanted in the game.
    settled: true,
    title: "Вітер і очерет",
    note: "Фон: рідкі пориви, коли вітер колише траву й очерет.",
    sounds: [
      {
        name: "Подих вітру",
        text: "М'який порив, що наростає й стихає",
        play: () => swell({ type: "bandpass", freq: 500, q: 0.6, length: 2.5, level: 0.06, deep: true }),
      },
      {
        name: "Шелест очерету",
        text: "Сухий шелест стебел",
        play: () => swell({ type: "bandpass", freq: 3200, q: 0.9, length: 1.8, level: 0.03, flutter: 0.5 }),
      },
      {
        name: "Вітер з очеретом",
        text: "Порив і шелест разом",
        play: () => { swell({ type: "bandpass", freq: 450, q: 0.6, length: 2.5, level: 0.05, deep: true }); swell({ at: 0.4, type: "bandpass", freq: 3000, q: 0.9, length: 1.8, level: 0.025, flutter: 0.5 }); },
      },
    ],
  },
  {
    id: "night.wisp",
    prefix: "Вг",
    chosen: [0],
    title: "Блукаючі вогники",
    note: "Ніч і містика: бліді вогники над тим берегом. Тихо, моторошно, але не страшно.",
    sounds: [
      {
        name: "Скляний дзвін",
        text: "Високі скляні тони, що тремтять і відлунюють",
        play: () => { const bus = echoBus(0.38, 0.5, 0.7); for (const [f, at] of [[1760, 0], [1767, 0], [2349, 0.4]]) { const start = ctx.currentTime + at; const osc = ctx.createOscillator(); osc.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(0.012, start + 0.4); g.gain.linearRampToValueAtTime(0, start + 1.6); osc.connect(g).connect(bus); osc.start(start); osc.stop(start + 1.7); } },
      },
      {
        name: "Подих вогника",
        text: "Тихий високий шелест і ледь чутний дзвоник",
        play: () => { wash({ type: "bandpass", from: 3000, to: 5000, q: 2, attack: 0.5, length: 1.4, level: 0.02 }); bell({ at: 0.6, freq: 2637, level: 0.012, length: 1.2 }); },
      },
    ],
  },
  {
    id: "night.boat",
    prefix: "Чв",
    chosen: [0],
    title: "Човняр",
    note: "Човен без весел пропливає вдалині: чути лише дерево й воду.",
    sounds: [
      {
        name: "Скрип дерева",
        text: "Повільний рипучий скрип старого човна",
        play: () => { creak({ length: 0.6, level: 0.04, low: 220, high: 420, step: 0.035 }); creak({ at: 1.4, length: 0.5, level: 0.03, low: 260, high: 380, step: 0.035 }); },
      },
      {
        name: "Плескіт об борт",
        text: "Вода тихо плескає об дерев'яний борт, і скрип",
        play: () => { for (let i = 0; i < 3; i += 1) wash({ at: i * 0.7, type: "lowpass", from: 600, to: 200, attack: 0.1, length: 0.5, level: 0.06, deep: true }); creak({ at: 0.4, length: 0.5, level: 0.03, low: 240, high: 400, step: 0.035 }); },
      },
    ],
  },
  {
    id: "night.mavka",
    prefix: "Мв",
    chosen: [0],
    title: "Мавка",
    note: "Бліда дівчина біля води заходить у воду й зникає.",
    sounds: [
      {
        name: "Наспів без слів",
        text: "Далекий жіночий наспів, три сумні ноти з відлунням",
        play: () => { const bus = echoBus(0.42, 0.45, 0.6); [[659, 0, 0.9], [587, 0.8, 0.9], [494, 1.6, 1.4]].forEach(([freq, at, length]) => hum({ at, freq, length, level: 0.03, destination: bus })); },
      },
      {
        name: "Плескіт і зітхання",
        text: "Тихе зітхання, і хтось заходить у воду",
        play: () => { wash({ type: "bandpass", from: 1200, to: 700, q: 0.8, attack: 0.3, length: 0.9, level: 0.025 }); for (let i = 0; i < 3; i += 1) wash({ at: 0.9 + i * 0.35, type: "lowpass", from: 900, to: 250, attack: 0.05, length: 0.3, level: 0.06, deep: true }); },
      },
    ],
  },
  {
    id: "night.lantern",
    prefix: "Лх",
    chosen: [1],
    title: "Ліхтар на березі",
    note: "Вогник ліхтаря йде берегом, зупиняється й гасне.",
    sounds: [
      {
        name: "Тріск і гасне",
        text: "Потріскування вогню, а потім тихе «пф» і тиша",
        play: () => { for (let i = 0; i < 10; i += 1) wash({ at: Math.random() * 1, type: "bandpass", from: 2500 + Math.random() * 2000, q: 3, attack: 0.001, length: 0.008, level: 0.03 }); wash({ at: 1.1, type: "lowpass", from: 800, to: 200, attack: 0.02, length: 0.3, level: 0.05 }); },
      },
      {
        name: "Скрип дужки",
        text: "Металева дужка ліхтаря поскрипує, поки він гойдається",
        play: () => { for (let i = 0; i < 3; i += 1) creak({ at: i * 0.55, length: 0.2, level: 0.025, low: 1400, high: 1900, step: 0.02 }); },
      },
    ],
  },
  {
    id: "night.eyes",
    prefix: "Оч",
    chosen: [0],
    title: "Очі біля берега",
    note: "Червоні очі спливають біля берега й зникають у кільцях.",
    sounds: [
      {
        name: "Гул і бульк",
        text: "Глибокий низький гул наростає, і важкий бульк",
        play: () => { swell({ type: "lowpass", freq: 90, length: 2, level: 0.18, deep: true }); bubble({ at: 1.7, freq: 140, rise: 2.6, length: 0.18, level: 0.2, muffle: 0.5 }); },
      },
      {
        name: "Вдих води",
        text: "З глибини піднімаються повільні бульбашки",
        play: () => { for (let i = 0; i < 6; i += 1) bubble({ at: i * 0.28 + Math.random() * 0.1, freq: 180 + i * 30, rise: 2.4, length: 0.12, level: 0.08, muffle: 0.6 }); },
      },
    ],
  },
  {
    id: "night.drone",
    prefix: "Гл",
    chosen: [0],
    title: "Нічний гул",
    note: "Глибокої ночі ледь чутне тло під усім, від якого трохи не по собі. Тут 4 секунди.",
    sounds: [
      {
        name: "Глибокий тон",
        text: "Дуже низький тон, що повільно «пливе»",
        play: () => { const start = ctx.currentTime; for (const f of [55, 55.6]) { const osc = ctx.createOscillator(); osc.frequency.value = f; const g = ctx.createGain(); g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(0.06, start + 1.5); g.gain.linearRampToValueAtTime(0, start + 4); osc.connect(g).connect(master); osc.start(start); osc.stop(start + 4.1); } },
      },
      {
        name: "Повітряний бас",
        text: "Глухий шум, як далекий вітер у порожнечі",
        play: () => swell({ type: "lowpass", freq: 110, length: 4, level: 0.12, deep: true }),
      },
    ],
  },
  {
    id: "night.whisper",
    prefix: "Шп",
    chosen: [1],
    title: "Шепіт з очерету",
    note: "Дуже рідко: ніби хтось шепоче в очереті. Не розбереш слів.",
    sounds: [
      {
        name: "Шепіт",
        text: "Кілька нерозбірливих шиплячих складів",
        play: () => { const side = pan() * 2; let at = 0; for (let i = 0; i < 6; i += 1) { const length = 0.08 + Math.random() * 0.14; const f = 1800 + Math.random() * 2500; const start = ctx.currentTime + at; const source = ctx.createBufferSource(); source.buffer = noise; const filter = ctx.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = f; filter.Q.value = 2.5; const g = ctx.createGain(); g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(0.03, start + length * 0.3); g.gain.linearRampToValueAtTime(0, start + length); const p = ctx.createStereoPanner(); p.pan.value = side; source.connect(filter).connect(g).connect(p).connect(master); source.start(start, Math.random(), length + 0.05); at += length + 0.03 + Math.random() * 0.1; } },
      },
      {
        name: "Шепіт з відлунням",
        text: "Те саме, але далеко й з відлунням",
        play: () => { const bus = echoBus(0.3, 0.5, 0.7); let at = 0; for (let i = 0; i < 5; i += 1) { const length = 0.1 + Math.random() * 0.12; const start = ctx.currentTime + at; const source = ctx.createBufferSource(); source.buffer = noise; const filter = ctx.createBiquadFilter(); filter.type = "bandpass"; filter.frequency.value = 2000 + Math.random() * 2000; filter.Q.value = 2.5; const g = ctx.createGain(); g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(0.02, start + length * 0.3); g.gain.linearRampToValueAtTime(0, start + length); source.connect(filter).connect(g).connect(bus); source.start(start, Math.random(), length + 0.05); at += length + 0.05 + Math.random() * 0.1; } },
      },
    ],
  },
  {
    id: "river.flow",
    prefix: "Рч",
    chosen: [2],
    title: "Течія біля мосту",
    note: "Старий міст: швидка річка, звучить весь час, тихо. Тут 4 секунди.",
    sounds: [
      {
        name: "Течія",
        text: "Рівний шум води з легкими перепадами",
        play: () => { swell({ type: "lowpass", freq: 800, length: 4, level: 0.09, deep: true, flutter: 0.25 }); swell({ type: "bandpass", freq: 1800, q: 0.6, length: 4, level: 0.015, flutter: 0.5 }); },
      },
      {
        name: "Дзюрчання",
        text: "Вода дзюрчить між корчами й каменями",
        play: () => { swell({ type: "lowpass", freq: 600, length: 4, level: 0.06, deep: true }); for (let t = 0; t < 4; t += 0.05 + Math.random() * 0.1) bubble({ at: t, freq: 300 + Math.random() * 600, rise: 1.6 + Math.random(), length: 0.04 + Math.random() * 0.04, level: 0.02, pan: Math.random() * 1.2 - 0.6 }); },
      },
      {
        name: "Широка ріка",
        text: "Низький широкий шум великої води",
        play: () => swell({ type: "lowpass", freq: 400, length: 4, level: 0.13, deep: true, flutter: 0.15 }),
      },
    ],
  },
  {
    id: "village.far",
    prefix: "Сл",
    chosen: [2],
    title: "Село біля ставка",
    note: "Ставок за селом: зрідка з села долітають звуки. Можна обрати кілька.",
    sounds: [
      {
        name: "Пес далеко",
        text: "Два-три приглушені «гав» з села",
        play: () => { const side = pan() * 2; for (let i = 0; i < 3; i += 1) voice({ at: i * jitter(0.35), contour: [520, 600, 440], length: 0.14, level: 0.08, formants: [[900, 3], [1900, 5]], pan: side, muffle: 0.7 }); },
      },
      {
        name: "Півень на світанку",
        text: "Далеке «ку-ку-рі-ку»",
        play: () => { const side = pan() * 2; [[0, 0.12, [600, 620]], [0.16, 0.12, [640, 660]], [0.32, 0.14, [700, 720]], [0.5, 0.6, [760, 820, 780, 600]]].forEach(([at, length, contour]) => voice({ at, contour, length, level: 0.06, formants: [[1100, 4], [2400, 6]], pan: side, muffle: 0.5 })); },
      },
      {
        name: "Корова",
        text: "Протяжне низьке «му-у» з пасовища",
        play: () => voice({ contour: [150, 180, 170, 130], length: 1.3, level: 0.08, formants: [[400, 3], [900, 5]], pan: pan() * 2, muffle: 0.6 }),
      },
    ],
  },
  {
    id: "castle.bell",
    prefix: "Дз",
    chosen: [1],
    title: "Дзвін над замковим озером",
    note: "Замкове озеро: дуже рідко з-за гір лунає далекий дзвін.",
    sounds: [
      {
        name: "Один удар",
        text: "Глибокий далекий удар дзвона, що довго гасне",
        play: () => bigBell({ freq: 196, level: 0.05, length: 5 }),
      },
      {
        name: "Два удари",
        text: "Два повільні удари, як з далекої каплиці",
        play: () => { bigBell({ freq: 220, level: 0.045, length: 4 }); bigBell({ at: 2.2, freq: 220, level: 0.04, length: 4 }); },
      },
    ],
  },
  {
    id: "pripyat",
    prefix: "Пр",
    chosen: [0, 2],
    title: "Прип'ять",
    note: "Порожня зона довкола: рідкі моторошні звуки. Можна обрати кілька.",
    sounds: [
      {
        name: "Скрип металу",
        text: "Корабель стогне іржавим металом",
        play: () => { creak({ length: 1.2, level: 0.05, low: 160, high: 260, step: 0.05 }); creak({ at: 1.5, length: 0.6, level: 0.035, low: 300, high: 380, step: 0.04 }); },
      },
      {
        name: "Порожній вітер",
        text: "Вітер свистить у порожніх будівлях",
        play: () => { swell({ type: "bandpass", freq: 700, q: 12, length: 3.5, level: 0.08, flutter: 0.3 }); swell({ at: 0.6, type: "bandpass", freq: 1050, q: 14, length: 2.5, level: 0.05, flutter: 0.3 }); },
      },
      {
        name: "Лічильник Гейгера",
        text: "Тихе випадкове потріскування, ніби поруч дозиметр",
        play: () => { let t = 0; while (t < 3) { wash({ at: t, type: "highpass", from: 3000, q: 0.7, attack: 0.0005, length: 0.004, level: 0.07 }); t += -Math.log(Math.random()) * 0.12; } },
      },
      {
        name: "Далекий брязкіт",
        text: "Десь далеко брязкає метал, і луна",
        play: () => { const bus = echoBus(0.45, 0.4, 0.7); for (const [at, f] of [[0, 900], [0.12, 1250]]) { const start = ctx.currentTime + at; for (const [ratio, part] of [[1, 1], [2.76, 0.5], [5.4, 0.25]]) { const osc = ctx.createOscillator(); osc.frequency.value = f * ratio; const g = ctx.createGain(); g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(0.03 * part, start + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, start + 0.6 / ratio); osc.connect(g).connect(bus); osc.start(start); osc.stop(start + 0.7); } } },
      },
    ],
  },
  {
    id: "village.dog",
    prefix: "Пс",
    chosen: [],
    // Not wanted in the game.
    settled: true,
    title: "Пес у селі (нові варіанти)",
    note: "Ставок за селом: зрідка гавкає пес. Перший варіант не підійшов, ось інші.",
    sounds: [
      {
        name: "Справжній гав",
        text: "Різкий короткий «гав»: голос і видих разом, двічі",
        play: () => { const side = pan() * 2; for (const at of [0, 0.42]) { voice({ at, contour: [460, 520, 360], length: 0.12, level: 0.07, formants: [[800, 2], [1700, 3]], pan: side, muffle: 0.55 }); wash({ at, type: "bandpass", from: 1200, to: 700, q: 1, attack: 0.003, length: 0.1, level: 0.05, pan: side }); } },
      },
      {
        name: "Цуцик",
        text: "Тонкі швидкі «тяв-тяв-тяв»",
        play: () => { const side = pan() * 2; for (let i = 0; i < 4; i += 1) voice({ at: i * 0.2, contour: [820, 900, 700], length: 0.07, level: 0.05, formants: [[1300, 3], [2600, 4]], pan: side, muffle: 0.45 }); },
      },
      {
        name: "Великий пес",
        text: "Низьке глухе «вуф… вуф»",
        play: () => { const side = pan() * 2; for (const at of [0, 0.7]) { voice({ at, contour: [230, 260, 170], length: 0.2, level: 0.08, formants: [[500, 2.5], [1100, 3]], pan: side, muffle: 0.65 }); wash({ at, type: "lowpass", from: 900, to: 300, attack: 0.005, length: 0.18, level: 0.04, pan: side }); } },
      },
      {
        name: "Пес і відлуння",
        text: "Гавкіт далеко в селі, з відлунням між хатами",
        play: () => { const side = pan() * 2; const bus = echoBus(0.25, 0.3, 0.5); for (const at of [0, 0.38, 0.75]) { const start = ctx.currentTime + at; const osc = ctx.createOscillator(); osc.type = "sawtooth"; osc.frequency.setValueCurveAtTime(Float32Array.from([480, 540, 380]), start, 0.13); const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 850; f.Q.value = 2; const far = ctx.createBiquadFilter(); far.type = "lowpass"; far.frequency.value = 900; const g = ctx.createGain(); g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(0.07, start + 0.02); g.gain.linearRampToValueAtTime(0, start + 0.13); osc.connect(f).connect(far).connect(g).connect(bus); osc.start(start); osc.stop(start + 0.15); } },
      },
    ],
  },
  {
    id: "music",
    prefix: "Мз",
    chosen: [],
    title: "Фонова музика",
    note: "Генерується наживо й щоразу трохи інша. Кожна грає ~25 секунд; натисни ще раз, щоб зупинити. У грі вмикатиметься час від часу.",
    music: true,
    sounds: [
      {
        name: "Ранок на ставку",
        text: "Тепле електропіано, повільні м'які акорди, тихий біт і вініл",
        play: () => track((bus) => {
          const beat = 60 / 70;
          const chords = [["F3", "A3", "C4", "E4"], ["E3", "G3", "B3", "D4"], ["D3", "F3", "A3", "C4"], ["C3", "E3", "G3", "B3"]];
          const roots = ["F2", "E2", "D2", "C2"];
          vinyl(bus, 28);
          for (let bar = 0; bar < 8; bar += 1) {
            const at = bar * beat * 4;
            const chord = chords[bar % 4];
            chord.forEach((n, i) => epiano(bus, NOTE(n), at + i * 0.02, beat * 3.6, 0.022));
            epiano(bus, NOTE(pick(chord).replace(/\d$/, "5")), at + beat * 2.5, beat * 1.4, 0.016);
            bass(bus, NOTE(roots[bar % 4]), at, beat * 1.8);
            bass(bus, NOTE(roots[bar % 4]), at + beat * 2.5, beat * 1.2, 0.05);
            for (let b = 0; b < 4; b += 1) {
              if (b === 0 || b === 2.5) drum(bus, "kick", at + b * beat);
              if (b === 1 || b === 3) drum(bus, "snare", at + b * beat);
              drum(bus, "hat", at + b * beat + beat * 0.55);
            }
            drum(bus, "kick", at + beat * 2.5);
          }
        }),
      },
      {
        name: "Вечірня гітара",
        text: "Перебір нейлонової гітари, без барабанів, спокійно",
        play: () => track((bus) => {
          const beat = 60 / 80;
          const chords = [["A2", "E3", "A3", "C4", "E4"], ["F2", "C3", "F3", "A3", "C4"], ["C3", "G3", "C4", "E4", "G4"], ["G2", "D3", "G3", "B3", "D4"]];
          for (let bar = 0; bar < 8; bar += 1) {
            const at = bar * beat * 4;
            const chord = chords[bar % 4];
            const pattern = [0, 2, 3, 4, 3, 2, 1, 2];
            pattern.forEach((idx, i) => guitar(bus, NOTE(chord[idx]), at + i * beat * 0.5 + (Math.random() - 0.5) * 0.02, 1.8, i === 0 ? 0.045 : 0.03));
          }
        }),
      },
      {
        name: "Ніч над водою",
        text: "Пади й рідкі ноти піаніно з відлунням, без ритму",
        play: () => track((bus) => {
          const echo = ctx.createDelay(2);
          echo.delayTime.value = 0.55;
          const back = ctx.createGain();
          back.gain.value = 0.45;
          const damp = ctx.createBiquadFilter();
          damp.type = "lowpass";
          damp.frequency.value = 1800;
          const wet = ctx.createGain();
          wet.gain.value = 0.6;
          const send = ctx.createGain();
          send.connect(bus);
          send.connect(echo).connect(damp).connect(back).connect(echo);
          damp.connect(wet).connect(bus);
          const chords = [["A2", "C3", "E3", "B3"], ["F2", "A2", "C3", "E3"], ["D2", "F2", "A2", "C3"], ["E2", "G#2", "B2", "D3"]];
          const scale = ["A4", "B4", "C5", "E5", "G5", "A5"];
          for (let i = 0; i < 4; i += 1) pad(bus, chords[i].map(NOTE), i * 6.5, 7.5, 0.01);
          let t = 1;
          while (t < 26) {
            epiano(send, NOTE(pick(scale)), t, 2.2, 0.018);
            t += 1.2 + Math.random() * 2.2;
          }
        }),
      },
      {
        name: "Лоу-фай біт",
        text: "Класичний лоу-фай: джазові акорди, ледачий свінг, вініл",
        play: () => track((bus) => {
          const beat = 60 / 78;
          const swing = beat * 0.12;
          const chords = [["D3", "F3", "A3", "C4", "E4"], ["G2", "F3", "B3", "E4"], ["C3", "E3", "G3", "B3", "D4"], ["A2", "G3", "C#4", "F4"]];
          const roots = ["D2", "G2", "C2", "A2"];
          vinyl(bus, 28);
          for (let bar = 0; bar < 8; bar += 1) {
            const at = bar * beat * 4;
            const chord = chords[bar % 4];
            chord.forEach((n, i) => epiano(bus, NOTE(n), at + i * 0.015, beat * 1.7, 0.02));
            chord.forEach((n, i) => epiano(bus, NOTE(n), at + beat * 2.5 + swing + i * 0.015, beat * 1.2, 0.014));
            bass(bus, NOTE(roots[bar % 4]), at, beat * 1.5);
            bass(bus, NOTE(roots[bar % 4]) * 1.5, at + beat * 2.5 + swing, beat, 0.05);
            drum(bus, "kick", at);
            drum(bus, "kick", at + beat * 1.5 + swing);
            drum(bus, "snare", at + beat);
            drum(bus, "snare", at + beat * 3);
            for (let h = 0; h < 8; h += 1) drum(bus, "hat", at + h * beat * 0.5 + (h % 2 ? swing : 0));
          }
        }),
      },
    ],
  },
  ...uiPacks(),
  {
    id: "shop.buy",
    prefix: "Щ",
    chosen: [0],
    title: "Покупка",
    note: "Купив наживку, гачки, приманку: дрібна покупка, часто.",
    sounds: [
      {
        name: "Монетки",
        text: "Дві дрібні монети дзенькнули",
        play: () => { coin({ freq: 2350 }); coin({ at: 0.085, freq: 2650 }); },
      },
      {
        name: "Монети в долоню",
        text: "Кілька монет і м'який стук у долоню",
        play: () => { coin({ freq: 2500 }); coin({ at: 0.06, freq: 2200 }); coin({ at: 0.11, freq: 2800 }); knock({ at: 0.14, freq: 600, level: 0.05 }); },
      },
      {
        name: "Прилавок",
        text: "Монета об дерев'яний прилавок",
        play: () => { knock({ freq: 900, level: 0.07 }); coin({ at: 0.02, freq: 2400 }); },
      },
    ],
  },
  {
    id: "shop.buy.big",
    prefix: "Ї",
    chosen: [0],
    title: "Велика покупка",
    note: "Вудка чи спорядження: рідко й приємно.",
    sounds: [
      {
        name: "Купа монет",
        text: "Цілий каскад монет",
        play: () => { for (let i = 0; i < 9; i += 1) coin({ at: i * 0.045 + Math.random() * 0.02, freq: 2000 + Math.random() * 1200, level: 0.03 }); },
      },
      {
        name: "Дзвіночок крамниці",
        text: "Дзвіночок над дверима і монети",
        play: () => { bell({ freq: 1568, level: 0.05, length: 0.9 }); bell({ at: 0.12, freq: 2093, level: 0.04, length: 0.8 }); coin({ at: 0.25, freq: 2400 }); coin({ at: 0.32, freq: 2700 }); },
      },
      {
        name: "Монети й стук",
        text: "Монети, а потім покупку кладуть на прилавок",
        play: () => { for (let i = 0; i < 5; i += 1) coin({ at: i * 0.05, freq: 2100 + i * 150, level: 0.03 }); knock({ at: 0.35, freq: 500, level: 0.09 }); knock({ at: 0.42, freq: 700, level: 0.05 }); },
      },
    ],
  },
  {
    id: "keepnet.sell",
    prefix: "Й",
    chosen: [1],
    title: "Продаж садка",
    note: "Продав увесь улов разом: момент нагороди за риболовлю.",
    sounds: [
      {
        name: "Гаманець",
        text: "Монети сиплються в гаманець",
        play: () => { for (let i = 0; i < 12; i += 1) coin({ at: i * 0.04 + Math.random() * 0.03, freq: 1900 + Math.random() * 1300, level: 0.028 }); wash({ at: 0.5, type: "lowpass", from: 500, to: 200, length: 0.1, level: 0.06 }); },
      },
      {
        name: "Садок і монети",
        text: "Садок піднімають з води, і монети",
        play: () => { droplets({ count: 8, from: 0, to: 0.4, level: 0.05 }); for (let i = 0; i < 6; i += 1) coin({ at: 0.45 + i * 0.05, freq: 2100 + i * 140, level: 0.03 }); },
      },
      {
        name: "Монети й дзвіночок",
        text: "Монети, а наприкінці радісний дзвіночок",
        play: () => { for (let i = 0; i < 8; i += 1) coin({ at: i * 0.05, freq: 2000 + Math.random() * 1000, level: 0.03 }); bell({ at: 0.45, freq: 1319, level: 0.04, length: 0.7 }); bell({ at: 0.55, freq: 1976, level: 0.03, length: 0.7 }); },
      },
    ],
  },
  {
    id: "trophy.mount",
    prefix: "Ц",
    chosen: [0],
    title: "Трофей",
    note: "Рибу зберегли як трофей: її вішають на стіну.",
    sounds: [
      {
        name: "Цвях",
        text: "Три удари молотком по цвяху",
        play: () => { for (let i = 0; i < 3; i += 1) { knock({ at: i * 0.18, freq: 700 - i * 40, level: 0.09 }); bell({ at: i * 0.18, freq: 3200, level: 0.008, length: 0.08 }); } },
      },
      {
        name: "Урочисто",
        text: "Тихі дзвіночки, як нагорода",
        play: () => [659, 880, 1319].forEach((f, i) => bell({ at: i * 0.12, freq: f, level: 0.045, length: 0.9 })),
      },
      {
        name: "Стук і дзвін",
        text: "Повісили на стіну, і короткий дзенькіт",
        play: () => { knock({ freq: 600, level: 0.09 }); knock({ at: 0.15, freq: 640, level: 0.08 }); bell({ at: 0.3, freq: 1760, level: 0.04, length: 0.7 }); },
      },
    ],
  },
  {
    id: "water.lap",
    prefix: "Хв",
    chosen: [0],
    title: "Хвилька об берег",
    note: "Фон на воді: раз на кілька секунд маленька хвилька плескає біля берега. Має бути ледь помітно.",
    sounds: [
      {
        name: "Тихий плескіт",
        text: "М'яке наростання й пара бульбашок",
        play: () => {
          wash({ type: "lowpass", from: jitter(380), to: 160, attack: 0.22, length: 1, level: 0.08, deep: true, pan: pan() });
          bubble({ at: 0.3, freq: jitter(500), rise: 2, length: 0.04, level: 0.02 });
          bubble({ at: 0.5, freq: jitter(700), rise: 2, length: 0.03, level: 0.015 });
        },
      },
      {
        name: "Об камінь",
        text: "Коротший, ясніший шльоп хвильки об камінь",
        play: () => {
          wash({ type: "lowpass", from: jitter(1400), to: 300, attack: 0.04, length: 0.35, level: 0.07, pan: pan() });
          droplets({ count: 3, from: 0.1, to: 0.35, level: 0.025 });
        },
      },
      {
        name: "Довгий накат",
        text: "Хвиля повільно набігає й відкочується",
        play: () => {
          const start = ctx.currentTime;
          const source = ctx.createBufferSource();
          source.buffer = brown;
          const filter = ctx.createBiquadFilter();
          filter.type = "lowpass";
          filter.frequency.setValueAtTime(200, start);
          filter.frequency.linearRampToValueAtTime(600, start + 0.7);
          filter.frequency.linearRampToValueAtTime(180, start + 1.8);
          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0, start);
          gain.gain.linearRampToValueAtTime(0.09, start + 0.7);
          gain.gain.linearRampToValueAtTime(0, start + 1.8);
          source.connect(filter).connect(gain).connect(master);
          source.start(start, Math.random(), 1.9);
        },
      },
    ],
  },
  {
    id: "fish.jump",
    prefix: "Рб",
    chosen: [0],
    title: "Риба сплеснула вдалині",
    note: "Фон: час від часу десь на воді грає риба.",
    sounds: [
      {
        name: "Далекий сплеск",
        text: "Тихий, приглушений відстанню",
        play: () => {
          wash({ type: "lowpass", from: jitter(900), to: 200, attack: 0.004, length: 0.25, level: 0.07, deep: true, pan: pan() * 2 });
          droplets({ count: 2, from: 0.08, to: 0.25, level: 0.012 });
        },
      },
      {
        name: "Плюх і кола",
        text: "Ясніший плюх і кілька бульбашок",
        play: () => {
          const side = pan() * 2;
          wash({ type: "lowpass", from: jitter(1600), to: 260, attack: 0.003, length: 0.22, level: 0.08, pan: side });
          bubble({ at: 0.04, freq: jitter(300), rise: 2.4, length: 0.07, level: 0.05, pan: side });
          droplets({ count: 3, from: 0.08, to: 0.4, level: 0.02 });
        },
      },
      {
        name: "Двічі",
        text: "Вистрибнула й плюхнулась ще раз",
        play: () => {
          const side = pan() * 2;
          wash({ type: "lowpass", from: jitter(1300), to: 240, attack: 0.003, length: 0.2, level: 0.07, deep: true, pan: side });
          wash({ at: jitter(0.45), type: "lowpass", from: jitter(1100), to: 220, attack: 0.003, length: 0.16, level: 0.05, deep: true, pan: side });
        },
      },
    ],
  },
  {
    id: "bird.day",
    prefix: "Пт",
    chosen: [0, 1, 2, 3],
    title: "Пташки вдень",
    note: "Фон удень, раз на 10–20 секунд, звідкись збоку. Можна обрати кілька: гратимуть по черзі.",
    sounds: [
      {
        name: "Трель",
        text: "Швидка спадна трель із розчерком у кінці (як зяблик)",
        play: () => {
          const side = pan() * 2;
          for (let i = 0; i < 9; i += 1) chirp({ at: i * 0.07, from: 4200 - i * 120, to: 3600 - i * 120, length: 0.06, level: 0.022, pan: side });
          chirp({ at: 0.7, from: 3000, to: 4800, length: 0.18, level: 0.025, pan: side });
        },
      },
      {
        name: "Синиця",
        text: "Дзвінке «ці-фі, ці-фі»",
        play: () => {
          const side = pan() * 2;
          for (let i = 0; i < 3; i += 1) {
            chirp({ at: i * 0.38, from: 5200, to: 5000, length: 0.1, level: 0.022, pan: side });
            chirp({ at: i * 0.38 + 0.14, from: 3900, to: 3700, length: 0.14, level: 0.022, pan: side });
          }
        },
      },
      {
        name: "Очеретянка",
        text: "Балакуче цвірінькання з очерету",
        play: () => {
          const side = pan() * 2;
          let at = 0;
          for (let i = 0; i < 12; i += 1) {
            const f = 2500 + Math.random() * 2500;
            chirp({ at, from: f, to: f * (0.7 + Math.random() * 0.6), length: 0.04 + Math.random() * 0.05, level: 0.015, pan: side, vibrato: Math.random() < 0.4 ? 300 : 0 });
            at += 0.06 + Math.random() * 0.07;
          }
        },
      },
      {
        name: "Іволга",
        text: "Мелодійне флейтове «фіу-лі-у»",
        play: () => {
          const side = pan() * 2;
          chirp({ from: 1500, to: 2100, length: 0.18, level: 0.03, pan: side });
          chirp({ at: 0.2, from: 2300, to: 1700, length: 0.16, level: 0.03, pan: side });
          chirp({ at: 0.38, from: 1600, to: 1900, length: 0.28, level: 0.03, pan: side });
        },
      },
    ],
  },
  {
    id: "duck.quack",
    prefix: "Кч",
    chosen: [1, 2],
    title: "Качка крякає",
    note: "Коли качки пливуть по воді: іноді крякають.",
    sounds: [
      {
        name: "Крижень",
        text: "Голосне «кря-кря-кря»",
        play: () => { const side = pan(); for (let i = 0; i < 3; i += 1) quack({ at: i * 0.22, freq: jitter(380) * (1 - i * 0.05), length: 0.15, level: 0.05, pan: side }); },
      },
      {
        name: "Тихе бурмотіння",
        text: "Низькі тихі «кхр-кхр», качка вдоволено бурмоче",
        play: () => { const side = pan(); for (let i = 0; i < 4; i += 1) quack({ at: i * jitter(0.14), freq: jitter(260), length: 0.08, level: 0.03, pan: side }); },
      },
      {
        name: "Одне кря",
        text: "Одне коротке «кря»",
        play: () => quack({ freq: jitter(400), length: 0.17, level: 0.05, pan: pan() }),
      },
    ],
  },
  {
    id: "duck.eats",
    prefix: "Кз",
    chosen: [0],
    title: "Качка з'їла наживку",
    note: "Качка пропливла повз поплавок і з'їла наживку.",
    sounds: [
      {
        name: "Хап і кря",
        text: "Швидкий плюскіт дзьобом і задоволене «кря»",
        play: () => {
          for (let i = 0; i < 4; i += 1) wash({ at: i * 0.05, type: "lowpass", from: 2000, to: 600, attack: 0.002, length: 0.05, level: 0.06 });
          quack({ at: 0.3, freq: jitter(420), length: 0.15, level: 0.05 });
        },
      },
      {
        name: "Чвакання",
        text: "Качка булькає дзьобом у воді",
        play: () => { for (let i = 0; i < 8; i += 1) bubble({ at: i * 0.06 + Math.random() * 0.03, freq: 400 + Math.random() * 400, rise: 2, length: 0.04, level: 0.06 }); },
      },
      {
        name: "Кря з насмішкою",
        text: "Плюскіт і два швидкі «кря-кря», ніби сміється",
        play: () => {
          wash({ type: "lowpass", from: 1800, to: 500, attack: 0.002, length: 0.12, level: 0.07 });
          quack({ at: 0.2, freq: 460, length: 0.1, level: 0.05 });
          quack({ at: 0.34, freq: 500, length: 0.12, level: 0.05 });
        },
      },
    ],
  },
];

/*
 * Build the page: the sounds still waiting for a pick on top, then (folded
 * away) the ones already in the game. A section per sound, a numbered button
 * per candidate.
 */
function renderSection(section, into) {
  const heading = document.createElement("h2");
  heading.textContent = `${section.title} · ${section.id}`;
  const note = document.createElement("p");
  note.textContent = section.note;
  const grid = document.createElement("div");
  grid.className = "grid";
  section.sounds.forEach((sound, index) => {
    const button = document.createElement("button");
    button.className = "sound";
    button.type = "button";
    const picked = section.chosen.includes(index);
    button.classList.toggle("is-chosen", picked);
    button.innerHTML = `<strong><b>${section.prefix}${index + 1}</b> · ${sound.name}${picked ? " ✓ у грі" : ""}</strong><span>${sound.text}</span>`;
    button.addEventListener("click", () => {
      audio();
      // Music plays for a while: a second press stops it.
      if (section.music) {
        if (button.stop) {
          button.stop();
          button.stop = null;
          button.classList.remove("is-playing");
          return;
        }
        button.stop = sound.play();
        button.classList.add("is-playing");
        setTimeout(() => {
          button.stop = null;
          button.classList.remove("is-playing");
        }, 27000);
        return;
      }
      sound.play();
      button.classList.add("is-playing");
      setTimeout(() => button.classList.remove("is-playing"), 900);
    });
    grid.append(button);
  });
  into.append(heading, note, grid);
}

const root = document.querySelector("#sections");
const decided = (section) => section.chosen.length > 0 || section.settled;
const waiting = SECTIONS.filter((section) => !decided(section));
const done = SECTIONS.filter(decided);

const waitingTitle = document.createElement("h2");
waitingTitle.className = "group-title";
waitingTitle.textContent = waiting.length ? `Чекають на вибір · ${waiting.length}` : "Усе вибрано";
root.append(waitingTitle);
for (const section of waiting) renderSection(section, root);

const doneBox = document.createElement("details");
doneBox.className = "done";
const summary = document.createElement("summary");
summary.textContent = `Уже в грі · ${done.length}`;
doneBox.append(summary);
for (const section of done) renderSection(section, doneBox);
root.append(doneBox);
