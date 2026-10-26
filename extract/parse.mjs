#!/usr/bin/env node
/* ============================================================
   Book page photos -> web/data/dayXX.js

   Usage:
     node extract/parse.mjs d2                # live API, good for checking one day
     node extract/parse.mjs --all --batch     # Batch API (half price) for the whole book
     node extract/parse.mjs d5 --force        # ignore the cache and re-read one day

   Offline demo (no API key needed, every image is already cached):
     PAGES_DIR=samples/pages CACHE_DIR=samples/cache node extract/parse.mjs d1

   Environment:
     ANTHROPIC_API_KEY   only needed when an image is not cached yet
     PAGES_DIR           folder holding d1/, d2/ ... photo folders (default: ./pages)
     CACHE_DIR           per-image JSON results (default: ./.cache)
     OUT_DIR             where dayXX.js is written (default: ./web/data)

   What it does:
     - One request per photo, with a JSON schema enforced by structured outputs,
       so every page comes back in the same shape with no free-text parsing.
     - Every image's result is cached on disk, so an interrupted run never pays twice.
     - After merging, checks that headword numbers are continuous. A gap almost
       always means a page was not photographed or was misread.
     - Batch mode splits work into chunks to stay far below the batch size limits.
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { PAGE_SCHEMA } from "./schema.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const fromEnv = (name, fallback) => path.resolve(process.env[name] ?? fallback);
const PAGES = fromEnv("PAGES_DIR", path.join(REPO, "pages"));
const CACHE = fromEnv("CACHE_DIR", path.join(REPO, ".cache"));
const OUT = fromEnv("OUT_DIR", path.join(REPO, "web", "data"));
const MODEL = process.env.EXTRACT_MODEL ?? "claude-sonnet-5";
const CONCURRENCY = 4; // images in flight at once in live mode
const BATCH_MAX_BYTES = 40 * 1024 * 1024; // 40 MB per batch, far below the 256 MB cap
const BATCH_MAX_REQS = 100;

// Created on first use, so a fully cached run works without an API key.
let _client;
const client = () => (_client ??= new Anthropic());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Prompt ----------
   The book is a Traditional Chinese edition, so the instructions are written in
   Chinese to match the page. Every rule below came from a mistake seen while
   reading the first day by hand:
   - ignore phonetic symbols; copy examples verbatim, never "fix" them
   - merge multiple parts of speech into one entry (position n. + v.)
   - first example -> example, the rest -> extraExamples
   - derived words and synonyms both go into related
   - an "exam focus" box at the top of a page belongs to the last word of the previous page
   - do not extract the half-visible neighbouring page at the spine
   - do not guess text hidden by fingers, shadow or glare */
const SYSTEM = `你在把一本多益單字書的書頁照片轉成結構化資料。這本書是繁體中文版的多益單字書。

書頁的版面：
- 左欄是單字，上標數字是編號，單字後面的星號表示出題率（*** 最高、** 高、* 中）
- 單字下方可能列出衍生字（图 符號）和同義字／反義字（回 符號），兩種都要收進 related
- 右欄是中文字義、英文例句、例句中譯
- 部分單字下方有「出題重點」框，左側灰底標籤是「常考語句」「文法」「同義詞」「易混淆單字」
- 每個 Day 的最後幾頁是「新制多益基礎單字 / 800分單字 / 900分單字」表格，只有單字、詞性、中文

抽取規則：
1. 音標一律忽略，不要抽出來。
2. 例句照抄，不要改寫、不要修正你認為的錯誤。中譯同樣照抄。
3. 一個單字有多種詞性時（例如 position 有 n. 和 v.），合併成一筆：pos 寫 "n./v."，zh 把兩種意思都寫進去，example 取第一個例句，其餘放 extraExamples。
4. 一個單字有多個例句時，第一句放 example，其餘放 extraExamples。
5. 出題重點框可能跨頁 —— 如果這一頁最上方就是一個沒有對應單字的框，那是上一頁最後一個單字的，把 continued 設為 true，並在 notes 的 word 欄填上你判斷的那個單字。
6. 頁面邊緣可能露出隔壁頁的內容（被書脊遮住、只有半行的）—— 那些不要抽，只抽這一頁完整可讀的。
7. 如果照片有手指、陰影、反光遮住部分文字，就抽你能確定讀出來的部分，不要猜測補字。
8. 表格頁的 words 給空陣列，一般單字頁的 lists 給空陣列。

只回傳結構化資料，不要任何額外說明。`;

/* ---------- One request, shared by live and batch mode ---------- */
function requestParams(imgPath) {
  const b64 = fs.readFileSync(imgPath).toString("base64");
  const ext = path.extname(imgPath).toLowerCase();
  const media_type = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: PAGE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type, data: b64 } },
          { type: "text", text: `File name: ${path.basename(imgPath)}` },
        ],
      },
    ],
  };
}

