#!/usr/bin/env python3
"""Build a standalone speed-reading player for one day.

Emits output/dayNN/story.html (self-contained: data + CSS + JS inlined) and
copies that day's narration clips to output/dayNN/story_audio/. Word
pronunciation reuses the existing output/dayNN/audio/ library built by
build_day.py — nothing there is modified, and the day's index.html is
left untouched.

    python tools/build_player.py --day 03
"""
import argparse
import importlib
import json
import re
import shutil
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
VIDEO = HERE.parent
TOEIC = VIDEO.parent / "course"  # day YAML and HTML output live under course/
sys.path.insert(0, str(HERE))


def load_episodes(day: str):
    with open(VIDEO / "src" / f"day{day}" / "episodes.json") as f:
        return json.load(f)


def copy_audio(day: str, out_dir: Path, episodes):
    dest = out_dir / "story_audio"
    dest.mkdir(parents=True, exist_ok=True)
    for ep in episodes:
        for turn in ep["turns"]:
            src = VIDEO / "public" / "audio" / turn["audio"]
            shutil.copy2(src, dest / Path(turn["audio"]).name)
    return dest


def build_word_audio_map(day: str, out_dir: Path):
    """Map each vocabulary entry to its already-recorded pronunciation clip in
    output/dayNN/audio/ (built by build_day.py, whose naming this mirrors:
    chunk{id}_m_chunk.mp3 and supp_{tier}_{index:03d}_m.mp3). Male voice, per
    the project's primary-voice convention. Nothing is re-generated here."""
    with open(TOEIC / "data" / f"day{day}.yaml") as f:
        d = yaml.safe_load(f)

    m = {}
    for c in d["chunks"]:
        m[c["chunk"].lower()] = f"audio/chunk{c['id']}_m_chunk.mp3"
    for tier in ["basic", "score_800", "score_900"]:
        for i, w in enumerate(d["supplementary"][tier]):
            m[w["en"].lower()] = f"audio/supp_{tier}_{i:03d}_m.mp3"

    missing = [k for k, v in m.items() if not (out_dir / v).exists()]
    if missing:
        sys.exit(f"missing pronunciation clips for: {missing[:8]} ({len(missing)} total)")
    return m


def clean_token(w: str) -> str:
    return re.sub(r"[.,!?;:'’\"]", "", w.lower())


def token_index(text: str, phrase: str) -> int:
    toks = [clean_token(w) for w in text.split()]
    ph = [clean_token(w) for w in phrase.split()]
    for i in range(len(toks) - len(ph) + 1):
        if toks[i : i + len(ph)] == ph:
            return i
    return -1


def build_payload(episodes, word_audio, ZH):
    missing, no_clip = [], []
    payload = []
    for ep in episodes:
        turns = []
        for i, turn in enumerate(ep["turns"]):
            key = f"{ep['id']}_{i:02d}"
            if key not in ZH:
                missing.append(key)
            token_count = len(turn["text"].split())
            words = []
            for s in turn["spots"]:
                clip = word_audio.get(s["phrase"].lower())
                if not clip:
                    no_clip.append(s["phrase"])
                idx = token_index(turn["text"], s["realized"])
                words.append({
                    "en": s["phrase"],
                    "zh": s["zh"],
                    "realized": s["realized"],
                    "tier": s["tier"],
                    "audio": clip or "",
                    # fraction of the line at which this phrase starts, so the
                    # sidebar reveals words in step with the narration
                    "pos": round(max(idx, 0) / max(token_count, 1), 4),
                })
            turns.append({
                "speaker": ep["leftName"] if turn["speaker"] == "L" else ep["rightName"],
                "side": turn["speaker"],
                "text": turn["text"],
                "zh": ZH.get(key, ""),
                "audio": "story_audio/" + Path(turn["audio"]).name,
                "words": words,
            })
        payload.append({
            "id": ep["id"], "titleEn": ep["titleEn"], "titleZh": ep["titleZh"],
            "turns": turns,
        })
    if missing:
        sys.exit(f"missing zh translations: {missing}")
    if no_clip:
        sys.exit(f"no pronunciation clip for: {sorted(set(no_clip))}")
    return payload


