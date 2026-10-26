/* ============================================================
   Detail notes (right-hand panel). SAMPLE DATA written for this repo.

   In the real pipeline these are generated from the "exam focus" boxes that
   extract/parse.mjs saves to .cache/notes-dayXX.json, one generator per day,
   then checked by extract/check.mjs before the site loads them.

   Key is the word itself; every block is optional.
   Fields marked [rich] may contain simple HTML (<b> <br>); everything else is escaped.
   detail = {
     level    : "B2+",
     forms    : "approve → approved → approved",
     preps    : [{ p, zh, eg:{en,zh}, bad?: true, fix? }],   // preposition patterns
     family   : [{ pos, word, zh }],
     meanings : [{ title, badge, stars, body[rich], eg:{en, zh} }],
     pitfall  : { lead, no, yes, note[rich] },              // the most common mistake
     chunks   : [{ en, zh, stars }],                        // collocations
     lookalikes: { rows:[{ word, zh, tag }], tip:{ lead, body[rich] }, note },
     nearby   : { rows:[{ word, zh[rich] }], tip:{ lead, body[rich] } },
     lock     : { big, rows:[{ l[rich], d[rich] }] }        // one-line takeaway
   }
   ============================================================ */

window.VOCAB_DETAIL = Object.assign(window.VOCAB_DETAIL || {}, {
  submit: {
    level: "B1",
    forms: "submit → submitted → submitted",
    preps: [
      { p: "submit A to B", zh: "把 A 交給 B",
        eg: { en: "Please submit the form to the front desk.", zh: "請把表格交給櫃台。" } },
      { p: "be submitted by + 時間", zh: "在某時間前被提交",
        eg: { en: "All receipts must be submitted by Friday.", zh: "所有收據必須在星期五前提交。" } },
      { p: "submit for", zh: "（誤）submit 後面直接接要交的東西", bad: true, fix: "submit a report（不加 for）",
        eg: { en: "She submitted a report yesterday.", zh: "她昨天交了一份報告。" } },
    ],
    family: [
      { pos: "v.", word: "submit", zh: "提交" },
      { pos: "n.", word: "submission", zh: "提交；提交的文件" },
    ],
    chunks: [
      { en: "submit a report", zh: "交報告", stars: 5 },
      { en: "submit an application", zh: "提出申請", stars: 4 },
    ],
    lock: {
      big: "submit 是「交出去」— 交什麼直接接，交給誰用 to",
      rows: [{ l: "submit <b>A</b> to <b>B</b>", d: "把 A 交給 B" }],
    },
  },

  available: {
    level: "B1",
    meanings: [
      { title: "有空的（人）", stars: 5, body: "說人時表示<b>有時間</b>，常接 for 或不定詞。",
        eg: { en: "Are you available for a quick call?", zh: "你有空講個簡短的電話嗎？" } },
      { title: "可取得的（物）", stars: 4, body: "說東西時表示<b>可以拿到、可以使用</b>。",
        eg: { en: "The new laptops are available at the IT desk.", zh: "新筆電可以在 IT 櫃台領取。" } },
    ],
    family: [
      { pos: "adj.", word: "available", zh: "有空的；可取得的" },
      { pos: "n.", word: "availability", zh: "可用性；空檔" },
      { pos: "adj.", word: "unavailable", zh: "沒空的（反義）" },
    ],
    lookalikes: {
      rows: [
        { word: "available", zh: "有空的；可取得的", tag: "adj." },
        { word: "avail", zh: "利用（avail oneself of）", tag: "v." },
      ],
      tip: { lead: "分辨方式", body: "考題空格在 be 動詞後面時，幾乎都是 <b>available</b>。" },
    },
    lock: {
      big: "available = 人有空、東西拿得到",
      rows: [{ l: "be available for + N", d: "有空做某事" }],
    },
  },

  schedule: {
    level: "A2",
    pitfall: {
      lead: "最常見的錯誤",
      no: "The meeting is scheduled on 3 p.m.",
      yes: "The meeting is scheduled for 3 p.m.",
      note: "「排定在某個時間」用 <b>be scheduled for</b>。",
    },
    chunks: [
      { en: "ahead of schedule", zh: "比預定提早", stars: 4 },
      { en: "behind schedule", zh: "進度落後", stars: 4 },
    ],
    nearby: {
      rows: [{ word: "reschedule", zh: "重新安排；可替換成 move the meeting" }],
    },
    lock: {
      big: "be scheduled for + 時間",
      rows: [{ l: "ahead of / behind schedule", d: "提早 / 落後" }],
    },
  },
});
