#!/usr/bin/env python3
"""Build one TOEIC day: reads data/dayNN.yaml, produces output/dayNN/
   (HTML + audio mp3s + Anki .apkg).
   TTS strategy: Hybrid — main chunks use ElevenLabs (if API key present),
   supplementary + story use edge-tts (free)."""
import asyncio, hashlib, os, re, shutil, sys, subprocess, urllib.request, urllib.error
import html as _html
import json as _json
from pathlib import Path
import yaml, jinja2, edge_tts, genanki

sys.path.insert(0, str(Path(__file__).resolve().parent))
from chunk_parts import part_sizes

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TEMPLATES = ROOT / "templates"
OUTPUT = ROOT / "output"

def _load_dotenv():
    """Load .env file (KEY=VALUE per line) into os.environ if present."""
    env_file = next((p for p in (ROOT / ".env", ROOT.parent / ".env") if p.exists()), None)
    if env_file is None:
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        v = v.strip().strip('"').strip("'")
        os.environ.setdefault(k.strip(), v)

_load_dotenv()

ELEVENLABS_API_KEY = os.environ.get("ELEVENLABS_API_KEY")
ELEVENLABS_MODEL = os.environ.get("EL_MODEL", "eleven_turbo_v2_5")

# Story-only ElevenLabs voices (chosen after listening tests, 2026-08)
# Only Story Comprehension audio uses these — chunks + supp stay on edge-tts
ELEVENLABS_STORY_VOICES = {
    "us_m": "wBXNqKUATyqu0RtYt25i",   # US male
    "uk_m": "fjnwTZkKtQOJaYzGLa6n",   # UK male
    "us_f": "qSeXEcewz7tA0Q0qk9fH",   # US female
    "uk_f": "dAlhI9qAHVIjXuVppzhW",   # UK female
}

# Voice assignment per story — evenly distributes 4 voices across 8 slots
# Each voice used exactly 2 times: us_m={A_m, D_m}, uk_m={B_m, C_m},
# us_f={B_f, C_f}, uk_f={A_f, D_f}
STORY_VOICE_ASSIGNMENT = {
    "A": {"m": "us_m", "f": "uk_f"},   # monologue: US male + UK female
    "B": {"m": "uk_m", "f": "us_f"},   # dialogue: UK male HR + US female Sarah
    "C": {"m": "uk_m", "f": "us_f"},   # monologue: UK male + US female
    "D": {"m": "us_m", "f": "uk_f"},   # dialogue: US male Manager + UK female Sarah
}

# Male voice is primary. US male + UK female for accent variety.
# Dict insertion order matters: first entry = primary (auto-play default)
VOICES = {
    "m": "en-US-GuyNeural",     # US male (PRIMARY — auto-play, Listen quiz)
    "f": "en-GB-SoniaNeural",   # UK female (SECONDARY)
}

def md_filter(txt):
    """Convert inline **bold** and `code` to HTML."""
    if not txt: return ""
    txt = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", txt)
    txt = re.sub(r"`([^`]+)`", r"<code>\1</code>", txt)
    return txt

def build_story_html(story, chunks):
    """Wrap each highlighted chunk with <span class='highlight'>."""
    html = story
    # sort by length desc so longer chunks (e.g. "All applicants are required to") match before shorter subsets
    for ch in sorted(chunks, key=len, reverse=True):
        pattern = re.escape(ch)
        html = re.sub(f"({pattern})", r'<span class="highlight">\1</span>', html, count=1, flags=re.IGNORECASE)
    return html

_AUDIO_SEM = None
_EL_SEM = None

async def _gen_one(text, voice, out_path, retries=3):
    if out_path.exists() and out_path.stat().st_size > 0:
        return
    async with _AUDIO_SEM:
        for attempt in range(retries):
            try:
                communicate = edge_tts.Communicate(text, voice)
                await communicate.save(str(out_path))
                return
            except Exception as e:
                if attempt == retries - 1:
                    print(f"  [edge-tts warn] {out_path.name} — {e}")
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))

