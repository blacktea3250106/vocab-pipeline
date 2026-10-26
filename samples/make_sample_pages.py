"""Render synthetic "book pages" for the demo.

The real input is phone photos of a commercial vocabulary book, which this repo
does not ship. These two pages are drawn from samples/sample_pages.json (ten
everyday office words written for this repo) in a layout that imitates a
bilingual vocabulary book: numbered headword, frequency stars, part of speech,
Chinese meaning, example sentence and translation, plus one "exam focus" box.

It also writes samples/cache/*.json: the per-image results that
extract/parse.mjs would normally get back from Claude. They are hand-made from
the same JSON, so the rest of the pipeline can run offline without an API key.

    pip install pillow
    python samples/make_sample_pages.py
"""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
PAGES = json.loads((HERE / "sample_pages.json").read_text(encoding="utf-8"))
OUT_DIR = HERE / "pages" / "d1"
CACHE_DIR = HERE / "cache"

# macOS ships these; any CJK-capable TTF/TTC works.
FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("No CJK font found; edit FONT_CANDIDATES.")


W, H = 1240, 1754  # A4 at 150 dpi
INK, SOFT, ACCENT, BOX = (30, 30, 30), (110, 110, 110), (176, 64, 48), (238, 236, 230)
LIST_TITLE = {"basic": "基礎單字", "t800": "800 分單字", "t900": "900 分單字"}


def render(page: dict, n: int) -> Image.Image:
    img = Image.new("RGB", (W, H), (252, 251, 247))
    d = ImageDraw.Draw(img)
    f_head, f_word, f_body, f_small = font(34), font(40), font(28), font(22)

    d.text((70, 50), f"{page['day'].upper()} · Office Life 辦公室日常", font=f_head, fill=INK)
    d.text((W - 470, 58), "SYNTHETIC SAMPLE PAGE", font=f_small, fill=ACCENT)
    d.line((70, 110, W - 70, 110), fill=SOFT, width=2)

    y = 140
    notes = {nb["word"]: nb for nb in page["notes"]}
    for w in page["words"]:
        d.text((70, y), str(w["index"]).zfill(2), font=f_small, fill=ACCENT)
        d.text((120, y - 8), w["word"], font=f_word, fill=INK)
        d.text((120, y + 44), "*" * w["star"], font=f_body, fill=ACCENT)
        d.text((560, y), f"{w['pos']}  {w['zh']}", font=f_body, fill=INK)
        d.text((560, y + 44), w["example"]["en"], font=f_small, fill=INK)
        d.text((560, y + 78), w["example"]["zh"], font=f_small, fill=SOFT)
        ry = y + 92
        for r in w["related"]:
            d.text((120, ry), f"+ {r['word']} {r['pos']} {r['zh']}", font=f_small, fill=SOFT)
            ry += 32
        y = max(y + 140, ry + 24)

        nb = notes.get(w["word"])
        if nb:
            d.rectangle((110, y, W - 70, y + 130), fill=BOX)
            d.text((130, y + 14), "出題重點", font=f_small, fill=ACCENT)
            d.text((130, y + 46), nb["kind"], font=f_small, fill=SOFT)
            d.text((300, y + 14), nb["heading"], font=f_body, fill=INK)
            d.text((300, y + 60), nb["body"], font=f_small, fill=INK)
            y += 160

    for lst in page["lists"]:
        y += 20
        d.text((70, y), f"{LIST_TITLE[lst['level']]} · {lst['section']}", font=f_head, fill=INK)
        y += 60
        for w in lst["words"]:
            d.text((120, y), w["word"], font=f_body, fill=INK)
            d.text((520, y), f"{w['pos']}  {w['zh']}", font=f_body, fill=INK)
            y += 48

    d.text((W // 2 - 20, H - 70), str(n), font=f_small, fill=SOFT)
    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for i, page in enumerate(PAGES, 1):
        name = f"page_{i}.png"
        render(page, i).save(OUT_DIR / name, optimize=True)
        # Same naming as cacheKeyFor() in extract/parse.mjs: <folder>-<file>.json
        (CACHE_DIR / f"d1-{name}.json").write_text(
            json.dumps(page, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"wrote {OUT_DIR / name} and cache/d1-{name}.json")


if __name__ == "__main__":
    main()
