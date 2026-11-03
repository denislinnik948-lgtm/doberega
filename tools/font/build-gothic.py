"""
Doberega Gothic: a small pixel blackletter for the game's headings, Ukrainian
and English. Each letter is drawn below as rows of pixels ('#' ink, '.' none);
this script turns them into a web font, one square per pixel.

    python3 -m venv .venv && .venv/bin/pip install fonttools brotli
    .venv/bin/python tools/font/build-gothic.py

Writes fonts/doberega-gothic.woff2. A pixel is 100 units on a 1500-unit em
(12 rows above the baseline, 3 below), so the font is sharpest at 15, 30 or
45 px. Letters it lacks fall back to the next font in the CSS.
"""

from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

PX = 100
ASCENT = 12
DESCENT = 3

# Glyph: (rows top to bottom, rows below the baseline). Lowercase letters are
# 7 rows tall at x-height, 10 with an ascender; capitals 10; accents go above.
G = {}


def glyph(chars, rows, below=0):
    for char in chars:
        G[char] = (rows, below)


def rows(text):
    return text.split()


# ---------- Lowercase ----------
# Bowls are slanted hexagons (thin top left, thin bottom right), arches join at
# the shoulder; pen_cut below gives every stem its slanted ends.
glyph("oо", rows("..##. .#.## ##.## ##.## ##.## ##.#. .##.."))
glyph("cс", rows("..##. .#.## ##... ##... ##... ##.#. .##.."))
glyph("eе", rows("..##. .#.## ##.## ####. ##... ##.#. .##.."))
glyph("aа", rows("..##. .#.## ...## .#### ##.## ##.## .##.#"))
glyph("b", rows("##... ##... ##... ##.#. ####. ##.## ##.## ##.## ##.#. ###.."))
glyph("d", rows("...## ...## ...## ..### .#.## ##.## ##.## ##.## ##.## .##.#"))
glyph("f", rows("..## .##. .##. #### .##. .##. .##. .##. .##. .##."))
glyph("g", rows("..### .#.## ##.## ##.## ##.## ##.## .#### ...## #..#. .##.."), 3)
glyph("h", rows("##... ##... ##... ##.## ##### ##.## ##.## ##.## ##.## ##.##"))
glyph("iі", rows(".. ## .. ## ## ## ## ## ## ##"))
glyph("j", rows("... .## ... .## .## .## .## .## .## .## .## .## ##."), 3)
glyph("k", rows("##... ##... ##... ##.## ##.#. ###.. ##.#. ##.## ##.## ##.##"))
glyph("l", rows("## ## ## ## ## ## ## ## ## ##"))
glyph("m", rows("##.##.## ######## ##.##.## ##.##.## ##.##.## ##.##.## ##.##.##"))
glyph("n", rows("##.## ##### ##.## ##.## ##.## ##.## ##.##"))
glyph("pр", rows("##.#. ####. ##.## ##.## ##.## ##.#. ###.. ##... ##... ##..."), 3)
glyph("q", rows(".#.## .#### ##.## ##.## ##.## .#.## ..### ...## ...## ...##"), 3)
glyph("r", rows("##.## ##### ##... ##... ##... ##... ##..."))
glyph("s", rows("..### .##.. .##.. ..##. ...## ...## ###.."))
glyph("t", rows(".... .##. .##. #### .##. .##. .##. .##. .##. .###"))
glyph("uи", rows("##.## ##.## ##.## ##.## ##.## ##### ##.##"))
glyph("v", rows("##.## ##.## ##.## ##.## .#.#. .###. ..#.."))
glyph("w", rows("##.##.## ##.##.## ##.##.## ##.##.## ##.##.## ######## .##..##."))
glyph("xх", rows("##..# .#.#. .###. ..#.. .###. .#.#. #..##"))
glyph("yу", rows("##.## ##.## ##.## ##.## ##.## ##### ...## ...## #..#. .##.."), 3)
glyph("z", rows("##### ...## ..##. .##.. ##... ##... #####"))

