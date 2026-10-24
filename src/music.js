/**
 * Background music: short calm pieces, generated with Web Audio (no audio
 * files). Two families, picked in the sound lab: daytime pieces built around
 * a nylon guitar (lab: Мз2) and night pieces of piano, pads and soft voices
 * with an echo (lab: Мз3). Each piece has its own character: its key, tempo
 * and metre, how it is accompanied (fingerpicked, strummed, a waltz, harp-like
 * rolls, travis picking, low piano chords, a music box, bowed strings), what
 * carries the tune (guitar, flute, music box, harmonics, piano, cello), and
 * sometimes a bass or a quiet shaker. Its tune is a short motif, played
 * A A B A so it sticks, written from the piece's scale by a fixed seed: the
 * same every time, while the playing (timing, touch) varies a little.
 *
 * `playPiece(ctx, destination, piece)` schedules a whole piece and returns a
 * function that fades it out. The game (sound.js) decides when music plays;
 * the sound lab (tools/sound-lab) plays the same pieces.
 */

const NAMES = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };

/** "A3" → its frequency in Hz. */
export function note(name) {
  const [, pitch, octave] = name.match(/^([A-G][#b]?)(-?\d)$/);
  return 440 * 2 ** ((NAMES[pitch] + (Number(octave) + 1) * 12 - 69) / 12);
}

/** A small seeded random, so a piece's tune is the same every time it plays. */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/*
 * The pieces. `level` evens out their loudness (measured offline);
 * `chords` are voicings, low to high, one per bar (cycled);
 * `accompany` and `lead` name the arrangement; `scale` is what the tune is
 * drawn from; `density` how busy the tune is (notes per bar, roughly).
 */
export const PIECES = [
  // Day, dusk and dawn: around the guitar.
  { id: "quiet-bank", level: 0.68, title: "Тихий берег", family: "guitar", tempo: 80, beats: 4, bars: 16, seed: 11,
    accompany: "fingerpick", lead: "guitar", density: 2,
    chords: [["A2", "E3", "A3", "C4", "E4"], ["F2", "C3", "F3", "A3", "C4"], ["C3", "G3", "C4", "E4", "G4"], ["G2", "D3", "G3", "B3", "D4"]],
    scale: ["A4", "B4", "C5", "D5", "E5", "G5", "A5"] },
  { id: "summer-evening", level: 0.49, title: "Літній вечір", family: "guitar", tempo: 92, beats: 4, bars: 16, seed: 23, swing: 0.1,
    accompany: "strum", lead: "flute", bass: true, density: 3,
    chords: [["C3", "G3", "C4", "E4", "G4"], ["A2", "E3", "A3", "C4", "E4"], ["D3", "A3", "D4", "F4", "A4"], ["G2", "D3", "G3", "B3", "F4"]],
    scale: ["C5", "D5", "E5", "G5", "A5", "C6", "D6"] },
  { id: "old-willow", level: 0.83, title: "Стара верба", family: "guitar", tempo: 96, beats: 3, bars: 16, seed: 37,
    accompany: "waltz", lead: "musicbox", density: 2,
    chords: [["E2", "B2", "E3", "G3", "B3"], ["C3", "G3", "C4", "E4", "G4"], ["A2", "E3", "A3", "C4", "E4"], ["B2", "F#3", "B3", "D#4", "F#4"]],
    scale: ["E5", "F#5", "G5", "A5", "B5", "D6", "E6"] },
  { id: "morning-mist", level: 0.78, title: "Ранковий туман", family: "guitar", tempo: 64, beats: 4, bars: 12, seed: 51,
    accompany: "harp", lead: "harmonics", density: 1,
    chords: [["D3", "A3", "D4", "F#4", "A4", "D5"], ["G2", "D3", "G3", "B3", "D4", "G4"], ["B2", "F#3", "B3", "D4", "F#4", "B4"], ["A2", "E3", "A3", "C#4", "E4", "A4"]],
    scale: ["D6", "E6", "F#6", "A6", "B6", "D7"] },
  { id: "playful-bite", level: 0.6, title: "Весела поклювка", family: "guitar", tempo: 104, beats: 4, bars: 16, seed: 97,
    accompany: "travis", lead: "guitar", shaker: true, density: 4,
    chords: [["G2", "D3", "G3", "B3", "D4"], ["C3", "G3", "C4", "E4", "G4"], ["G2", "D3", "G3", "B3", "D4"], ["D3", "A3", "D4", "F#4", "A4"]],
    scale: ["G4", "A4", "B4", "D5", "E5", "G5"] },
  // Night: piano, pads and soft voices, with an echo.
  { id: "night-water", level: 0.92, title: "Ніч над водою", family: "night", tempo: 56, beats: 4, bars: 12, seed: 61,
    accompany: "pad", lead: "piano", density: 1.5,
    chords: [["A2", "C3", "E3", "B3"], ["F2", "A2", "C3", "E3"], ["D2", "F2", "A2", "C3"], ["E2", "G#2", "B2", "D3"]],
    scale: ["A4", "B4", "C5", "E5", "G5", "A5"] },
  { id: "moon-path", level: 0.85, title: "Місячна доріжка", family: "night", tempo: 60, beats: 4, bars: 12, seed: 73,
    accompany: "pianoChords", lead: "piano", density: 2.5,
    chords: [["F2", "C3", "E3", "A3"], ["E2", "B2", "D3", "G3"], ["D2", "A2", "C3", "F3"], ["G1", "D2", "F2", "B2"]],
    scale: ["C5", "D5", "E5", "F5", "G5", "A5", "C6"] },
  { id: "stars", level: 0.93, title: "Зорі", family: "night", tempo: 72, beats: 4, bars: 12, seed: 89,
    accompany: "musicbox", lead: "none", density: 0,
    chords: [["C2", "G2", "B2", "E3"], ["A1", "E2", "G2", "C3"], ["F1", "C2", "A2", "E3"], ["G1", "D2", "B2", "F#3"]],
    ostinato: ["E5", "G5", "B5", "G5", "C6", "B5", "G5", "E5"],
    scale: ["E5", "G5", "B5", "C6"] },
  { id: "pond-fog", level: 0.54, title: "Туман над ставком", family: "night", tempo: 48, beats: 4, bars: 10, seed: 103,
    accompany: "pad", lead: "cello", density: 1,
    chords: [["D2", "A2", "F3"], ["A#1", "F2", "D3"], ["G1", "D2", "A#2"], ["A1", "E2", "C#3"]],
    scale: ["D3", "E3", "F3", "G3", "A3", "C4", "D4"] },
];

/** How long a piece lasts, in seconds. */
export function pieceLength(piece) {
  return (piece.bars * piece.beats * 60) / piece.tempo;
}

/* ---------- Instruments ---------- */

/** One voice: an oscillator through an envelope, into `out`. Returns the oscillator (to bend it). */
function tone(ctx, out, { type = "sine", freq, at, attack = 0.005, length, level, detune = 0 }) {
  const start = ctx.currentTime + Math.max(0, at);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.05);
  return osc;
}

/** A plucked nylon string: a bright attack that mellows and dies away. */
function guitar(ctx, out, freq, at, length, level) {
  const start = ctx.currentTime + Math.max(0, at);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(3000, start);
  filter.frequency.exponentialRampToValueAtTime(500, start + 0.4);
  filter.connect(out);
  tone(ctx, filter, { type: "triangle", freq, at, attack: 0.004, length, level, detune: (Math.random() - 0.5) * 6 });
  tone(ctx, filter, { type: "sawtooth", freq, at, attack: 0.004, length: length * 0.6, level: level * 0.25 });
}

/** Piano: a bell-ish sine with soft upper partials, fading. */
function piano(ctx, out, freq, at, length, level) {
  for (const [ratio, part, decay] of [[1, 1, 1], [2, 0.25, 0.4], [3.01, 0.08, 0.15]]) {
    tone(ctx, out, { freq: freq * ratio, at, attack: 0.008, length: length * decay + 0.05, level: level * part, detune: (Math.random() - 0.5) * 8 });
  }
}

/** A music box: a high, glassy pluck with a quick metallic shimmer. */
function musicBox(ctx, out, freq, at, length, level) {
  for (const [ratio, part, decay] of [[1, 1, 1], [3.93, 0.3, 0.35], [6.2, 0.12, 0.2]]) {
    tone(ctx, out, { freq: freq * ratio, at, attack: 0.002, length: length * decay, level: level * part });
  }
}

/** A guitar harmonic: a pure, bell-like high sine. */
function harmonic(ctx, out, freq, at, length, level) {
  tone(ctx, out, { freq, at, attack: 0.003, length, level });
  tone(ctx, out, { freq: freq * 2, at, attack: 0.003, length: length * 0.4, level: level * 0.15 });
}

/** A soft flute: a sine with a delayed vibrato and a breath of air at the start. */
function flute(ctx, out, freq, at, length, level, noise) {
  const start = ctx.currentTime + Math.max(0, at);
  const osc = ctx.createOscillator();
  osc.frequency.value = freq;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.2;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, start);
  depth.gain.linearRampToValueAtTime(freq * 0.008, start + Math.min(0.4, length * 0.5));
  lfo.connect(depth).connect(osc.frequency);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.06);
  gain.gain.setValueAtTime(level * 0.85, start + length * 0.7);
  gain.gain.linearRampToValueAtTime(0, start + length);
  osc.connect(gain).connect(out);
  for (const o of [osc, lfo]) {
    o.start(start);
    o.stop(start + length + 0.05);
  }
  if (noise) {
    const breath = ctx.createBufferSource();
    breath.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq * 2;
    band.Q.value = 2;
    const air = ctx.createGain();
    air.gain.setValueAtTime(level * 0.3, start);
    air.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
    breath.connect(band).connect(air).connect(out);
    breath.start(start, Math.random(), 0.15);
  }
}

