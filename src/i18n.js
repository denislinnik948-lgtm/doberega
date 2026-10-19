/**
 * Translations. English is the default; Ukrainian is picked automatically when
 * the system language is Ukrainian or Russian. A choice made in Settings is
 * remembered in localStorage.
 */

// The storage key keeps the game's old working name so existing saves carry over.
const KEY = "stillwater.lang";

const STRINGS = {
  en: {
    locale: "en-US",
    title: "Doberega — peace and quiet",
    "a11y.scene": "An ASCII lake at sunset where you can fish",
    "a11y.canvas": "A lake at sunset made of ASCII characters. Tap the water to cast; hold Space or a finger on the water to reel in.",
    "a11y.clock": "Time of day",
    "a11y.money": "Money",
    "a11y.rain": "Rain",
    "a11y.spot": "Fishing spot",
    "a11y.slider": "slider",
    "a11y.prevSpot": "Previous spot",
    "a11y.nextSpot": "Next spot",
    "a11y.menu": "Menu",
    "a11y.exit": "Back to the main menu",
    "a11y.exitTitle": "Menu",
    "a11y.rod": "Rod",
    "a11y.bait": "Bait",
    "a11y.hooks": "Hooks",
    "a11y.tension": "Line tension",
    "a11y.close": "Close",
    "a11y.less": "Fewer",
    "a11y.more": "More",
    "menu.fish": "Go fishing",
    "menu.shop": "Shop",
    "menu.pack": "Backpack",
    "menu.trophies": "Trophies",
    "menu.settings": "Settings",
    "catch.title": "Catch",
    "catch.sell": "Sell",
    "catch.mount": "Trophy",
    "catch.release": "Release",
    "catch.noMoney": "Not enough money for a trophy",
    "catch.free": "free",
    "catch.unique": "One of a kind: it can only become a trophy",
    "shop.title": "Shop",
    "shop.bait": "Bait",
    "shop.rods": "Rods",
    "shop.extras": "Extras",
    "shop.each": "{price} ₴ each",
    "shop.inPack": "In backpack: {count}",
    "shop.buy": "Buy · {total}",
    "shop.owned": "Owned",
    "shop.upTo": "up to {weight}",
    "shop.hooks": "Hooks",
    "pack.title": "Backpack",
    "pack.rods": "Rods",
    "pack.bait": "Bait",
    "pack.extras": "Extras",
    "pack.empty": "Nothing yet",
    "pack.read": "read",
    "handbook.title": "Angler's handbook",
    "handbook.rules": "What affects the bite",
    "handbook.where": "Where: {places}",
    "handbook.whereNone": "rarely seen",
    "handbook.baits": "Takes: {baits}",
    "handbook.baitsNone": "anything, reluctantly",
    "handbook.active": "Active: {times}",
    "trophies.title": "Trophies",
    "trophies.empty": "The wall is empty for now",
    "settings.title": "Settings",
    "settings.language": "Language",
    "toast.escape": "Lost it",
    "toast.duck": "A duck ate the bait",
    "toast.unsnagged": "Came free",
    "toast.snagSnap": "Snapped on a snag",
    "toast.lostBait": "−1 {bait}",
    "toast.lostHook": "−1 hook",
    "toast.trophy": "Trophy!",
    "toast.noBait": "No bait",
    "toast.noHooks": "No hooks",
    "unit.g": "g",
    "unit.kg": "kg",
    "unit.pcs": "pcs",
    periods: { night: "at night", dawn: "at dawn", morning: "in the morning", day: "by day", evening: "in the evening", dusk: "at dusk" },
    traitKeys: { type: "Type", depth: "Depth", bottom: "Bottom", current: "Current" },
    traits: {
      type: { pond: "Pond", lake: "Lake", river: "River", reservoir: "Reservoir" },
      depth: { shallow: "Shallow", medium: "Medium", deep: "Deep", veryDeep: "Very deep" },
      bottom: { mud: "Mud", sandWeed: "Sand, weed", stones: "Stones", clayLogs: "Clay, sunken logs", logsEddies: "Sunken logs, eddies" },
      current: { none: "None", weak: "Weak", moderate: "Moderate", strong: "Strong" },
    },
    names: {
      fish: {
        yorzh: "Ruffe", plitka: "Roach", krasnopirka: "Rudd", karas: "Crucian carp", okun: "Perch", lyn: "Tench",
        lyasch: "Bream", korop: "Carp", shchuka: "Pike", sudak: "Zander", som: "Catfish", valerka: "Valerka", boot: "Old boot",
      },
      bait: {
        bread: "Bread", worm: "Worm", maggot: "Maggot", bloodworm: "Bloodworm", barley: "Pearl barley",
        corn: "Corn", boilie: "Boilies", livebait: "Live bait", frog: "Frog",
      },
      rod: {
        willow: "Willow switch", hazel: "Hazel", bamboo: "Bamboo", telescope: "Telescopic",
        glass: "Fibreglass", carbon: "Carbon", carp: "Carp rod", catfish: "Catfish rod",
      },
      extra: {
        handbook: "Angler's handbook", glowfloat: "Glowing float", net: "Landing net", braid: "Braided line", sonar: "Fish finder",
      },
      extraText: {
        handbook: "Where, when and on what each fish bites best",
        glowfloat: "Easy to see at night",
        net: "Fish fight less near the bank",
        braid: "The tension bar fills more slowly",
        sonar: "Fish find the bait sooner",
      },
      location: {
        pond: "Village pond", lake: "Quiet lake", castle: "Castle lake", reservoir: "Reservoir bay", bridge: "Old bridge",
      },
    },
    rules: [
      ["Spot", "Every water has its own fish. Shallow ponds hold mostly small fry; big fish turn up more often in deep rivers and reservoirs."],
      ["Cast", "The farther from the bank you cast, the better the chance of a big fish. Small fish bite everywhere."],
      ["Bait", "Each fish has a favourite bait and rarely takes others. Only tiddlers bite on bread. If no local fish likes the bait, nothing bites."],
      ["Time of day", "Fish feed at certain hours. When the fish your bait is meant for are active, bites come often; when they rest, the bite is slow."],
      ["Weather", "Fish bite noticeably better in the rain."],
      ["Ducks", "By day, ducks sometimes paddle out from the bank; at night they sleep. A duck that swims past the float eats the bait. You can reel in in time."],
      ["Snags", "Sometimes the hook catches a sunken log as you reel in. Pull hard and you'll lose the hook too — better to give slack and wait for it to come free. And now and then you reel in an old boot instead of a fish."],
      ["The bite", "The float twitches — too early. The float dips for a moment — you can try to strike. The float goes under — pull before it's too late."],
      ["Rod", "Every rod is rated for a weight. A heavier fish tightens the line fast, and it snaps."],
      ["Hooks", "No hook, no cast. Losing a big fish costs the hook as well as the bait."],
      ["Float", "A plain float is barely visible at night. A glowing one can be seen at any hour."],
      ["Gear", "A landing net calms fish near the bank, braided line tightens more slowly, and a fish finder helps fish find the bait sooner."],
    ],
  },

  uk: {
    locale: "uk-UA",
    title: "Доберега — тиша та спокій",
    "a11y.scene": "ASCII-озеро на заході сонця, де можна рибалити",
    "a11y.canvas": "Водойма на заході сонця з ASCII-символів. Торкніться води, щоб закинути вудку; тримайте пробіл або палець на воді, щоб тягти.",
    "a11y.clock": "Час доби",
    "a11y.money": "Гроші",
    "a11y.rain": "Дощ",
    "a11y.spot": "Місце ловлі",
    "a11y.slider": "слайдер",
    "a11y.prevSpot": "Попереднє місце",
    "a11y.nextSpot": "Наступне місце",
    "a11y.menu": "Меню",
    "a11y.exit": "У головне меню",
    "a11y.exitTitle": "У меню",
    "a11y.rod": "Вудка",
    "a11y.bait": "Наживка",
    "a11y.hooks": "Гачки",
    "a11y.tension": "Натяг волосіні",
    "a11y.close": "Закрити",
    "a11y.less": "Менше",
    "a11y.more": "Більше",
    "menu.fish": "Рибалити",
    "menu.shop": "Магазин",
    "menu.pack": "Рюкзак",
    "menu.trophies": "Трофеї",
    "menu.settings": "Налаштування",
    "catch.title": "Улов",
    "catch.sell": "Продати",
    "catch.mount": "Трофей",
    "catch.release": "Відпустити",
    "catch.noMoney": "Бракує грошей на трофей",
    "catch.free": "безкоштовно",
    "catch.unique": "Єдина у своєму роді: її можна лише зберегти як трофей",
    "shop.title": "Магазин",
    "shop.bait": "Наживка",
    "shop.rods": "Вудки",
    "shop.extras": "Різне",
    "shop.each": "{price} ₴ за шт.",
    "shop.inPack": "У рюкзаку: {count}",
    "shop.buy": "Купити · {total}",
    "shop.owned": "Є у вас",
    "shop.upTo": "до {weight}",
    "shop.hooks": "Гачки",
    "pack.title": "Рюкзак",
    "pack.rods": "Вудки",
    "pack.bait": "Наживка",
    "pack.extras": "Різне",
    "pack.empty": "Поки нічого",
    "pack.read": "читати",
    "handbook.title": "Довідник рибака",
    "handbook.rules": "Що впливає на кльов",
    "handbook.where": "Де: {places}",
    "handbook.whereNone": "трапляється рідко",
    "handbook.baits": "Бере на: {baits}",
    "handbook.baitsNone": "що завгодно, але неохоче",
    "handbook.active": "Активна: {times}",
    "trophies.title": "Трофеї",
    "trophies.empty": "Стіна поки порожня",
    "settings.title": "Налаштування",
    "settings.language": "Мова",
    "toast.escape": "Зрив",
    "toast.duck": "Качка з'їла наживку",
    "toast.unsnagged": "Відчепилось",
    "toast.snagSnap": "Обрив на корчі",
    "toast.lostBait": "−1 {bait}",
    "toast.lostHook": "−1 гачок",
    "toast.trophy": "Трофей!",
    "toast.noBait": "Немає наживки",
    "toast.noHooks": "Немає гачків",
    "unit.g": "г",
    "unit.kg": "кг",
    "unit.pcs": "шт",
    periods: { night: "вночі", dawn: "на світанку", morning: "вранці", day: "вдень", evening: "ввечері", dusk: "у сутінках" },
    traitKeys: { type: "Тип", depth: "Глибина", bottom: "Дно", current: "Течія" },
    traits: {
      type: { pond: "Ставок", lake: "Озеро", river: "Річка", reservoir: "Водосховище" },
      depth: { shallow: "Мілко", medium: "Середня", deep: "Глибоко", veryDeep: "Дуже глибоко" },
      bottom: { mud: "Мул", sandWeed: "Пісок, водорості", stones: "Каміння", clayLogs: "Глина, коряги", logsEddies: "Коряги, вири" },
      current: { none: "Немає", weak: "Слабка", moderate: "Помірна", strong: "Сильна" },
    },
    names: {
      fish: {
        yorzh: "Йорж", plitka: "Плітка", krasnopirka: "Краснопірка", karas: "Карась", okun: "Окунь", lyn: "Лин",
        lyasch: "Лящ", korop: "Короп", shchuka: "Щука", sudak: "Судак", som: "Сом", valerka: "Валерка", boot: "Старий чобіт",
      },
      bait: {
        bread: "Хліб", worm: "Черв'як", maggot: "Опариш", bloodworm: "Мотиль", barley: "Перловка",
        corn: "Кукурудза", boilie: "Бойли", livebait: "Живець", frog: "Жабка",
      },
      rod: {
        willow: "Лоза", hazel: "Ліщинова", bamboo: "Бамбукова", telescope: "Телескопічна",
        glass: "Скловолоконна", carbon: "Карбонова", carp: "Коропова", catfish: "Сомова",
      },
      extra: {
        handbook: "Довідник рибака", glowfloat: "Світний поплавок", net: "Підсак", braid: "Плетена волосінь", sonar: "Ехолот",
      },
      extraText: {
        handbook: "Де, коли і на що краще ловиться кожна риба",
        glowfloat: "Добре видно вночі",
        net: "Біля берега риба пручається слабше",
        braid: "Шкала натягу заповнюється повільніше",
        sonar: "Риба знаходить наживку швидше",
      },
      location: {
        pond: "Ставок за селом", lake: "Тихе озеро", castle: "Замкове озеро", reservoir: "Затока водосховища", bridge: "Старий міст",
      },
    },
    rules: [
      ["Місце", "У кожної водойми свій набір риби. У мілких ставках — переважно дрібнота, у глибоких річках і водосховищах частіше трапляється велика риба."],
      ["Закид", "Чим далі від берега закинути, тим більший шанс, що клюне велика риба. Мала клює всюди."],
      ["Наживка", "Кожна риба має улюблену наживку, на чужу бере рідко. На хліб клює тільки дрібнота. Якщо місцевій рибі наживка не до смаку — не клюне ніхто."],
      ["Час доби", "Риба годується в певні години. Коли активна риба, на яку розрахована наживка, клює частіше; коли вона спить — кльов повільний."],
      ["Погода", "У дощ риба клює помітно краще, ніж у суху погоду."],
      ["Качки", "Вдень інколи з берега випливають качки, вночі вони сплять. Якщо качка пропливе повз поплавок — вона з'їсть наживку. Можна вчасно змотати."],
      ["Коряги", "Буває, що гачок чіпляється за корягу, коли змотуєш волосінь. Якщо тягнути щосили — обірвеш і гачок. Краще відпускати й чекати, поки відчепиться. А інколи замість риби витягуєш старий чобіт."],
      ["Покльовка", "Поплавок смикається — рано. Поплавок пірнув на мить — можна спробувати підсікти. Поплавок потонув — тягни, поки не пізно."],
      ["Вудка", "Кожна вудка розрахована на свою вагу. Важча риба швидко натягує волосінь, і та рветься."],
      ["Гачки", "Без гачка не закинеш. Зрив великої риби забирає і гачок, і наживку."],
      ["Поплавок", "Звичайний поплавок вночі майже не видно. Світний видно в будь-яку пору."],
      ["Спорядження", "Підсак заспокоює рибу біля берега, плетена волосінь повільніше натягується, ехолот допомагає рибі швидше знайти наживку."],
    ],
  },
};

