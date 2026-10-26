/* TOEIC stats.js — shared localStorage + FSRS-lite scheduler + score projection.
   Attach ToeicStats to window; each page uses via inline <script>. */
(function () {
  const STORAGE_KEY = 'toeic-stats-v1';
  const DAY_MS = 86400000;

  /* The practice pages write their answers to srs.js, not here. This file used
     to read only its own key, which no page had written to since the legacy
     quiz was retired — so the dashboard rendered an empty memory bank on top of
     a full history. srs.js is now the source of truth; the old key is a fallback
     for anyone whose browser still holds the retired quiz's records.

     Reading one store instead of two also keeps the dashboard's "fading" count
     equal to the Review queue's "due" count. Two schedulers over the same
     answers would disagree, and the learner would have no way to tell which. */
  const SRS_KEY = 'toeic-srs-v1';

  function _srsAnswers() {
    try {
      const raw = localStorage.getItem(SRS_KEY);
      if (!raw) return [];
      const rows = (JSON.parse(raw) || {}).log || [];
      const out = [];
      for (const r of rows) {
        const m = /^day(\d+):(.+)$/.exec(r.key || '');
        if (!m) continue;
        out.push({ day: parseInt(m[1], 10), chunk: m[2], type: r.kind,
                   correct: !!r.correct, rt: r.rt || 0, ts: r.ts });
      }
      return out;
    } catch (e) { return []; }
  }

  function _load() {
    let legacy = { answers: [], chunks: {}, sessions: [] };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) legacy = JSON.parse(raw) || legacy;
    } catch (e) { /* unreadable legacy record: ignore */ }
    const srs = _srsAnswers();
    if (!srs.length) return legacy;
    // srs wins outright rather than merging: it already absorbed every day's
    // log during migration, so concatenating would double-count.
    return { answers: srs, chunks: legacy.chunks || {}, sessions: legacy.sessions || [] };
  }
  function _save(data) { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
  function _chunkKey(day, chunkId) { return `day${String(day).padStart(2, '0')}_${chunkId}`; }

  function logAnswer(day, chunkId, quizType, correct, rtMs) {
    const data = _load();
    const now = Date.now();
    data.answers.push({ day, chunk: chunkId, type: quizType, correct, rt: rtMs, ts: now });

    const key = _chunkKey(day, chunkId);
    const c = data.chunks[key] || { total: 0, correct: 0, stability: 1, last_ts: 0, next_due: 0 };
    c.total += 1;
    if (correct) c.correct += 1;
    c.last_ts = now;

    if (correct) {
      c.stability = c.total === 1 ? 1 : Math.max(c.stability * 1.9, 1);
    } else {
      c.stability = 0.5;
    }
    const nextDays = Math.max(0.5, c.stability * 0.163);
    c.next_due = now + nextDays * DAY_MS;
    data.chunks[key] = c;

    _save(data);
    return c;
  }

  function logSession(day, summary) {
    const data = _load();
    data.sessions.push(Object.assign({ day, ts: Date.now() }, summary));
    _save(data);
  }

  function getChunkStats(day, chunkId) {
    return _load().chunks[_chunkKey(day, chunkId)] || null;
  }

  function getReviewQueue(now) {
    now = now || Date.now();
    const chunks = _load().chunks;
    const due = [];
    for (const key of Object.keys(chunks)) {
      const c = chunks[key];
      if (c.next_due <= now && c.total > 0) {
        const day = parseInt(key.slice(3, 5), 10);
        const chunkId = key.slice(6);
        const elapsed = (now - c.last_ts) / DAY_MS;
        const retrievability = Math.exp(-elapsed / c.stability);
        due.push({ day, chunkId, retrievability, stability: c.stability, accuracy: c.correct / c.total });
      }
    }
    return due.sort((a, b) => a.retrievability - b.retrievability);
  }

  function _isMainChunkKey(key) {
    // Chunk keys look like `day01_c01` (main) or `day01_story_A_q0` (story Q).
    // Only main chunks count toward coverage / completion metrics.
    return !key.includes('_story_');
  }

  function getGlobalStats() {
    const data = _load();
    const total = data.answers.length;
    const correct = data.answers.filter(a => a.correct).length;
    const allChunkKeys = Object.keys(data.chunks);
    const mainChunkKeys = allChunkKeys.filter(_isMainChunkKey);
    const chunksTouched = mainChunkKeys.length;
    const chunksMastered = mainChunkKeys.filter(k => {
      const c = data.chunks[k];
      return c.stability >= 4 && c.correct / c.total >= 0.8;
    }).length;

    const dayMap = {};
    for (const a of data.answers) {
      dayMap[a.day] = dayMap[a.day] || { total: 0, correct: 0, avgRt: 0 };
      dayMap[a.day].total += 1;
      if (a.correct) dayMap[a.day].correct += 1;
      dayMap[a.day].avgRt += a.rt || 0;
    }
    for (const d of Object.values(dayMap)) d.avgRt /= d.total || 1;

    const typeMap = { listen: { t: 0, c: 0 }, meaning: { t: 0, c: 0 }, cloze: { t: 0, c: 0 } };
    for (const a of data.answers) {
      if (typeMap[a.type]) { typeMap[a.type].t += 1; if (a.correct) typeMap[a.type].c += 1; }
    }

    const now = Date.now();
    const trend = [];
    for (let i = 13; i >= 0; i--) {
      const dayStart = now - i * DAY_MS;
      const dayAnswers = data.answers.filter(a => a.ts >= dayStart - DAY_MS/2 && a.ts < dayStart + DAY_MS/2);
      trend.push({
        day_offset: -i,
        total: dayAnswers.length,
        accuracy: dayAnswers.length ? dayAnswers.filter(a => a.correct).length / dayAnswers.length : null,
      });
    }

    return { total_answers: total, total_correct: correct,
             accuracy: total ? correct / total : 0,
             chunks_touched: chunksTouched, chunks_mastered: chunksMastered,
             day_map: dayMap, type_map: typeMap, trend_14d: trend };
  }

  function getWeakChunks(threshold) {
    threshold = threshold || 2;
    const chunks = _load().chunks;
    const weak = [];
    for (const key of Object.keys(chunks)) {
      const c = chunks[key];
      const errors = c.total - c.correct;
      if (errors >= threshold) {
        weak.push({
          day: parseInt(key.slice(3, 5), 10),
          chunkId: key.slice(6),
          errors, total: c.total,
          accuracy: c.correct / c.total,
          last_ts: c.last_ts,
        });
      }
    }
    return weak.sort((a, b) => b.errors - a.errors);
  }

  function projectScore(accuracy, chunksTouched, chunksTotal) {
    chunksTotal = chunksTotal || 240;
    const baseline = 600;
    const coverage = Math.min(chunksTouched / chunksTotal, 1);
    let projected;
    if (accuracy >= 0.92) projected = 900;
    else if (accuracy >= 0.85) projected = 800 + (accuracy - 0.85) * (100 / 0.07);
    else if (accuracy >= 0.75) projected = 700 + (accuracy - 0.75) * (100 / 0.10);
    else if (accuracy >= 0.60) projected = 550 + (accuracy - 0.60) * (150 / 0.15);
    else projected = 400 + accuracy * (150 / 0.60);
    const blended = baseline + (projected - baseline) * coverage;
    return { projected: Math.round(blended), projected_pure: Math.round(projected),
             confidence: coverage, coverage };
  }

  function resetAll() {
    if (confirm('清除所有 chunk 學習資料？此動作不可還原')) {
      localStorage.removeItem(STORAGE_KEY); location.reload();
    }
  }

  /* ────────────────────────────────────────────────────────────────────
     Motivation layer — "what changed TODAY"

     The old dashboard only had 30-day / 840-chunk scales, so a single
     day's work moved every line by roughly one pixel. Everything below
     exists to answer the one question that actually drives return visits:
     what did I move forward today?
     ──────────────────────────────────────────────────────────────────── */

  function _dayStart(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function _dateKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
           '-' + String(d.getDate()).padStart(2, '0');
  }
  function _shiftKey(key, delta) {
    const [y, m, dd] = key.split('-').map(Number);
    const d = new Date(y, m - 1, dd);
    d.setDate(d.getDate() + delta);
    return _dateKey(d.getTime());
  }

  // Replay logAnswer()'s scheduler over a chunk's answer history. Because the
  // update rule is deterministic we can reconstruct any chunk's state at any
  // past timestamp — that's what lets us diff "before today" vs "now".
  /* Same schedule as srs.js, deliberately duplicated rather than imported so a
     page that loads only stats.js still classifies identically. `stability` is
     the interval in days, and response time grades it: an answer that took 25
     seconds barely stretches the gap, because in the exam it would have cost
     you the question anyway. Keep these constants in step with srs.js. */
  const FIRST = { lapse: 0.5, slow: 1, ok: 2, fast: 3 };
  const GROW = { slow: 1.3, ok: 1.9, fast: 2.5 };
  const FAST_MS = 10000, SLOW_MS = 20000, MAX_INTERVAL = 120;

  function _band(correct, rt) {
    if (!correct) return 'lapse';
    if (!rt || rt <= 0) return 'ok';
    if (rt < FAST_MS) return 'fast';
    if (rt > SLOW_MS) return 'slow';
    return 'ok';
  }

  function _replay(answers) {
    let total = 0, correct = 0, stability = 1, last_ts = 0, next_due = 0;
    for (const a of answers) {
      total += 1;
      if (a.correct) correct += 1;
      last_ts = a.ts;
      const b = _band(a.correct, a.rt);
      stability = b === 'lapse' ? FIRST.lapse
        : total === 1 ? FIRST[b]
        : Math.min(Math.max(stability * GROW[b], FIRST[b]), MAX_INTERVAL);
      next_due = last_ts + stability * DAY_MS;
    }
    return { total, correct, stability, last_ts, next_due };
  }

  // { chunkKey: [answers] } for main chunks only, each list sorted by ts.
  function _mainChunkHistories(data) {
    const byChunk = {};
    for (const a of data.answers) {
      if (a.type === 'story_q') continue;
      const key = _chunkKey(a.day, a.chunk);
      if (!_isMainChunkKey(key)) continue;
      (byChunk[key] = byChunk[key] || []).push(a);
    }
    for (const list of Object.values(byChunk)) list.sort((x, y) => x.ts - y.ts);
    return byChunk;
  }

  // Four-way classification used by the Memory Bank bar.
  // Order matters: `consolidated` wins over `fading` on purpose. Once a chunk
  // reaches stability >= 4 a due date is routine maintenance, not a risk of
  // loss — so the consolidated segment only ever shrinks when you get one
  // WRONG, which keeps the bar's growth honest and legible day to day.
  function _classify(state, now) {
    if (state.total === 0) return 'untouched';
    if (state.stability >= 4 && state.correct / state.total >= 0.8) return 'consolidated';
    if (state.next_due <= now) return 'fading';
    return 'learning';
  }

  function getMemoryBank(totalChunks, now) {
    now = now || Date.now();
    const histories = _mainChunkHistories(_load());
    const bank = { consolidated: 0, learning: 0, fading: 0, untouched: 0 };
    const fading = [];
    for (const [key, answers] of Object.entries(histories)) {
      const st = _replay(answers);
      const cls = _classify(st, now);
      bank[cls] += 1;
      if (cls === 'fading') {
        fading.push({
          day: parseInt(key.slice(3, 5), 10),
          chunkId: key.slice(6),
          stability: st.stability,
          retrievability: Math.exp(-((now - st.last_ts) / DAY_MS) / st.stability),
          accuracy: st.total ? st.correct / st.total : 0,
        });
      }
    }
    // Most-forgotten first, same ordering as getReviewQueue().
    fading.sort((a, b) => a.retrievability - b.retrievability);
    const touched = bank.consolidated + bank.learning + bank.fading;
    bank.untouched = Math.max(0, (totalChunks || 0) - touched);
    bank.touched = touched;
    bank.total = Math.max(totalChunks || 0, touched);
    // Replay-derived review queue. getReviewQueue() reads the incrementally
    // maintained `data.chunks` map instead; when the two disagree (stale or
    // migrated storage) the dashboard would show "rescue 54 chunks" above an
    // empty list, so every fading-related surface reads this one instead.
    bank.fading_list = fading;

    // Same classification as of midnight, so the UI can show today's deltas.
    const dayStart = _dayStart(now);
    const before = { consolidated: 0, learning: 0, fading: 0, untouched: 0 };
    for (const answers of Object.values(histories)) {
      const past = answers.filter(a => a.ts < dayStart);
      before[_classify(_replay(past), dayStart)] += 1;
    }
    bank.delta = {
      consolidated: bank.consolidated - before.consolidated,
      learning: bank.learning - before.learning,
      fading: bank.fading - before.fading,
      touched: touched - (before.consolidated + before.learning + before.fading),
    };
    return bank;
  }

  // Consolidated-chunk count per day over the last `days` days. Unlike accuracy
  // this is monotonic apart from genuine regressions, so it reads as "I am
  // getting stronger" instead of "I am getting worse at harder material".
  function getConsolidatedTrend(days, now) {
    days = days || 14;
    now = now || Date.now();
    const histories = Object.values(_mainChunkHistories(_load()));
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const at = _dayStart(now) - i * DAY_MS + DAY_MS - 1;
      let n = 0;
      for (const answers of histories) {
        const past = answers.filter(a => a.ts <= at);
        if (past.length && _classify(_replay(past), at) === 'consolidated') n += 1;
      }
      out.push({ date: _dateKey(at), offset: -i, count: n });
    }
    return out;
  }

  /* ── Streak with freeze ──────────────────────────────────────────────
     Loss aversion is the strongest daily-return driver, but a hard reset
     to zero after one missed day is exactly when people abandon a habit.
     One freeze granted per 7 days (cap 2) absorbs a single-day gap.
     Freezes are only ever spent on days already in the past, and only to
     bridge a gap of exactly one day inside an existing streak.           */
  function getStreak(now) {
    now = now || Date.now();
    const data = _load();
    const meta = data.meta || (data.meta = { freezes: 1, freeze_dates: [], freeze_week: null });
    if (meta.freezes === undefined) meta.freezes = 1;
    if (!meta.freeze_dates) meta.freeze_dates = [];

    const active = new Set(data.answers.map(a => _dateKey(a.ts)));
    const today = _dateKey(now);
    let dirty = false;

    // Grant one freeze per 7-day bucket, capped at 2.
    const week = Math.floor(_dayStart(now) / DAY_MS / 7);
    if (active.size > 0 && meta.freeze_week !== week) {
      if (meta.freeze_week !== null) meta.freezes = Math.min(2, meta.freezes + 1);
      meta.freeze_week = week;
      dirty = true;
    }

    const frozen = new Set(meta.freeze_dates);
    const covered = k => active.has(k) || frozen.has(k);
    const spentToday = [];

    // Not having practised *yet today* must not break the streak.
    let cursor = active.has(today) ? today : _shiftKey(today, -1);
    let current = 0;
    while (true) {
      if (covered(cursor)) { current += 1; cursor = _shiftKey(cursor, -1); continue; }
      // Gap. Spend a freeze only if it's a past day bridging to another
      // active day — never to extend backwards indefinitely.
      const canBridge = current > 0 && cursor !== today &&
                        meta.freezes > 0 && covered(_shiftKey(cursor, -1));
      if (!canBridge) break;
      meta.freezes -= 1;
      meta.freeze_dates.push(cursor);
      frozen.add(cursor);
      spentToday.push(cursor);
      dirty = true;
      current += 1;
      cursor = _shiftKey(cursor, -1);
    }

    // Longest run across all covered days.
    const all = Array.from(new Set([...active, ...frozen])).sort();
    let longest = 0, run = 0, prev = null;
    for (const k of all) {
      run = (prev && _shiftKey(prev, 1) === k) ? run + 1 : 1;
      if (run > longest) longest = run;
      prev = k;
    }

    if (dirty) _save(data);
    return {
      current, longest,
      freezes: meta.freezes,
      active_today: active.has(today),
      freeze_dates: meta.freeze_dates.slice(),
      just_spent: spentToday,
      // Last 7 calendar days, oldest first — for the week rhythm dots.
      week: Array.from({ length: 7 }, (_, i) => {
        const k = _shiftKey(today, i - 6);
        return { date: k, active: active.has(k), frozen: frozen.has(k), is_today: k === today };
      }),
    };
  }

  /* ── Today's mixed goal ──────────────────────────────────────────────
     Goal-gradient effect: the target has to be close enough to sprint at.
     Both halves are clamped to what is actually achievable right now —
     an impossible goal demotivates harder than no goal at all.           */
  function getDailyGoal(opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const dayStart = _dayStart(now);
    const histories = _mainChunkHistories(_load());

    let newDone = 0, reviewDone = 0, dueAtStart = 0, untouchedAvailable = 0;
    for (const answers of Object.values(histories)) {
      const past = answers.filter(a => a.ts < dayStart);
      const todays = answers.filter(a => a.ts >= dayStart);
      if (todays.length === 0) {
        if (past.length && _replay(past).next_due <= now) dueAtStart += 1;
        continue;
      }
      if (past.length === 0) newDone += 1;
      else { reviewDone += 1; if (_replay(past).next_due <= now) dueAtStart += 1; }
    }
    untouchedAvailable = Math.max(0, (opts.builtChunks || 0) - Object.keys(histories).length);

    // Both halves are clamped to what's actually available, but never below
    // what's already been done — reviewing a chunk slightly *before* it came
    // due is good behaviour, and must not produce a "4 / 2" goal that leaves
    // the ring under-filled for work genuinely completed.
    const newGoal = Math.max(0, Math.min(opts.newTarget || 15, untouchedAvailable + newDone));
    const reviewGoal = Math.max(0, Math.min(opts.reviewTarget || 10, Math.max(dueAtStart, reviewDone)));
    const total = newGoal + reviewGoal;
    const done = Math.min(newDone, newGoal) + Math.min(reviewDone, reviewGoal);
    return {
      new_goal: newGoal, new_done: newDone,
      review_goal: reviewGoal, review_done: reviewDone,
      total, done,
      remaining: Math.max(0, total - done),
      pct: total > 0 ? Math.min(1, done / total) : 0,
      met: total > 0 && done >= total,
    };
  }

  /* ── Today's wins ────────────────────────────────────────────────────
     Amabile's progress principle: concrete small wins, named. Deliberately
     phrased as capability gained ("you can now recall X") rather than
     points earned — informational feedback rather than controlling
     rewards, which is what keeps this from eroding intrinsic motivation. */
  function getTodayWins(now) {
    now = now || Date.now();
    const dayStart = _dayStart(now);
    const data = _load();
    const histories = _mainChunkHistories(data);

    let learned = 0, rescued = 0, promoted = 0, reviewed = 0;
    for (const answers of Object.values(histories)) {
      const past = answers.filter(a => a.ts < dayStart);
      const todays = answers.filter(a => a.ts >= dayStart);
      if (todays.length === 0) continue;
      const before = _replay(past);
      const after = _replay(answers);
      if (before.total === 0) learned += 1; else reviewed += 1;
      const cBefore = _classify(before, dayStart);
      const cAfter = _classify(after, now);
      if (cBefore === 'fading' && cAfter !== 'fading') rescued += 1;
      if (cBefore !== 'consolidated' && cAfter === 'consolidated') promoted += 1;
    }

    // Longest correct run today, across every answer type.
    const todayAnswers = data.answers.filter(a => a.ts >= dayStart).sort((a, b) => a.ts - b.ts);
    let bestRun = 0, run = 0;
    for (const a of todayAnswers) { run = a.correct ? run + 1 : 0; if (run > bestRun) bestRun = run; }
    const correct = todayAnswers.filter(a => a.correct).length;

    return {
      learned, rescued, promoted, reviewed,
      answers: todayAnswers.length, correct,
      accuracy: todayAnswers.length ? correct / todayAnswers.length : null,
      best_run: bestRun,
      minutes: Math.round(todayAnswers.reduce((s, a) => s + (a.rt || 0), 0) / 60000),
      any: todayAnswers.length > 0,
    };
  }

  window.ToeicStats = {
    logAnswer, logSession, getChunkStats,
    getReviewQueue, getGlobalStats, getWeakChunks, projectScore,
    getMemoryBank, getConsolidatedTrend, getStreak, getDailyGoal, getTodayWins,
    resetAll,
    _load, _save, _isMainChunkKey,  // exposed for debugging
    _replay, _classify, _dateKey, _dayStart,
  };
})();
