/*
 * Sound lab: candidates for each game sound, synthesized live with Web Audio,
 * to listen to side by side and pick. Each section is one sound from the list
 * (by its id); each candidate has a number to name when choosing.
 */

let ctx = null;
let master = null;
let noise = null;

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
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
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
function wash({ at = 0, type = "lowpass", from, to = from, q = 0.7, attack = 0.006, length, level, pan = 0 }) {
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = noise;
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
    chosen: [],
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
];

/* Build the page: a section per sound, a button per candidate (numbered). */
const root = document.querySelector("#sections");
for (const section of SECTIONS) {
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
      sound.play();
      button.classList.add("is-playing");
      setTimeout(() => button.classList.remove("is-playing"), 900);
    });
    grid.append(button);
  });
  root.append(heading, note, grid);
}