glyph("б", rows("..### .##.. ##... ####. ##.## ##.## ##.## ##.## ##.#. .##.."))
glyph("в", rows("###.. ##.#. ##.## ####. ##.## ##.#. ###.."))
glyph("г", rows("##### ##..# ##... ##... ##... ##... ##..."))
glyph("ґ", rows("..... ....# ....# ##### ##... ##... ##... ##... ##... ##..."))
glyph("д", rows("..###. .##.## .##.## .##.## .##.## ##..## ###### #....#"), 1)
glyph("є", rows("..##. .#.## ##... ####. ##... ##.#. .##.."))
glyph("ж", rows("#..##..# ##.##.## .#.##.#. ..####.. .#.##.#. ##.##.## #..##..#"))
glyph("з", rows(".##.. #.##. ..##. .##.. ..##. #.##. .##.."))
glyph("й", rows("..... #..#. .##.. ##.## ##.## ##.## ##.## ##.## ##### ##.##"))
glyph("ї", rows(".... #..# .... .##. .##. .##. .##. .##. .##. .##."))
glyph("к", rows("##.## ##.#. ###.. ####. ##.#. ##.## ##.##"))
glyph("л", rows("..### .##.# .##.## .##.## .##.## ##..## #...##"))
glyph("м", rows("##...## ###.### ##.#.## ##...## ##...## ##...## ##...##"))
glyph("н", rows("##.## ##.## ##.## ##### ##.## ##.## ##.##"))
glyph("п", rows("##### ##.## ##.## ##.## ##.## ##.## ##.##"))
glyph("т", rows("###### ..##.. ..##.. ..##.. ..##.. ..##.. ..##.."))
glyph("ф", rows("...#... ...#... ...##.. ..####. .#.#.## ##.#.## ##.#.## ##.#.## ##.#.#. .####.. ..##... ...#..."), 2)
glyph("ц", rows("##.##. ##.##. ##.##. ##.##. ##.##. ##.##. ###### .....#"), 1)
glyph("ч", rows("##.## ##.## ##.## .#### ...## ...## ...##"))
glyph("ш", rows("##.##.## ##.##.## ##.##.## ##.##.## ##.##.## ##.##.## ########"))
glyph("щ", rows("##.##.##. ##.##.##. ##.##.##. ##.##.##. ##.##.##. ##.##.##. ######### ........#"), 1)
glyph("ь", rows("##... ##... ##... ####. ##.## ##.#. ###.."))
glyph("ю", rows("##...##. ##..#.## ##.##.## #####.## ##.##.## ##.##.#. ##..##.."))
glyph("я", rows("..### .#.## ##.## .#### ..### .#.## ##.##"))

# ---------- Capitals ----------
glyph("AА", rows("..##... .####.. ##..##. ##..##. ######. ##..##. ##..##. ##..##. ##..##. #...###"))
glyph("BВ", rows("####.. ##.##. ##..## ##.##. #####. ##..## ##..## ##..## ##.##. ####.."))
glyph("CС", rows("..###. .#..## ##.... ##.... ##.... ##.... ##.... ##.... ##..#. .###.."))
glyph("D", rows("####.. ##.##. ##..## ##..## ##..## ##..## ##..## ##..## ##.##. ####.."))
glyph("EЕ", rows("###### ##...# ##.... ##.... #####. ##.... ##.... ##.... ##...# ######"))
glyph("F", rows("###### ##...# ##.... ##.... #####. ##.... ##.... ##.... ##.... #....."))
glyph("G", rows("..###. .#..## ##.... ##.... ##.### ##..## ##..## ##..## ##..#. .###.."))
glyph("HН", rows("##..## ##..## ##..## ##..## ###### ##..## ##..## ##..## ##..## #...##"))
glyph("IІ", rows("#### .##. .##. .##. .##. .##. .##. .##. .##. ####"))
glyph("J", rows("..#### ...##. ...##. ...##. ...##. ...##. ...##. ...##. #..##. .###.."))
glyph("KК", rows("##..## ##.##. ####.. ###... ####.. ##.##. ##..## ##..## ##..## #...##"))
glyph("L", rows("##.... ##.... ##.... ##.... ##.... ##.... ##.... ##.... ##...# ######"))
glyph("MМ", rows("##...## ###.### ####### ##.#.## ##...## ##...## ##...## ##...## ##...## #....##"))
glyph("N", rows("##..## ###.## ###.## ##.### ##.### ##..## ##..## ##..## ##..## #...##"))
glyph("OО", rows("..###. .#..## ##..## ##..## ##..## ##..## ##..## ##..## ##..#. .###.."))
glyph("PР", rows("####.. ##.##. ##..## ##..## ##.##. ####.. ##.... ##.... ##.... ##...."))
glyph("Q", rows(".####. ##..## ##..## ##..## ##..## ##..## ##..## ##.### ##..## .###.# .....#"), 1)
glyph("R", rows("#####. ##..## ##..## ##..## #####. ####.. ##.##. ##..## ##..## #...##"))
glyph("S", rows("..#### .##... ##.... ###... .####. ...### ....## ....## ...##. ####.."))
glyph("TТ", rows("###### #.##.# ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ..###."))
glyph("U", rows("##..## ##..## ##..## ##..## ##..## ##..## ##..## ##..## ##..## .####."))
glyph("V", rows("##..## ##..## ##..## ##..## ##..## ##..## .#..#. .####. ..##.. ..##.."))
glyph("W", rows("##...## ##...## ##...## ##...## ##...## ##...## ##.#.## ####### ###.### ##...##"))
glyph("XХ", rows("##..## ##..## .####. ..##.. ..##.. .####. ##..## ##..## ##..## #...##"))
glyph("Y", rows("##..## ##..## ##..## .####. ..##.. ..##.. ..##.. ..##.. ..##.. ..###."))
glyph("Z", rows("###### ....## ...##. ..##.. ..##.. .##... .##... ##.... ##...# ######"))

