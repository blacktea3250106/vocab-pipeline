/* ============================================================
   Drill mode: four options, timed, both directions
   Scope is whatever the current filters show. Grading is never self-rated; the answer decides:
     correct and ≤ 3.5 s → fast → Familiar/Mastered (gaps 3 → 7 → 16 → 35 days)
     correct but > 3.5 s → slow → Learning (asked again tomorrow)
     wrong             → miss → Learning, lapses +1 (asked again later this round)
   ============================================================ */

const FAST = 3500;
const SLOW = 8000;

const drill = {
  queue: [],
  i: 0,
  q: null,
  t0: 0,
  timer: null,
  answered: false,
  log: [],
};

const el = (id) => document.getElementById(id);

/* ---------- Distractors: this is where recognition is really tested ---------- */
const norm = (s) =>
  String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z]/g, "");

// How alike two words look (shared prefix + similar length + shared letters)
function similarity(a, b) {
  a = norm(a);
  b = norm(b);
  if (!a || !b) return 0;
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let end = 0;
  while (end < a.length - pre && end < b.length - pre && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const lenPenalty = Math.abs(a.length - b.length) / Math.max(a.length, b.length);
  return pre * 2 + end * 1.5 - lenPenalty * 3;
}

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Strip the simple HTML that note fields may contain
const plain = (t) => String(t ?? "").replace(/<[^>]*>/g, "").trim();

// English distractors: (1) lookalikes from the note (2) word family (3) other words that look similar
// Returns [{ word, zh }]; zh is shown beside the option once the answer is revealed
function enDistractors(w) {
  const d = detailOf(w) || {};
  const bank = [];
  (d.lookalikes?.rows || []).forEach((r) => bank.push({ word: r.word, zh: plain(r.zh) }));
  (d.nearby?.rows || []).forEach((r) => bank.push({ word: r.word, zh: plain(r.zh) }));
  (w.related || []).forEach((r) => bank.push({ word: r.word, zh: plain(r.zh) }));

  const picked = [];
  const seen = new Set([norm(w.word)]);
  for (const cand of bank) {
    if (!cand.word || seen.has(norm(cand.word))) continue;
    seen.add(norm(cand.word));
    picked.push(cand);
    if (picked.length === 3) return picked;
  }

  // Not enough? Fill up with the most similar-looking words in the deck
  const rest = words
    .filter((x) => !seen.has(norm(x.word)))
    .map((x) => ({ word: x.word, zh: x.zh, score: similarity(w.word, x.word) }))
    .sort((a, b) => b.score - a.score);
  for (const r of rest) {
    if (seen.has(norm(r.word))) continue;
    seen.add(norm(r.word));
    picked.push({ word: r.word, zh: r.zh });
    if (picked.length === 3) break;
  }
  return picked;
}

// Chinese distractors: prefer the same part of speech, so the answer can't be guessed from it
function zhDistractors(w) {
  const same = words.filter((x) => x.id !== w.id && x.pos === w.pos);
  const pool = shuffle(same.length >= 3 ? same : words.filter((x) => x.id !== w.id));
  const seen = new Set([w.zh]);
  const picked = [];
  for (const x of pool) {
    if (seen.has(x.zh)) continue;
    seen.add(x.zh);
    picked.push({ word: x.word, zh: x.zh });
    if (picked.length === 3) break;
  }
  return picked;
}

/* ---------- Questions ----------
   Each option is { text: shown, rev: other side revealed after answering, word: English headword }
   word is used to open that option's full note after answering. */
function makeQuestion(w) {
  // Direction is random so the next question can't be anticipated
  const dir = Math.random() < 0.5 ? "zh2en" : "en2zh";
  if (dir === "zh2en") {
    const opts = [
      { text: w.word, rev: w.zh, word: w.word },
      ...enDistractors(w).map((d) => ({ text: d.word, rev: d.zh, word: d.word })),
    ];
    return { w, dir, prompt: w.zh, sub: w.pos, answer: w.word, options: shuffle(opts), kind: "en" };
  }
  const opts = [
    { text: w.zh, rev: w.word, word: w.word },
    ...zhDistractors(w).map((d) => ({ text: d.zh, rev: d.word, word: d.word })),
  ];
  return { w, dir, prompt: w.word, sub: null, answer: w.zh, options: shuffle(opts), kind: "zh" };
}

/* ---------- Flow ---------- */
function scopeLabel() {
  const t = state.tier === "all" ? "All words" : TIERS[state.tier];
  const s = state.stage === "all" ? "" : STAGES[state.stage];
  const qk = { today: "Due today", lapse: "Often missed" }[state.quick] || "";
  const q = state.query.trim();
  return [t, s, qk, q && `Search “${q}”`].filter(Boolean).join(" · ");
}

function startDrill() {
  const pool = visible(); // the drill covers exactly the filtered words
  if (!pool.length) return;
  drill.queue = shuffle(pool);
  drill.i = 0;
  drill.log = [];
  el("dr-scope").textContent = scopeLabel();
  el("drill").classList.add("on");
  document.body.classList.add("drilling");
  document.body.style.overflow = "hidden";
  nextQuestion();
}

function nextQuestion() {
  if (drill.i >= drill.queue.length) return finishDrill();
  drill.q = makeQuestion(drill.queue[drill.i]);
  drill.answered = false;
  renderQuestion();
  drill.t0 = performance.now();
  startTimerBar();
}

function startTimerBar() {
  clearInterval(drill.timer);
  const bar = el("dr-bar");
  const tick = () => {
    const t = performance.now() - drill.t0;
    bar.style.width = Math.min(100, (t / 12000) * 100) + "%";
    bar.className = t < FAST ? "fast" : t < SLOW ? "mid" : "slow";
  };
  tick();
  drill.timer = setInterval(tick, 60);
}

function renderQuestion() {
  const { q } = drill;
  el("dr-step").textContent = `${drill.i + 1} / ${drill.queue.length}`;
  el("dr-dir").textContent = q.dir === "zh2en" ? "ZH → EN" : "EN → ZH";
  el("dr-prompt").innerHTML =
    q.dir === "zh2en"
      ? `<span class="zh-q">${esc(q.prompt)}</span>${q.sub ? `<span class="sub">${esc(q.sub)}</span>` : ""}`
      : `<span class="en-q">${esc(q.prompt)}</span>${q.sub ? `<span class="sub">${esc(q.sub)}</span>` : ""}`;
  el("dr-options").className = "dr-options";
  el("dr-options").innerHTML = q.options
    .map(
      (o, i) => `<div class="opt ${q.kind}" data-opt="${esc(o.text)}" role="button" tabindex="0">
        <span class="k">${i + 1}</span>
        <span class="ot">${esc(o.text)}</span>
        <span class="orev"></span>
      </div>`
    )
    .join("");
  el("dr-after").innerHTML = "";
  el("dr-after").className = "dr-after";
}

function answer(choice) {
  if (drill.answered) return;
  drill.answered = true;
  clearInterval(drill.timer);
  const ms = performance.now() - drill.t0;
  const { q } = drill;
  const ok = choice === q.answer;
  const verdict = !ok ? "miss" : ms <= FAST ? "fast" : "slow";

  grade(q.w.id, verdict, ms);
  drill.log.push({ w: q.w, ok, ms, verdict });
  if (!ok) drill.queue.push(q.w); // a missed word comes back once more before the round ends

  el("dr-options").classList.add("done");
  document.querySelectorAll("#dr-options .opt").forEach((b, i) => {
    const o = q.options[i];
    if (o.text === q.answer) b.classList.add("right");
    else if (o.text === choice) b.classList.add("wrong");
    // Reveal the other side: zh→en questions add Chinese, en→zh add English
    b.querySelector(".orev").textContent = o.rev || "";
    // Every option links to a note, including distractors that are not in the deck
    const nb = document.createElement("button");
    nb.className = "opt-note";
    nb.dataset.note = i;
    nb.textContent = "Note";
    nb.title = `Open the full note for ${o.word}`;
    b.appendChild(nb);
  });

  speak(q.w.word);

  const sec = (ms / 1000).toFixed(1);
  const label = { miss: "Missed", slow: "Learning", fast: "Familiar" }[verdict];
  const why = !ok
    ? "Wrong pick — it comes back later this round, and a slip is recorded"
    : ms <= FAST
    ? `Right in ${sec}s — that is what counts as knowing it`
    : ms <= SLOW
    ? `Right, but it took ${sec}s — too slow for the real test, so it comes back tomorrow`
    : `Right, but you thought for ${sec}s — that is working it out, not recalling it`;

  el("dr-after").className = `dr-after on ${verdict}`;
  el("dr-after").innerHTML = `
    <div class="verdict"><i class="dot v-${verdict}"></i>${label}<span class="ms">${sec}s</span></div>
    <div class="why">${esc(why)}</div>
    <div class="ans"><b>${esc(q.w.word)}</b> <i>${esc(q.w.pos || "")}</i> ${esc(q.w.zh)}</div>
    ${q.w.example ? `<div class="eg">${esc(q.w.example.en)}<small>${esc(q.w.example.zh)}</small></div>` : ""}
    <div class="go">
      <button class="ghost" id="dr-note">Full note</button>
      <button class="btn-primary" id="dr-next">Next <kbd>Enter</kbd></button>
    </div>`;

  el("dr-next").addEventListener("click", () => {
    drill.i++;
    nextQuestion();
  });
  // The note opens over the drill; closing it returns to the same question
  el("dr-note").addEventListener("click", () => openDetail(q.w.id));
  el("dr-next").focus();
}

function finishDrill() {
  clearInterval(drill.timer);
  const first = {};
  drill.log.forEach((r) => {
    if (!(r.w.id in first)) first[r.w.id] = r;
  });
  const rows = Object.values(first);
  const n = (v) => rows.filter((r) => r.verdict === v).length;
  const avg = rows.length ? (rows.reduce((s, r) => s + r.ms, 0) / rows.length / 1000).toFixed(1) : "0";
  const slowOnes = rows.filter((r) => r.verdict !== "fast");

  el("dr-body").innerHTML = `
    <div class="done">
      <h2>Round complete</h2>
      <div class="tally">
        <span><i class="dot v-fast"></i>Knew it <b>${n("fast")}</b></span>
        <span><i class="dot v-slow"></i>Right but slow <b>${n("slow")}</b></span>
        <span><i class="dot v-miss"></i>Missed <b>${n("miss")}</b></span>
      </div>
      <p class="avg">${avg}s average</p>
      ${
        slowOnes.length
          ? `<div class="weak"><div class="k">Still shaky</div>${slowOnes
              .map(
                (r) =>
                  `<div class="wrow"><b>${esc(r.w.word)}</b><span>${esc(r.w.zh)}</span><i>${(r.ms / 1000).toFixed(
                    1
                  )}s</i></div>`
              )
              .join("")}</div>`
          : `<p class="avg">Every one right inside 3.5s — this set can rest.</p>`
      }
      <button class="btn-primary" id="dr-done">Back to cards</button>
    </div>`;
  el("dr-done").addEventListener("click", closeDrill);
}

function closeDrill() {
  clearInterval(drill.timer);
  closeDetail();
  el("drill").classList.remove("on");
  document.body.classList.remove("drilling");
  document.body.style.overflow = "";
  el("dr-body").innerHTML = DRILL_BODY;
  render();
}

/* ---------- Events ---------- */
const DRILL_BODY = el("dr-body").innerHTML;

el("drill-btn").addEventListener("click", startDrill);
el("dr-quit").addEventListener("click", closeDrill);

el("drill").addEventListener("click", (e) => {
  const note = e.target.closest("[data-note]");
  if (note) {
    e.stopPropagation();
    const o = drill.q?.options?.[+note.dataset.note];
    if (!o) return;
    const w = words.find((x) => x.word === o.word);
    // Distractor not in the deck: show it from a temporary object
    openDetail(w ? w.id : { word: o.word, zh: o.rev || "", pos: "", related: [], external: true });
    return;
  }
  const opt = e.target.closest("[data-opt]");
  if (opt && !drill.answered) answer(opt.dataset.opt);
});

document.addEventListener("keydown", (e) => {
  if (!el("drill").classList.contains("on")) return;
  if (e.key === "Escape") {
    // With a note open, Esc closes the note and keeps the drill
    return shell.classList.contains("split") ? closeDetail() : closeDrill();
  }
  if (shell.classList.contains("split")) return; // answer shortcuts are off while a note is open
  if (drill.answered) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      el("dr-next")?.click();
    }
    return;
  }
  const i = "1234".indexOf(e.key);
  if (i >= 0) {
    e.preventDefault();
    document.querySelectorAll("#dr-options .opt")[i]?.click();
  }
});
