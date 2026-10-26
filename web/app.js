/* ---------- state ---------- */
/* Stages only move forward: new → learning → familiar → mastered.
   A miss is not a stage but an event: back to learning, lapses + 1. */
const STAGES = { new: "New", learning: "Learning", familiar: "Familiar", mastered: "Mastered" };
const STAGE_LONG = { new: "Not tested yet", learning: "Learning", familiar: "Holding", mastered: "Put away" };
const STORE_KEY = "vocab.progress.v3";
const THEME_KEY = "vocab.theme";

const words = (window.VOCAB_DATA || []).map((w, i) => ({ id: `${w.day}-${i}-${w.word}`, ...w }));

let progress = load();
const state = { day: "all", stage: "all", quick: "", tier: "all", query: "", view: "cards" };
// Every Day that appears in the data files, in order
const DAYS = [...new Set(words.map((w) => w.day))].sort();
const TIERS = { core: "Core", basic: "Basic", t800: "Target 800", t900: "Target 900" };
let openWord = null; // word currently shown in the right-hand note

/* Progress record: { s: stage, n: fast answers in a row, lapses: misses, due: "YYYY-MM-DD"|null } */
function dayStr(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Each correct answer pushes the next review further out
const GAPS = [3, 7, 16, 35];
const MASTER_GAP = 35; // a gap this long moves the word to Mastered

const HISTORY_MAX = 60; // answer history kept per word

/* Every update keeps a timestamp and answer history, for later review analysis and forgetting curves
   history: [{ t: ISO time, v: "fast"|"slow"|"miss"|"manual", ms: answer time, to: stage after update }] */
function stamp(id, patch, event) {
  const p = progress[id] || { n: 0, lapses: 0, history: [] };
  const now = new Date().toISOString();
  const history = (p.history || []).concat({ t: now, ...event, to: patch.s }).slice(-HISTORY_MAX);
  progress[id] = {
    ...patch,
    lapses: patch.lapses ?? p.lapses ?? 0,
    first: p.first || now, // first time this word was seen
    last: now, // last update
    history,
  };
  save();
}

/* Answer result → stage change. verdict: "fast" | "slow" | "miss" */
function grade(id, verdict, ms) {
  const p = progress[id] || { n: 0, lapses: 0 };
  let patch;
  if (verdict === "miss") {
    patch = { s: "learning", n: 0, lapses: (p.lapses || 0) + 1, due: dayStr(0) };
  } else if (verdict === "slow") {
    patch = { s: "learning", n: 0, due: dayStr(1) };
  } else {
    const n = Math.min((p.s === "familiar" || p.s === "mastered" ? p.n || 0 : 0) + 1, GAPS.length);
    const gap = GAPS[n - 1];
    patch = { s: gap >= MASTER_GAP ? "mastered" : "familiar", n, due: dayStr(gap) };
  }
  stamp(id, patch, { v: verdict, ms: ms == null ? null : Math.round(ms) });
}

// Manual override (buttons on the note panel)
function setStage(id, s) {
  const p = progress[id] || { n: 0, lapses: 0 };
  const due = s === "new" ? null : s === "learning" ? dayStr(0) : dayStr(s === "mastered" ? MASTER_GAP : GAPS[0]);
  stamp(id, { s, n: s === "familiar" || s === "mastered" ? Math.max(p.n || 0, 1) : 0, due }, { v: "manual" });
}

const st = (id) => progress[id]?.s || "new";
const lapses = (id) => progress[id]?.lapses || 0;
const isDue = (id) => {
  const p = progress[id];
  return p?.s !== "new" && p?.due && p.due <= dayStr(0);
};

// "Today" shortcut = words whose review is due
const todayList = () => words.filter((w) => isDue(w.id));

function dueLabel(id) {
  const p = progress[id];
  if (!p || p.s === "new") return "Not scheduled";
  if (!p.due || p.due <= dayStr(0)) return "Due today";
  const diff = Math.round((new Date(p.due) - new Date(dayStr(0))) / 864e5);
  return diff === 1 ? "Due tomorrow" : `In ${diff} days`;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    const out = {};
    words.forEach((w) => {
      const r = saved[w.id];
      out[w.id] = r && typeof r === "object" && r.s in STAGES
        ? { history: [], ...r }
        : { s: "new", n: 0, lapses: 0, due: null, first: null, last: null, history: [] };
    });
    return out;
  } catch {
    return {};
  }
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(progress));
}

