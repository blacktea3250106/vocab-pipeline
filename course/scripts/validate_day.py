#!/usr/bin/env python3
"""Validate data/dayNN.yaml before building.

Usage:
    python scripts/validate_day.py 2
    python scripts/validate_day.py all       # all day*.yaml
    python scripts/validate_day.py           # same as `all`

Exits 0 if clean, 1 on any errors. Warnings don't fail.
"""
import sys
import re
from pathlib import Path
import yaml

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

RESET = "\033[0m"; RED = "\033[31m"; YEL = "\033[33m"; GRN = "\033[32m"; DIM = "\033[2m"

VALID_POS = {"n.", "v.", "adj.", "adv.", "phr.", "prep.", "conj.", "int."}
VALID_Q_TYPES = {"main_idea", "detail", "inference", "vocab"}
VALID_VOICES = {"m", "f"}
VALID_STORY_FORMATS = {"monologue", "dialogue"}


def _err(loc, msg, bag):
    bag["errors"].append(f"{RED}✗{RESET} [{loc}] {msg}")


def _warn(loc, msg, bag):
    bag["warnings"].append(f"{YEL}⚠{RESET} [{loc}] {msg}")


def _check_pos(loc, pos, bag):
    # Split combined POS like "n./v." — each half must be valid
    for token in re.split(r"[/,]", pos or ""):
        token = token.strip()
        if token and token not in VALID_POS:
            _warn(loc, f"unusual pos '{token}' (expected one of {sorted(VALID_POS)})", bag)


def _check_no_placeholder(loc, val, bag):
    """The template uses '__' as a placeholder — a real yaml should have none."""
    if isinstance(val, str) and val.strip() == "__":
        _err(loc, "value is still template placeholder '__'", bag)
    if isinstance(val, str) and "__" in val and len(val.strip()) <= 4:
        _err(loc, f"value looks like unfilled placeholder: '{val}'", bag)