CSS = """
:root {
  --bg: #0d1620; --panel: #101b26; --line: rgba(255,255,255,.09);
  --ink: #f2f5f8; --dim: #6f8497; --gold: #ffd166; --blue: #7fb3e8;
  --orange: #f0a868;
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  background: var(--bg); color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue",
               "PingFang TC", "Noto Sans TC", sans-serif;
  display: flex; flex-direction: column; overflow: hidden;
}
header {
  display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  padding: 14px 26px; border-bottom: 1px solid var(--line);
}
header h1 { font-size: 15px; letter-spacing: 2px; margin: 0; color: var(--dim); font-weight: 700; }
select, button {
  font: inherit; font-size: 14px; color: var(--ink);
  background: #17222e; border: 1px solid var(--line);
  border-radius: 8px; padding: 7px 13px; cursor: pointer;
}
button:hover, select:hover { border-color: rgba(255,209,102,.5); }
button.on { background: var(--gold); color: #10202e; border-color: var(--gold); font-weight: 700; }
.spacer { flex: 1; }
.count { font-size: 13px; color: var(--dim); font-variant-numeric: tabular-nums; }

main { flex: 1; display: flex; min-height: 0; }

.stage {
  flex: 1; display: flex; flex-direction: column; justify-content: center;
  padding: 40px 60px; min-width: 0;
}
.speaker {
  font-size: 15px; font-weight: 700; letter-spacing: 3px; margin-bottom: 22px;
}
.speaker.L { color: var(--orange); }
.speaker.R { color: var(--blue); }
.line {
  font-size: clamp(30px, 3.4vw, 56px); font-weight: 650; line-height: 1.42;
  letter-spacing: -.01em;
}
.line .w { color: var(--gold); }
.zh {
  margin-top: 30px; font-size: clamp(17px, 1.35vw, 24px); color: #9db2c4;
  line-height: 1.75; max-width: 46em; border-left: 2px solid var(--line);
  padding-left: 18px;
}
.zh[hidden] { display: none; }

aside {
  width: 340px; flex: none; border-left: 1px solid var(--line);
  background: var(--panel); padding: 22px 24px; overflow-y: auto;
}
aside h2 {
  font-size: 12px; letter-spacing: 2.5px; color: var(--dim);
  margin: 0 0 16px; font-weight: 700; position: sticky; top: -22px;
  background: var(--panel); padding: 4px 0 10px;
}
.word {
  margin: 0 -10px 5px; padding: 7px 10px; border-radius: 8px;
  cursor: pointer; border: 1px solid transparent;
}
.word:hover { background: rgba(255,209,102,.08); border-color: rgba(255,209,102,.3); }
.word:hover .en::after { content: " 🔊"; font-size: 13px; opacity: .75; }
.word.playing { background: rgba(255,209,102,.16); border-color: var(--gold); }
.word .en { font-size: 18px; font-weight: 700; color: var(--gold); line-height: 1.25; }
.word .zh2 { font-size: 15px; color: #a8bccf; margin-top: 1px; }
.word.new { animation: pop .5s ease-out; }
@keyframes pop {
  from { opacity: 0; transform: translateY(-6px); }
  to { opacity: 1; transform: none; }
}

footer {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 14px 26px; border-top: 1px solid var(--line);
}
.progress {
  flex: 1; height: 4px; background: #1c2836; border-radius: 3px;
  overflow: hidden; min-width: 120px;
}
.progress i { display: block; height: 100%; background: var(--gold); width: 0; }
kbd {
  font: inherit; font-size: 12px; color: var(--dim);
  border: 1px solid var(--line); border-radius: 5px; padding: 2px 6px;
}
@media (max-width: 820px) {
  main { flex-direction: column; }
  aside { width: auto; border-left: none; border-top: 1px solid var(--line); max-height: 34vh; }
  .stage { padding: 28px 24px; }
}
"""