/* ---------- speech ---------- */
let voice = null;
function pickVoice() {
  const vs = speechSynthesis.getVoices().filter((v) => /^en(-|_)?/i.test(v.lang));
  voice =
    vs.find((v) => /Samantha|Ava|Allison|Google US English/i.test(v.name)) ||
    vs.find((v) => /en[-_]US/i.test(v.lang)) ||
    vs[0] ||
    null;
}
if ("speechSynthesis" in window) {
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}

function speak(text, btn) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  if (voice) u.voice = voice;
  u.lang = voice?.lang || "en-US";
  u.rate = 0.92;
  u.pitch = 1;
  if (btn) {
    btn.classList.add("playing");
    const off = () => btn.classList.remove("playing");
    u.onend = off;
    u.onerror = off;
  }
  speechSynthesis.speak(u);
}

/* ---------- helpers ---------- */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* Note marker icon: a lined sheet of paper */
const NOTE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 4h14v16H5z" stroke-width="1.6"/><path d="M8.5 9h7M8.5 12.5h7M8.5 16h4"/></svg>`;

/* On hover, tell the user what the note contains */
function noteSummary(w) {
  const d = detailOf(w);
  if (!d) return "";
  const bits = [];
  if (d.preps?.length) bits.push(`${d.preps.length} preposition${d.preps.length === 1 ? "" : "s"}`);
  if (d.lookalikes?.rows?.length) bits.push(`${d.lookalikes.rows.length} lookalike${d.lookalikes.rows.length === 1 ? "" : "s"}`);
  if (d.nearby?.rows?.length) bits.push(`${d.nearby.rows.length} near synonym${d.nearby.rows.length === 1 ? "" : "s"}`);
  if (d.pitfall) bits.push("grammar trap");
  if (d.meanings?.length > 1) bits.push(`${d.meanings.length} meanings`);
  if (d.family?.length) bits.push("word family");
  return bits.length ? "Full note · " + bits.join(" · ") : "Full note";
}