def _el_sync_call(text, voice_id):
    body = _json.dumps({
        "text": text,
        "model_id": ELEVENLABS_MODEL,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0},
    }).encode()
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}",
        data=body,
        headers={
            "xi-api-key": ELEVENLABS_API_KEY,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()

async def _gen_elevenlabs(text, voice_id, out_path, retries=2):
    if out_path.exists() and out_path.stat().st_size > 0:
        return
    async with _EL_SEM:
        for attempt in range(retries):
            try:
                content = await asyncio.to_thread(_el_sync_call, text, voice_id)
                out_path.write_bytes(content)
                return
            except urllib.error.HTTPError as e:
                msg = e.read().decode(errors="ignore")[:200]
                if attempt == retries - 1:
                    print(f"  [EL fail — falling back to edge-tts] {out_path.name}: HTTP {e.code} {msg}")
                    # Fallback: use edge-tts. Determine m/f from voice_id via ELEVENLABS_STORY_VOICES lookup.
                    slot_key = next((k for k, v in ELEVENLABS_STORY_VOICES.items() if v == voice_id), "us_m")
                    fallback_voice = VOICES["m"] if slot_key.endswith("_m") else VOICES["f"]
                    await _gen_one(text, fallback_voice, out_path)
                    return
                await asyncio.sleep(2 * (attempt + 1))
            except Exception as e:
                if attempt == retries - 1:
                    print(f"  [EL err — falling back to edge-tts] {out_path.name}: {e}")
                    slot_key = next((k for k, v in ELEVENLABS_STORY_VOICES.items() if v == voice_id), "us_m")
                    fallback_voice = VOICES["m"] if slot_key.endswith("_m") else VOICES["f"]
                    await _gen_one(text, fallback_voice, out_path)
                    return
                await asyncio.sleep(2 * (attempt + 1))

async def generate_all_audio(data, out_dir):
    """TTS routing:
       - Main chunks + supplementary: edge-tts
       - Story Comprehension ONLY: ElevenLabs (4 voices evenly distributed A~D)
         Falls back to edge-tts if ELEVENLABS_API_KEY absent."""
    global _AUDIO_SEM, _EL_SEM
    _AUDIO_SEM = asyncio.Semaphore(8)
    _EL_SEM = asyncio.Semaphore(4)
    audio_dir = out_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    el_available = bool(ELEVENLABS_API_KEY)
    story_tts = f"ElevenLabs ({ELEVENLABS_MODEL})" if el_available else "edge-tts FALLBACK — add ELEVENLABS_API_KEY to .env for real voices"
    print(f"    TTS: chunks/supp → edge-tts | stories → {story_tts}")

    def _story_voice(sid, tag):
        assignment = STORY_VOICE_ASSIGNMENT.get(sid, {"m": "us_m", "f": "uk_f"})
        return ELEVENLABS_STORY_VOICES.get(assignment.get(tag, "us_m"))

    tasks = []
    # Main chunks — always edge-tts
    for c in data["chunks"]:
        for tag, voice in VOICES.items():
            tasks.append(_gen_one(c["chunk"], voice, audio_dir / f"chunk{c['id']}_{tag}_chunk.mp3"))
            tasks.append(_gen_one(c["example"], voice, audio_dir / f"chunk{c['id']}_{tag}_ex.mp3"))

    # Legacy mini_story fallback
    if data.get("mini_story") and not data.get("stories"):
        story = data["mini_story"].strip()
        for tag, voice in VOICES.items():
            tasks.append(_gen_one(story, voice, audio_dir / f"story_{tag}.mp3"))

    # Per-Part stories — ElevenLabs with per-story voice assignment
    for s in (data.get("stories") or []):
        sid = s["id"]
        if s.get("format") == "monologue":
            text = s["text"].strip()
            for tag in ("m", "f"):
                out_path = audio_dir / f"story_{sid}_{tag}.mp3"
                if el_available:
                    tasks.append(_gen_elevenlabs(text, _story_voice(sid, tag), out_path))
                else:
                    tasks.append(_gen_one(text, VOICES[tag], out_path))
        elif s.get("format") == "dialogue":
            for i, turn in enumerate(s.get("turns", [])):
                turn_tag = turn["voice"]
                out_path = audio_dir / f"story_{sid}_{i:02d}.mp3"
                if el_available:
                    tasks.append(_gen_elevenlabs(turn["text"], _story_voice(sid, turn_tag), out_path))
                else:
                    tasks.append(_gen_one(turn["text"], VOICES[turn_tag], out_path))

    supp = data.get("supplementary") or {}
    for tier_key in ["basic", "score_800", "score_900"]:
        for i, w in enumerate(supp.get(tier_key, [])):
            for tag, voice in VOICES.items():
                tasks.append(_gen_one(w["en"], voice, audio_dir / f"supp_{tier_key}_{i:03d}_{tag}.mp3"))
    await asyncio.gather(*tasks)
    return audio_dir

def _extract_cloze_answer(example, example_cloze):
    """Recover the exact substring of `example` that `example_cloze`'s '______'
       blank stands in for, via prefix/suffix matching. Examples are written
       naturally (inflected forms, different word order) so the blanked text
       often differs from the dictionary-form `chunk` field — the cloze quiz
       must grade against what was actually blanked, not against `chunk`.
       Returns None if example_cloze wasn't formed by blanking a contiguous
       span of example (caller should fall back to `chunk`)."""
    idx = (example_cloze or "").find("______")
    if idx == -1:
        return None
    prefix, suffix = example_cloze[:idx], example_cloze[idx + 6:]
    if not example.startswith(prefix) or not example.endswith(suffix):
        return None
    if len(prefix) + len(suffix) > len(example):
        return None
    answer = example[len(prefix): len(example) - len(suffix)] if suffix else example[len(prefix):]
    return answer.strip() or None

def _build_distractors(chunks):
    """For each chunk, precompute 3+ distractors: other chunks' meanings/chunks in same day.
       Attach to chunk dict as distractors_meaning / distractors_chunk."""
    all_meanings = [c["meaning_zh"] for c in chunks]
    all_chunks_en = [c["chunk"] for c in chunks]
    for c in chunks:
        c["distractors_meaning"] = [m for m in all_meanings if m != c["meaning_zh"]][:5]
        c["distractors_chunk"] = [ch for ch in all_chunks_en if ch != c["chunk"]][:5]
        answer = _extract_cloze_answer(c.get("example") or "", c.get("example_cloze") or "")
        if answer is None:
            print(f"  [cloze] {c['id']} '{c['chunk']}': couldn't align blank with example — falling back to chunk text as answer")
            answer = c["chunk"]
        c["cloze_answer"] = answer
    return chunks

def split_into_parts(chunks, force_parts=None):
    """Split chunks into sub-sessions per Spaced Learning research (~7-10 words/session).
       force_parts: force N parts even for small chunks (used for demo).
       Default: 1 part if <=12, else 2-4 parts of ~10 chunks each."""
    import math
    n = len(chunks)
    if force_parts:
        n_parts = min(force_parts, n)
    elif n <= 12:
        n_parts = 1
    elif n <= 20:
        n_parts = 2
    elif n <= 30:
        n_parts = 3
    else:
        n_parts = min(4, math.ceil(n / 10))
    if n_parts == 1:
        return [chunks]
    # Distribute chunks evenly across parts (early parts get 1 more if remainder)
    base = n // n_parts
    remainder = n % n_parts
    parts = []
    idx = 0
    for p in range(n_parts):
        size = base + (1 if p < remainder else 0)
        parts.append(chunks[idx:idx + size])
        idx += size
    return parts

def render_html(data, out_dir):
    import json
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(str(TEMPLATES)),
        autoescape=False,
    )
    env.filters["md"] = md_filter
    tpl = env.get_template("day.html.j2")
    # Legacy compat
    story_html = build_story_html((data.get("mini_story") or "").strip(),
                                    data.get("story_chunks", []))
    data["chunks"] = _build_distractors(data["chunks"])
    parts = split_into_parts(data["chunks"], force_parts=data.get("force_parts"))
    parts_json = json.dumps(parts, ensure_ascii=False)
    chunks_json = json.dumps(data["chunks"], ensure_ascii=False)
    story_html_json = json.dumps(story_html, ensure_ascii=False)

    # New: build per-story data with pre-rendered highlighted HTML
    stories = data.get("stories") or []
    stories_out = []
    for s in stories:
        if s.get("format") == "monologue":
            text_html = build_story_html(s["text"].strip(), s.get("story_chunks", []))
            stories_out.append({
                "id": s["id"], "format": "monologue", "title": s.get("title", ""),
                "text_html": text_html, "questions": s.get("questions", []),
            })
        elif s.get("format") == "dialogue":
            turns_html = []
            for i, turn in enumerate(s.get("turns", [])):
                turn_html = build_story_html(turn["text"], s.get("story_chunks", []))
                turns_html.append({
                    "idx": i, "speaker": turn["speaker"], "voice": turn["voice"],
                    "text_html": turn_html,
                })
            stories_out.append({
                "id": s["id"], "format": "dialogue", "title": s.get("title", ""),
                "turns": turns_html, "questions": s.get("questions", []),
            })
    stories_json = json.dumps(stories_out, ensure_ascii=False)

    supp = data.get("supplementary") or {}
    has_supp = bool(supp.get("basic") or supp.get("score_800") or supp.get("score_900"))
    # Per-Part scenario metadata. If yaml omits (or gives too few), fall back to a
    # neutral palette so the build still works — validator warns about the gap.
    default_palette = [
        {"icon": "📘", "name": f"Part {chr(65+i)}", "color": c}
        for i, c in enumerate(["#4a6fa5", "#c07030", "#7a5aa3", "#2a8570"])
    ]
    parts_meta = list(data.get("parts") or [])
    while len(parts_meta) < len(parts):
        parts_meta.append(default_palette[len(parts_meta) % 4])
    parts_meta_json = json.dumps(parts_meta[:len(parts)], ensure_ascii=False)
    n_supp = sum(len(supp.get(k) or []) for k in ("basic", "score_800", "score_900"))
    html = tpl.render(story_html=story_html, chunks_json=chunks_json,
                       story_html_json=story_html_json, parts_json=parts_json,
                       stories_json=stories_json, n_parts=len(parts),
                       parts_meta_json=parts_meta_json,
                       has_supp=has_supp, n_supp=n_supp,
                       # index.html is a hub now, not a quiz — a tile is only a
                       # live link once the page it points at has been built.
                       has_practice=(out_dir / "practice.html").exists(),
                       has_story=(out_dir / "story.html").exists(),
                       has_patterns=(out_dir / "patterns.html").exists(),
                       has_chunks_page=(out_dir / "chunks.html").exists(),
                       has_player=(out_dir / "player.html").exists(),
                       has_reading=(out_dir / "reading.html").exists(),
                       **data)
    (out_dir / "index.html").write_text(html, encoding="utf-8")