JS = """
const $ = (s) => document.querySelector(s);
// Playback rates come from the speed selector, computed at build time from
// this day's measured narration rate so the labels really mean 155 / 175 wpm.
let epIndex = 0, turnIndex = 0, autoplay = true, showZh = false, speed = 1;
let seen = [];            // words revealed so far, in order — never removed
const seenKeys = new Set();
const audio = new Audio();       // narration
const wordAudio = new Audio();   // single-word pronunciation

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

// Wrap each target phrase in the sentence so the gold text matches the
// vocabulary column exactly. Longest-first avoids a short phrase eating a
// longer one that contains it.
function markup(text, words) {
  const phrases = words.map((w) => w.realized).sort((a, b) => b.length - a.length);
  let out = escapeHtml(text);
  const hit = [];   // the sentence's own casing, preserved
  phrases.forEach((p, i) => {
    const esc = escapeHtml(p).replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');
    out = out.replace(new RegExp(esc, 'i'), (m) => { hit[i] = m; return `\\u0000${i}\\u0000`; });
  });
  phrases.forEach((p, i) => {
    if (hit[i] === undefined) return;
    out = out.replace(`\\u0000${i}\\u0000`, `<span class="w">${hit[i]}</span>`);
  });
  return out;
}

function applySpeed() {
  audio.playbackRate = speed;
  audio.preservesPitch = true;          // keep the voice natural when sped up
  audio.mozPreservesPitch = true;
  audio.webkitPreservesPitch = true;
}

// Words from finished lines are permanent; words in the line being played
// appear one by one as the narration reaches them.
function collectSeen(progress) {
  const ep = DATA[epIndex];
  let added = 0;
  const take = (w) => {
    if (seenKeys.has(w.en)) return;
    seenKeys.add(w.en); seen.push(w); added++;
  };
  for (let i = 0; i < turnIndex; i++) ep.turns[i].words.forEach(take);
  for (const w of ep.turns[turnIndex].words) if (w.pos <= progress) take(w);
  return added;
}

function renderWords(freshCount) {
  $('#words').innerHTML = seen.map((w, i) =>
    `<div class="word${i >= seen.length - freshCount ? ' new' : ''}"
          data-audio="${w.audio}" title="點一下聽發音">
       <div class="en">${escapeHtml(w.en)}</div>
       <div class="zh2">${escapeHtml(w.zh)}</div>
     </div>`).join('');
  $('#wcount').textContent = seen.length;
  const aside = $('aside');
  aside.scrollTop = aside.scrollHeight;
}

// Reveal any words the narration has now reached, without redrawing the
// whole list on every timeupdate tick.
function tickWords() {
  if (!audio.duration) return;
  const added = collectSeen(audio.currentTime / audio.duration);
  if (added) renderWords(added);
}

function sayWord(el) {
  const src = el.dataset.audio;
  if (!src) return;
  audio.pause();                 // never overlap the narration
  wordAudio.src = src;
  wordAudio.playbackRate = 1;    // single words stay at natural speed
  wordAudio.play().catch(() => {});
  document.querySelectorAll('.word.playing').forEach((n) => n.classList.remove('playing'));
  el.classList.add('playing');
}

function render() {
  const ep = DATA[epIndex];
  const t = ep.turns[turnIndex];
  const added = collectSeen(0);   // words already earned; this line starts fresh

  $('#speaker').textContent = t.speaker;
  $('#speaker').className = 'speaker ' + t.side;
  $('#line').innerHTML = markup(t.text, t.words);
  $('#zh').textContent = t.zh;
  $('#zh').hidden = !showZh;
  $('#pos').textContent = `${turnIndex + 1} / ${ep.turns.length}`;
  $('#bar').style.width = ((turnIndex + 1) / ep.turns.length * 100) + '%';
  renderWords(added);

  audio.src = t.audio;
  applySpeed();   // src assignment can reset the rate, so set it after
  // browsers block autoplay until the page gets a real interaction
  audio.play().then(() => { $('#hint').hidden = true; })
              .catch(() => { $('#hint').hidden = false; });
}

function go(delta) {
  const ep = DATA[epIndex];
  const next = turnIndex + delta;
  if (next < 0 || next >= ep.turns.length) return;
  collectSeen(1);        // skipping ahead still banks the current line's words
  turnIndex = next;
  render();
}

function loadEpisode(i, keepWords) {
  epIndex = i; turnIndex = 0;
  if (!keepWords) { seen = []; seenKeys.clear(); }
  $('#eptitle').textContent = DATA[i].titleZh;
  render();
}

audio.addEventListener('timeupdate', tickWords);
audio.addEventListener('ended', () => {
  collectSeen(1);                // make sure the line's last word landed
  renderWords(0);
  if (autoplay) go(1);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
  else if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
  else if (e.key === ' ') { audio.paused ? audio.play() : audio.pause(); e.preventDefault(); }
  else if (e.key.toLowerCase() === 'r') { audio.currentTime = 0; audio.play(); }
  else if (e.key.toLowerCase() === 't') { $('#zhBtn').click(); }
});

window.addEventListener('DOMContentLoaded', () => {
  const sel = $('#ep');
  sel.innerHTML = DATA.map((e, i) =>
    `<option value="${i}">${e.titleEn} · ${e.titleZh}</option>`).join('');
  sel.addEventListener('change', () => loadEpisode(+sel.value, false));

  $('#words').addEventListener('click', (e) => {
    const el = e.target.closest('.word');
    if (el) sayWord(el);
  });

  $('#prev').addEventListener('click', () => go(-1));
  $('#next').addEventListener('click', () => go(1));
  $('#replay').addEventListener('click', () => { audio.currentTime = 0; audio.play(); });
  $('#zhBtn').addEventListener('click', (e) => {
    showZh = !showZh;
    $('#zh').hidden = !showZh;
    e.currentTarget.classList.toggle('on', showZh);
  });
  $('#autoBtn').addEventListener('click', (e) => {
    autoplay = !autoplay;
    e.currentTarget.classList.toggle('on', autoplay);
  });
  $('#autoBtn').classList.add('on');

  const sp = $('#speed');
  speed = +sp.value;      // whichever option the build marked as selected
  sp.addEventListener('change', () => { speed = +sp.value; applySpeed(); });

  loadEpisode(0, false);
});
"""