const SPK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>`;

function visible() {
  const q = state.query.trim().toLowerCase();
  const todayIds = state.quick === "today" ? new Set(todayList().map((w) => w.id)) : null;
  return words.filter((w) => {
    if (state.day !== "all" && w.day !== state.day) return false;
    if (state.tier !== "all" && w.tier !== state.tier) return false;
    if (state.quick === "today" && !todayIds.has(w.id)) return false;
    if (state.quick === "lapse" && lapses(w.id) < 2) return false;
    if (state.quick === "noted" && !detailOf(w)) return false;
    if (state.stage !== "all" && st(w.id) !== state.stage) return false;
    if (!q) return true;
    return (
      w.word.toLowerCase().includes(q) ||
      w.zh.includes(q) ||
      (w.example?.en || "").toLowerCase().includes(q) ||
      (w.example?.zh || "").includes(q) ||
      (w.related || []).some((r) => r.word.toLowerCase().includes(q) || r.zh.includes(q))
    );
  });
}

const counts = () => {
  const c = { new: 0, learning: 0, familiar: 0, mastered: 0 };
  words.forEach((w) => c[st(w.id)]++);
  return c;
};

/* ---------- render ---------- */
function renderMeter() {
  const c = counts();
  const total = words.length || 1;
  document.getElementById("meter").innerHTML = Object.keys(STAGES)
    .filter((k) => c[k])
    .map(
      (k) =>
        `<span class="s-${k}" style="flex-grow:${c[k]}" title="${STAGES[k]} ${c[k]}">${
          c[k] / total > 0.06 ? c[k] : ""
        }</span>`
    )
    .join("");
  document.getElementById("legend").innerHTML = Object.keys(STAGES)
    .map((k) => `<span><i class="dot s-${k}"></i>${STAGES[k]} <b>${c[k]}</b></span>`)
    .join("");

  // Day menu (hidden when there is only one day)
  const dayBox = document.getElementById("day-picker");
  const daySel = document.getElementById("day");
  if (DAYS.length <= 1) {
    dayBox.hidden = true;
  } else if (daySel.options.length !== DAYS.length + 1) {
    daySel.innerHTML =
      `<option value="all">All ${DAYS.length} days</option>` +
      DAYS.map((d) => `<option value="${esc(d)}">${esc(d)}</option>`).join("");
  }
  daySel.value = state.day;

  // Tier and stage counts, within the selected Day only
  const inDay = words.filter((w) => state.day === "all" || w.day === state.day);
  document.querySelectorAll(".chip[data-tier]").forEach((el) => {
    const t = el.dataset.tier;
    el.querySelector("small").textContent =
      t === "all" ? inDay.length : inDay.filter((w) => w.tier === t).length;
    el.setAttribute("aria-pressed", String(state.tier === t));
  });
  const inTier = inDay.filter((w) => state.tier === "all" || w.tier === state.tier);
  const sel = document.getElementById("stage");
  [...sel.options].forEach((o) => {
    const n = o.value === "all" ? inTier.length : inTier.filter((w) => st(w.id) === o.value).length;
    o.textContent = `${o.dataset.label} · ${n}`;
  });
  sel.value = state.stage;

  const todayN = inTier.filter((w) => isDue(w.id)).length;
  const todayBtn = document.getElementById("quick-today");
  todayBtn.querySelector("small").textContent = todayN;
  todayBtn.disabled = todayN === 0 && state.quick !== "today";

  const lapseN = inTier.filter((w) => lapses(w.id) >= 2).length;
  const lapseBtn = document.getElementById("quick-lapse");
  lapseBtn.querySelector("small").textContent = lapseN;
  lapseBtn.disabled = lapseN === 0 && state.quick !== "lapse";
  const notedBtn = document.getElementById("quick-noted");
  const notedN = words.filter((w) => detailOf(w)).length;
  notedBtn.querySelector("small").textContent = notedN;
  document.querySelectorAll("[data-quick]").forEach((el) =>
    el.setAttribute("aria-pressed", String(state.quick === el.dataset.quick))
  );

  // Drill scope = currently filtered words
  const n = visible().length;
  document.getElementById("drill-n").textContent = n;
  document.getElementById("drill-btn").disabled = n === 0;
}

function cardHTML(w) {
  const s = st(w.id);
  const stars = "★".repeat(w.star || 0);
  const hasNote = !!detailOf(w);
  return `
  <div class="card${hasNote ? " has-note" : ""}${openWord?.id === w.id ? " active" : ""}"
       data-id="${w.id}" tabindex="0" role="button"
       aria-label="${esc(w.word)}${hasNote ? ", has a full note" : ""} — tap to hear it and open the note">
    <button class="speak" data-speak="${esc(w.word)}" title="Say it" aria-label="Say it">${SPK}</button>
    <h3 class="word">${esc(w.word)}${stars ? `<i class="stars">${stars}</i>` : ""}</h3>
    <p class="zh-hint"><span class="p">${esc(w.pos || "")}</span>${esc(w.zh)}</p>
    <div class="foot">
      <span class="status"><i class="dot s-${s}"></i>${STAGES[s]}</span>
      ${w.tier ? `<span class="tier ${w.tier}">${TIERS[w.tier]}</span>` : ""}
      ${hasNote ? `<span class="notemark" title="${esc(noteSummary(w))}">${NOTE_ICON}Note</span>` : ""}
      <span class="day">${esc(w.day || "")}</span>
    </div>
  </div>`;
}

function rowHTML(w) {
  const s = st(w.id);
  const hasNote = !!detailOf(w);
  return `
  <div class="row${hasNote ? " has-note" : ""}${openWord?.id === w.id ? " active" : ""}" data-id="${w.id}">
    <div><span class="w">${esc(w.word)}</span>${
      hasNote ? `<i class="rowmark" title="${esc(noteSummary(w))}">${NOTE_ICON}</i>` : ""
    }</div>
    <div class="m"><b style="font-weight:600;color:var(--ink)">${esc(w.pos || "")}</b> ${esc(w.zh)}</div>
    <div class="a">
      ${w.tier ? `<span class="tier ${w.tier}">${TIERS[w.tier]}</span>` : ""}
      <span class="status" style="font-size:12px;color:var(--muted)"><i class="dot s-${s}"></i>${STAGES[s]}</span>
      <button class="speak" data-speak="${esc(w.word)}" title="Say it" aria-label="Say it">${SPK}</button>
    </div>
  </div>`;
}

/* ---------- Full note panel ---------- */
const detailOf = (w) => (window.VOCAB_DETAIL || {})[w.word] || (window.VOCAB_DETAIL || {})[w.word.toLowerCase()];
const rate = (n) => `<span class="rate">${"★".repeat(n)}${"☆".repeat(Math.max(0, 5 - n))}</span>`;
const sec = (title, note, body) =>
  `<section><h2>${title}${note ? `<span class="note">${esc(note)}</span>` : ""}</h2>${body}</section>`;

function detailHTML(w) {
  const d = detailOf(w) || {};
  const out = [];

  out.push(`
    <header>
      <div class="head-w">
        <h1>${esc(w.word)}</h1>
        ${w.tier ? `<span class="tier ${w.tier}">${TIERS[w.tier]}</span>` : ""}
        ${d.level ? `<span class="lvl">${esc(d.level)}</span>` : ""}
      </div>
      <div class="sub">
        <span class="pos">${esc(w.pos || "")}</span>
        <span class="zh">${esc(w.zh)}</span>
        ${d.forms ? `<span class="forms">${esc(d.forms).replace(/→/g, "<b>→</b>")}</span>` : ""}
      </div>
    </header>`);

  // Preposition patterns: first block for high-frequency words, after Chunks for the rest
  const prepsHTML = d.preps?.length
    ? sec(
        "🧩 Prepositions",
        w.tier === "core" ? "where core words get tested most" : null,
        `<div class="preps">${d.preps
          .map(
            (p) => `<div class="pr${p.bad ? " bad" : ""}">
              <div class="p">${esc(p.p)}</div>
              <div class="z">${esc(p.zh)}</div>
              ${p.fix ? `<div class="fix">Write it as <b>${esc(p.fix)}</b></div>` : ""}
              ${p.eg ? `<div class="e">${esc(p.eg.en)}<small>${esc(p.eg.zh)}</small></div>` : ""}
            </div>`
          )
          .join("")}</div>`
      )
    : "";
  if (w.tier === "core" && prepsHTML) out.push(prepsHTML);

  if (d.family?.length) {
    out.push(
      sec(
        "🌳 Word Family",
        d.familyNote,
        `<div class="tw"><table>
          <thead><tr><th>POS</th><th>Word</th><th>Meaning</th></tr></thead>
          <tbody>${d.family
            .map((r) => `<tr><td class="pos">${esc(r.pos)}</td><td class="w">${esc(r.word)}</td><td class="zh">${r.zh}</td></tr>`)
            .join("")}</tbody></table></div>`
      )
    );
  }

  const nums = ["①", "②", "③", "④", "⑤"];
  if (d.meanings?.length) {
    out.push(
      sec(
        "📖 Common meanings",
        null,
        d.meanings
          .map(
            (m, i) => `<div class="mean">
              <div class="top">
                <span class="n">${nums[i] || i + 1}</span>
                <span class="t">${esc(m.title)}</span>
                ${m.badge ? `<span class="badge">${esc(m.badge)}</span>` : ""}
                ${m.stars ? rate(m.stars) : ""}
              </div>
              ${m.body ? `<div class="b">${m.body}</div>` : ""}
              ${m.eg ? `<div class="eg">${esc(m.eg.en)}<small>${esc(m.eg.zh)}</small></div>` : ""}
            </div>`
          )
          .join("") +
          (d.pitfall
            ? `<div class="tip alert">
                <span class="lead">✕ ${esc(d.pitfall.lead || "The most common mistake")}</span>
                <span class="no">${esc(d.pitfall.no)}</span>　→　<span class="yes">${esc(d.pitfall.yes)}</span><br>
                ${d.pitfall.note || ""}
              </div>`
            : "")
      )
    );
  } else if (w.example?.en) {
    out.push(
      sec(
        "📖 Example",
        null,
        `<div class="mean"><div class="eg">${esc(w.example.en)}<small>${esc(w.example.zh)}</small></div></div>`
      )
    );
  }

  if (d.chunks?.length) {
    out.push(
      sec(
        "🔗 Chunks / Collocations",
        d.chunksNote,
        `<div class="chunks">${d.chunks
          .map(
            (c) => `<div class="ck">
              <div class="en">${esc(c.en)}</div>
              ${rate(c.stars || 3)}
              <div class="zh">${esc(c.zh)}</div>
            </div>`
          )
          .join("")}</div>`
      )
    );
  }

  if (w.tier !== "core" && prepsHTML) out.push(prepsHTML);

  if (d.lookalikes?.rows?.length) {
    out.push(
      sec(
        "🔤 Lookalikes",
        d.lookalikes.note,
        `<div class="tw"><table>
          <thead><tr><th>Word</th><th>Meaning</th><th>Collocation</th></tr></thead>
          <tbody>${d.lookalikes.rows
            .map((r) => `<tr><td class="w">${esc(r.word)}</td><td class="zh">${r.zh}</td><td class="tag">${esc(r.tag || "")}</td></tr>`)
            .join("")}</tbody></table></div>` + tip(d.lookalikes.tip)
      )
    );
  }

  if (d.nearby?.rows?.length) {
    out.push(
      sec(
        "🔄 Near synonyms",
        d.nearby.note,
        `<div class="tw"><table>
          <thead><tr><th>Word</th><th>Core difference</th></tr></thead>
          <tbody>${d.nearby.rows
            .map((r) => `<tr><td class="w">${esc(r.word)}</td><td class="zh">${r.zh}</td></tr>`)
            .join("")}</tbody></table></div>` + tip(d.nearby.tip)
      )
    );
  } else if (!d.nearby && w.related?.length) {
    out.push(
      sec(
        "🔄 Word family",
        null,
        `<div class="tw"><table><tbody>${w.related
          .map((r) => `<tr><td class="pos">${esc(r.pos || "")}</td><td class="w">${esc(r.word)}</td><td class="zh">${esc(r.zh)}</td></tr>`)
          .join("")}</tbody></table></div>`
      )
    );
  }

  if (d.everyday?.length) {
    out.push(
      `<section class="daily"><h2>🗣️ Everyday English</h2>${d.everyday
        .map((e) =>
          typeof e === "string"
            ? `<p>${e}</p>`
            : `<div class="swap"><span class="f">${esc(e.from)}</span><span class="a">${esc(e.label || "people actually say")}</span><span class="t">${esc(e.to)}</span></div>`
        )
        .join("")}</section>`
    );
  }

  if (d.lock) {
    out.push(`
      <section class="lock">
        <div class="k">💡 One-second lock</div>
        <div class="big">${esc(d.lock.big)}</div>
        ${
          d.lock.rows?.length
            ? `<div class="rows">${d.lock.rows
                .map((r) => `<div class="r"><span class="l">${esc(r.l)}</span><span class="d">${r.d}</span></div>`)
                .join("")}</div>`
            : ""
        }
      </section>`);
  }

  if (w.external) {
    out.push(
      `<div class="thin">This word is <b>not in your deck</b> — the drill pulled it in as a distractor from a lookalike table or word family, to test whether you can tell them apart. The book does not list it as a main entry, so there is no example sentence or full note.</div>`
    );
  } else if (!detailOf(w)) {
    out.push(
      w.tier === "core"
        ? `<div class="thin">The book gives this word <b>no "exam focus" box</b> — only a meaning and an example, so there are no extra collocations or lookalikes to show here.</div>`
        : `<div class="thin">The book files this word under the <b>${esc(
            TIERS[w.tier]
          )} list</b>, which gives the word and its meaning only — no example, no exam focus. The example above was added later, to anchor the word in context.</div>`
    );
  }

  return out.join("");
}

function tip(t) {
  return t ? `<div class="tip"><span class="lead">${esc(t.lead || "")}</span>${t.body || ""}</div>` : "";
}

const shell = document.getElementById("shell");
const drawer = document.getElementById("drawer");
const scrim = document.getElementById("scrim");
const dBody = document.getElementById("d-body");
const isNarrow = () => matchMedia("(max-width: 900px)").matches;

function markActive(id) {
  document.querySelectorAll(".card.active, .row.active").forEach((el) => el.classList.remove("active"));
  const el = document.querySelector(`#out [data-id="${CSS.escape(id)}"]`);
  el?.classList.add("active");
  // The grid reflows when it narrows; keep the clicked card in view so it isn't pushed off screen
  if (el && !document.body.classList.contains("drilling")) {
    requestAnimationFrame(() =>
      setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 220)
    );
  }
}