def render_reference(data, out_dir):
    """Standalone reference page listing all supplementary vocab with audio + search + filter."""
    supp = data.get("supplementary") or {}
    if not (supp.get("basic") or supp.get("score_800") or supp.get("score_900")):
        return None
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(TEMPLATES)), autoescape=False)
    tpl = env.get_template("reference.html.j2")
    # Flatten all supplementary; attach audio paths per item
    all_items = []
    tier_meta = [
        ("basic",     "Basic",  "basic"),
        ("score_800", "800",    "s800"),
        ("score_900", "900",    "s900"),
    ]
    for tier_key, tier_zh, tier_class in tier_meta:
        for i, w in enumerate(supp.get(tier_key, [])):
            all_items.append({
                **w,
                "tier": tier_key, "tier_zh": tier_zh, "tier_class": tier_class,
                "audio_m": f"audio/supp_{tier_key}_{i:03d}_m.mp3",
                "audio_f": f"audio/supp_{tier_key}_{i:03d}_f.mp3",
            })
    html = tpl.render(day=data["day"], theme_zh=data["theme_zh"], theme_en=data["theme_en"],
                      items=all_items,
                      counts={"basic": len(supp.get("basic", [])),
                              "s800": len(supp.get("score_800", [])),
                              "s900": len(supp.get("score_900", []))})
    ref_path = out_dir / "reference.html"
    ref_path.write_text(html, encoding="utf-8")
    return ref_path

