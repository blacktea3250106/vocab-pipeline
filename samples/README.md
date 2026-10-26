# Sample data

Everything in this folder was written for this repo. None of it comes from the
vocabulary book I use day to day. The book's page photos and everything derived
from them stay on my machine, because that content is copyrighted.

| Path | What it is |
|---|---|
| `sample_pages.json` | Ten everyday office words, written by me, in the same shape the extractor returns. |
| `make_sample_pages.py` | Draws `pages/d1/page_1.png` and `page_2.png` from that JSON in a vocabulary-book layout (numbered headword, stars, meaning, example, an "exam focus" box, a word-list table). Marked "SYNTHETIC SAMPLE PAGE". |
| `pages/d1/*.png` | The two synthetic page images. |
| `cache/d1-*.json` | Hand-made stand-ins for the per-image results Claude would return for those pages. They let `extract/parse.mjs` run fully offline. They are not recorded API output. |
| `cache/notes-day01.json` | Written by `parse.mjs`: the "exam focus" boxes collected across pages. |
| `vault/` | Obsidian notes written by `graph/vocab_graph.py build` (no API) from the sample data. |

To see the real extraction step, put your own photos in `pages/d1/` at the repo
root (ignored by git), set `ANTHROPIC_API_KEY`, and run `node extract/parse.mjs d1`.
The synthetic pages work too: point `PAGES_DIR` at `samples/pages` with an empty
cache folder.