const MARK_LABEL = { learning: "Relearn", familiar: "I know it", mastered: "Put away" };

function renderMarks() {
  const box = document.getElementById("d-marks");
  if (!openWord || !openWord.id) return (box.innerHTML = "");
  const s = st(openWord.id);
  const n = lapses(openWord.id);
  box.innerHTML =
    `<span class="lbl">${STAGE_LONG[s]}${n ? ` · ${n} slip${n === 1 ? "" : "s"}` : ""}</span>` +
    Object.keys(MARK_LABEL)
      .map(
        (k) =>
          `<button class="mark" data-mark="${k}" data-s="${k}" aria-pressed="${s === k}">${MARK_LABEL[k]}</button>`
      )
      .join("") +
    `<span class="next">${dueLabel(openWord.id)}</span>`;
}

document.getElementById("d-marks").addEventListener("click", (e) => {
  const b = e.target.closest("[data-mark]");
  if (!b || !openWord) return;
  setStage(openWord.id, b.dataset.mark);
  renderMarks();
  render();
});

/* Takes a word id or a temporary word object (drill distractors may not be in the deck,
   e.g. differ / deter pulled from a lookalike table). */
function openDetail(idOrWord) {
  const w = typeof idOrWord === "string" ? words.find((x) => x.id === idOrWord) : idOrWord;
  if (!w || !w.word) return;
  openWord = w;
  document.getElementById("d-title").innerHTML = `${esc(w.word)}<small>${esc(w.day || "")}</small>`;
  renderMarks();
  dBody.innerHTML = detailHTML(w);
  dBody.scrollTop = 0;
  drawer.classList.add("on");
  scrim.classList.add("on");
  drawer.setAttribute("aria-hidden", "false");
  if (isNarrow()) document.body.style.overflow = "hidden";
  if (w.id) markActive(w.id);
  else document.querySelectorAll(".card.active, .row.active").forEach((el) => el.classList.remove("active"));
}