# ---------------- Core chunks page ----------------

def _md_code(s):
    """`backticks` in the authored family/grammar notes become <code>. Everything
    else is escaped — these fields are prose, not markup."""
    parts = re.split(r"`([^`]*)`", s or "")
    out = []
    for i, p in enumerate(parts):
        out.append(f"<code>{_html.escape(p)}</code>" if i % 2 else _html.escape(p))
    return "".join(out)

def _grammar_bare(s):
    """The one pattern worth showing as a Speak-mode cue. Prefer the first
    backticked form (`be accustomed TO + V-ing`); fall back to the first clause."""
    m = re.search(r"`([^`]+)`", s or "")
    if m:
        return m.group(1)
    return re.split(r"[；;]", (s or "").strip())[0]

def _example_html(example, cloze, chunk):
    """Bold the chunk where it actually occurs in the example. `example_cloze`
    already carries a hand-authored blank, so diffing it against `example`
    recovers the exact surface form — no inflection guessing. Falls back to a
    tolerant match for the rows whose cloze blanks a different span."""
    ex = (example or "").strip()
    if not ex:
        return ""
    i = (cloze or "").find("______")
    if i >= 0:
        pre, post = cloze[:i], cloze[i:].lstrip("_")
        if ex.startswith(pre) and ex.endswith(post) and len(ex) > len(pre) + len(post):
            a, b = len(pre), len(ex) - len(post)
            return (_html.escape(ex[:a]) + "<b>" + _html.escape(ex[a:b]) + "</b>"
                    + _html.escape(ex[b:]))
    pat = (r"(?<![A-Za-z])" + re.escape(chunk).replace(r"\ ", r"\s+")
           + r"(?:s|es|d|ed|ing)?(?![A-Za-z])")
    m = re.search(pat, ex, flags=re.I)
    if m:
        return (_html.escape(ex[:m.start()]) + "<b>" + _html.escape(m.group(0)) + "</b>"
                + _html.escape(ex[m.end():]))
    return _html.escape(ex)

