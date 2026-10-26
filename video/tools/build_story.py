#!/usr/bin/env python3
"""Verify a day's story script against data/dayNN.yaml, then emit
src/dayNN/episodes.json (optionally generating narration with edge-tts).

Generalized from the Day02 build so every later day reuses the same pipeline:
    python tools/build_story.py --day 03            # verify only
    python tools/build_story.py --day 03 --tts      # + narration + durations

Expects a sibling module tools/dayNN_story.py exposing EPISODES.
"""
import argparse
import importlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
VIDEO = HERE.parent
TOEIC = VIDEO.parent / "course"  # day YAML lives in course/data/
sys.path.insert(0, str(HERE))

# L = left speaker (US male), R = right speaker (GB female) — the project's
# two-voice convention.
VOICES = {"L": "en-US-GuyNeural", "R": "en-GB-SoniaNeural"}


# Emoji chosen by keyword; only the Remotion video compositions render these,
# the HTML player does not.
ICON_RULES = [
    (r"law|legal|judicial|attorney|justly|justification|legitimate", "⚖️"),
    (r"safety|alert", "🦺"),
    (r"inspect|assess|identify", "🔍"),
    (r"tax", "💰"),
    (r"dress|attire|smock", "👔"),
    (r"ban|prohibit|restrict|refrain|off-limits|circumscribe|suppress", "🚫"),
    (r"approv|permission|authoriz|allowed", "✅"),
    (r"penalty|punish|fine|reprimand", "💸"),
    (r"warn", "⚠️"),
    (r"petition|write|list|registration", "✍️"),
    (r"compensation", "💵"),
    (r"witness|testimony|substantiate", "🗣️"),
    (r"theft|suspect|accuse|trespass", "🕵️"),
    (r"lawsuit|court|ministry|act|legislation|ordinance|enactment|resolution", "🏛️"),
    (r"policy|regulations|procedure|principle|curriculum", "📜"),
    (r"effect", "⚡"),
    (r"habit|regular", "🔁"),
    (r"increase", "📈"),
    (r"end", "🏁"),
    (r"mistake|inadvertently", "😅"),
    (r"mind|consider", "🧠"),
    (r"advantage|advice|counsel", "💬"),
    (r"supervis|stand over|control", "👀"),
    (r"obey|comply|adhere|observance|accordance|according", "🙇"),
    (r"ignore|distrust", "🙈"),
    (r"endure|tensely|stiff", "😤"),
    (r"precious|impeccable|exemplary", "🌟"),
    (r"access|door|enter", "🚪"),
    (r"feedback|inquiries|concerns", "💭"),
    (r"crucial|bound|obligation", "❗"),
]


def pick_icon(en: str) -> str:
    for pat, icon in ICON_RULES:
        if re.search(pat, en.lower()):
            return icon
    return "📌"


def clean_word(w: str) -> str:
    return re.sub(r"[.,!?;:'’\"]", "", w.lower())


def phrase_in_text(realized: str, text: str) -> bool:
    toks = [clean_word(w) for w in text.split()]
    ph = [clean_word(w) for w in realized.split()]
    return any(toks[i : i + len(ph)] == ph for i in range(len(toks) - len(ph) + 1))


def load_words(day: str):
    with open(TOEIC / "data" / f"day{day}.yaml") as f:
        d = yaml.safe_load(f)
    words = {}
    for c in d["chunks"]:
        words[c["chunk"].lower()] = {
            "en": c["chunk"], "zh": c["meaning_zh"], "tier": "chunk",
            "example_zh": c.get("example_zh"), "diagram": None,
        }
    for tier in ["basic", "score_800", "score_900"]:
        for w in d["supplementary"][tier]:
            words[w["en"].lower()] = {
                "en": w["en"], "zh": w["zh"], "tier": tier,
                "example_zh": None, "diagram": w.get("diagram"),
            }
    return words, d


