/* What to extract from one page photo.
   Passed to the API as a structured-output JSON schema, so the model must return
   exactly this shape: no hand-written parser, no missing fields.
   The field descriptions are in Chinese on purpose: they are read by the model
   next to a Traditional Chinese page, and they name the labels printed on it. */

export const PAGE_SCHEMA = {
  type: "object",
  properties: {
    day: {
      type: "string",
      description: '這一頁屬於哪個 Day，例如 "Day 01"。看頁面右側的 DAY 標籤或頁尾的頁碼列。',
    },
    words: {
      type: "array",
      description:
        "這一頁的主單字（左側有編號、右側有中文字義和英文例句的那些）。沒有就給空陣列。",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", description: "單字左上角的編號，用來檢查有沒有漏抓" },
          word: { type: "string", description: "英文單字，照抄（含重音符號，如 résumé）" },
          pos: {
            type: "string",
            description:
              '詞性。單一詞性寫 "n." / "v." / "adj." / "adv." / "phr."；一個字有多種詞性時寫 "n./v."',
          },
          zh: {
            type: "string",
            description:
              "中文字義。多個意思用「，」或「；」分隔。若有多種詞性，把次要詞性的意思也寫進來，例如「職位；位置；（v.）放置」",
          },
          example: {
            type: "object",
            description: "書上的第一個英文例句與其中譯，照抄不要改寫",
            properties: {
              en: { type: "string" },
              zh: { type: "string" },
            },
            required: ["en", "zh"],
            additionalProperties: false,
          },
          extraExamples: {
            type: "array",
            description: "同一個字若書上給了第二、第三個例句，放這裡（沒有就空陣列）",
            items: {
              type: "object",
              properties: { en: { type: "string" }, zh: { type: "string" } },
              required: ["en", "zh"],
              additionalProperties: false,
            },
          },
          related: {
            type: "array",
            description:
              "單字下方列出的衍生字與同義字，兩種都收進來。反義字在中文後面註明「（反義）」。沒有就空陣列。",
            items: {
              type: "object",
              properties: {
                word: { type: "string" },
                pos: { type: "string", description: '詞性，沒標就給空字串' },
                zh: { type: "string" },
              },
              required: ["word", "pos", "zh"],
              additionalProperties: false,
            },
          },
          star: {
            type: "integer",
            description: "單字後面的星號數量：*** = 3、** = 2、* = 1。沒有星號給 1。",
          },
        },
        required: ["index", "word", "pos", "zh", "example", "extraExamples", "related", "star"],
        additionalProperties: false,
      },
    },
    notes: {
      type: "array",
      description:
        "「出題重點」框裡的內容，一個框一筆。這是筆記的原料，要完整抄下來。沒有就空陣列。",
      items: {
        type: "object",
        properties: {
          word: { type: "string", description: "這個框屬於哪個單字" },
          kind: {
            type: "string",
            enum: ["常考語句", "文法", "同義詞", "易混淆單字", "其他"],
            description: "框左側的灰底標籤",
          },
          heading: {
            type: "string",
            description: "框裡的粗體標題行，例如「a requirement + of/for ～的必要條件」",
          },
          body: {
            type: "string",
            description: "標題底下的說明文字，完整抄錄",
          },
        },
        required: ["word", "kind", "heading", "body"],
        additionalProperties: false,
      },
    },
    lists: {
      type: "array",
      description:
        "書頁若是「新制多益基礎單字 / 800分單字 / 900分單字」的表格，把整張表抓進來。一般單字頁給空陣列。",
      items: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: ["basic", "t800", "t900"],
            description: "基礎單字表 = basic、800分 = t800、900分 = t900",
          },
          section: {
            type: "string",
            description: '表格左側的分區標籤，例如 "LC"、"RC"、"Part 5, 6"、"Part 7"',
          },
          words: {
            type: "array",
            items: {
              type: "object",
              properties: {
                word: { type: "string" },
                pos: { type: "string" },
                zh: { type: "string" },
              },
              required: ["word", "pos", "zh"],
              additionalProperties: false,
            },
          },
        },
        required: ["level", "section", "words"],
        additionalProperties: false,
      },
    },
    continued: {
      type: "boolean",
      description:
        "這一頁最上方是否有「接續上一頁某個單字」的出題重點框或表格（是的話 notes/lists 裡的 word 要對應到上一頁的單字）",
    },
  },
  required: ["day", "words", "notes", "lists", "continued"],
  additionalProperties: false,
};