/** A bowed cello: a dark sawtooth swelling slowly, with a gentle vibrato. */
function cello(ctx, out, freq, at, length, level) {
  const start = ctx.currentTime + Math.max(0, at);
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = freq;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 4.6;
  const depth = ctx.createGain();
  depth.gain.value = freq * 0.006;
  lfo.connect(depth).connect(osc.frequency);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + Math.min(0.6, length * 0.4));
  gain.gain.setValueAtTime(level, start + length * 0.7);
  gain.gain.linearRampToValueAtTime(0, start + length);
  osc.connect(filter).connect(gain).connect(out);
  for (const o of [osc, lfo]) {
    o.start(start);
    o.stop(start + length + 0.05);
  }
}

/** A warm pad: detuned soft saws swelling in and out. */
function pad(ctx, out, freqs, at, length, level) {
  const start = ctx.currentTime + Math.max(0, at);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 900;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + length * 0.35);
  gain.gain.linearRampToValueAtTime(0, start + length);
  filter.connect(gain).connect(out);
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

/** An upright bass: a round, plucked low note. */
function uprightBass(ctx, out, freq, at, length, level) {
  tone(ctx, out, { freq, at, attack: 0.01, length, level });
  tone(ctx, out, { type: "triangle", freq: freq * 2, at, attack: 0.005, length: length * 0.3, level: level * 0.2 });
}