def verify_and_build(day: str, episodes, speakers):
    words, _ = load_words(day)
    errors, used = [], {}

    for ep in episodes:
        for ti, (spk, text, spots, highlights) in enumerate(ep["turns"]):
            if spk not in VOICES:
                errors.append(f"{ep['id']} turn{ti}: unknown speaker '{spk}'")
            for canonical, realized in spots + highlights:
                key = canonical.lower()
                if key not in words:
                    errors.append(f"{ep['id']} turn{ti}: '{canonical}' not in day{day} word list")
                    continue
                if not phrase_in_text(realized, text):
                    errors.append(f"{ep['id']} turn{ti}: realized '{realized}' NOT in: {text}")
                used.setdefault(key, []).append(ep["id"])
            wrong_tier = [c for c, _ in spots if words.get(c.lower(), {}).get("tier") == "basic"]
            if wrong_tier:
                errors.append(f"{ep['id']} turn{ti}: basic words belong in highlights: {wrong_tier}")

    missing = sorted(w["en"] for k, w in words.items() if k not in used)
    if missing:
        errors.append(f"MISSING {len(missing)} words: {missing}")

    dupes = {k: v for k, v in used.items() if len(v) > 1}
    print(f"coverage: {len(used)}/{len(words)} words; repeated: {len(dupes)}")
    if errors:
        print("\n".join(errors))
        sys.exit(1)

    out = []
    for ep in episodes:
        turns = []
        for ti, (spk, text, spots, highlights) in enumerate(ep["turns"]):
            spots_out = []
            for canonical, realized in spots:
                w = words[canonical.lower()]
                spot = {"phrase": w["en"], "realized": realized, "zh": w["zh"],
                        "icon": pick_icon(w["en"]), "tier": w["tier"]}
                if w["diagram"]:
                    spot["diagram"] = {
                        "ascii": w["diagram"]["ascii"].rstrip("\n"),
                        "mnemonic": w["diagram"]["mnemonic"],
                    }
                elif w["example_zh"]:
                    spot["exampleZh"] = w["example_zh"]
                spots_out.append(spot)
            turns.append({
                "speaker": spk,
                "voice": VOICES[spk],
                "text": text,
                "audio": f"day{day}/{ep['id']}_{ti:02d}.mp3",
                "spots": spots_out,
                "highlights": [r for _, r in highlights],
            })
        entry = {
            "id": ep["id"], "titleEn": ep["title_en"], "titleZh": ep["title_zh"],
            "leftName": speakers["left"], "rightName": speakers["right"],
            "turns": turns,
        }
        # optional scene dressing, only used by the Remotion video compositions
        for snake, camel in [("location", "location"), ("time", "time"),
                             ("status_from", "statusFrom"), ("status_to", "statusTo"),
                             ("left_icon", "leftIcon"), ("right_icon", "rightIcon")]:
            if snake in ep:
                entry[camel] = ep[snake]
        out.append(entry)
    return out


def gen_tts(day: str, episodes):
    audio_dir = VIDEO / "public" / "audio" / f"day{day}"
    audio_dir.mkdir(parents=True, exist_ok=True)
    for ep in episodes:
        for turn in ep["turns"]:
            path = VIDEO / "public" / "audio" / turn["audio"]
            if not path.exists():
                # edge-tts can hang indefinitely on a stalled connection, so
                # every attempt is bounded and retried rather than left to block
                for attempt in range(5):
                    try:
                        r = subprocess.run(
                            ["edge-tts", "--voice", turn["voice"], "--text", turn["text"],
                             "--write-media", str(path)],
                            capture_output=True, text=True, timeout=45)
                        if r.returncode == 0 and path.exists() and path.stat().st_size > 0:
                            break
                        err = r.stderr[-160:]
                    except subprocess.TimeoutExpired:
                        err = "timed out after 45s"
                    path.unlink(missing_ok=True)   # never keep a truncated file
                    print(f"  retry {attempt + 1}: {turn['audio']} — {err}", flush=True)
                    time.sleep(2 * (attempt + 1))
                else:
                    sys.exit(f"TTS failed: {turn['audio']}")
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                 "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                capture_output=True, text=True)
            turn["durationSec"] = float(probe.stdout.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", required=True, help="two-digit day, e.g. 03")
    ap.add_argument("--tts", action="store_true", help="generate narration and measure durations")
    args = ap.parse_args()

    story = importlib.import_module(f"day{args.day}_story")
    episodes = verify_and_build(args.day, story.EPISODES, story.SPEAKERS)

    lines = sum(len(e["turns"]) for e in episodes)
    cards = sum(len(t["spots"]) for e in episodes for t in e["turns"])
    hl = sum(len(t["highlights"]) for e in episodes for t in e["turns"])
    wps = sum(len(t["text"].split()) for e in episodes for t in e["turns"])
    print(f"episodes={len(episodes)} lines={lines} cards={cards} highlights={hl} words_spoken={wps}")

    if args.tts:
        gen_tts(args.day, episodes)
        total_s = sum(t["durationSec"] for e in episodes for t in e["turns"])
        print(f"narration: {total_s:.0f}s total, base rate {wps / (total_s / 60):.1f} wpm")

    dest = VIDEO / "src" / f"day{args.day}" / "episodes.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w") as f:
        json.dump(episodes, f, ensure_ascii=False, indent=1)
    print(f"wrote {dest}")


if __name__ == "__main__":
    main()