export const LANGUAGES = [
  { id: "en", label: "English" },
  { id: "uk", label: "Українська" },
];

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (STRINGS[saved]) return saved;
  } catch {
    // Storage may be blocked; fall back to the system language.
  }
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language ?? "en"];
  return languages.some((code) => /^(uk|ru)\b/i.test(code)) ? "uk" : "en";
}

let current = detect();

export function language() {
  return current;
}

export function setLanguage(id) {
  if (!STRINGS[id]) return;
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // Remembered for this visit only.
  }
}

/** Translate a key, filling `{name}` placeholders from `vars`. */
export function t(key, vars = {}) {
  const value = STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  return value.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}

/** Localized name of a catalog item: kind is fish, bait, rod, extra, extraText or location. */
export function nameOf(kind, id) {
  return STRINGS[current].names[kind]?.[id] ?? STRINGS.en.names[kind]?.[id] ?? id;
}

export function traitLabel(key) {
  return STRINGS[current].traitKeys[key];
}

export function traitValue(key, value) {
  return STRINGS[current].traits[key]?.[value] ?? value;
}

export function periodName(id) {
  return STRINGS[current].periods[id];
}

export function handbookRules() {
  return STRINGS[current].rules;
}

export function locale() {
  return STRINGS[current].locale;
}
