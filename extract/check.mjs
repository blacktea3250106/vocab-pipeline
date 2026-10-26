/* Data integrity check for the study site: node extract/check.mjs [dataDir]
   Detail notes are written by several independent generators (one per day), so
   this confirms every note has the shape the renderer expects, that raw-HTML
   fields only use a small set of closed tags, that no word has two notes, and
   that no day's file contains another day's words. Exits 1 on any problem. */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const dataDir = path.resolve(process.argv[2] ?? path.join(import.meta.dirname, "..", "web", "data"));

global.window = {};
const all = readdirSync(dataDir).filter((f) => f.endsWith(".js")).sort();
const dayFiles = all.filter((f) => /^day\d+\.js$/.test(f));
const files = all.filter((f) => /^detail(-day\d+)?\.js$/.test(f)).map((f) => path.join(dataDir, f));
dayFiles.forEach((f) => require(path.join(dataDir, f)));
const words = window.VOCAB_DATA || [];
const byWord = Object.fromEntries(words.map((w) => [w.word, w]));

window.VOCAB_DETAIL = {};
files.forEach((f) => require(f));
const D = window.VOCAB_DETAIL;
// Every day file should have a matching detail file (detail.js covers Day 01)
const missingFiles = dayFiles
  .map((f) => f.match(/\d+/)[0])
  .filter((n) => n !== "01" && !all.includes(`detail-day${n}.js`))
  .map((n) => `detail-day${n}.js`);

const problems = [];
const warn = (k, msg) => problems.push(`${k}: ${msg}`);
const isStr = (v) => typeof v === "string" && v.trim() !== "";
const isArr = (v) => Array.isArray(v);

for (const [k, d] of Object.entries(D)) {
  if (!byWord[k]) warn(k, "no matching word in the deck");
  if (!d || typeof d !== "object") { warn(k, "note is not an object"); continue; }
  if (!d.lock) warn(k, "missing lock");
  else if (!isStr(d.lock.big)) warn(k, "lock.big is not a string");

  if (d.preps !== undefined) {
    if (!isArr(d.preps)) warn(k, "preps is not an array");
    else d.preps.forEach((p, i) => {
      if (!isStr(p?.p)) warn(k, `preps[${i}].p missing or not a string`);
      if (!isStr(p?.zh)) warn(k, `preps[${i}].zh missing or not a string`);
      if (!p?.eg) warn(k, `preps[${i}] missing example`);
      else if (!isStr(p.eg.en) || !isStr(p.eg.zh)) warn(k, `preps[${i}].eg malformed`);
      if (p?.bad && !isStr(p.fix)) warn(k, `preps[${i}] marked bad but has no fix`);
    });
  }
  if (d.chunks !== undefined) {
    if (!isArr(d.chunks)) warn(k, "chunks is not an array");
    else d.chunks.forEach((c, i) => {
      if (!isStr(c?.en)) warn(k, `chunks[${i}].en missing`);
      if (!isStr(c?.zh)) warn(k, `chunks[${i}].zh missing`);
    });
  }
  if (d.meanings !== undefined) {
    if (!isArr(d.meanings)) warn(k, "meanings is not an array");
    else d.meanings.forEach((m, i) => {
      if (!isStr(m?.title)) warn(k, `meanings[${i}].title missing`);
      if (m?.eg && (!isStr(m.eg.en) || !isStr(m.eg.zh))) warn(k, `meanings[${i}].eg malformed`);
    });
  }
  if (d.family !== undefined) {
    if (!isArr(d.family)) warn(k, "family is not an array");
    else d.family.forEach((r, i) => {
      if (!isStr(r?.word)) warn(k, `family[${i}].word missing`);
      if (r?.zh === undefined) warn(k, `family[${i}].zh missing`);
    });
  }
  for (const key of ["lookalikes", "nearby"]) {
    const t = d[key];
    if (t === undefined) continue;
    if (typeof t !== "object" || t === null) { warn(k, `${key} is not an object`); continue; }
    if (!isArr(t.rows)) { warn(k, `${key}.rows is not an array`); continue; }
    t.rows.forEach((r, i) => {
      if (!isStr(r?.word)) warn(k, `${key}.rows[${i}].word missing`);
      if (r?.zh === undefined) warn(k, `${key}.rows[${i}].zh missing`);
    });
    if (t.tip && !isStr(t.tip.body)) warn(k, `${key}.tip.body missing`);
  }
  if (d.pitfall) {
    if (!isStr(d.pitfall.no) || !isStr(d.pitfall.yes)) warn(k, "pitfall missing no/yes");
  }
}

