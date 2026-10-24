/**
 * Sound: a few soft effects, made on the fly with Web Audio (no sound files to
 * download), and a quiet bed of water and rain. On by default; Settings turns
 * it off, and the choice is remembered in this browser. Browsers only let a
 * page make sound after a tap or a key, so nothing plays before the first one.
 */

const KEY = "doberega.sound";

let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
})();

let ctx = null;
let master = null;
let noise = null;
let bed = null;

export function soundEnabled() {
  return enabled;
}

export function setSoundEnabled(on) {
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
  master.gain.setTargetAtTime(on ? 0.6 : 0, ctx.currentTime, 0.05);
  if (on) ctx.resume();
  else setTimeout(() => !enabled && ctx.suspend(), 200);
}

/** The audio graph, made on the first tap; null while sound is off or not yet allowed. */
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
  master.gain.value = enabled ? 0.6 : 0;
  master.connect(ctx.destination);
  // Two seconds of white noise, looped or sliced for splashes, swishes and rain.
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  bed = makeBed();
}

// Sound may only start from a user gesture: the first tap or key unlocks it.
for (const type of ["pointerdown", "keydown"]) {
  window.addEventListener(type, start, { passive: true });
}
// A hidden tab goes quiet (and saves the battery).
document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden || !enabled) ctx.suspend();
  else if (enabled) ctx.resume();
});

/** A slice of noise through a filter, with its own gain, ready to shape. */
function noiseVoice(type, frequency, q = 1) {
  const source = ctx.createBufferSource();
  source.buffer = noise;
  source.loop = true;
  source.loopStart = Math.random() * 1.5;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(master);
  return { source, filter, gain };
}

/** A short tone that slides from one pitch to another and fades out. */
function tone(type, from, to, duration, volume, delay = 0) {
  const at = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + duration + 0.02);
}

/** A burst of filtered noise with a quick rise and a fade. */
function burst(type, frequency, sweepTo, duration, volume, q = 1) {
  const voice = noiseVoice(type, frequency, q);
  const at = ctx.currentTime;
  voice.filter.frequency.setValueAtTime(frequency, at);
  voice.filter.frequency.exponentialRampToValueAtTime(sweepTo, at + duration);
  voice.gain.gain.setValueAtTime(0, at);
  voice.gain.gain.linearRampToValueAtTime(volume, at + duration * 0.25);
  voice.gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
  voice.source.start(at);
  voice.source.stop(at + duration + 0.05);
}

/** The bed: a low hush of water while fishing, and rain on top of it. */
function makeBed() {
  const water = noiseVoice("lowpass", 420, 0.5);
  const rain = noiseVoice("highpass", 1400, 0.4);
  water.source.start();
  rain.source.start();
  return { water, rain };
}

/** Keep the bed in step with the scene: water while at the water, rain as it falls. */
export function setAmbience({ water = 0, rain = 0 }) {
  if (!audio() || !bed) return;
  const at = ctx.currentTime;
  bed.water.gain.gain.setTargetAtTime(0.05 * water, at, 0.6);
  bed.rain.gain.gain.setTargetAtTime(0.09 * rain, at, 0.6);
}

/*
 * The effects. Each is a small, soft sound; a little randomness in pitch and
 * length keeps repeats from sounding mechanical.
 */
const vary = (value, amount = 0.08) => value * (1 + (Math.random() * 2 - 1) * amount);

export const sounds = {
  /** The rod swishing through the air. */
  cast() {
    if (!audio()) return;
    burst("bandpass", vary(500), vary(2600), 0.42, 0.22, 1.4);
  },
  /** The float or lure dropping onto the water. */
  splash(size = 1) {
    if (!audio()) return;
    burst("lowpass", vary(1400), 300, 0.22 + 0.1 * size, 0.18 * size);
    tone("sine", vary(340), 110, 0.14, 0.12 * size);
  },
  /** The float ducking under: a small plip. */
  bite() {
    if (!audio()) return;
    tone("sine", vary(620), 260, 0.09, 0.12);
  },
  /** A fish hitting a lure: a heavier swirl. */
  strike() {
    if (!audio()) return;
    burst("lowpass", vary(1800), 250, 0.35, 0.24);
    tone("sine", vary(260), 90, 0.2, 0.14);
  },
  /** One click of the reel's ratchet. */
  reelTick() {
    if (!audio()) return;
    tone("triangle", vary(2100, 0.15), 1400, 0.018, 0.035);
  },
  /** A fish thrashing at the surface. */
  thrash() {
    if (!audio()) return;
    burst("bandpass", vary(900, 0.2), 400, 0.18, 0.08, 0.8);
  },
  /** The line snapping or the hook bending: a sharp twang. */
  snap() {
    if (!audio()) return;
    tone("triangle", vary(980), 140, 0.28, 0.16);
    burst("highpass", 3000, 1500, 0.06, 0.12);
  },
  /** A fish on the bank: two soft rising notes. */
  landed() {
    if (!audio()) return;
    tone("sine", 523, 523, 0.22, 0.1);
    tone("sine", 784, 784, 0.32, 0.1, 0.12);
  },
  /** Money in the pocket. */
  coin() {
    if (!audio()) return;
    tone("square", 1319, 1319, 0.07, 0.03);
    tone("square", 1760, 1760, 0.16, 0.03, 0.07);
  },
};