glyph("Б", rows("###### ##...# ##.... ##.... #####. ##..## ##..## ##..## ##..## #####."))
glyph("Г", rows("###### ##...# ##.... ##.... ##.... ##.... ##.... ##.... ##.... #....."))
glyph("Ґ", rows(".....# .....# ###### ##.... ##.... ##.... ##.... ##.... ##.... ##.... ##.... #....."))
glyph("Д", rows("..####. .##.##. .##.##. .##.##. .##.##. .##.##. .##.##. ##..##. ####### #.....#"), 1)
glyph("Є", rows("..###. .#..## ##.... ##.... #####. ##.... ##.... ##.... ##..#. .###.."))
glyph("Ж", rows("##.##.## ##.##.## .#.##.#. ..####.. ..####.. .#.##.#. ##.##.## ##.##.## ##.##.## #..##..#"))
glyph("З", rows(".###.. #..##. ....## ....## ..###. ....## ....## ....## #..##. .###.."))
glyph("И", rows("##..## ##..## ##.### ##.### ###### ###.## ###.## ##..## ##..## #...##"))
glyph("Й", rows(".#..#. ..##.. ##..## ##..## ##.### ##.### ###### ###.## ###.## ##..## ##..## #...##"))
glyph("Ї", rows("#..# .... #### .##. .##. .##. .##. .##. .##. .##. .##. ####"))
glyph("Л", rows("..#### .##.## .##.## .##.## .##.## .##.## .##.## ##..## ##..## #...##"))
glyph("П", rows("###### ##..## ##..## ##..## ##..## ##..## ##..## ##..## ##..## #...##"))
glyph("У", rows("##..## ##..## ##..## ##..## .##### ....## ....## ....## #..##. .###.."))
glyph("Ф", rows("...##... .######. ##.##.## ##.##.## ##.##.## ##.##.## .######. ...##... ...##... ...##..."))
glyph("Ц", rows("##..##. ##..##. ##..##. ##..##. ##..##. ##..##. ##..##. ##..##. ##..##. ####### ......#"), 1)
glyph("Ч", rows("##..## ##..## ##..## ##..## .##### ....## ....## ....## ....## ....##"))
glyph("Ш", rows("##.##.## ##.##.## ##.##.## ##.##.## ##.##.## ##.##.## ##.##.## ##.##.## ##.##.## ########"))
glyph("Щ", rows("##.##.##. ##.##.##. ##.##.##. ##.##.##. ##.##.##. ##.##.##. ##.##.##. ##.##.##. ##.##.##. ######### ........#"), 1)
glyph("Ь", rows("##.... ##.... ##.... #####. ##..## ##..## ##..## ##..## ##..## #####."))
glyph("Ю", rows("##..####. ##.##..## ##.##..## ##.##..## #####..## ##.##..## ##.##..## ##.##..## ##.##..## ##..####."))
glyph("Я", rows("..#### .##.## ##..## ##..## .##### ..#### .##.## .##.## ##..## ##..##"))

# ---------- Figures ----------
glyph("0", rows("..###. .#..## ##..## ##.### ##.### ###.## ###.## ##..## ##..#. .###.."))
glyph("1", rows("..##.. .###.. ####.. ..##.. ..##.. ..##.. ..##.. ..##.. ..##.. ######"))
glyph("2", rows(".####. ##..## ....## ....## ...##. ..##.. .##... ##.... ##...# ######"))
glyph("3", rows(".####. ##..## ....## ....## ..###. ....## ....## ....## ##..## .####."))
glyph("4", rows("...### ..#### .##.## ##..## ##..## ###### ....## ....## ....## ....##"))
glyph("5", rows("###### ##.... ##.... #####. ....## ....## ....## ....## ##..## .####."))
glyph("6", rows(".####. ##..## ##.... #####. ##..## ##..## ##..## ##..## ##..## .####."))
glyph("7", rows("###### ##..## ....## ...##. ..##.. ..##.. ..##.. ..##.. ..##.. ..##.."))
glyph("8", rows(".####. ##..## ##..## ##..## .####. ##..## ##..## ##..## ##..## .####."))
glyph("9", rows(".####. ##..## ##..## ##..## ##..## .##### ....## ....## ##..## .####."))