// Raw HTML fields skip esc(); one unclosed tag breaks the whole panel layout
const ALLOWED = new Set(["b", "i", "br", "small", "em", "strong", "u", "code", "del"]);
let rawFields = 0;
for (const [k, d] of Object.entries(D)) {
  const raws = [];
  const add = (p, v) => typeof v === "string" && raws.push([p, v]);
  if (d.pitfall) add("pitfall.note", d.pitfall.note);
  for (const t of ["lookalikes", "nearby"]) {
    if (d[t]?.tip) add(`${t}.tip.body`, d[t].tip.body);
    (d[t]?.rows || []).forEach((r, i) => add(`${t}.rows[${i}].zh`, r.zh));
  }
  (d.meanings || []).forEach((m, i) => add(`meanings[${i}].body`, m.body));
  (d.family || []).forEach((r, i) => add(`family[${i}].zh`, r.zh));
  (d.lock?.rows || []).forEach((r, i) => { add(`lock.rows[${i}].l`, r.l); add(`lock.rows[${i}].d`, r.d); });

  for (const [p, v] of raws) {
    rawFields++;
    const stack = [];
    let stop = false;
    for (const m of v.matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
      const [, close, tag, self] = m;
      const t = tag.toLowerCase();
      if (!ALLOWED.has(t)) { warn(k, `${p} uses disallowed tag <${t}>`); stop = true; break; }
      if (t === "br" || self) continue;
      if (close) { if (stack.pop() !== t) { warn(k, `${p} has </${t}> with no opening tag`); stop = true; break; } }
      else stack.push(t);
    }
    if (!stop && stack.length) warn(k, `${p} has unclosed <${stack.join("><")}>`);
    if (/<(?![\/a-zA-Z])/.test(v)) warn(k, `${p} has a stray <`);
  }
}

// Duplicate keys: a word noted in two files, where the later one silently wins
const seen = {};
const dupes = [];
files.forEach((f) => {
  const src = readFileSync(f, "utf8");
  const short = f.split("/").pop();
  for (const m of src.matchAll(/^ {2}("([^"]+)"|([A-Za-z][\w-]*)):\s*\{/gm)) {
    const key = m[2] ?? m[3];
    if (seen[key]) dupes.push(`${key} (${seen[key]} and ${short})`);
    else seen[key] = short;
  }
});

// Cross-day contamination: each detail file should only hold that day's words
const strays = [];
for (const f of files) {
  const n = path.basename(f).match(/\d+/)?.[0] ?? "01";
  const dayWords = new Set(words.filter((w) => w.day === `Day ${n}`).map((w) => w.word));
  if (!dayWords.size) continue;
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/^ {2}("([^"]+)"|([A-Za-z][\w-]*)):\s*\{/gm)) {
    const key = m[2] ?? m[3];
    if (!dayWords.has(key)) strays.push(`Day ${n} file contains ${key}`);
  }
}

const tot = { core: 0, basic: 0, t800: 0, t900: 0 };
const has = { core: 0, basic: 0, t800: 0, t900: 0 };
words.forEach((w) => tot[w.tier]++);
Object.keys(D).forEach((k) => byWord[k] && has[byWord[k].tier]++);

console.log(`words ${words.length} · notes ${Object.keys(D).length}`);
for (const t of ["core", "basic", "t800", "t900"])
  console.log(`  ${t.padEnd(6)} ${String(has[t]).padStart(4)} / ${String(tot[t]).padStart(4)}  ${(tot[t] ? (has[t] / tot[t]) * 100 : 0).toFixed(1)}%`);
console.log(`missing files: ${missingFiles.length ? missingFiles.join(", ") : "none"}`);
console.log(`duplicate keys: ${dupes.length ? dupes.slice(0, 20).join("; ") : "none"}`);
console.log(`cross-day strays: ${strays.length ? strays.slice(0, 10).join("; ") : "none"}`);
console.log(`raw HTML fields checked: ${rawFields}`);
console.log(`shape problems: ${problems.length || "none"}`);
problems.slice(0, 40).forEach((p) => console.log("  ⚠ " + p));
if (problems.length > 40) console.log(`  … ${problems.length - 40} more`);
process.exit(problems.length || dupes.length || missingFiles.length || strays.length ? 1 : 0);