/** A quiet shaker: a tick of high noise. */
function shaker(ctx, out, at, level, noise) {
  if (!noise) return;
  const start = ctx.currentTime + Math.max(0, at);
  const source = ctx.createBufferSource();
  source.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = 6000;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(level, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.07);
  source.connect(filter).connect(gain).connect(out);
  source.start(start, Math.random(), 0.08);
}

/** An echo: notes fade back again and again, darker each time. */
function echo(ctx, out, time = 0.55) {
  const input = ctx.createGain();
  const delay = ctx.createDelay(2);
  delay.delayTime.value = time;
  const back = ctx.createGain();
  back.gain.value = 0.45;
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 1800;
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  input.connect(out);
  input.connect(delay).connect(damp).connect(back).connect(delay);
  damp.connect(wet).connect(out);
  return input;
}

/* ---------- The tune ---------- */

/**
 * A tune: a two-bar motif (rhythm and steps along the scale), played A A B A
 * over each four bars, the B a fresh motif; the second A shifts a little. The
 * same seed gives the same tune. Returns notes as { bar, beat, length, freq }.
 */
function tune(piece) {
  if (!piece.density) return [];
  const random = seeded(piece.seed);
  const scale = piece.scale.map(note);
  const slotsPerBar = piece.beats * 2;
  const motif = () => {
    const notes = [];
    let step = Math.floor(scale.length / 2);
    for (let bar = 0; bar < 2; bar += 1) {
      const count = Math.max(1, Math.round(piece.density * (0.7 + random() * 0.6)));
      const slots = [...Array(slotsPerBar).keys()].sort(() => random() - 0.5).slice(0, count).sort((a, b) => a - b);
      slots.forEach((slot, i) => {
        step = Math.max(0, Math.min(scale.length - 1, step + Math.round((random() - 0.45) * 3)));
        const next = slots[i + 1] ?? slotsPerBar;
        notes.push({ bar, slot, slots: next - slot, step });
      });
    }
    return notes;
  };
  const a = motif();
  const b = motif();
  const notes = [];
  for (let start = 0; start < piece.bars; start += 2) {
    const phrase = Math.floor(start / 2) % 4;
    // A A B A: the second A shifts a step, B is the other motif.
    const use = phrase === 2 ? b : a;
    const shift = phrase === 1 ? (random() < 0.5 ? 1 : -1) : 0;
    for (const n of use) {
      const bar = start + n.bar;
      if (bar >= piece.bars) continue;
      const step = Math.max(0, Math.min(scale.length - 1, n.step + shift));
      notes.push({ bar, beat: n.slot / 2, length: n.slots / 2, freq: scale[step] });
    }
  }
  return notes;
}

