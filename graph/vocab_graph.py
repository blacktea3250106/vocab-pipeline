"""Vocabulary knowledge graph: word -> relations -> Obsidian notes linked by [[wikilinks]].

Two modes:
  build  no API. Turns the extracted book data (web/data/*.js) into notes,
         splitting the book's related-word lists into family / synonym /
         antonym / lookalike links with plain rules.
  add    Claude analysis. Structured output validated by Pydantic, then a
         second pass of semantic rules (clean()) before anything is written.

Usage:
  python graph/vocab_graph.py build                       # every word in the book data
  python graph/vocab_graph.py add emerge implicitly       # analyse specific words
  python graph/vocab_graph.py add -f graph/seed_words.txt # one word per line
  python graph/vocab_graph.py                             # interactive
  python graph/vocab_graph.py stats                       # link statistics

Prompts and note text are Traditional Chinese because the learner reads them;
code, comments and CLI output are English.
"""

import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

import anthropic
import yaml
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
DEFAULT_VAULT = HERE / "vault"
DEFAULT_BOOK = Path(os.environ.get("VOCAB_BOOK_DIR", HERE.parent / "web"))
MODEL = os.environ.get("VOCAB_MODEL", "claude-opus-5-5")

# These four relations become graph edges; collocations and examples are content only
LINK_TYPES = ["synonyms", "antonyms", "family", "confusing"]
LINK_LABELS = {"synonyms": "synonyms", "antonyms": "antonyms", "family": "family", "confusing": "lookalikes"}
LIMITS = {"synonyms": 4, "antonyms": 3, "family": 6, "confusing": 4, "collocations": 5, "examples": 3}
WORD_RE = re.compile(r"^[a-zé][a-zé'\-]*$")


# ---------- Shape of the model output (enforced by structured outputs) ----------

class Link(BaseModel):
    word: str = Field(description="小寫原形單字，不能是片語")
    note: str = Field(description="一句繁體中文：同義詞寫用法差異，易混淆字寫怎麼分辨")


class FamilyMember(BaseModel):
    word: str = Field(description="小寫單字")
    pos: str = Field(description="詞性，如 n. / v. / adj. / adv.")
    zh: str


class Collocation(BaseModel):
    phrase: str
    zh: str


class Example(BaseModel):
    en: str
    zh: str


class WordAnalysis(BaseModel):
    pos: str
    meaning_zh: str = Field(description="中文字義，多個義項用；分隔")
    core_sense: str = Field(description="一句中文描述核心畫面或語感")
    root: str | None = Field(description="字根字源的記憶解釋；不確定就是 null")
    family: list[FamilyMember]
    synonyms: list[Link]
    antonyms: list[Link]
    confusing: list[Link]
    collocations: list[Collocation]
    examples: list[Example]


SYSTEM = """你是多益（TOEIC）單字教學專家，也懂詞源學與認知科學。你要為一個 Obsidian 單字知識圖譜分析一個英文單字。圖譜裡的每條連線都會被學習者當成記憶線索，所以一條錯誤或牽強的連線，比少一條連線更糟。

原則：
- 寧缺勿濫。每一類都可以是空陣列，只放學習者在多益情境真的用得到、或能幫他把兩個字分清楚的關係。
- synonyms：在多益常見語境下（至少某個義項）可以互換。note 寫兩者的差別或可互換的情境。只是「同主題」的字不算。
- antonyms：真正的相反詞。沒有就留空，不要硬找（例如 corporation 沒有反義詞）。
- family：與本字共享字根、有真實衍生關係的字（emerge → emergence, emergent）。拼字像但字源無關的不算。
- confusing：拼字或發音相近，或多益常拿來當陷阱的字（emerge / merge、attendant / attendance）。note 寫一句怎麼分辨。可以和 family 重疊——同字根但詞性、意思不同正是多益常考點。
- root：用一句話解釋字根字源，要能幫助記憶（例：e-「向外」+ mergere「浸入」→ 從水裡冒出來）。不確定就填 null，不要編造。
- core_sense：一句中文描述這個字的核心畫面或語感，讓人看得出它和近義字的不同。
- collocations：多益真的常見的搭配，最多 5 個。
- examples：2 句多益風格（商務、職場、公告、email）的例句，附中文翻譯。
- synonyms / antonyms / family / confusing 的 word 一律用小寫單字；片語放 collocations。
- 「書上的資料」是學習者課本的內容：中文字義以它為準；書上列的衍生字、同義字、易混淆字如果正確，就要納入。
- 「圖譜裡已有的單字」中，若有字和本字有上述任一種真實關係，優先放進對應類別，讓新節點接上既有節點；沒有真實關係就不要連。
- 中文一律用繁體中文（台灣用語）。"""