const pickText = (content) => content.find((b) => b.type === "text")?.text ?? "{}";
const cacheKeyFor = (imgPath) =>
  path.join(CACHE, `${path.basename(path.dirname(imgPath))}-${path.basename(imgPath)}.json`);
// Batch custom_id: folder + trailing image number, e.g. d2-7
const customIdFor = (imgPath) =>
  `${path.basename(path.dirname(imgPath))}-${path.basename(imgPath).match(/(\d+)\.\w+$/)?.[1] ?? "x"}`;

function imagesIn(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    // Phone exports look like ALBUM_260804_10.jpg: sort by the trailing number, not lexically
    .sort((a, b) => {
      const n = (s) => parseInt(s.match(/(\d+)\.\w+$/)?.[1] ?? "0", 10);
      return n(a) - n(b);
    })
    .map((f) => path.join(dir, f));
}

/* ---------- Mode 1: live API ---------- */
async function runLive(jobs) {
  let totalIn = 0,
    totalOut = 0;
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    await Promise.all(
      jobs.slice(i, i + CONCURRENCY).map(async (j) => {
        try {
          const res = await client().messages.create(requestParams(j.img));
          totalIn += res.usage.input_tokens;
          totalOut += res.usage.output_tokens;
          fs.writeFileSync(j.key, JSON.stringify(JSON.parse(pickText(res.content)), null, 2));
          process.stdout.write("✓");
        } catch (e) {
          process.stdout.write("✗");
          console.error(`\n  ${path.basename(j.img)}: ${e.message}`);
        }
      })
    );
  }
  return { totalIn, totalOut, batched: false };
}

/* ---------- Mode 2: Batch API (half price, results arrive later) ---------- */
async function runBatch(jobs) {
  // Split by request count and payload size
  const chunks = [];
  let cur = [],
    curBytes = 0;
  for (const j of jobs) {
    const size = fs.statSync(j.img).size * 1.37; // base64 overhead
    if (cur.length && (cur.length >= BATCH_MAX_REQS || curBytes + size > BATCH_MAX_BYTES)) {
      chunks.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(j);
    curBytes += size;
  }
  if (cur.length) chunks.push(cur);

  console.log(`\nBatch mode: ${jobs.length} images in ${chunks.length} batch(es)`);
  let totalIn = 0,
    totalOut = 0;

  for (const [ci, chunk] of chunks.entries()) {
    const batch = await client().messages.batches.create({
      requests: chunk.map((j) => ({ custom_id: customIdFor(j.img), params: requestParams(j.img) })),
    });
    console.log(`\n  batch ${ci + 1}/${chunks.length} (${chunk.length} images) id=${batch.id}`);

    // Poll until done. Most batches finish within an hour; the hard limit is 24 hours.
    let b = batch;
    const started = Date.now();
    while (b.processing_status !== "ended") {
      await sleep(30_000);
      b = await client().messages.batches.retrieve(batch.id);
      const mins = Math.round((Date.now() - started) / 60000);
      process.stdout.write(
        `\r  ${b.processing_status} · succeeded ${b.request_counts.succeeded} / processing ${b.request_counts.processing} · ${mins} min`
      );
    }
    console.log("");

    // Result order is not guaranteed; always map back by custom_id
    const byId = new Map(chunk.map((j) => [customIdFor(j.img), j]));
    for await (const r of await client().messages.batches.results(batch.id)) {
      const j = byId.get(r.custom_id);
      if (!j) continue;
      if (r.result.type === "succeeded") {
        const u = r.result.message.usage;
        totalIn += u.input_tokens;
        totalOut += u.output_tokens;
        try {
          fs.writeFileSync(j.key, JSON.stringify(JSON.parse(pickText(r.result.message.content)), null, 2));
        } catch (e) {
          console.error(`  ✗ ${r.custom_id}: response is not valid JSON — ${e.message}`);
        }
      } else {
        console.error(`  ✗ ${r.custom_id}: ${r.result.type}`, r.result.error?.type ?? "");
      }
    }
  }
  return { totalIn, totalOut, batched: true };
}

/* ---------- Merge pages into one day ---------- */
function merge(pages) {
  const day = pages.find((p) => p.day)?.day ?? "Day ??";

  // Headwords: sort by book number, drop duplicates (a word photographed twice)
  const byIndex = new Map();
  for (const p of pages) for (const w of p.words ?? []) if (!byIndex.has(w.index)) byIndex.set(w.index, w);
  const core = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, w]) => w);

  // Continuity check: the most important guard against a missing or misread page
  const gaps = [];
  for (let i = 1; i <= (core.at(-1)?.index ?? 0); i++) if (!byIndex.has(i)) gaps.push(i);

  const lists = pages.flatMap((p) => p.lists ?? []);
  const notes = pages.flatMap((p) => p.notes ?? []);
  return { day, core, gaps, lists, notes };
}

/* ---------- Write web/data/dayXX.js ---------- */
const LIST_TITLE = {
  basic: "Basic word list",
  t800: "Target 800 word list",
  t900: "Target 900 word list",
};