function closeDetail() {
  drawer.classList.remove("on");
  scrim.classList.remove("on");
  drawer.setAttribute("aria-hidden", "true");
  if (!document.body.classList.contains("drilling")) document.body.style.overflow = "";
  openWord = null;
  document.querySelectorAll(".card.active, .row.active").forEach((el) => el.classList.remove("active"));
  showEmptyPanel();
}

// Hint shown in the right panel before a word is picked
function showEmptyPanel() {
  document.getElementById("d-title").innerHTML = "";
  document.getElementById("d-marks").innerHTML = "";
  dBody.innerHTML =
    `<div class="panel-empty"><span><b>Tap any card on the left</b> and its full note opens here — meanings, examples, prepositions, lookalikes and the one-second lock.<br>After you answer in a drill, the <b>Note</b> button beside each option jumps straight here too.</span></div>`;
}

// ‹ › on the panel: step through the filtered list
function step(dir) {
  if (!openWord) return;
  const list = visible();
  const i = list.findIndex((x) => x.id === openWord.id);
  const next = list[(i + dir + list.length) % list.length];
  if (!next) return;
  openDetail(next.id);
  speak(next.word);
  document.querySelector(`#out [data-id="${CSS.escape(next.id)}"]`)?.scrollIntoView({
    block: "nearest",
    behavior: "smooth",
  });
}