# ---------- Book data (web/data/*.js written by extract/parse.mjs) ----------

BOOK_JS = r"""
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.join(process.argv[1], 'data');
const ctx = { window: {} }; vm.createContext(ctx);
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort())
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx);
process.stdout.write(JSON.stringify({ data: ctx.window.VOCAB_DATA || [], detail: ctx.window.VOCAB_DETAIL || {} }));
"""


def load_book(book_dir: Path) -> dict:
    """Evaluate the site's data files with node; return {word: {entries, detail, listed_under}}, or {} if unavailable."""
    if not (book_dir / "data").is_dir():
        print(f"(no book data at {book_dir}/data; using model analysis only)")
        return {}
    try:
        out = subprocess.run(["node", "-e", BOOK_JS, str(book_dir)], capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError) as e:
        print(f"(could not read book data, using model analysis only: {e})")
        return {}
    raw = json.loads(out)
    book = defaultdict(lambda: {"entries": [], "detail": None, "listed_under": []})
    for e in raw["data"]:
        w = e["word"].lower()
        book[w]["entries"].append(e)
        for r in e.get("related") or []:
            book[r["word"].lower()]["listed_under"].append(f'{e["word"]}（{e["day"]}）')
    for w, d in raw["detail"].items():
        book[w.lower()]["detail"] = d
    return dict(book)


# ---------- Claude call ----------

def build_prompt(word: str, book_info: dict | None, existing: list[str]) -> str:
    parts = [f"單字：{word}"]
    if book_info and (book_info["entries"] or book_info["detail"]):
        book = {"entries": book_info["entries"], "detail": book_info["detail"]}
        parts.append("書上的資料：\n" + json.dumps(book, ensure_ascii=False, indent=1))
    if book_info and book_info["listed_under"]:
        parts.append("書上把這個字列在以下單字的相關字裡：" + "、".join(book_info["listed_under"][:10]))
    others = [w for w in existing if w != word]
    parts.append("圖譜裡已有的單字：" + ("、".join(others) if others else "（還沒有）"))
    return "\n\n".join(parts)


def analyze(client: anthropic.Anthropic, word: str, book_info: dict | None, existing: list[str]) -> WordAnalysis | None:
    response = client.messages.parse(
        model=MODEL,
        max_tokens=16000,
        system=SYSTEM,
        messages=[{"role": "user", "content": build_prompt(word, book_info, existing)}],
        output_format=WordAnalysis,
        output_config={"effort": "medium"},
        # If a request is wrongly blocked, the server retries it on a fallback model
        extra_headers={"anthropic-beta": "server-side-fallback-2026-07-01"},
        extra_body={"fallbacks": "default"},
    )
    if response.stop_reason == "refusal":
        print(f"  ✗ model refused ({response.stop_details})")
        return None
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        print(f"  ✗ incomplete output (stop_reason={response.stop_reason})")
        return None
    return response.parsed_output


# ---------- Validation: semantic rules the schema cannot express ----------

