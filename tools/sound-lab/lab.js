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
    chosen: [],
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
    chosen: [],
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