def validate_day_yaml(path: Path):
    bag = {"errors": [], "warnings": []}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as e:
        return {"errors": [f"{RED}✗{RESET} YAML parse error: {e}"], "warnings": []}

    if not isinstance(data, dict):
        return {"errors": [f"{RED}✗{RESET} top-level YAML must be a mapping"], "warnings": []}

    # ── Top-level required fields ──
    for f in ("day", "theme_zh", "theme_en"):
        if f not in data or not data[f] and data[f] != 0:
            _err("root", f"missing required field: {f}", bag)
        else:
            _check_no_placeholder(f"root.{f}", data[f], bag)
    if "day" in data and not (isinstance(data["day"], int) and 1 <= data["day"] <= 30):
        _err("root.day", f"must be int 1..30, got {data['day']!r}", bag)

    # ── Parts scenario metadata ──
    parts_meta = data.get("parts") or []
    if not parts_meta:
        _warn("parts", "no `parts:` — falling back to neutral default palette", bag)
    else:
        for i, p in enumerate(parts_meta):
            loc = f"parts[{i}]"
            if not isinstance(p, dict):
                _err(loc, "must be a mapping with icon/name/color", bag); continue
            for k in ("icon", "name", "color"):
                if k not in p:
                    _err(loc, f"missing '{k}'", bag)
                else:
                    _check_no_placeholder(f"{loc}.{k}", p[k], bag)
            if "color" in p and not re.match(r"^#[0-9a-fA-F]{6}$", p["color"] or ""):
                _err(loc, f"color must be 6-digit hex (#rrggbb), got '{p['color']}'", bag)

    # ── Chunks ──
    chunks = data.get("chunks") or []
    if not chunks:
        _err("chunks", "no chunks defined", bag)
    else:
        seen_ids = set()
        for i, c in enumerate(chunks):
            loc = f"chunks[{i}]"
            if not isinstance(c, dict):
                _err(loc, "must be a mapping", bag); continue
            for f in ("id", "chunk", "meaning_zh", "example", "example_cloze"):
                if f not in c or not c[f]:
                    _err(loc, f"missing '{f}'", bag)
                else:
                    _check_no_placeholder(f"{loc}.{f}", c[f], bag)
            cid = c.get("id")
            if cid in seen_ids:
                _err(loc, f"duplicate id '{cid}'", bag)
            seen_ids.add(cid)
            # example_cloze should include a blank
            ex_cloze = c.get("example_cloze") or ""
            if ex_cloze and "___" not in ex_cloze:
                _warn(loc, f"example_cloze missing '______' blank: '{ex_cloze[:60]}'", bag)
            # The blank must align with `example` via prefix/suffix (build_day.py
            # grades the cloze quiz against the text actually blanked out, not
            # against `chunk` verbatim — misaligned examples silently fall back
            # to grading against `chunk`, which often can't grammatically fill
            # the blank shown to the learner).
            elif ex_cloze:
                idx = ex_cloze.find("______")
                prefix, suffix = ex_cloze[:idx], ex_cloze[idx + 6:]
                example = c.get("example") or ""
                if not example.startswith(prefix) or not example.endswith(suffix):
                    _warn(loc, "example_cloze blank doesn't align with `example` "
                               "(prefix/suffix mismatch) — cloze quiz will fall back to grading against `chunk`", bag)
            # Example should share at least one meaningful word with the chunk
            # (chunks often appear inflected: "be impressed by" → "impressed").
            ex = (c.get("example") or "").lower()
            chunk = (c.get("chunk") or "").lower()
            if ex and chunk:
                stop = {"the", "a", "an", "be", "is", "are", "to", "of", "in", "on",
                        "for", "with", "from", "at", "by", "and", "or", "your"}
                key_words = [w for w in re.findall(r"[a-z]+", chunk)
                             if len(w) >= 4 and w not in stop]
                if key_words and not any(w in ex for w in key_words):
                    _warn(loc, f"chunk '{chunk}' shares no keyword with example", bag)

        # Chunk count sanity
        n = len(chunks)
        if n < 8:
            _warn("chunks", f"only {n} chunks — very small day, will be 1 Part", bag)
        elif n > 50:
            # The book hands out a different number of numbered headwords each day —
            # 39 on Day 07, 45 on Day 11 — so anything in the 40s is normal, not a smell.
            _warn("chunks", f"{n} chunks is more than any day in the book (~39-45)", bag)

    # ── Stories ──
    stories = data.get("stories") or []
    if not stories:
        _warn("stories", "no stories — Final Boss section will be empty", bag)
    else:
        story_ids = set()
        for si, s in enumerate(stories):
            loc = f"stories[{si}]"
            if not isinstance(s, dict):
                _err(loc, "must be a mapping", bag); continue
            sid = s.get("id")
            if not sid:
                _err(loc, "missing id (e.g. A/B/C/D)", bag)
            if sid in story_ids:
                _err(loc, f"duplicate story id '{sid}'", bag)
            story_ids.add(sid)
            fmt = s.get("format")
            if fmt not in VALID_STORY_FORMATS:
                _err(loc, f"format must be monologue|dialogue, got '{fmt}'", bag)
            if not s.get("title"):
                _err(loc, "missing title", bag)
            else:
                _check_no_placeholder(f"{loc}.title", s["title"], bag)
            # Content
            if fmt == "monologue":
                if not s.get("text"):
                    _err(loc, "monologue requires 'text'", bag)
                elif len(s["text"].split()) < 60:
                    _warn(loc, f"monologue is only {len(s['text'].split())} words — aim for 100-150", bag)
            elif fmt == "dialogue":
                turns = s.get("turns") or []
                if len(turns) < 4:
                    _err(loc, f"dialogue needs ≥4 turns, has {len(turns)}", bag)
                for ti, t in enumerate(turns):
                    tloc = f"{loc}.turns[{ti}]"
                    if not isinstance(t, dict):
                        _err(tloc, "must be a mapping with speaker/voice/text", bag); continue
                    for f in ("speaker", "voice", "text"):
                        if f not in t or not t[f]:
                            _err(tloc, f"missing '{f}'", bag)
                    if t.get("voice") not in VALID_VOICES:
                        _err(tloc, f"voice must be m|f, got '{t.get('voice')}'", bag)
            # Questions
            qs = s.get("questions") or []
            if len(qs) != 6:
                _err(loc, f"questions must be exactly 6 (bank of 6, UI shows 3+reshuffle), has {len(qs)}", bag)
            for qi, q in enumerate(qs):
                qloc = f"{loc}.questions[{qi}]"
                for f in ("q", "options", "correct"):
                    if f not in q:
                        _err(qloc, f"missing '{f}'", bag)
                if not isinstance(q.get("options"), list) or len(q.get("options") or []) != 4:
                    _err(qloc, "options must be a list of exactly 4", bag)
                if not isinstance(q.get("correct"), int) or not (0 <= q.get("correct", -1) < 4):
                    _err(qloc, "correct must be int 0..3", bag)
                if q.get("type") and q["type"] not in VALID_Q_TYPES:
                    _warn(qloc, f"type '{q['type']}' not in {sorted(VALID_Q_TYPES)}", bag)

    # Story slot consistency with parts meta
    if parts_meta and stories:
        expected = min(len(parts_meta), 4)
        if len(stories) != expected:
            _warn("stories", f"{len(stories)} stories but {expected} Parts — some Parts have no Story", bag)

    # ── Supplementary ──
    supp = data.get("supplementary") or {}
    tier_counts = {}
    for tier in ("basic", "score_800", "score_900"):
        items = supp.get(tier) or []
        tier_counts[tier] = len(items)
        for i, it in enumerate(items):
            loc = f"supplementary.{tier}[{i}]"
            if not isinstance(it, dict):
                _err(loc, "must be a mapping {en, zh, pos}", bag); continue
            for f in ("en", "zh", "pos"):
                if f not in it or not it[f]:
                    _err(loc, f"missing '{f}'", bag)
                else:
                    _check_no_placeholder(f"{loc}.{f}", it[f], bag)
            if "pos" in it:
                _check_pos(loc, it["pos"], bag)
    if tier_counts.get("score_800", 0) < 30:
        _warn("supplementary.score_800", f"only {tier_counts.get('score_800',0)} items — this is the 700→900 gold zone, aim for ~68", bag)

    return bag


