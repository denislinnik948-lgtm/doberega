/**
 * Background music: short calm pieces, generated with Web Audio (no audio
 * files). Two families, picked in the sound lab: nylon-guitar pieces for day,
 * dusk and dawn (lab: Мз2), and night pieces of soft pads and sparse piano
 * with an echo (lab: Мз3). Each piece has its own chords, tempo, picking and
 * a melody written from its chords by a fixed seed, so it is recognisable,
 * while the playing (timing, touch) is a little different every time.
 *
 * `playPiece(ctx, destination, piece)` schedules a whole piece and
 * returns a function that fades it out. The game (sound.js) decides when
 * music plays; the sound lab (tools/sound-lab) plays the same pieces.
 */

const NAMES = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };

/** "A3" → its frequency in Hz. */
export function note(name) {
  const [, pitch, octave] = name.match(/^([A-G][#b]?)(-?\d)$/);
  return 440 * 2 ** ((NAMES[pitch] + (Number(octave) + 1) * 12 - 69) / 12);
}

/** A small seeded random, so a piece's melody is the same every time it plays. */
function seeded(seed) {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}

/*
 * The pieces. `chords` are voicings (low to high); `pattern` picks which
 * chord tones the guitar plucks on each eighth note; `melody` is the seed for
 * the tune above it, drawn from `scale`.
 */
export const PIECES = [
  // Guitar: day, dusk and dawn.
  { id: "quiet-bank", title: "Тихий берег", family: "guitar", tempo: 80, bars: 16, seed: 11,
    chords: [["A2", "E3", "A3", "C4", "E4"], ["F2", "C3", "F3", "A3", "C4"], ["C3", "G3", "C4", "E4", "G4"], ["G2", "D3", "G3", "B3", "D4"]],
    pattern: [0, 2, 3, 4, 3, 2, 1, 2], scale: ["A4", "B4", "C5", "D5", "E5", "G5", "A5"] },
  { id: "summer-evening", title: "Літній вечір", family: "guitar", tempo: 76, bars: 16, seed: 23,
    chords: [["C3", "G3", "C4", "E4", "G4"], ["A2", "E3", "A3", "C4", "E4"], ["D3", "A3", "D4", "F4", "A4"], ["G2", "D3", "G3", "B3", "F4"]],
    pattern: [0, 3, 2, 4, 1, 3, 2, 4], scale: ["C5", "D5", "E5", "G5", "A5", "C6"] },
  { id: "old-willow", title: "Стара верба", family: "guitar", tempo: 72, bars: 16, seed: 37, waltz: true,
    chords: [["E2", "B2", "E3", "G3", "B3"], ["C3", "G3", "C4", "E4", "G4"], ["G2", "D3", "G3", "B3", "D4"], ["D3", "A3", "D4", "F#4", "A4"]],
    pattern: [0, 2, 3, 4, 3, 2], scale: ["E4", "F#4", "G4", "A4", "B4", "D5", "E5"] },
  { id: "morning-mist", title: "Ранковий туман", family: "guitar", tempo: 68, bars: 12, seed: 51,
    chords: [["D3", "A3", "D4", "F4", "A4"], ["A#2", "F3", "A#3", "D4", "F4"], ["F2", "C3", "F3", "A3", "C4"], ["C3", "G3", "C4", "E4", "G4"]],
    pattern: [0, 3, 4, 2, 4, 3, 1, 3], scale: ["D5", "E5", "F5", "A5", "C6", "D6"] },
  // Night: pads and sparse piano with an echo.
  { id: "night-water", title: "Ніч над водою", family: "night", tempo: 56, bars: 12, seed: 61,
    chords: [["A2", "C3", "E3", "B3"], ["F2", "A2", "C3", "E3"], ["D2", "F2", "A2", "C3"], ["E2", "G#2", "B2", "D3"]],
    scale: ["A4", "B4", "C5", "E5", "G5", "A5"] },
  { id: "moon-path", title: "Місячна доріжка", family: "night", tempo: 52, bars: 12, seed: 73,
    chords: [["F2", "A2", "C3", "E3"], ["E2", "G2", "B2", "D3"], ["D2", "F2", "A2", "C3"], ["C2", "E2", "G2", "B2"]],
    scale: ["C5", "D5", "E5", "G5", "A5", "C6"] },
  { id: "stars", title: "Зорі", family: "night", tempo: 50, bars: 10, seed: 89,
    chords: [["C2", "G2", "B2", "E3"], ["A1", "E2", "G2", "C3"]],
    scale: ["E5", "G5", "B5", "C6", "D6", "E6"] },
];

/** How long a piece lasts, in seconds. */
export function pieceLength(piece) {
  return (piece.bars * (piece.waltz ? 3 : 4) * 60) / piece.tempo;
}

/* ---------- Instruments ---------- */

/** A plucked nylon string: a bright attack that mellows and dies away. */
function guitar(ctx, out, freq, at, length, level) {
  const start = ctx.currentTime + at;
  const string = ctx.createOscillator();
  string.type = "triangle";
  string.frequency.value = freq;
  string.detune.value = (Math.random() - 0.5) * 6;
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
  string.connect(filter);
  body.connect(bodyGain).connect(filter);
  filter.connect(gain).connect(out);
  for (const osc of [string, body]) {
    osc.start(start);
    osc.stop(start + length + 0.05);
  }
}

/** Electric piano: a bell-ish sine with soft upper partials, fading. */
function piano(ctx, out, freq, at, length, level) {
  const start = ctx.currentTime + at;
  for (const [ratio, part, decay] of [[1, 1, 1], [2, 0.25, 0.4], [3.01, 0.08, 0.15]]) {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq * ratio;
    osc.detune.value = (Math.random() - 0.5) * 8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level * part, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length * decay + 0.05);
    osc.connect(gain).connect(out);
    osc.start(start);
    osc.stop(start + length + 0.1);
  }
}

/** A warm pad: detuned soft saws swelling in and out. */
function pad(ctx, out, freqs, at, length, level) {
  const start = ctx.currentTime + at;
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

/** An echo for the night pieces: notes fade back again and again, darker each time. */
function echo(ctx, out) {
  const input = ctx.createGain();
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.55;
  const back = ctx.createGain();
  back.gain.value = 0.45;
  const damp = ctx.createBiquadFilter();
  damp.type = "lowpass";
  damp.frequency.value = 1800;
  const wet = ctx.createGain();
  wet.gain.value = 0.6;
  input.connect(out);
  input.connect(delay).connect(damp).connect(back).connect(delay);
  damp.connect(wet).connect(out);
  return input;
}

/**
 * A melody for a piece: per bar a few notes from its scale, mostly stepping,
 * leaning on the chord's tones, with rests. The same seed gives the same tune.
 */
function melody(piece) {
  const random = seeded(piece.seed);
  const beats = piece.waltz ? 3 : 4;
  const scale = piece.scale.map(note);
  const notes = [];
  let index = Math.floor(scale.length / 2);
  for (let bar = 0; bar < piece.bars; bar += 1) {
    // The first and last bars, and every fourth one, breathe: fewer notes.
    const sparse = bar === 0 || bar === piece.bars - 1 || bar % 4 === 3;
    const count = sparse ? 1 : 1 + Math.floor(random() * (piece.family === "night" ? 2 : 3));
    const slots = [...Array(beats * 2).keys()].sort(() => random() - 0.5).slice(0, count).sort((a, b) => a - b);
    for (const slot of slots) {
      index = Math.max(0, Math.min(scale.length - 1, index + Math.round((random() - 0.5) * 3)));
      notes.push({ bar, beat: slot / 2, freq: scale[index] });
    }
  }
  return notes;
}

/**
 * Schedule a whole piece into `destination`; returns a function that fades
 * it out and stops it.
 */
export function playPiece(ctx, destination, piece) {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3200;
  out.connect(tone).connect(destination);
  const beat = 60 / piece.tempo;
  const beats = piece.waltz ? 3 : 4;
  const bar = beat * beats;
  const human = () => (Math.random() - 0.5) * 0.025;

  if (piece.family === "guitar") {
    for (let b = 0; b < piece.bars; b += 1) {
      const chord = piece.chords[b % piece.chords.length].map(note);
      piece.pattern.forEach((tone, i) => guitar(ctx, out, chord[tone], b * bar + i * beat * 0.5 + human(), 1.8, i === 0 ? 0.04 : 0.026));
    }
    for (const n of melody(piece)) guitar(ctx, out, n.freq, n.bar * bar + n.beat * beat + human(), 1.6, 0.034);
    // The last chord rings out.
    const last = piece.chords[0].map(note);
    last.forEach((freq, i) => guitar(ctx, out, freq, piece.bars * bar + i * 0.06, 3, 0.03));
  } else {
    const send = echo(ctx, out);
    for (let b = 0; b < piece.bars; b += 2) {
      pad(ctx, out, piece.chords[(b / 2) % piece.chords.length].map(note), b * bar, bar * 2.2, 0.01);
    }
    for (const n of melody(piece)) piano(ctx, send, n.freq, n.bar * bar + n.beat * beat + human(), 2.4, 0.018);
  }

  return () => {
    out.gain.cancelScheduledValues(ctx.currentTime);
    out.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
    setTimeout(() => out.disconnect(), 3000);
  };
}
