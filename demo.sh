#!/usr/bin/env bash
# Run the whole pipeline on the synthetic sample day. No API key needed.
#   ./demo.sh            # offline steps only
#   ./demo.sh --audio    # also generate neural TTS audio + Anki deck (needs internet for edge-tts)
set -euo pipefail
cd "$(dirname "$0")"
PY=${PYTHON:-python3}

echo "== 1. extract: cached page results -> web/data/day01.js (continuity check runs here)"
PAGES_DIR=samples/pages CACHE_DIR=samples/cache node extract/parse.mjs d1

echo "== 2. validate: detail notes for the study site"
node extract/check.mjs

echo "== 3. graph: Obsidian notes from the book data, no API"
$PY graph/vocab_graph.py --vault samples/vault build
$PY graph/vocab_graph.py --vault samples/vault stats

echo "== 4. course: validate the day YAML, then build"
$PY course/scripts/validate_day.py 1
if [[ "${1:-}" == "--audio" ]]; then
  $PY course/scripts/build_day.py 1
else
  $PY course/scripts/build_day.py 1 --pages-only
  $PY course/scripts/build_dashboard.py
fi

echo
echo "Open web/index.html (word cards + drill) and course/output/day01/index.html (chunk course)."