scrim.addEventListener("click", closeDetail);
document.getElementById("d-close").addEventListener("click", closeDetail);
document.getElementById("d-prev").addEventListener("click", () => step(-1));
document.getElementById("d-next").addEventListener("click", () => step(1));
document.getElementById("d-say").addEventListener("click", (e) => {
  if (openWord) speak(openWord.word, e.currentTarget);
});

function render() {
  renderMeter();
  const list = visible();
  const box = document.getElementById("out");
  if (!list.length) {
    box.className = "";
    box.innerHTML = `<div class="empty">No words match.</div>`;
    return;
  }
  if (state.view === "cards") {
    box.className = "grid";
    box.innerHTML = list.map(cardHTML).join("");
  } else {
    box.className = "list";
    box.innerHTML = list.map(rowHTML).join("");
  }
}

/* ---------- events ---------- */
document.getElementById("out").addEventListener("click", (e) => {
  const spk = e.target.closest("[data-speak]");
  if (spk) {
    e.stopPropagation();
    speak(spk.dataset.speak, spk);
    return;
  }
  const row = e.target.closest(".row");
  if (row) {
    openDetail(row.dataset.id);
    return;
  }
  const card = e.target.closest(".card");
  if (card) {
    const id = card.dataset.id;
    if (openWord?.id === id) return closeDetail(); // clicking the same card again closes it
    speak(words.find((x) => x.id === id).word, card.querySelector(".speak"));
    openDetail(id);
  }
});

