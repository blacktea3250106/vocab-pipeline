/* TOEIC srs.js — the review schedule shared by every practice page.
   Attaches window.SRS. Loaded before the page's own script.

   What this fixes: answers were logged per day and never aged. A wrong answer
   on Day 03 could only be redrilled in the same sitting — close the tab and it
   was gone. Everything here is keyed `dayNN:cid`, so an item stays addressable
   for the rest of the course and comes back on a schedule instead of on a whim.

   Response time is not just recorded, it schedules. A word you got right in
   22 seconds is not a word you know; in the exam it is what makes you run out
   of time. Slow-correct therefore earns a much smaller interval than
   fast-correct, so it returns sooner without being marked wrong. */
(function () {
  const KEY = 'toeic-srs-v1';
  const DAY_MS = 86400000;
  const MAX_LOG = 20000;          // ~4 months of full days; keeps localStorage sane

  /* Answer speed bands. Under 10s is retrieval; over 20s is reconstruction.
     These match the bands the result screen already reports, so the schedule
     and the feedback tell the same story. */
  const FAST_MS = 10000;
  const SLOW_MS = 20000;

  /* Intervals in days, stored directly rather than as an abstract strength —
     `s` IS the gap until this item comes back.

     FIRST is the gap after a first meeting. It has to differ by speed: an item
     answered in 4 seconds and one answered in 25 seconds are not equally known,
     and giving both the same interval throws away the one signal that separates
     them. GROW is how much the gap stretches on each later success — a slow
     correct barely stretches, so it keeps returning until it gets fast. */
  const FIRST = { lapse: 0.5, slow: 1, ok: 2, fast: 3 };
  const GROW  = { slow: 1.3, ok: 1.9, fast: 2.5 };
  const LAPSE_INTERVAL = 0.5;      // a miss always comes back within the day
  const MAX_INTERVAL = 120;        // longer than the course; nothing sleeps past it

  let mem = null;

  function load() {
    if (mem) return mem;
    try {
      const raw = localStorage.getItem(KEY);
      mem = raw ? JSON.parse(raw) : null;
    } catch (e) { mem = null; }
    if (!mem || typeof mem !== 'object') mem = {};
    if (!mem.cards) mem.cards = {};
    if (!mem.log) mem.log = [];
    if (!mem.migrated) mem.migrated = {};
    return mem;
  }

  let syncTimer = null;
  function save() {
    localStorage.setItem(KEY, JSON.stringify(mem));
    clearTimeout(syncTimer);
    syncTimer = setTimeout(push, 600);      // coalesce a burst of answers
  }

  function push() {
    fetch('/api/srs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mem),
    }).catch(() => {});                     // file:// origin: localStorage only
  }

  function band(correct, rt) {
    if (!correct) return 'lapse';
    if (!rt || rt <= 0) return 'ok';        // untimed items grade as neutral
    if (rt < FAST_MS) return 'fast';
    if (rt > SLOW_MS) return 'slow';
    return 'ok';
  }

  /* One answer. `key` is `dayNN:cid`; several question types share one key on
     purpose — the thing being scheduled is the chunk, not the question. */
  function record(key, kind, correct, rt, now) {
    if (!key || /undefined|null/.test(key)) return null;   // unkeyed item: nothing to age
    now = now || Date.now();
    const d = load();
    const c = d.cards[key] || { n: 0, ok: 0, slow: 0, s: 1, last: 0, due: 0 };
    const b = band(correct, rt);

    c.n += 1;
    if (correct) c.ok += 1;
    if (b === 'slow') c.slow += 1;
    c.s = b === 'lapse' ? LAPSE_INTERVAL
        : c.n === 1 ? FIRST[b]
        : Math.min(Math.max(c.s * GROW[b], FIRST[b]), MAX_INTERVAL);
    c.last = now;
    c.due = now + c.s * DAY_MS;
    d.cards[key] = c;

    d.log.push({ key, kind, correct: !!correct, rt: rt || 0, ts: now });
    if (d.log.length > MAX_LOG) d.log.splice(0, d.log.length - MAX_LOG);
    save();
    return c;
  }

  /* How far past due, measured against the item's own interval — a 2-day item
     one day late is more urgent than a 60-day item a week late. This is the
     ordering, not a memory model: it decides who goes first in a queue you may
     not finish, and the worst-remembered has to be at the front. */
  function urgency(c, now) {
    if (!c.due) return 0;
    return (now - c.due) / Math.max(c.s * DAY_MS, DAY_MS * 0.25);
  }

  /* Everything past its due date, most overdue first. Items never answered are
     not due — they are simply not started, and belong to the day's own flow
     rather than to review. */
  function due(now) {
    now = now || Date.now();
    const d = load();
    const out = [];
    for (const key of Object.keys(d.cards)) {
      const c = d.cards[key];
      if (c.n > 0 && c.due <= now) {
        out.push({
          key, card: c, r: urgency(c, now),
          acc: c.n ? c.ok / c.n : 0,
          slowRate: c.n ? c.slow / c.n : 0,
        });
      }
    }
    return out.sort((a, b) => b.r - a.r);
  }

  function stats(now) {
    now = now || Date.now();
    const d = load();
    const s = { total: 0, due: 0, learning: 0, consolidated: 0, shaky: 0 };
    for (const key of Object.keys(d.cards)) {
      const c = d.cards[key];
      if (!c.n) continue;
      s.total += 1;
      if (c.due <= now) s.due += 1;
      else if (c.s >= 4 && c.ok / c.n >= 0.8) s.consolidated += 1;
      else s.learning += 1;
      // Right but never fast: scores as mastery, behaves like a gap.
      if (c.ok === c.n && c.slow / c.n >= 0.5) s.shaky += 1;
    }
    return s;
  }

  /* Backfill from the per-day progress records written before this file
     existed. Replaying them in timestamp order reconstructs the same schedule
     the learner would have had all along, so Day01–21 arrive already aged
     instead of starting from zero.

     Semantic answers from old builds carry `cid: undefined` — that bug is what
     kept supplementary words out of the schedule, and those rows cannot be
     recovered. They are counted and reported rather than silently dropped. */
  function migrate(day, log) {
    if (!Array.isArray(log) || !log.length) return { added: 0, skipped: 0 };
    const d = load();
    const tag = 'day' + String(day).padStart(2, '0');
    const seen = d.migrated[tag] || 0;
    if (log.length <= seen) return { added: 0, skipped: 0 };

    let added = 0, skipped = 0;
    const rows = log.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
    for (const r of rows.slice(seen)) {
      if (r.cid === undefined || r.cid === null || r.cid === '') { skipped += 1; continue; }
      record(tag + ':' + r.cid, r.kind || 'drill', r.correct, r.rt || 0, r.ts || Date.now());
      added += 1;
    }
    d.migrated[tag] = log.length;
    save();
    return { added, skipped };
  }

  /* Pull every day's history this browser can see. The server copy is
     authoritative when reachable; localStorage is the fallback that also covers
     a file:// origin, whose answers never reached disk at all. */
  function migrateAll() {
    const found = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const m = k && k.match(/^toeic-trr-day(\d+)$/);
      if (!m) continue;
      try {
        const rec = JSON.parse(localStorage.getItem(k));
        if (rec && rec.log) found.push([parseInt(m[1], 10), rec.log]);
      } catch (e) { /* unreadable entry: skip */ }
    }
    let added = 0, skipped = 0;
    for (const [day, log] of found) {
      const r = migrate(day, log);
      added += r.added; skipped += r.skipped;
    }

    return fetch('/api/progress')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(all => {
        for (const name of Object.keys(all || {})) {
          const m = name.match(/day(\d+)/);
          if (!m || !all[name] || !all[name].log) continue;
          const r = migrate(parseInt(m[1], 10), all[name].log);
          added += r.added; skipped += r.skipped;
        }
        return { added, skipped };
      })
      .catch(() => ({ added, skipped }));
  }

  /* Adopt the server copy when it holds more history than this browser — the
     case where you practised on http://localhost and later opened file://. */
  function boot() {
    return fetch('/api/srs')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(rec => {
        if (rec && rec.log && rec.log.length > load().log.length) {
          mem = rec;
          if (!mem.cards) mem.cards = {};
          if (!mem.migrated) mem.migrated = {};
          localStorage.setItem(KEY, JSON.stringify(mem));
        }
        return migrateAll();
      })
      .catch(() => migrateAll());
  }

  function reset() {
    mem = { cards: {}, log: [], migrated: {} };
    save();
  }

  window.SRS = { record, due, stats, migrate, migrateAll, boot, reset,
                 urgency, FAST_MS, SLOW_MS,
                 raw: () => load() };
})();
