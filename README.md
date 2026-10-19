# Stillwater — ASCII Water Study

A small, dependency-free canvas prototype for a calm lake scene rendered as a regular ASCII character field. The screen grid and distant forest glyphs are generated on resize or when character spacing changes. Water animation is a separate mathematical model, so the same wave sampling can later feed another renderer.

The water uses the common 2:1 game projection, with axes at about 26.6°; touch ripples use the inverse projection so they stay anchored under the pointer. Its calm breeze model layers slow, nearly parallel swells with faint crosswind variations. Coherent wave light maps to a fixed ASCII density ramp, from sparse punctuation to dense symbols, using one editable, muted blue-green water color. The scene is set at golden hour from a seat at the water's edge. A low sun glows above three hazy mountain ridges; slow value-noise clouds drift across the sky, the first stars twinkle overhead, and a small flock of birds crosses now and then. The far shore has three overlapping forest depths (pine, spruce, oak, and rounded crowns) lit on the side facing the sun, with gentle deterministic canopy sway. The water mirrors the shore, the reflection wobbling with waves and ripples, and a path of sun glints widens toward the viewer. Fish occasionally break the surface. In the foreground, reeds and cattails sway at the edges of the frame, beside a rock and a few floating lily pads.

## Language

English and Ukrainian, switched in **Settings** on the main menu. English is the default; Ukrainian is chosen automatically when the system language is Ukrainian or Russian. A manual choice is remembered. All text — UI, fish, bait, rods, spots and their traits, the handbook and messages — lives in `src/i18n.js`; static markup uses `data-i18n` / `data-i18n-aria` attributes.

## Fishing spots

Each spot has its own ASCII landscape, built from a profile in `src/scene.js` (horizon, ridges, forest, near banks, structures, water behaviour, foreground):

- **Ставок за селом** — a pond in open farmland: big sky, a low flat far bank of green meadow and a ploughed strip, scattered round trees and tall poplars, a few small cottages in the distance, a reed fringe along the far waterline, and thick reeds and cattails on both near sides.
- **Тихе озеро** — layered mountains behind a forested shore, reeds, a boulder and a few lily pads.
- **Замкове озеро** — after a photo of an alpine lake: a dark wooded hill of distinct tree crowns rises on the left to a sheer limestone cliff topped by an ancient ruined castle (broken grey walls, gutted towers, ivy, no roofs); jagged snow-capped peaks fill the right; an arched stone bridge sits under the cliff and two red-roofed houses on the far shore. Calm emerald water.
- **Затока водосховища** — wide open water, low far hills, a concrete dam with gates and lamps, power pylons with sagging wires, concrete blocks in the foreground.
- **Старий міст** — fishing from a wooden bridge over a fast river: we look downstream past the railing, willow-lined banks recede toward a bend, and the current races away in long streaks and flecks of foam (no casting onto the railing).

Switching spots in the menu rebuilds the scene behind it.

## Time of day

24 in-game hours pass in 20 real minutes, starting mid-afternoon, with a clock in the menu and HUD: night → dawn → morning → noon → afternoon → evening → dusk → night. Keyframes in `src/daycycle.js` hold the sky gradient, sun/moon glow, cloud colours, star visibility, glint colours and light multipliers for land, water and the foreground; everything between them is blended smoothly. The sun rises on the right, peaks near the top and sets on the left; the moon and stars take over at night, with a pale moon path on the water.

The sky texture, water palette and glint path refresh four times a second (≈1.3 ms); land and glyph lighting is a multiplier in the WebGL shaders, so the cycle costs almost nothing per frame. URL options: `?time=0.5` pins the clock (0 midnight, 0.25 dawn, 0.5 noon, 0.76 evening), `?day=60` makes a day last 60 seconds.

Time of day matters for fishing: every species has its own feeding hours (`active` in `src/fishing/data.js`) — catfish at night, pike at dawn and dusk, perch by day — which weight who bites and how soon. At night the plain float is barely visible; the glowing float (shop → Різне) shines through the dark.

## Weather and wildlife

- **Rain** (`src/weather.js`) comes and goes on its own — 1–2.5 minute showers between 6–14 minute dry spells, fading in and out over ~12 s. It brings slanted streaks, splashes on the water, a heavier cloud cover and a dimmer scene, with a rain cloud beside the clock. Fish bite noticeably faster in the rain (about 40% sooner in a heavy shower). `?rain=1` forces rain.
- **Ducks** (`src/wildlife.js`): every minute or two, one to three ducks (by day only) paddle in from just off-screen — a side or the bottom edge, never where a bank or cliff meets the edge — wander toward a couple of random spots on the water and leave past another edge, steering around banks and rocks, with a wake behind them. A duck that swims over the float eats the bait (the hook stays): "Качка з'їла наживку". Reeling in early saves it.

Both are explained in the handbook.

## Fishing

The game opens on a **main menu** over the live lake: a slider of fishing spots (pond, lake, castle lake, reservoir, old bridge) shows each spot's picture and plain facts — type, depth, bottom, current — with **Рибалити** to go fishing. Around it: **Магазин** (bait by the piece with − / + steppers, rods, and expensive extras), **Рюкзак** (owned rods, bait and extras; pick the active gear here or from the in-game slots) and **Трофеї**. In game, the door icon returns to the menu.

- **Spots** decide which fish live there and the base odds of a big one (from 1:100 at the pond to 1:20 at the old bridge); bait and cast distance scale those odds. Nothing in the game says which fish lives where — only the **Довідник рибака** (an extra) does.
- **Bait:** bread is free and endless but only tempts tiddlers; everything else is bought per piece. If no local fish takes a bait, nothing bites.
- **Rods:** from a willow switch (0.6 kg, no reel) to a catfish rod (40 kg); each looks different in game. Prices climb steeply — roughly 9 min of play for the second rod, ~2 h for the last.
- **Extras:** landing net (calmer fish near the bank), braided line (slower tension), sonar (faster bites), handbook.
- **Bite:** the float twitches, sometimes dips; pull on a twitch and the fish is gone with the bait; a pull on the dip hooks it half the time; once it sinks, pull within ~1.3 s.
- **Fight:** hold **Space** or a finger on the water. The tension bar fills at rate X while pulling and drains at 1.5X when released, while the fish swims off at a random pace. A full bar snaps the line. Small fish come in within one full bar; heavy ones need several pulls.
- **Catch:** sell, mount as a trophy, or release. Every escape or catch uses one bait (bread excepted).
- **Snags and junk:** reeling in an empty line rarely hooks a snag (≈2% at the pond up to ≈6% at the old bridge) or an old boot (≈1%). A snag won't move and pulling hard snaps the line (hook lost); giving it slack lets the hook work free (only the bait is lost). The boot comes in heavy but doesn't fight, and sells for 2 ₴ — or makes a joke trophy.
- **Hooks:** bought per piece (5 to start); no hook, no cast. A big fish that snaps the line takes the hook with it.
- **Handbook:** opens with a page on everything that affects the bite (spot, cast distance, bait, time of day, rod, hooks, float, extras), then each fish's weight range, waters, favourite bait and feeding times.

The catalog (fish, bait, rods, extras, spots) lives in `src/fishing/data.js`; fight balance in `src/fishing/game.js` (`fightRates`). Progress is saved in localStorage. Add `?debug` to the URL to expose the game as `window.stillwater`.

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