document.getElementById("out").addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("card")) {
    e.preventDefault();
    e.target.click();
  }
});

document.querySelectorAll("[data-quick]").forEach((el) =>
  el.addEventListener("click", () => {
    state.quick = state.quick === el.dataset.quick ? "" : el.dataset.quick;
    render();
  })
);

document.getElementById("stage").addEventListener("change", (e) => {
  state.stage = e.target.value;
  render();
});

document.getElementById("day").addEventListener("change", (e) => {
  state.day = e.target.value;
  render();
});

document.querySelectorAll(".chip[data-tier]").forEach((el) =>
  el.addEventListener("click", () => {
    state.tier = el.dataset.tier;
    render();
  })
);

document.querySelectorAll("[data-view]").forEach((el) =>
  el.addEventListener("click", () => {
    state.view = el.dataset.view;
    document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b === el)));
    render();
  })
);

const input = document.getElementById("q");
input.addEventListener("input", () => {
  state.query = input.value;
  render();
});

document.addEventListener("keydown", (e) => {
  if (document.getElementById("drill").classList.contains("on")) return; // during a drill, shortcuts belong to drill.js
  if (e.key === "Escape" && shell.classList.contains("split")) {
    e.preventDefault();
    closeDetail();
    return;
  }
  if (openWord && document.activeElement !== input && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
    e.preventDefault();
    step(e.key === "ArrowRight" ? 1 : -1);
    return;
  }
  if (e.key === "/" && document.activeElement !== input) {
    e.preventDefault();
    input.focus();
  }
  if (e.key === "Escape" && document.activeElement === input) {
    input.value = "";
    state.query = "";
    render();
    input.blur();
  }
});

document.getElementById("shuffle").addEventListener("click", () => {
  for (let i = words.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [words[i], words[j]] = [words[j], words[i]];
  }
  render();
});

const themeBtn = document.getElementById("theme");
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
  themeBtn.setAttribute("aria-label", t === "dark" ? "Switch to light" : "Switch to dark");
}
applyTheme(
  localStorage.getItem(THEME_KEY) ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);
themeBtn.addEventListener("click", () =>
  applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")
);

showEmptyPanel();
render();