def clean(a: WordAnalysis, headword: str) -> list[str]:
    """Fix the model output in place; return a description of everything dropped."""
    warnings = []
    for field in LINK_TYPES:
        kept, seen = [], set()
        for item in getattr(a, field):
            w = item.word.strip().lower()
            if not WORD_RE.match(w):
                warnings.append(f"{LINK_LABELS[field]}: dropped '{item.word}' (not a single word)")
            elif w == headword:
                warnings.append(f"{LINK_LABELS[field]}: dropped self-link")
            elif w not in seen:
                seen.add(w)
                item.word = w
                kept.append(item)
        setattr(a, field, kept)

    contradictory = {s.word for s in a.synonyms} & {x.word for x in a.antonyms}
    if contradictory:
        warnings.append(f"both synonym and antonym, dropped from both: {', '.join(contradictory)}")
        a.synonyms = [s for s in a.synonyms if s.word not in contradictory]
        a.antonyms = [x for x in a.antonyms if x.word not in contradictory]

    for field, limit in LIMITS.items():
        items = getattr(a, field)
        if len(items) > limit:
            warnings.append(f"{field} has {len(items)} items, keeping the first {limit}")
            setattr(a, field, items[:limit])

    stem = headword[: max(4, len(headword) - 3)]  # tolerate inflections like emerged / complied
    for ex in a.examples:
        if stem not in ex.en.lower():
            warnings.append(f"example does not contain {headword}, dropped: {ex.en}")
    a.examples = [ex for ex in a.examples if stem in ex.en.lower()]
    return warnings


# ---------- Render an Obsidian note ----------

def existing_words(vault: Path) -> list[str]:
    return sorted(p.stem.lower() for p in vault.glob("*.md"))


def render_note(word: str, a: WordAnalysis, book_info: dict | None, source: str = "ai",
                extras: list[str] | None = None) -> str:
    entries = (book_info or {}).get("entries") or []
    props = {"word": word, "pos": a.pos, "meaning": a.meaning_zh}
    if entries:
        props["tier"] = entries[0]["tier"]
        props["day"] = entries[0]["day"]
    for field in LINK_TYPES:
        props[field] = [f"[[{x.word}]]" for x in getattr(a, field)]
    props["tags"] = ["vocab"] + ([f"tier/{entries[0]['tier']}"] if entries else [])
    props["source"] = source
    props["created"] = date.today().isoformat()

    lines = ["---", yaml.safe_dump(props, allow_unicode=True, sort_keys=False).strip(), "---", ""]
    lines += [f"# {word}", "", f"*{a.pos}* {a.meaning_zh}", ""]
    if a.core_sense:
        lines += [f"> {'核心語感' if source == 'ai' else '記憶點'}：{a.core_sense}", ""]
    if a.root:
        lines += ["## 字根字源", a.root, ""]

    def section(title, rows):
        if rows:
            lines.extend([f"## {title}", *rows, ""])

    section("同義詞", [f"- [[{x.word}]] — {x.note}" for x in a.synonyms])
    section("反義詞", [f"- [[{x.word}]] — {x.note}" for x in a.antonyms])
    section("詞族", [f"- [[{x.word}]] *{x.pos}* {x.zh}" for x in a.family])
    section("容易混淆", [f"- [[{x.word}]] — {x.note}" for x in a.confusing])
    section("延伸比較", extras or [])
    section("常見搭配", [f"- **{x.phrase}** {x.zh}" for x in a.collocations])
    section("多益例句", [f"- {x.en}\n  {x.zh}" for x in a.examples])
    section("書上的例句", [f"- {e['example']['en']}\n  {e['example']['zh']}（{e['day']}）"
                           for e in entries if e.get("example", {}).get("en")])
    return "\n".join(lines)


