#!/usr/bin/env python3
"""Scan data/day*.yaml, build output/index.html master dashboard.
   Runs after any day is built to refresh the master view."""
import re
import sys
from pathlib import Path
import yaml, jinja2

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TEMPLATES = ROOT / "templates"
OUTPUT = ROOT / "output"

def md_filter(txt):
    """Inline **bold** / `code` → HTML. Same contract as build_day.py's md_filter."""
    if not txt:
        return ""
    txt = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", txt)
    txt = re.sub(r"`([^`]+)`", r"<code>\1</code>", txt)
    return txt


STATIC = ROOT / "static"


def main():
    OUTPUT.mkdir(exist_ok=True)
    # srs.js / stats.js are shared by every page; ship them next to the pages.
    for f in STATIC.glob("*.js"):
        (OUTPUT / f.name).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
    days_list = []
    total_chunks = 0
    for yf in sorted(DATA.glob("day*.yaml")):
        # dayNN_examples.yaml holds example sentences, not a day — skip it
        if yf.stem.endswith("_examples"):
            continue
        d = yaml.safe_load(yf.read_text(encoding="utf-8"))
        # Prefer explicit day_icon; fall back to first Part's icon; else neutral 📖
        icon = d.get("day_icon") or ""
        if not icon and d.get("parts"):
            icon = (d["parts"][0] or {}).get("icon", "")
        days_list.append({
            "day": d["day"],
            "theme_zh": d["theme_zh"],
            "theme_en": d.get("theme_en", d["theme_zh"]),
            "icon": icon or "📖",
            "chunks": len(d["chunks"]),
        })
        total_chunks += len(d["chunks"])

    days_built = len(days_list)
    # Denominator honesty: `built_chunks` = actual chunks in built days (source of truth for %).
    # `projected_30d` = extrapolate remaining days using per-day average (informational only).
    avg_per_day = total_chunks / days_built if days_built > 0 else 40
    projected_30d = int(round(total_chunks + max(0, 30 - days_built) * avg_per_day))

    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(TEMPLATES)),
        autoescape=False,
    )
    env.filters["md"] = md_filter
    # V-ing reference: cross-day, not tied to any dayNN, so it lives on the hub.
    # Absent file just drops the section rather than breaking the dashboard.
    ving_path = DATA / "ving.yaml"
    ving = yaml.safe_load(ving_path.read_text(encoding="utf-8")) if ving_path.exists() else None
    # Only drill/contrast groups count toward "n/N solid" — the `grid` group is
    # recognition material and deliberately stays out of the target.
    ving_count = sum(len(g["items"]) for g in ving["groups"] if g["kind"] != "grid") if ving else 0

    tpl = env.get_template("dashboard.html.j2")
    html = tpl.render(
        days_built=days_built,
        days_total=30,
        built_chunks=total_chunks,
        projected_30d=projected_30d,
        days_list=days_list,
        ving=ving,
        ving_count=ving_count,
    )
    out = OUTPUT / "index.html"
    out.write_text(html, encoding="utf-8")
    print(f"✓ Dashboard rebuilt: {out}")

    # The vault is a page of its own — a deck, not a panel — but it shares this
    # build step so the two never drift apart.
    # the vault reads glossary.js, so keep it fresh in the same step
    import subprocess, sys as _sys
    subprocess.run([_sys.executable, str(ROOT / "scripts" / "build_glossary.py")], check=False)
    vault = env.get_template("vault.html.j2").render()
    (OUTPUT / "vault.html").write_text(vault, encoding="utf-8")
    print(f"✓ Word Vault rebuilt: {OUTPUT / 'vault.html'}")
    print(f"  {days_built}/30 days built · {total_chunks} chunks in built days · projected 30d ≈ {projected_30d}")
    if ving:
        grid_n = sum(len(s["items"]) for g in ving["groups"] if g["kind"] == "grid" for s in g["sets"])
        print(f"  V-ing section: {ving_count} drill items · {grid_n} lookup collocations")
    else:
        print("  V-ing section: skipped (no data/ving.yaml)")

if __name__ == "__main__":
    main()