def _hex_soft(hex_color, alpha=0.13):
    h = (hex_color or "#2a7a4f").lstrip("#")
    if len(h) != 6:
        return "rgba(42,122,79,0.13)"
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return f"rgba({r},{g},{b},{alpha})"

def render_chunks(data, out_dir):
    """Standalone page for the 40 main chunks — the counterpart to reference.html.

    Practice shows these fields one answer at a time and then moves on; nothing
    else in the build ever renders `life_scenario` or `family` at all. This page
    is where all seven authored fields are readable, searchable, and re-visitable."""
    chunks = data.get("chunks") or []
    if not chunks:
        return None
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(str(TEMPLATES)), autoescape=False)
    tpl = env.get_template("chunks.html.j2")

    default_palette = ["#4a6fa5", "#c07030", "#7a5aa3", "#2a8570"]
    parts_meta = list(data.get("parts") or [])
    n_parts = max(1, min(4, -(-len(chunks) // 10)))
    while len(parts_meta) < n_parts:
        i = len(parts_meta)
        parts_meta.append({"icon": "📘", "name": f"Part {chr(65 + i)}",
                           "color": default_palette[i % 4]})
    parts_meta = parts_meta[:n_parts]

    # Same split build_trr.py uses, so a chunk lands in the same Part on both pages.
    sizes = part_sizes(len(chunks), n_parts)
    owner = [p for p, size in enumerate(sizes) for _ in range(size)]
    items, counts = [], [0] * n_parts
    for i, c in enumerate(chunks):
        p = owner[i]
        counts[p] += 1
        cid = str(c.get("id") or f"{i + 1:02d}")
        items.append({
            "id": cid,
            "chunk": c.get("chunk", ""),
            "zh": c.get("meaning_zh", ""),
            "example_html": _example_html(c.get("example", ""), c.get("example_cloze", ""),
                                          c.get("chunk", "")),
            "example_zh": c.get("example_zh", ""),
            "life_scenario": c.get("life_scenario", ""),
            "family": c.get("family", ""),
            "family_html": _md_code(c.get("family", "")),
            "grammar": c.get("grammar", ""),
            "grammar_html": _md_code(c.get("grammar", "")),
            "grammar_bare": _grammar_bare(c.get("grammar", "")),
            "part": p,
            "part_name": parts_meta[p].get("name", f"Part {chr(65 + p)}"),
            "part_icon": parts_meta[p].get("icon", "📘"),
            "part_color": parts_meta[p].get("color", default_palette[p % 4]),
            "part_soft": _hex_soft(parts_meta[p].get("color")),
            # one lowercased blob so Lookup search reaches the scene and family
            # notes too, not just the chunk and its meaning
            "haystack": " ".join(str(c.get(k, "")) for k in
                                 ("chunk", "meaning_zh", "example", "example_zh",
                                  "life_scenario", "family", "grammar")).lower(),
            "audio_wm": f"audio/chunk{cid}_m_chunk.mp3",
            "audio_wf": f"audio/chunk{cid}_f_chunk.mp3",
            "audio_sm": f"audio/chunk{cid}_m_ex.mp3",
            "audio_sf": f"audio/chunk{cid}_f_ex.mp3",
        })

    html = tpl.render(day=data["day"], theme_zh=data.get("theme_zh", ""),
                      theme_en=data.get("theme_en", ""),
                      items=items, parts_meta=parts_meta, counts=counts)
    path = out_dir / "chunks.html"
    path.write_text(html, encoding="utf-8")
    return path

# ---------------- Anki ----------------

# Stable IDs (do not change or Anki treats as new deck / model)
# v3: audio split into chunk-only vs example (audio must match what is on screen)
MODEL_ID = 1690000003
DECK_ID_BASE = 1690000100  # + day number
# Supplementary model & deck offsets
# v2: unified model — ALL tiers use listen+recognition (audio required per research)
SUPP_MODEL_ID = 1690000006
DECK_ID_BASIC_OFFSET = 1000     # DECK_ID_BASE + 1000 + day
DECK_ID_800_OFFSET = 2000       # DECK_ID_BASE + 2000 + day
DECK_ID_900_OFFSET = 3000       # DECK_ID_BASE + 3000 + day

SUPP_CSS = """
    .card { font-family: -apple-system, "PingFang TC", sans-serif; font-size: 18px;
            text-align: center; color: #1a1a1a; padding: 24px; line-height: 1.6; }
    .tag { color: #2a7a4f; font-size: 12px; font-weight: 700;
           letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 12px; }
    .chunk { font-size: 26px; font-weight: 700; color: #2a7a4f; margin: 12px 0; }
    .zh { color: #5a5a5a; font-size: 15px; }
    .zh-big { font-size: 24px; margin: 12px 0; }
    .hint { color: #999; font-size: 12px; margin-top: 12px; }
    hr { border: none; border-top: 1px dashed #d0d0d0; margin: 16px 0; }
"""

# ONE model for ALL supp tiers — always includes audio (listen + recognition)
SUPP_MODEL = genanki.Model(
    SUPP_MODEL_ID,
    "TOEIC Supp (Listen+Recognition, all tiers)",
    fields=[
        {"name": "Word"}, {"name": "MeaningZh"},
        {"name": "AudioM"}, {"name": "AudioF"},
        {"name": "Tier"}, {"name": "DayTag"},
    ],
    templates=[
        {
            "name": "1 Listen→Word",
            "qfmt": '<div class="tag">{{DayTag}} · {{Tier}} · Listen</div>'
                    '{{AudioM}}<div class="hint">聽到的字是？</div>',
            "afmt": '{{FrontSide}}<hr>'
                    '<div class="chunk">{{Word}}</div>'
                    '<div class="zh">{{MeaningZh}}</div>{{AudioF}}',
        },
        {
            "name": "2 Word→Meaning",
            "qfmt": '<div class="tag">{{DayTag}} · {{Tier}} · Recognition</div>'
                    '<div class="chunk">{{Word}}</div>',
            "afmt": '{{FrontSide}}<hr>'
                    '<div class="zh-big">{{MeaningZh}}</div>{{AudioM}}',
        },
    ],
    css=SUPP_CSS,
)

MODEL = genanki.Model(
    MODEL_ID,
    "TOEIC Chunk v3 (Chunk+Example audio)",
    fields=[
        {"name": "Chunk"},
        {"name": "MeaningZh"},
        {"name": "Example"},
        {"name": "ExampleZh"},
        {"name": "ExampleCloze"},
        {"name": "LifeScenario"},
        {"name": "Grammar"},
        {"name": "AudioChunkF"},   # female voice, chunk alone
        {"name": "AudioChunkM"},   # male voice, chunk alone
        {"name": "AudioExF"},      # female voice, full example
        {"name": "AudioExM"},      # male voice, full example
        {"name": "DayTag"},
    ],
    templates=[
        {
            "name": "1 Listening (Audio→Cloze)",
            "qfmt": '<div class="tag">{{DayTag}} · Listening</div>'
                    '{{AudioChunkM}}'
                    '<div class="cloze">{{ExampleCloze}}</div>'
                    '<div class="hint">聽 chunk 音檔（美男），填空</div>',
            "afmt": '{{FrontSide}}<hr>'
                    '<div class="chunk">{{Chunk}}</div>'
                    '<div class="zh">{{MeaningZh}}</div>'
                    '<div class="ex">{{Example}}</div>'
                    '{{AudioExF}}',
        },
        {
            "name": "2 Recognition (EN→ZH)",
            "qfmt": '<div class="tag">{{DayTag}} · Recognition</div>'
                    '<div class="chunk">{{Chunk}}</div>'
                    '<div class="hint">想中文意思</div>',
            "afmt": '{{FrontSide}}<hr>'
                    '<div class="zh-big">{{MeaningZh}}</div>'
                    '<div class="ex">{{Example}}<br><span class="zh">{{ExampleZh}}</span></div>'
                    '{{AudioExM}}',
        },
        {
            "name": "3 Production (ZH→EN)",
            "qfmt": '<div class="tag">{{DayTag}} · Production</div>'
                    '<div class="zh-big">{{MeaningZh}}</div>'
                    '<div class="scenario">情境：{{LifeScenario}}</div>'
                    '<div class="hint">說出英文 chunk</div>',
            "afmt": '{{FrontSide}}<hr>'
                    '<div class="chunk">{{Chunk}}</div>'
                    '<div class="ex">{{Example}}</div>'
                    '{{AudioExM}}',
        },
    ],
    css="""
        .card { font-family: -apple-system, "PingFang TC", sans-serif; font-size: 18px;
                text-align: center; color: #1a1a1a; padding: 24px; line-height: 1.6; }
        .tag { color: #2a7a4f; font-size: 12px; font-weight: 700;
               letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 12px; }
        .chunk { font-size: 26px; font-weight: 700; color: #2a7a4f; margin: 12px 0; }
        .zh { color: #5a5a5a; font-size: 15px; }
        .zh-big { font-size: 24px; margin: 12px 0; }
        .ex { margin: 12px 0; font-style: italic; color: #333; }
        .cloze { font-size: 20px; margin: 16px 0; padding: 12px;
                 background: #fff3b0; border-radius: 8px; }
        .scenario { background: #e5f0ea; padding: 8px 12px; border-radius: 8px;
                    color: #1e5e3d; font-size: 13px; margin: 10px 0; }
        .hint { color: #999; font-size: 12px; margin-top: 12px; }
        .deep { text-align: left; font-size: 13px; margin: 8px 20px; color: #5a5a5a; }
        hr { border: none; border-top: 1px dashed #d0d0d0; margin: 16px 0; }
    """,
)

def build_anki(data, audio_dir, out_dir):
    day = data["day"]
    tag = f"Day{day:02d}"
    theme = data["theme_zh"]
    deck_name_base = f"TOEIC::Day {day:02d} · {theme}"

    # ---- Main deck: 40 chunks × 3 card types ----
    main_deck = genanki.Deck(DECK_ID_BASE + day, f"{deck_name_base}::01 主 chunks")
    media_files = []
    for c in data["chunks"]:
        files = {
            "cf": f"chunk{c['id']}_f_chunk.mp3",
            "cm": f"chunk{c['id']}_m_chunk.mp3",
            "ef": f"chunk{c['id']}_f_ex.mp3",
            "em": f"chunk{c['id']}_m_ex.mp3",
        }
        for f in files.values():
            media_files.append(str(audio_dir / f))
        note = genanki.Note(
            model=MODEL,
            fields=[
                c["chunk"], c["meaning_zh"], c["example"], c["example_zh"],
                c["example_cloze"], c["life_scenario"], md_filter(c.get("grammar") or ""),
                f"[sound:{files['cf']}]", f"[sound:{files['cm']}]",
                f"[sound:{files['ef']}]", f"[sound:{files['em']}]",
                tag,
            ],
            tags=["TOEIC", tag, data["theme_en"].replace(" ", "_"), "main"],
        )
        main_deck.add_note(note)

    all_decks = [main_deck]
    supp = data.get("supplementary") or {}

    def add_supp_deck(tier_key, tier_display, offset):
        items = supp.get(tier_key, [])
        if not items:
            return
        d = genanki.Deck(DECK_ID_BASE + offset + day,
                         f"{deck_name_base}::{tier_display}")
        for i, w in enumerate(items):
            audio_m = f"supp_{tier_key}_{i:03d}_m.mp3"
            audio_f = f"supp_{tier_key}_{i:03d}_f.mp3"
            media_files.extend([str(audio_dir / audio_m), str(audio_dir / audio_f)])
            n = genanki.Note(model=SUPP_MODEL, fields=[
                w["en"], w["zh"],
                f"[sound:{audio_m}]", f"[sound:{audio_f}]",
                tier_display.split(" · ")[-1],  # tier badge text
                tag,
            ], tags=["TOEIC", tag, f"supp_{tier_key}"])
            d.add_note(n)
        all_decks.append(d)

    # All 3 tiers get audio + 2 card types (uniform treatment)
    add_supp_deck("basic",     "02 補充 · 基礎",  DECK_ID_BASIC_OFFSET)
    add_supp_deck("score_800", "03 補充 · 800 分", DECK_ID_800_OFFSET)
    add_supp_deck("score_900", "04 補充 · 900 分", DECK_ID_900_OFFSET)

    apkg_path = out_dir / f"day{day:02d}.apkg"
    genanki.Package(all_decks, media_files=media_files).write_to_file(str(apkg_path))
    return apkg_path, sum(len(d.notes) for d in all_decks)

# ---------------- Main ----------------

def main(day_num: int, pages_only: bool = False):
    yaml_path = DATA / f"day{day_num:02d}.yaml"
    if not yaml_path.exists():
        print(f"[error] {yaml_path} not found"); sys.exit(1)
    data = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))

    out_dir = OUTPUT / f"day{day_num:02d}"
    out_dir.mkdir(parents=True, exist_ok=True)

    # Audio and Anki are the slow, quota-spending steps and neither depends on
    # the HTML. --pages-only re-renders just the pages against existing mp3s.
    if pages_only:
        # chunks/reference first: index.html only lights a tile up once the page
        # it points at exists on disk.
        chunks_path = render_chunks(data, out_dir)
        ref_path = render_reference(data, out_dir)
        render_html(data, out_dir)
        print(f"✓ Day {day_num:02d} pages re-rendered:")
        print(f"  HTML  : {out_dir / 'index.html'}")
        if ref_path:
            print(f"  Ref   : {ref_path}")
        if chunks_path:
            print(f"  Chunks: {chunks_path}")
        return

    supp_800_n = len((data.get('supplementary') or {}).get('score_800', []))
    n_audio = 4 * len(data['chunks']) + 2 * 1 + 2 * supp_800_n  # 4/chunk + 2/story + 2/supp800
    print(f"[1/5] generating audio ({n_audio} files)…")
    audio_dir = asyncio.run(generate_all_audio(data, out_dir))

    print("[2/5] rendering core chunks page…")
    chunks_path = render_chunks(data, out_dir)

    print("[3/5] rendering reference page…")
    ref_path = render_reference(data, out_dir)

    print("[4/5] rendering HTML…")
    render_html(data, out_dir)

    print("[5/5] building Anki .apkg…")
    apkg, n_notes = build_anki(data, audio_dir, out_dir)

    print(f"\n✓ Day {day_num:02d} built:")
    print(f"  HTML  : {out_dir / 'index.html'}")
    if ref_path:
        print(f"  Ref   : {ref_path}")
    if chunks_path:
        print(f"  Chunks: {chunks_path}")
    print(f"  Audio : {audio_dir}/  ({sum(1 for _ in audio_dir.glob('*.mp3'))} mp3s)")
    print(f"  Anki  : {apkg}  ({n_notes} notes, main + supp sub-decks)")

    # Auto-refresh dashboard
    print("\n[bonus] rebuilding master dashboard…")
    import subprocess
    subprocess.run([sys.executable, str(Path(__file__).parent / "build_dashboard.py")], check=True)

if __name__ == "__main__":
    args = sys.argv[1:]
    pages_only = "--pages-only" in args
    args = [a for a in args if not a.startswith("--")]
    if len(args) != 1:
        print("usage: build_day.py <day_number> [--pages-only]"); sys.exit(1)
    main(int(args[0]), pages_only=pages_only)