def safe_filename(word: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", word)


# ---------- No-API mode: build notes straight from the book data ----------

def split_words(text: str) -> list[str]:
    """Split 'trustworthy / dependable' or 'hurry, hasten' into separate words."""
    return [w.strip().lower() for w in re.split(r"[/,]", text) if w.strip()]


def same_root(a: str, b: str) -> bool:
    n = 0
    while n < min(len(a), len(b)) and a[n] == b[n]:
        n += 1
    return n >= min(4, min(len(a), len(b)) - 1)


REPLACEABLE = re.compile(r"替換|代換|換成|同義|可互換|可以換|意思相近|近義|反義|相同意思|也可以用|也能用|= ")


def from_book(word: str, info: dict) -> tuple[list[str], WordAnalysis]:
    """Return (unlinked comparison rows, analysis)."""
    entries, detail = info["entries"], info["detail"] or {}
    links = {f: {} for f in LINK_TYPES}  # dicts dedupe and keep order

    def put(field, w, note):
        if w != word and w not in links[field]:
            links[field][w] = note

    for f in detail.get("family") or []:
        for w in split_words(f["word"]):
            put("antonyms" if "反義" in f["zh"] else "synonyms" if "同義" in f["zh"] else "family", w, f["zh"])
    for e in entries:
        for r in e.get("related") or []:
            for w in split_words(r["word"]):
                if "反義" in r["zh"]:
                    put("antonyms", w, r["zh"])
                elif same_root(w, word):
                    put("family", w, r["zh"])
                else:
                    put("synonyms", w, r["zh"])
    # nearby rows mix synonyms, contrasts and same-grammar lists (e.g. uncountable
    # nouns). Only rows that say "replaceable" or "opposite" become links; the rest
    # stay in the note body, or aircraft would end up a synonym of luggage.
    extras = []
    for r in (detail.get("nearby") or {}).get("rows") or []:
        zh = re.sub(r"<[^>]+>", "", r["zh"])
        if REPLACEABLE.search(zh):
            for w in split_words(r["word"]):
                put("antonyms" if "反義" in zh else "synonyms", w, zh)
        else:
            extras.append((split_words(r["word"]), f"- {r['word']} — {zh}"))
    for r in (detail.get("lookalikes") or {}).get("rows") or []:
        for w in split_words(r["word"]):
            put("confusing", w, r["zh"] + (f"（{r['tag']}）" if r.get("tag") else ""))
    # a word listed as both synonym and antonym is treated as an antonym
    for w in links["antonyms"]:
        links["synonyms"].pop(w, None)
    linked = {word}.union(*links.values())
    extras = [row for ws, row in extras if not set(ws) <= linked]

    pos_of = {f["word"].lower(): f["pos"] for f in detail.get("family") or []}
    return extras, WordAnalysis(
        pos=entries[0]["pos"],
        meaning_zh="；".join(dict.fromkeys(e["zh"] for e in entries)),
        core_sense=(detail.get("lock") or {}).get("big") or "",
        root=None,
        family=[FamilyMember(word=w, pos=pos_of.get(w, ""), zh=z) for w, z in links["family"].items()],
        synonyms=[Link(word=w, note=z) for w, z in links["synonyms"].items()],
        antonyms=[Link(word=w, note=z) for w, z in links["antonyms"].items()],
        confusing=[Link(word=w, note=z) for w, z in links["confusing"].items()],
        collocations=[Collocation(phrase=c["en"], zh=c["zh"]) for c in detail.get("chunks") or []],
        examples=[],  # book examples are listed separately by render_note
    )


def build_from_book(words: list[str] | None, vault: Path, book: dict, force: bool) -> None:
    vault.mkdir(parents=True, exist_ok=True)
    targets = words or sorted(w for w, info in book.items() if info["entries"])
    written = skipped = missing = 0
    for word in targets:
        info = book.get(word)
        if not info or not info["entries"]:
            print(f"{word}: not in the book data, skipped (use add for model analysis)")
            missing += 1
            continue
        path = vault / f"{safe_filename(word)}.md"
        if path.exists() and not force and read_props(path).get("source") != "book":
            skipped += 1  # model-written notes are richer; never overwrite them here
            continue
        extras, a = from_book(word, info)
        path.write_text(render_note(word, a, info, source="book", extras=extras), encoding="utf-8")
        written += 1
    print(f"wrote {written} notes ({vault}); kept {skipped} model-written notes; {missing} not in book data")


# ---------- Commands ----------

def add_words(words: list[str], vault: Path, book: dict, force: bool) -> None:
    vault.mkdir(parents=True, exist_ok=True)
    client = anthropic.Anthropic()
    for i, raw in enumerate(words, 1):
        word = raw.strip().lower()
        if not word:
            continue
        path = vault / f"{safe_filename(word)}.md"
        if path.exists() and not force:
            print(f"[{i}/{len(words)}] {word}: exists, skipped")
            continue
        print(f"[{i}/{len(words)}] {word}: analysing…", flush=True)
        try:
            a = analyze(client, word, book.get(word), existing_words(vault))
        except anthropic.AuthenticationError:
            sys.exit("API authentication failed: set ANTHROPIC_API_KEY first")
        except anthropic.RateLimitError:
            print("  ✗ rate limited; run again later (finished words are skipped)")
            continue
        except anthropic.APIStatusError as e:
            print(f"  ✗ API error {e.status_code}: {e.message}")
            continue
        except anthropic.APIConnectionError:
            print("  ✗ cannot reach the API, check the network")
            continue
        if a is None:
            continue
        for w in clean(a, word):
            print(f"  ⚠ {w}")
        path.write_text(render_note(word, a, book.get(word)), encoding="utf-8")
        counts = "、".join(f"{LINK_LABELS[f]} {len(getattr(a, f))}" for f in LINK_TYPES)
        print(f"  ✓ {path.name}（{counts}）")


def read_props(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\n(.*?)\n---", text, re.S)
    return yaml.safe_load(m.group(1)) if m else {}


def stats(vault: Path) -> None:
    notes = {p.stem.lower(): read_props(p) for p in vault.glob("*.md")}
    if not notes:
        print("no notes in the vault yet")
        return
    targets = defaultdict(set)          # linked word -> notes that link to it
    per_type = Counter()
    internal = Counter()                # links that land on an existing note
    edges = set()
    for word, props in notes.items():
        for field in LINK_TYPES:
            for link in props.get(field) or []:
                t = link.strip("[]").lower()
                per_type[field] += 1
                targets[t].add(word)
                if t in notes:
                    internal[field] += 1
                    edges.add(tuple(sorted((word, t))))

    print(f"{len(notes)} notes, {sum(per_type.values())} links, {len(targets)} distinct linked words\n")
    print(f"{'relation':<12}{'links':>6}{'to notes':>10}")
    for field in LINK_TYPES:
        print(f"{LINK_LABELS[field]:<12}{per_type[field]:>6}{internal[field]:>10}")

    connected = {w for e in edges for w in e}
    isolated = sorted(set(notes) - connected)
    shown = ", ".join(isolated[:20]) + (" ⋯" if len(isolated) > 20 else "")
    print(f"\n{len(edges)} note-to-note pairs; {len(isolated)} isolated notes: {shown or 'none'}")

    bridges = sorted(((t, ws) for t, ws in targets.items() if len(ws) >= 2), key=lambda x: -len(x[1]))
    if bridges:
        print("\nBridge words (linked from 2+ notes; they tie clusters together):")
        for t, ws in bridges[:15]:
            mark = "" if t in notes else " (no note yet)"
            print(f"  {t}{mark} ← {', '.join(sorted(ws))}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Vocabulary knowledge graph")
    parser.add_argument("--vault", type=Path, default=DEFAULT_VAULT, help="Obsidian vault path")
    parser.add_argument("--book", type=Path, default=DEFAULT_BOOK, help="study site folder containing data/")
    sub = parser.add_subparsers(dest="cmd")
    p_add = sub.add_parser("add", help="analyse words with Claude")
    p_add.add_argument("words", nargs="*")
    p_add.add_argument("-f", "--file", type=Path, help="word list file, one per line")
    p_add.add_argument("--force", action="store_true", help="regenerate existing notes")
    p_build = sub.add_parser("build", help="no API: build notes from book data (all words if none given)")
    p_build.add_argument("words", nargs="*")
    p_build.add_argument("-f", "--file", type=Path, help="word list file, one per line")
    p_build.add_argument("--force", action="store_true", help="also overwrite model-written notes")
    sub.add_parser("stats", help="graph statistics")
    args = parser.parse_args()

    if args.cmd == "stats":
        stats(args.vault)
        return

    book = load_book(args.book)
    if args.cmd == "build":
        words = [w.lower() for w in args.words]
        if args.file:
            words += [l.strip().lower() for l in args.file.read_text(encoding="utf-8").splitlines()
                      if l.strip() and not l.startswith("#")]
        build_from_book(words, args.vault, book, args.force)
        return

    if args.cmd == "add":
        words = list(args.words)
        if args.file:
            words += [l.strip() for l in args.file.read_text(encoding="utf-8").splitlines()
                      if l.strip() and not l.startswith("#")]
        if not words:
            parser.print_help()
            return
        add_words(words, args.vault, book, args.force)
        return

    # interactive mode: keep reading words until an empty line
    while True:
        try:
            line = input("words (space or comma separated, Enter to quit)> ")
        except EOFError:
            break
        words = [w for w in re.split(r"[\s,，]+", line) if w]
        if not words:
            break
        add_words(words, args.vault, book, force=False)


if __name__ == "__main__":
    main()