# ---------- Marks ----------
glyph(".", rows("## ##"))
glyph(",", rows("## ## .# #."), 2)
glyph(":", rows("## ## .. .. .. ## ##"))
glyph(";", rows("## ## .. .. .. ## ## .# #."), 2)
glyph("!", rows("## ## ## ## ## ## ## .. ## ##"))
glyph("?", rows(".####. ##..## ....## ...##. ..##.. ..##.. ..##.. ...... ..##.. ..##.."))
glyph("-‐", rows("#### ####"))
glyph("–—", rows("###### ######"))
glyph("'’", rows("## ## .#"))
glyph("«", rows("..#..# .#..#. #..#.. .#..#. ..#..#"))
glyph("»", rows("#..#.. .#..#. ..#..# .#..#. #..#.."))
glyph("·", rows("## ##"))
glyph("(", rows("..## .##. ##.. ##.. ##.. ##.. ##.. ##.. .##. ..##"))
glyph(")", rows("##.. .##. ..## ..## ..## ..## ..## ..## .##. ##.."))
glyph("/", rows("....## ....## ...##. ...##. ..##.. ..##.. .##... .##... ##.... ##...."))

# Where each mark sits above the baseline when it is shorter than its line (rows from the baseline up to its bottom).
RAISE = {"-": 3, "‐": 3, "–": 3, "—": 3, "·": 3, "'": 8, "’": 8, ":": 0, ";": 0, "«": 1, "»": 1}
SPACE = 3


def pen_cut(pattern):
    """
    The broad pen held at an angle: where a two-pixel stem starts with nothing
    over it, its top keeps only the right pixel; where it ends with nothing
    under it, its foot keeps only the left. Each stem ends in a slanted cut,
    the lozenge of a blackletter hand. Wider bars are left as drawn.
    """
    grid = [list(row) for row in pattern]
    width = max(len(row) for row in grid)
    for row in grid:
        row.extend("." * (width - len(row)))
    ink = lambda x, y: 0 <= y < len(grid) and 0 <= x < width and grid[y][x] == "#"
    cuts = []
    for y, row in enumerate(grid):
        x = 0
        while x < width:
            if row[x] != "#":
                x += 1
                continue
            start = x
            while x < width and row[x] == "#":
                x += 1
            if x - start != 2:
                continue
            column = range(start, x)
            # Only a real stem: ink right above or right below, two pixels wide.
            above = all(ink(c, y - 1) for c in column)
            below = all(ink(c, y + 1) for c in column)
            if below and not any(ink(c, y - 1) for c in column) and not ink(start - 1, y) and not ink(x, y):
                cuts.append((start, y))
            if above and not any(ink(c, y + 1) for c in column) and not ink(start - 1, y) and not ink(x, y):
                cuts.append((x - 1, y))
    for x, y in cuts:
        grid[y][x] = "."
    return ["".join(row) for row in grid]


def outline(char):
    """The glyph's pixels as squares (runs of a row merged), with its advance width."""
    pattern, below = G[char]
    if char.isalpha():
        pattern = pen_cut(pattern)
    width = max(len(row) for row in pattern)
    raise_by = RAISE.get(char, 0)
    pen = TTGlyphPen(None)
    height = len(pattern)
    for index, row in enumerate(pattern):
        y = (height - below - 1 - index + raise_by) * PX
        x = 0
        while x < len(row):
            if row[x] != "#":
                x += 1
                continue
            start = x
            while x < len(row) and row[x] == "#":
                x += 1
            # Clockwise, as TrueType wants an outer contour.
            pen.moveTo((start * PX, y))
            pen.lineTo((start * PX, y + PX))
            pen.lineTo((x * PX, y + PX))
            pen.lineTo((x * PX, y))
            pen.closePath()
    return pen.glyph(), (width + 1) * PX


def build(out):
    names = {char: f"uni{ord(char):04X}" for char in G}
    order = [".notdef", "space", *names.values()]
    glyphs = {".notdef": TTGlyphPen(None).glyph(), "space": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (SPACE * PX, 0), "space": (SPACE * PX, 0)}
    for char, name in names.items():
        shape, advance = outline(char)
        glyphs[name] = shape
        metrics[name] = (advance, 0)
    fb = FontBuilder((ASCENT + DESCENT) * PX, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({32: "space", **{ord(char): name for char, name in names.items()}})
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT * PX, descent=-DESCENT * PX)
    fb.setupNameTable({"familyName": "Doberega Gothic", "styleName": "Regular"})
    fb.setupOS2(sTypoAscender=ASCENT * PX, sTypoDescender=-DESCENT * PX, sTypoLineGap=0, usWinAscent=ASCENT * PX, usWinDescent=DESCENT * PX)
    fb.setupPost()
    fb.font.flavor = "woff2"
    fb.save(out)
    print(f"{out}: {len(names)} letters and marks")


if __name__ == "__main__":
    build(Path(__file__).resolve().parents[2] / "fonts" / "doberega-gothic.woff2")