/* ---------- Playing a piece ---------- */

/**
 * Schedule a whole piece into `destination` (with `noise`, a buffer of white
 * noise, for breath and the shaker); returns a function that fades it out
 * and stops it.
 */
export function playPiece(ctx, destination, piece, noise = null) {
  const out = ctx.createGain();
  out.gain.value = 0;
  // Each piece at its own level (measured), so none is louder than the rest.
  out.gain.linearRampToValueAtTime(piece.level ?? 1, ctx.currentTime + 1.5);
  const color = ctx.createBiquadFilter();
  color.type = "lowpass";
  color.frequency.value = 3400;
  out.connect(color).connect(destination);
  const night = piece.family === "night";
  const wet = night ? echo(ctx, out) : echo(ctx, out, 0.32);
  const beat = 60 / piece.tempo;
  const bar = beat * piece.beats;
  const human = () => (Math.random() - 0.5) * 0.025;
  const swing = (eighth) => (eighth % 2 ? (piece.swing ?? 0) * beat : 0);
  const chordAt = (b) => piece.chords[b % piece.chords.length].map(note);

  // The accompaniment.
  for (let b = 0; b < piece.bars; b += 1) {
    const chord = chordAt(b);
    const at = b * bar;
    switch (piece.accompany) {
      case "fingerpick":
        [0, 2, 3, 4, 3, 2, 1, 2].forEach((t, i) => guitar(ctx, out, chord[t], at + i * beat * 0.5 + human(), 1.8, i === 0 ? 0.04 : 0.024));
        break;
      case "strum": {
        // Down on the beat, a lighter up in between; each a quick spread across the strings.
        const strokes = [[0, 1], [1.5, 0.5], [2, 0.8], [2.5, 0.45], [3.5, 0.5]];
        for (const [pos, weight] of strokes) {
          const up = pos % 1 !== 0;
          const strings = up ? [...chord].reverse() : chord;
          strings.forEach((freq, i) => guitar(ctx, out, freq, at + pos * beat + swing(pos * 2) + i * 0.012 + human(), 0.9, 0.018 * weight));
        }
        break;
      }
      case "waltz":
        guitar(ctx, out, chord[0], at + human(), 1.4, 0.045);
        for (const pos of [1, 2]) chord.slice(2).forEach((freq, i) => guitar(ctx, out, freq, at + pos * beat + i * 0.01 + human(), 0.6, 0.016));
        break;
      case "harp":
        // Rolling up the whole chord and back, like a harp.
        [...chord, ...chord.slice(1, -1).reverse()].forEach((freq, i) => guitar(ctx, out, freq, at + i * (bar / (chord.length * 2 - 2)) + human(), 2.2, 0.022));
        break;
      case "travis": {
        // Alternating bass with the thumb, chord tones plucked between.
        const pattern = [[0, 0.04], [3, 0.022], [1, 0.034], [4, 0.022], [0, 0.04], [3, 0.022], [1, 0.034], [2, 0.022]];
        pattern.forEach(([t, level], i) => guitar(ctx, out, chord[t], at + i * beat * 0.5 + human(), 0.9, level));
        break;
      }
      case "pianoChords":
        // Low, slow chords: rolled a little, once a bar, the top note held.
        chord.forEach((freq, i) => piano(ctx, wet, freq, at + i * 0.05 + human(), bar * 1.1, 0.016));
        break;
      case "musicbox": {
        // A turning music box over a faint pad.
        const notes = piece.ostinato.map(note);
        notes.forEach((freq, i) => musicBox(ctx, wet, freq, at + i * (bar / notes.length) + human() * 0.5, 1.2, 0.016));
        if (b % 2 === 0) pad(ctx, out, chord, at, bar * 2.2, 0.007);
        break;
      }
      case "pad":
      default:
        if (b % 2 === 0) pad(ctx, out, chord, at, bar * 2.2, 0.01);
        break;
    }
    if (piece.bass) {
      uprightBass(ctx, out, chord[0] / (chord[0] > 150 ? 2 : 1), at + human(), beat * 1.4, 0.06);
      uprightBass(ctx, out, chord[1] / (chord[1] > 150 ? 2 : 1), at + beat * 2 + human(), beat * 1.4, 0.05);
    }
    if (piece.shaker) for (let i = 0; i < piece.beats * 2; i += 1) shaker(ctx, out, at + i * beat * 0.5 + human() * 0.5, i % 2 ? 0.008 : 0.014, noise);
  }

  // The tune.
  for (const n of tune(piece)) {
    const at = n.bar * bar + n.beat * beat + human();
    const length = Math.max(0.25, n.length * beat);
    switch (piece.lead) {
      case "flute":
        flute(ctx, wet, n.freq, at, length * 0.95, 0.02, noise);
        break;
      case "musicbox":
        musicBox(ctx, wet, n.freq, at, 1.4, 0.02);
        break;
      case "harmonics":
        harmonic(ctx, wet, n.freq, at, 2.5, 0.016);
        break;
      case "piano":
        piano(ctx, wet, n.freq, at, Math.max(1.6, length), 0.02);
        break;
      case "cello":
        cello(ctx, wet, n.freq, at, length * 1.05, 0.03);
        break;
      case "guitar":
      default:
        guitar(ctx, out, n.freq, at, 1.6, 0.034);
        break;
    }
  }

  // The last chord rings out.
  const last = chordAt(0);
  if (night) piano(ctx, wet, last[0], piece.bars * bar, 3, 0.016);
  else last.forEach((freq, i) => guitar(ctx, out, freq, piece.bars * bar + i * 0.06, 3, 0.026));

  return () => {
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    setTimeout(() => out.disconnect(), 3000);
  };
}
