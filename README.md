# Doberega — тиша та спокій

A small, dependency-free canvas prototype for a calm lake scene rendered as a regular ASCII character field. The screen grid and distant forest glyphs are generated on resize or when character spacing changes. Water animation is a separate mathematical model, so the same wave sampling can later feed another renderer.

The water uses the common 2:1 game projection, with axes at about 26.6°; touch ripples use the inverse projection so they stay anchored under the pointer. Its calm breeze model layers slow, nearly parallel swells with faint crosswind variations. Coherent wave light maps to a fixed ASCII density ramp, from sparse punctuation to dense symbols, using one editable, muted blue-green water color. The scene is set at golden hour from a seat at the water's edge. A low sun glows above three hazy mountain ridges; slow value-noise clouds drift across the sky, the first stars twinkle overhead, and a small flock of birds crosses now and then. The far shore has three overlapping forest depths (pine, spruce, oak, and rounded crowns) lit on the side facing the sun, with gentle deterministic canopy sway. The water mirrors the shore, the reflection wobbling with waves and ripples, and a path of sun glints widens toward the viewer. Fish occasionally break the surface. In the foreground, reeds and cattails sway at the edges of the frame, beside a rock and a few floating lily pads.

## Language

English and Ukrainian, switched in **Settings** on the main menu. English is the default; Ukrainian is chosen automatically when the system language is Ukrainian or Russian. A manual choice is remembered. All text — UI, fish, bait, rods, spots and their traits, the handbook and messages — lives in `src/i18n.js`; static markup uses `data-i18n` / `data-i18n-aria` attributes.

## Fishing spots

Each spot has its own ASCII landscape, built from a profile in `src/scene.js` (horizon, ridges, forest, near banks, structures, water behaviour, foreground):

