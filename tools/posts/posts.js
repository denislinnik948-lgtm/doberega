import { FISH, LOCATIONS, RODS } from "../../src/fishing/data.js";
import { fishSprite, rodSprite } from "../../src/fishing/sprites.js";
import { P } from "../../src/fishing/palette.js";
import { nameOf, setLanguage, traitLabel, traitValue } from "../../src/i18n.js";

/**
 * Instagram posts for Doberega (1080x1350, the 4:5 portrait feeds like best):
 * the game's own scenes, fish and rods, in its palette and its Handjet font.
 * The scenes are real frames from the game, saved in shots/ (see README there).
 *
 * "Зберегти" (or ?save) posts every one as a JPEG to tools/posts/save.py, which writes posts/.
 * ?lang=en makes the English set, saved into posts/en/.
 */

const LANG = new URLSearchParams(location.search).get("lang") === "en" ? "en" : "uk";
setLanguage(LANG);

/** Every line of text on the posts, in both languages. */
const TEXT = {
  uk: {
    title: "ДОБЕРЕГА",
    tagline: "тиша та спокій",
    pitch: "Риболовля з символів. Безкоштовно, просто в браузері.",
    spots: "ВОДОЙМИ",
    fishUpTo: (kg, list) => `Риба до ${kg} кг: ${list.join(", ").toLowerCase()}.`,
    fish: "РИБА",
    fishTitle: (n) => `${n} вид риби`,
    fishLine: "від верховодки на кілька грамів до сома на 60 кг",
    fishTitle2: "І ті, що важчі",
    fishLine2: "для них знадобиться добра вудка і терпіння",
    secret: "Секрет",
    odds: "1 на 25 000",
    redBook: "Червона книга",
    upTo: (w) => `до ${w}`,
    rods: "ВУДКИ",
    rodsTitle: "Від лози до сомової",
    rodsLine: "вісім вудок, і кожна тримає важчу рибу",
    holds: (w) => `тримає до ${w}`,
    free: "на старті",
    sky: "НЕБО",
    skyTitle: "Жодного однакового вечора",
    strips: ["малиновий захід над ставком", "вогняний захід над Замковим озером", "рожевий світанок на Прип'яті"],
    skyText: "Кожен захід і світанок має свої барви: золоті, багряні, малинові, вогняні, бузкові. І бачать їх усі рибалки одночасно.",
    weather: "ПОГОДА",
    storm: "Гроза",
    stormText: "Дощ тут нечастий гість. Та коли над старим мостом гримить, риба клює вдвічі жвавіше. Тільки не забудь каптур.",
    nightLabel: "НІЧ",
    night: "Ніч на воді",
    nightText: "Глибокої ночі на воді діється дивне: бліді вогники над тим берегом, човен без весел, очі біля самого берега. Що ще, побачиш сам.",
    gram: "г",
    kilo: "кг",
  },
  en: {
    title: "DOBEREGA",
    tagline: "quiet and calm",
    pitch: "Fishing drawn in characters. Free, right in your browser.",
    spots: "WATERS",
    fishUpTo: (kg, list) => `Fish up to ${kg} kg: ${list.join(", ").toLowerCase()}.`,
    fish: "FISH",
    fishTitle: (n) => `${n} kinds of fish`,
    fishLine: "from a bleak of a few grams to a 60 kg catfish",
    fishTitle2: "And the heavy ones",
    fishLine2: "for these you need a good rod and patience",
    secret: "Secret",
    odds: "1 in 25,000",
    redBook: "Red Book",
    upTo: (w) => `up to ${w}`,
    rods: "RODS",
    rodsTitle: "From a willow switch up",
    rodsLine: "eight rods, each one holds a heavier fish",
    holds: (w) => `holds up to ${w}`,
    free: "starter",
    sky: "SKY",
    skyTitle: "No two evenings alike",
    strips: ["a raspberry sunset over the pond", "a fiery sunset over the castle lake", "a rose dawn at Pripyat"],
    skyText: "Every sunset and dawn has its own colours: golden, crimson, raspberry, fiery, lilac. And every angler sees the same sky at the same moment.",
    weather: "WEATHER",
    storm: "Storm",
    stormText: "Rain is a rare guest here. But when thunder rolls over the old bridge, the fish bite twice as eagerly. Just bring a hood.",
    nightLabel: "NIGHT",
    night: "Night on the water",
    nightText: "Deep in the night strange things happen: pale lights over the far shore, a boat with no oars, eyes by the bank. The rest, see for yourself.",
    gram: "g",
    kilo: "kg",
  },
}[LANG];

