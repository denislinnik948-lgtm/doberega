/*
 * The update log: what changed in how the game plays (mechanics, the economy,
 * new things to do), newest first, a few plain lines a day in both languages.
 * Small fixes and looks don't go here. Shown once a day on coming in when
 * there is something new since last time (see openNews in ui.js), and all of
 * it in Settings → Update log.
 */
export const CHANGELOG = [
  {
    date: "2026-11-17",
    uk: [
      "Квиток на Драконове озеро дешевшає: 80 000 $ замість 100 000 $.",
      "Бій з велетнями тонший: що важча риба, то більше в неї сили, довші й сильніші ривки. 45 кг втомлюється секунд за десять, 140 кг за пів хвилини.",
      "Риба втомлюється тим швидше, чим ближче натяг до краю шкали, і ще швидше, коли рве проти вудки. Велика риба на межі сил може зробити останній ривок.",
      "Замовлення скупника: раз на три дні він замовляє важку рибу або кілька риб з однієї з ваших найкращих водойм і платить приблизно стільки, скільки дає година риболовлі там. Дивіться на сторінці «Сьогодні».",
      "Проліт дракона сколихує Драконове озеро: п'ять хвилин риба клює вдвічі активніше, а часом на гачку виявляється луска дракона (скупник дає за неї 10 000 $).",
      "Качка чи бобер, перепливаючи волосінь, можуть її сплутати, і тоді пропадуть наживка й гачок. Побачили, що хтось пливе на волосінь, змотуйте.",
      "Поки чапля стоїть на мілині, риба клює вдвічі повільніше. Зате прилітає вона тепер удвічі рідше.",
    ],
    en: [
      "The Dragon Lake ticket is cheaper: 80 000 $ instead of 100 000 $.",
      "Fighting giants is finer: the heavier the fish, the more strength it has and the longer and harder its runs. 45 kg tires in about ten seconds, 140 kg in half a minute.",
      "A fish tires the faster the nearer the tension is to the top of the bar, and faster still while it runs against the rod. A big one, nearly spent, may make a last run.",
      "The buyer's order: every three days he orders a heavy fish or a few fish from one of your best waters and pays about an hour's fishing there. See the Today page.",
      "The dragon's flight stirs Dragon Lake: for five minutes the fish bite twice as keenly, and now and then a dragon's scale comes up on the hook (the buyer gives 10 000 $ for it).",
      "A duck or the beaver swimming across the line may tangle it, and the bait and the hook are lost. If you see one heading for the line, reel in.",
      "While a heron stands in the shallows, fish bite half as fast. It comes half as often now, though.",
    ],
  },
  {
    date: "2026-11-16",
    uk: [
      "Турнір тепер триває три дні замість тижня. Призи видаються за кожен турнір, у якому ти брав участь, навіть якщо кілька пройшли, поки тебе не було.",
      "З 22 листопада чотири нові формати турніру: снайпер (риба, найближча до заданої ваги), легка снасть (лоза, ліщина чи бамбук), одна наживка і трофейний (будь-яка риба, рахується відсоток від рекорду виду).",
      "Дні поспіль тепер ідуть колом з десяти днів: сьомого дня половина нагороди за завдання, восьмого 10 кукурудзи, дев'ятого дві прикормки, десятого півтори нагороди.",
      "У налаштуваннях з'явилися журнал оновлень і зв'язок з розробником: можна написати про помилку чи ідею просто з гри.",
      "Відкрито Драконове озеро, останню водойму: гірське озеро під руїнами старої вежі. Вхід за квитком на добу (100 000 $) і лише з сомовою вудкою. Тут ловляться велетні від 45 кг: нільський окунь, сіамський короп, білий осетер і сом, а легенда озера, осетер Змій, важить 130–150 кг.",
      "Риба на Драконовому озері має силу: над шкалою натягу з'являється шкала «Сила риби». Тримай волосінь натягнутою, щоб риба втомилася, і лише тоді вона піде до берега.",
      "Новий сомовий гачок (50 $): лише риба від 5 кг, тримає будь-яку. Великий гачок тепер тримає до 45 кг, тож велетні Драконового озера його розгинають. Малий гачок тонкий: на нього клює частіше, і на ставку він дає більше риби й досвіду.",
      "Морський шнур (Снасті, 120 000 $): купується раз, не зношується і тримає будь-яку рибу. Без нього на Драконове озеро не пускають, а звичайну волосінь тамтешні велетні рвуть. Деінде на нього клює рідше, тож яку волосінь поставити, обирай у рюкзаку. Хто купив квиток раніше, ловить там без шнура, доки квиток діє.",
    ],
    en: [
      "A tournament now lasts three days instead of a week. Prizes are paid for every tournament you took part in, even if several went by while you were away.",
      "From 22 November, four new tournament formats: sniper (the fish closest to a set weight), light tackle (willow, hazel or bamboo rod), one bait, and trophy (any fish, scored as a share of its kind's top weight).",
      "Days in a row now go round ten days: half the quest reward on the seventh, 10 corn on the eighth, two groundbaits on the ninth, one and a half quest rewards on the tenth.",
      "Settings now have the update log and a way to contact the developer: write about a bug or an idea right from the game.",
      "Dragon Lake, the last water, is open: a mountain lake under a ruined tower. Entry is by a day ticket (100 000 $) and only with the catfish rod. Here giants from 45 kg bite: the Nile perch, the Siamese giant carp, the white sturgeon and the catfish, and the lake's legend, the sturgeon Zmii, weighs 130-150 kg.",
      "Fish at Dragon Lake have strength: a Fish's strength bar appears over the tension bar. Keep the line tight to wear the fish out, and only then will it come in.",
      "A new catfish hook (50 $): only fish from 5 kg, holds any. The large hook now holds up to 45 kg, so Dragon Lake's giants bend it straight. The small hook is fine: fish bite on it more often, and at the pond it brings more fish and experience.",
      "The sea line (Tackle, 120 000 $): bought once, never wears and holds any fish. Dragon Lake lets no one in without it, and its giants snap the plain line. Elsewhere fish bite less often on it, so pick which line is on the reel in the backpack. Those who bought a ticket before fish there without it while the ticket lasts.",
    ],
  },
  {
    date: "2026-11-15",
    uk: [
      "Кольорові світлячки для поплавка в магазині (Додатки, 2 000 $): купуєш раз і вибираєш у рюкзаку, яким світитиметься поплавок уночі: зеленим, синім, червоним, жовтим чи білим.",
    ],
    en: [
      "Coloured float lights in the shop (Extras, 2 000 $): buy them once and pick in the backpack how the float glows at night: green, blue, red, yellow or white.",
    ],
  },
  {
    date: "2026-11-14",
    uk: [
      "Поплавок світиться вночі в усіх. Хто купував світний поплавок, отримав 900 $ назад.",
      "Риба продається рівно за свою ціну за кілограм, як у довіднику. У садку видно, що підняло ціну: велика ×1,3, переросток ×1,6, риба дня ×1,5.",
      "Скіни поплавків прибрано з гри, гроші за куплені повернуто.",
    ],
    en: [
      "Every float glows at night. Those who bought the glowing float got their 900 $ back.",
      "Fish sell for exactly their price per kilo, as the handbook says. The keepnet shows what lifted a price: big ×1.3, outgrown ×1.6, fish of the day ×1.5.",
      "Float skins are gone from the game; the money for those bought has been paid back.",
    ],
  },
];

/** At most this many days are shown on coming in, however long the angler was away. */
export const NEWS_DAYS_SHOWN = 3;