def print_report(path, bag):
    name = path.name
    errs = bag["errors"]; warns = bag["warnings"]
    if not errs and not warns:
        print(f"{GRN}✓{RESET} {name} — clean")
        return
    print(f"\n── {name} ──")
    for msg in errs: print(f"  {msg}")
    for msg in warns: print(f"  {msg}")
    print(f"  {DIM}{len(errs)} errors, {len(warns)} warnings{RESET}")


def main(argv):
    args = argv[1:] or ["all"]
    if args == ["all"]:
        paths = sorted(DATA.glob("day*.yaml"))
    else:
        paths = []
        for a in args:
            try:
                n = int(a)
                paths.append(DATA / f"day{n:02d}.yaml")
            except ValueError:
                p = DATA / a
                if not p.suffix:
                    p = p.with_suffix(".yaml")
                paths.append(p)
    if not paths:
        print(f"{YEL}no day*.yaml found in {DATA}{RESET}"); return 1

    total_errs = 0
    for p in paths:
        if not p.exists():
            print(f"{RED}✗{RESET} {p} not found"); total_errs += 1; continue
        bag = validate_day_yaml(p)
        print_report(p, bag)
        total_errs += len(bag["errors"])

    print()
    if total_errs == 0:
        print(f"{GRN}✓ all clean{RESET}"); return 0
    print(f"{RED}✗ {total_errs} error(s) — fix before building{RESET}"); return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