const W = 1080;
const H = 1350;
const BG = P.ink;
const FONT = '"Handjet", monospace';
const SITE = "doberega.site";

const SHOT = {
  pond: "pond-sunset",
  lake: "lake-day",
  castle: "castle-sunset",
  reservoir: "reservoir-dawn",
  bridge: "bridge-day",
};

const images = new Map();
const load = (name) => {
  if (!images.has(name)) {
    images.set(name, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `./shots/${name}.jpg`;
    }));
  }
  return images.get(name);
};

/* ---------- Drawing helpers ---------- */

function canvas() {
  const node = document.createElement("canvas");
  node.width = W;
  node.height = H;
  const ctx = node.getContext("2d");
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  return { node, ctx };
}

/** Fill a box with an image, cropped like CSS `cover`; `fx`, `fy` pick which part stays. */
function cover(ctx, image, x, y, w, h, fx = 0.5, fy = 0.5) {
  const scale = Math.max(w / image.width, h / image.height);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (image.width - sw) * fx, (image.height - sh) * fy, sw, sh, x, y, w, h);
}

/** A fade from clear to the background, over a band. */
function fade(ctx, from, to, strength = 1) {
  const gradient = ctx.createLinearGradient(0, from, 0, to);
  gradient.addColorStop(0, "rgba(10, 20, 18, 0)");
  gradient.addColorStop(1, `rgba(10, 20, 18, ${strength})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, from, W, to - from);
  if (strength >= 1) {
    ctx.fillStyle = BG;
    ctx.fillRect(0, to, W, H - to);
  }
}

/** The game's window frame: a bone line, a darker inner line and gold corner studs. */
function frame(ctx, x, y, w, h) {
  ctx.save();
  ctx.strokeStyle = P.bone;
  ctx.lineWidth = 4;
  ctx.strokeRect(x - 8, y - 8, w + 16, h + 16);
  ctx.strokeStyle = P.mid;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = P.gold;
  for (const [cx, cy] of [[x - 8, y - 8], [x + w + 8, y - 8], [x - 8, y + h + 8], [x + w + 8, y + h + 8]]) ctx.fillRect(cx - 8, cy - 8, 16, 16);
  ctx.restore();
}

function text(ctx, value, x, y, { size = 40, weight = 500, color = P.bone, align = "left", spacing = 0, shadow = false } = {}) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.letterSpacing = `${spacing}px`;
  if (shadow) {
    ctx.shadowColor = "rgba(0, 0, 0, 0.75)";
    ctx.shadowBlur = 18;
  }
  ctx.fillText(value, x, y);
  ctx.restore();
}

/** Wrapped text; returns the y below the last line. */
function paragraph(ctx, value, x, y, width, { size = 38, lineHeight = size * 1.25, ...style } = {}) {
  ctx.save();
  ctx.font = `${style.weight ?? 500} ${size}px ${FONT}`;
  const lines = [];
  let line = "";
  for (const word of value.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  ctx.restore();
  const align = style.align ?? "left";
  const ax = align === "center" ? x + width / 2 : x;
  lines.forEach((row, i) => text(ctx, row, ax, y + i * lineHeight, { size, ...style, align }));
  return y + lines.length * lineHeight;
}

/** Top line of every post: the game's name and, in a carousel, the page. */
function header(ctx, label, page = "") {
  text(ctx, TEXT.title, 60, 72, { size: 34, weight: 600, color: P.gold, spacing: 6 });
  text(ctx, label, W / 2, 72, { size: 34, weight: 500, color: P.soft, align: "center", spacing: 4 });
  if (page) text(ctx, page, W - 60, 72, { size: 34, weight: 500, color: P.soft, align: "right" });
}

function footer(ctx, color = P.soft) {
  text(ctx, SITE, W / 2, H - 50, { size: 36, weight: 500, color, align: "center", spacing: 3 });
}

/** A sprite canvas drawn crisp, fitted into a box and centred. */
function sprite(ctx, source, x, y, w, h) {
  const scale = Math.min(w / source.width, h / source.height);
  const dw = source.width * scale;
  const dh = source.height * scale;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  ctx.restore();
}

const weight = (kg) => (kg < 1 ? `${Math.round(kg * 1000)} ${TEXT.gram}` : `${LANG === "uk" ? String(kg).replace(".", ",") : kg} ${TEXT.kilo}`);
const money = (value) => (value ? `${value.toLocaleString(LANG === "uk" ? "uk-UA" : "en-US").replace(/\s/g, " ")} ₴` : TEXT.free);

/* ---------- The posts ---------- */

async function intro() {
  const { node, ctx } = canvas();
  cover(ctx, await load("pond-sunset"), 0, 0, W, 1040, 0.5, 0.4);
  fade(ctx, 700, 1040);
  text(ctx, TEXT.title, W / 2, 1110, { size: 168, weight: 700, color: P.gold, align: "center", spacing: 10, shadow: true });
  text(ctx, TEXT.tagline, W / 2, 1180, { size: 60, weight: 500, color: P.bone, align: "center", spacing: 2 });
  text(ctx, TEXT.pitch, W / 2, 1238, { size: 36, color: P.light, align: "center" });
  footer(ctx, P.gold);
  return node;
}

async function spot(index) {
  const place = LOCATIONS[index];
  const { node, ctx } = canvas();
  header(ctx, TEXT.spots, `${index + 1} / ${LOCATIONS.length}`);
  frame(ctx, 70, 120, 940, 705);
  cover(ctx, await load(SHOT[place.id]), 70, 120, 940, 705);
  text(ctx, nameOf("location", place.id), 70, 920, { size: 84, weight: 700, color: P.gold });
  const traits = Object.entries(place.traits);
  traits.forEach(([key, value], i) => {
    const x = 70 + (i % 2) * 480;
    const y = 985 + Math.floor(i / 2) * 82;
    text(ctx, traitLabel(key), x, y, { size: 30, color: P.soft });
    text(ctx, traitValue(key, value), x, y + 40, { size: 42, weight: 600, color: P.bone });
  });
  const fish = Object.keys(place.fish).filter((id) => !FISH[id].protected).map((id) => nameOf("fish", id));
  paragraph(ctx, TEXT.fishUpTo(place.maxKg, fish), 70, 1175, 940, { size: 32, lineHeight: 38, color: P.light });
  footer(ctx);
  return node;
}

/** Every species worth collecting, lightest first. */
const SPECIES = Object.keys(FISH).filter((id) => !FISH[id].unique && !FISH[id].junk).sort((a, b) => FISH[a].max - FISH[b].max);

async function fishPage(page) {
  const { node, ctx } = canvas();
  const perPage = 12;
  const list = SPECIES.slice(page * perPage, page * perPage + perPage);
  header(ctx, TEXT.fish, `${page + 1} / 2`);
  if (page === 0) {
    text(ctx, TEXT.fishTitle(SPECIES.length), 60, 175, { size: 78, weight: 700, color: P.gold });
    text(ctx, TEXT.fishLine, 60, 225, { size: 36, color: P.light });
  } else {
    text(ctx, TEXT.fishTitle2, 60, 175, { size: 78, weight: 700, color: P.gold });
    text(ctx, TEXT.fishLine2, 60, 225, { size: 36, color: P.light });
  }
  // Two columns of tiles; the second page ends with the secrets, shown only as "?".
  const tiles = [...list.map((id) => ({ id })), ...Array.from({ length: perPage - list.length }, () => ({ secret: true }))];
  tiles.forEach((tile, i) => {
    const x = 60 + (i % 2) * 490;
    const y = 270 + Math.floor(i / 2) * 170;
    ctx.fillStyle = P.deep;
    ctx.fillRect(x, y, 470, 152);
    ctx.strokeStyle = P.dark;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, 468, 150);
    if (tile.secret) {
      text(ctx, "?", x + 120, y + 112, { size: 120, weight: 700, color: P.mid, align: "center" });
      text(ctx, TEXT.secret, x + 250, y + 70, { size: 40, weight: 600, color: P.bone });
      text(ctx, TEXT.odds, x + 250, y + 112, { size: 32, color: P.gold });
      return;
    }
    sprite(ctx, fishSprite(tile.id, 4), x + 14, y + 16, 220, 120);
    text(ctx, nameOf("fish", tile.id), x + 250, y + 70, { size: 40, weight: 600, color: P.bone });
    const note = FISH[tile.id].protected ? TEXT.redBook : TEXT.upTo(weight(FISH[tile.id].max));
    text(ctx, note, x + 250, y + 112, { size: 32, color: FISH[tile.id].protected ? P.ember : P.gold });
  });
  footer(ctx);
  return node;
}

async function rods() {
  const { node, ctx } = canvas();
  header(ctx, TEXT.rods);
  text(ctx, TEXT.rodsTitle, 60, 175, { size: 78, weight: 700, color: P.gold });
  text(ctx, TEXT.rodsLine, 60, 225, { size: 36, color: P.light });
  Object.entries(RODS).forEach(([id, rod], i) => {
    const y = 268 + i * 122;
    ctx.fillStyle = i % 2 ? BG : P.deep;
    ctx.fillRect(60, y, W - 120, 112);
    sprite(ctx, rodSprite(rod.tier, 4), 76, y + 6, 100, 100);
    text(ctx, nameOf("rod", id), 200, y + 54, { size: 44, weight: 600, color: P.bone });
    text(ctx, TEXT.holds(weight(rod.maxKg)), 200, y + 94, { size: 32, color: P.light });
    text(ctx, money(rod.price), W - 84, y + 72, { size: 42, weight: 600, color: P.gold, align: "right" });
  });
  footer(ctx);
  return node;
}

async function skies() {
  const { node, ctx } = canvas();
  header(ctx, TEXT.sky);
  text(ctx, TEXT.skyTitle, 60, 175, { size: 72, weight: 700, color: P.gold });
  const strips = [
    ["pond-sunset", TEXT.strips[0], 0.6, 0.25],
    ["castle-sunset", TEXT.strips[1], 0.5, 0.2],
    ["reservoir-dawn", TEXT.strips[2], 0.5, 0.25],
  ];
  for (const [i, [name, label, fx, fy]] of strips.entries()) {
    const y = 250 + i * 300;
    frame(ctx, 70, y, 940, 230);
    cover(ctx, await load(name), 70, y, 940, 230, fx, fy);
    text(ctx, label, 90, y + 210, { size: 34, weight: 600, color: P.bone, shadow: true });
  }
  paragraph(ctx, TEXT.skyText, 70, 1190, 940, { size: 36, color: P.light });
  footer(ctx);
  return node;
}

/** A whole-post scene with a title and a few lines at the bottom. */
async function scenePost(name, fx, label, title, body) {
  const { node, ctx } = canvas();
  cover(ctx, await load(name), 0, 0, W, H, fx, 0.5);
  const top = ctx.createLinearGradient(0, 0, 0, 160);
  top.addColorStop(0, "rgba(10, 20, 18, 0.7)");
  top.addColorStop(1, "rgba(10, 20, 18, 0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, 160);
  fade(ctx, 820, 1350, 0.92);
  header(ctx, label);
  text(ctx, title, 70, 1080, { size: 110, weight: 700, color: P.bone, shadow: true });
  paragraph(ctx, body, 70, 1150, 940, { size: 38, color: P.light });
  footer(ctx, P.gold);
  return node;
}

const storm = () => scenePost("bridge-storm", 0.62, TEXT.weather, TEXT.storm, TEXT.stormText);

const night = () => scenePost("castle-night", 0.55, TEXT.nightLabel, TEXT.night, TEXT.nightText);

const POSTS = [
  ["01-intro", intro],
  ...LOCATIONS.map((place, i) => [`02-spot-${i + 1}-${place.id}`, () => spot(i)]),
  ["03-fish-1", () => fishPage(0)],
  ["03-fish-2", () => fishPage(1)],
  ["04-rods", rods],
  ["05-sky", skies],
  ["06-storm", storm],
  ["07-night", night],
];

async function main() {
  await document.fonts.load(`700 40px ${FONT}`);
  await document.fonts.load(`500 40px ${FONT}`);
  await document.fonts.load(`600 40px ${FONT}`);
  const rendered = [];
  for (const [name, build] of POSTS) {
    const node = await build();
    const figure = document.createElement("figure");
    const caption = document.createElement("figcaption");
    caption.textContent = name;
    figure.append(node, caption);
    document.querySelector("#posts").append(figure);
    rendered.push([name, node]);
  }
  const save = async () => {
    for (const [name, node] of rendered) {
      const blob = await new Promise((resolve) => node.toBlob(resolve, "image/jpeg", 0.93));
      await fetch(`http://127.0.0.1:8002/save?name=${name}.jpg${LANG === "en" ? "&dir=en" : ""}`, { method: "POST", body: blob });
    }
    document.querySelector("#save").textContent = `Збережено: ${rendered.length}`;
  };
  document.querySelector("#save").addEventListener("click", save);
  if (new URLSearchParams(location.search).has("save")) await save();
  window.postsReady = true;
}

main();