function emit({ day, core, lists }, outPath) {
  const esc = (s) => String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const entry = (w, tier) => `  {
    word: "${esc(w.word)}",
    pos: "${esc(w.pos)}",
    zh: "${esc(w.zh)}",
    example: {
      en: "${esc(w.example?.en)}",
      zh: "${esc(w.example?.zh)}",
    },
    related: [${(w.related ?? [])
      .map((r) => `{ word: "${esc(r.word)}", pos: "${esc(r.pos)}", zh: "${esc(r.zh)}" }`)
      .join(", ")}],
    star: ${w.star ?? 1},
    tier: "${tier}",
    day: "${esc(day)}",
  },`;

  const body = [
    ...core.map((w) => entry(w, "core")),
    ...lists.flatMap((l) => [
      `\n  /* ===== ${LIST_TITLE[l.level] ?? l.level} (${l.section}) ===== */`,
      ...l.words.map((w) => entry({ ...w, example: { en: "", zh: "" }, related: [] }, l.level)),
    ]),
  ].join("\n");

  fs.writeFileSync(
    outPath,
    `// ${day} — generated from page photos by extract/parse.mjs
// Word-list entries have no example sentence on the page, so example is empty.
//
// word / pos / zh / example{en,zh} / related[{word,pos,zh}] / star / tier / day
// tier: core (numbered headword) / basic / t800 / t900

window.VOCAB_DATA = (window.VOCAB_DATA || []).concat([
${body}
]);
`
  );
  return core.length + lists.reduce((n, l) => n + l.words.length, 0);
}

/* ---------- Main ---------- */
const args = process.argv.slice(2);
const force = args.includes("--force");
const useBatch = args.includes("--batch");
const targets = args.includes("--all")
  ? fs
      .readdirSync(PAGES)
      .filter((f) => /^d\d+$/i.test(f) && fs.statSync(path.join(PAGES, f)).isDirectory())
      .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)))
  : args.filter((a) => !a.startsWith("--"));

if (!targets.length) {
  console.error("usage: node extract/parse.mjs d2 [d3 ...] | --all [--batch] [--force]");
  process.exit(1);
}

fs.mkdirSync(CACHE, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// 1. Collect images, skipping the ones already cached
const allJobs = [];
for (const t of targets) {
  const dir = path.join(PAGES, t);
  if (!fs.existsSync(dir)) {
    console.error(`! not found: ${dir}`);
    continue;
  }
  for (const img of imagesIn(dir)) {
    const key = cacheKeyFor(img);
    if (force || !fs.existsSync(key)) allJobs.push({ img, key });
  }
}

// 2. Call the API (or go straight to the cache)
if (allJobs.length) {
  console.log(`${allJobs.length} image(s) to read${useBatch ? "" : " (live mode)"}`);
  const { totalIn, totalOut, batched } = useBatch ? await runBatch(allJobs) : await runLive(allJobs);
  // USD per million tokens [input, output] at the time of the run; batch is half
  const rate = batched ? [1, 5] : [2, 10];
  const cost = (totalIn / 1e6) * rate[0] + (totalOut / 1e6) * rate[1];
  console.log(`\nTokens: ${totalIn.toLocaleString()} in / ${totalOut.toLocaleString()} out ≈ $${cost.toFixed(2)}`);
} else {
  console.log("All images cached, writing data files only");
}

// 3. Merge and write each folder
console.log("");
for (const t of targets) {
  const dir = path.join(PAGES, t);
  if (!fs.existsSync(dir)) continue;
  const pages = imagesIn(dir)
    .map((img) => cacheKeyFor(img))
    .filter((k) => fs.existsSync(k))
    .map((k) => JSON.parse(fs.readFileSync(k, "utf8")));

  if (!pages.length) {
    console.log(`${t}: no results, skipped`);
    continue;
  }

  const merged = merge(pages);
  const dayNum = (merged.day.match(/\d+/)?.[0] ?? t.replace(/\D/g, "")).padStart(2, "0");
  const outPath = path.join(OUT, `day${dayNum}.js`);
  const total = emit(merged, outPath);

  console.log(
    `${merged.day.padEnd(7)} headwords ${String(merged.core.length).padStart(3)} · word lists ${String(
      total - merged.core.length
    ).padStart(3)} · total ${String(total).padStart(3)} · exam-focus notes ${merged.notes.length}  -> ${path.relative(
      process.cwd(),
      outPath
    )}`
  );
  if (merged.gaps.length) {
    console.log(
      `   ! headword numbers missing: ${merged.gaps.join(", ")} — a page was probably skipped or misread; re-shoot it and rerun with --force`
    );
  }

  // Exam-focus boxes are kept separately; they are the raw material for the detail notes
  fs.writeFileSync(path.join(CACHE, `notes-day${dayNum}.json`), JSON.stringify(merged.notes, null, 2));
}

console.log("\nDone.");