- **Ставок за селом** — a pond in open farmland: big sky, a low flat far bank of green meadow and a ploughed strip, scattered round trees and tall poplars, a few small cottages in the distance, a reed fringe along the far waterline, and thick reeds and cattails on both near sides.
- **Тихе озеро** — layered mountains behind a forested shore, reeds, a boulder and a few lily pads.
- **Замкове озеро** — after a photo of an alpine lake: a dark wooded hill of distinct tree crowns rises on the left to a sheer limestone cliff topped by an ancient ruined castle (broken grey walls, gutted towers, ivy, no roofs); a snowy alpine massif fills the right, built from glyph cells in a flat palette: `/` and `\` follow the slope, faces facing the sun are lighter, snow runs down the gullies and leaves steep rock bare, woods cover the lower slopes, with blue distance haze; an arched stone bridge sits under the cliff and two red-roofed houses on the far shore. Calm emerald water.
- **Затока водосховища** — wide open water, low far hills, a concrete dam with gates and lamps, power pylons with sagging wires, concrete blocks in the foreground.
- **Старий міст** — fishing from a wooden bridge over a fast river: we look downstream past the railing, willow-lined banks recede and the river swings right round a bend, leaving the view past the right edge; the current runs away from us and turns with the bend in long streaks and flecks of foam (no casting onto the railing).

Switching spots in the menu rebuilds the scene behind it.

The far landscape keeps moving too (`src/ambient-engine.js`, redrawn every frame on top of the static layer for under a millisecond): wind runs through the meadow by the pond and the grassy banks at the old bridge in bright travelling gusts, smoke rises from cottage chimneys and drifts downwind (flattened by rain), mist creeps along the far shore — thick at dawn and dusk, light at night, and never in rain or over the fast river at the old bridge — the leaves on the castle hill stir, the near trees on the old bridge's banks sway, thin cloud clings to the alpine flanks at the castle lake, and the reservoir's pylons blink red after dusk.

## Time of day

A full in-game day takes 21 min 20 s of real time, starting mid-afternoon, and each part runs at its own pace: day (07:41–18:43) 10 min, sunset (18:43–22:05) 1 min 30 s, night (22:05–04:48) 8 min 20 s, sunrise (04:48–07:41) 1 min 30 s — so the clock races through dawn and dusk. There is a clock in the menu and HUD: night → dawn → morning → noon → afternoon → evening → dusk → night. Keyframes in `src/daycycle.js` hold the sky gradient, sun/moon glow, cloud colours, star visibility, glint colours and light multipliers for land, water and the foreground; everything between them is blended smoothly. The sun rises on the right, peaks near the top and sets on the left; the moon and stars take over at night, with a pale moon path on the water.

The sky texture, water palette and glint path refresh four times a second (≈1.3 ms); land and glyph lighting is a multiplier in the WebGL shaders, so the cycle costs almost nothing per frame. URL options: `?time=0.5` pins the clock (0 midnight, 0.25 dawn, 0.5 noon, 0.76 evening), `?day=60` squeezes the whole cycle into 60 seconds, keeping the phase proportions.

Time of day matters for fishing: every species has its own feeding hours (`active` in `src/fishing/data.js`) — catfish at night, pike at dawn and dusk, perch by day — which weight who bites and how soon. At night the plain float is barely visible; the glowing float (shop → Різне) shines through the dark.

## Weather and wildlife

- **Rain** (`src/weather.js`) comes and goes on its own — 1–2.5 minute showers between 6–14 minute dry spells, fading in and out over ~12 s. It brings slanted streaks, splashes on the water, a heavier cloud cover and a dimmer scene, with a rain cloud beside the clock. Fish bite noticeably faster in the rain (about 40% sooner in a heavy shower). `?rain=1` forces rain.
- **Ducks** (`src/wildlife.js`): every minute or two, one to three ducks (by day only) paddle in from just off-screen — a side or the bottom edge, never where a bank or cliff meets the edge — wander toward a couple of random spots on the water and leave past another edge, steering around banks and rocks, with a wake behind them. A duck that swims over the float eats the bait (the hook stays): "Качка з'їла наживку". Reeling in early saves it.

Both are explained in the handbook.

## Fishing

The game opens on a **main menu** over the live lake: a slider of fishing spots (pond, lake, castle lake, reservoir, old bridge) shows each spot's picture and plain facts — type, depth, bottom, current — with **Рибалити** to go fishing. Around it: **Магазин** (bait by the piece with − / + steppers, rods, and expensive extras), **Рюкзак** (owned rods, bait and extras, with the hook count in the corner; pick the active gear here) and **Трофеї**. The in-game HUD is kept bare: the clock top left, the door icon (back to the menu) top right, and at the bottom a single backpack button — open it to change rod or bait — with the bait in use and how much is left beside it. Arriving at the water puts on the most expensive bait you own (bread if nothing else).

- **Spots** decide which fish live there and the base odds of a big one (from 1:100 at the pond to 1:20 at the old bridge); bait and cast distance scale those odds. Each water also caps how heavy a fish can grow (pond 6 kg, lake 12, castle lake 16, reservoir 40, old bridge 60) and sets the pace of bites — big water gives fewer, bigger fish. Every spot pays about the same to a beginner with a worm; the gap opens with better rods and baits, from the pond up to catfish at the old bridge. Nothing in the game says which fish lives where — only the **Довідник рибака** (an extra) does.
- **Bait:** bread is free and endless but only tempts tiddlers; everything else is bought per piece. If no local fish takes a bait, nothing bites.
- **Rods:** from a willow switch (0.6 kg, no reel) to a catfish rod (40 kg); each looks different in game. Prices climb steeply — roughly 9 min of play for the second rod, ~2 h for the last.
- **Extras:** landing net (calmer fish near the bank), braided line (slower tension), sonar (faster bites), handbook.
- **Bite:** every bite has a temper — a greedy one grabs almost at once, a nibbler plays a little, a wary one fiddles for a long time, a teaser goes quiet for a few seconds and comes back — and each species leans its own way (`NIBBLE` in `src/fishing/data.js`): perch and pike mostly grab within a second, crucian, tench, bream and carp fiddle for 7–9 s, catfish give few, heavy pulls after long pauses, zander bite gingerly and let go quickly. Twitches, their strength, the pauses and up to two dips differ each time, and each tug shifts the float a little in the fish's own wandering direction; once it takes, the fish drags the sunk float away. On still water the float otherwise stays exactly where it landed; on the reservoir and at the old bridge the current carries it along. Pull on a twitch and the fish is gone with the bait; a pull on a dip hooks it half the time; once the float sinks you have roughly 0.8–1.9 s to strike. The wait before a nibble varies too, with the odd long lull.
- **Fight:** hold **Space** or a finger on the water. The tension bar fills at rate X while pulling and drains at 1.5X when released, while the fish swims off at a random pace. A full bar snaps the line. Small fish come in within one full bar; heavy ones need several pulls.
- **Catch:** sell, mount as a trophy, or release. Every escape or catch uses one bait (bread excepted).
- **Snags and junk:** reeling in an empty line rarely hooks a snag (≈2% at the pond up to ≈6% at the old bridge) or an old boot (≈1%). A snag won't move and pulling hard snaps the line (hook lost); giving it slack lets the hook work free (only the bait is lost). The boot comes in heavy but doesn't fight, and sells for 2 ₴ — or makes a joke trophy.
- **Valerka:** a joke — a clownfish that has no business in these waters. Any bite, anywhere, on any bait, has a 1 in 25,000 chance to be Valerka (about once in 190 hours of fishing). It has no price and can't be released: the only choice is to keep it as a free trophy. The handbook never mentions it.
- **Hooks:** bought per piece (5 to start); no hook, no cast. A big fish that snaps the line takes the hook with it.
- **Handbook:** opens with a page on everything that affects the bite (spot, cast distance, bait, time of day, rod, hooks, float, extras), then each fish's weight range, waters, favourite bait and feeding times.

The catalog (fish, bait, rods, extras, spots) lives in `src/fishing/data.js`; fight balance in `src/fishing/game.js` (`fightRates`). Progress is saved in localStorage. Add `?debug` to the URL to expose the game as `window.doberega`.

## Accounts and cloud saves

Signing in is optional: the game is fully playable without an account. Progress then lives only in the browser's localStorage, which can be wiped, and the main menu says so in an amber line under the buttons, next to a **Увійти** button (once signed in, the line reads that progress is saved to the account and the button opens **Акаунт**). After the very first fish the game offers once to sign in, with a warning of what skipping means, and a **Продовжити без входу** option. The **Акаунт** window lets a player sign in or create an account with email and password (Supabase Auth). While signed in, every save is pushed to the player's row in a `saves` table a few seconds after it happens (and on leaving the page); signing in on another device pulls it back. If the device and the account hold different progress, the game asks which one to keep. Row-level security means each player can only read and write their own save.

To switch it on:
1. Create a free project at [supabase.com](https://supabase.com).
2. In the project, open **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql) and run it.
3. In **Project Settings → API**, copy the project URL and the `anon` public key into [`src/cloud-config.js`](src/cloud-config.js).
4. Optionally, under **Authentication → Providers → Email**, turn off “Confirm email” to let players sign in straight away; otherwise they confirm their address first.

With the two values left empty the game runs exactly as before and the account section says cloud saves aren't set up.

## Icon

A pixel perch leaping out of night water under a crescent moon (`icons/`): an SVG favicon, a 512 px PNG and a square 192 px home-screen icon, also listed in `manifest.webmanifest` so the game can be installed to a phone's home screen.

## Phones

On a phone held upright the landscape isn't squeezed: the scene is laid out at least 1.15 times as wide as it is tall and the screen shows a slice of it, centred on what each spot is about (the castle crag at the castle lake, the middle elsewhere); reeds, rocks, lily pads and the rod follow the visible slice. The interface adapts too: the menu drops the title so nothing overlaps, puts a full-width **Рибалити** under the spot card and the four sections in a 2×2 grid of large buttons; dialogs fill the screen and scroll inside, the shop shows two columns of cards; everything stays clear of the notch and the home bar, and buttons don't zoom on double tap.

## Rendering

Every character is pushed into a glyph batch (position, glyph, color). WebGL2 draws each batch with a single instanced call from a white glyph atlas tinted on the GPU, so the ~25,000 characters on screen cost a few milliseconds per frame. Static scenery (sky gradient, sun, ridges, forest silhouette, water body) is rasterized once into layer textures; clouds and stars are resampled about 15 times per second. Reeds and the rock are drawn on a light 2D overlay. Browsers without WebGL2 fall back to Canvas 2D with the same batches. 

## Run locally

From this folder, start any static file server. For example, with Python 3:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a modern browser.

## Water settings

The water look is fixed in `src/main.js` (`config`): 5 px spacing, 7 px glyphs, 0.1× wave speed, flat surface (amplitude 0), 51% shimmer. Resizing the viewport rebuilds the character grid.