def speech_rates(episodes):
    """The two mandated listening speeds (155 / 175 wpm) expressed as playback
    rates for this day's narration, whose base rate varies per build."""
    words = sum(len(t["text"].split()) for e in episodes for t in e["turns"])
    secs = sum(t["durationSec"] for e in episodes for t in e["turns"])
    base = words / (secs / 60)
    return base, round(155 / base, 3), round(175 / base, 3)


def build_html(payload, day: str, theme: str, rate155: float, rate175: float):
    return f"""<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Day {day} · 速讀劇場</title>
<style>{CSS}</style>
</head>
<body>
<header>
  <h1>DAY {day} · {theme}</h1>
  <select id="ep"></select>
  <span class="count" id="eptitle"></span>
  <span class="spacer"></span>
  <select id="speed" title="播放語速">
    <option value="{rate155}" selected>155 wpm · 正常</option>
    <option value="{rate175}">175 wpm · 進階</option>
  </select>
  <button id="zhBtn">中文翻譯</button>
  <button id="autoBtn">自動連播</button>
</header>

<main>
  <div class="stage">
    <div class="speaker" id="speaker"></div>
    <div class="line" id="line"></div>
    <div class="zh" id="zh" hidden></div>
  </div>
  <aside>
    <h2>NEW WORDS · <span id="wcount">0</span></h2>
    <div id="words"></div>
  </aside>
</main>

<footer>
  <button id="prev">← 上一句</button>
  <button id="replay">↻ 重播</button>
  <button id="next">下一句 →</button>
  <span class="count" id="pos"></span>
  <span class="progress"><i id="bar"></i></span>
  <span class="count" id="hint" hidden>🔇 按 <kbd>space</kbd> 或任一按鈕開始播放</span>
  <span class="count"><kbd>←</kbd><kbd>→</kbd> 換句 <kbd>space</kbd> 播放
    <kbd>R</kbd> 重播 <kbd>T</kbd> 翻譯</span>
</footer>

<script>const DATA = {json.dumps(payload, ensure_ascii=False)};</script>
<script>{JS}</script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day", required=True, help="two-digit day, e.g. 03")
    args = ap.parse_args()
    day = args.day

    out_dir = TOEIC / "output" / f"day{day}"
    if not out_dir.exists():
        sys.exit(f"{out_dir} does not exist — run scripts/build_day.py first")

    ZH = importlib.import_module(f"day{day}_zh").ZH
    with open(TOEIC / "data" / f"day{day}.yaml") as f:
        theme = yaml.safe_load(f).get("theme_zh", "速讀劇場")

    episodes = load_episodes(day)
    word_audio = build_word_audio_map(day, out_dir)
    payload = build_payload(episodes, word_audio, ZH)
    audio_dir = copy_audio(day, out_dir, episodes)

    base, r155, r175 = speech_rates(episodes)
    dest = out_dir / "story.html"
    dest.write_text(build_html(payload, day, theme, r155, r175), encoding="utf-8")
    print(f"narration base {base:.1f} wpm -> rates {r155}x / {r175}x")

    clips = sum(len(e["turns"]) for e in payload)
    words = sum(len(t["words"]) for e in payload for t in e["turns"])
    print(f"episodes={len(payload)} lines={clips} carded_words={words}")
    print(f"audio  -> {audio_dir} ({len(list(audio_dir.glob('*.mp3')))} files)")
    print(f"player -> {dest} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
