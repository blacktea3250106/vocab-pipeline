# Design notes

Condensed from the handoff document I kept while building this, so that any
person or model picking it up would not have to repeat the same trial and error.
The rule at the top of that document still holds: every learning decision here
is backed by a source, and changes start from the reasoning, not from taste.

## Goal and learner

- Target: TOEIC 900+, and English that holds up in real work conversations.
- Starting point (self-assessed): 550–700. Weakest area: Parts 3/4 listening.
- Budget: 60+ minutes a day.
- Preferences: no rote word lists; learn phrases, not single words; everything
  should be usable outside the exam. Explanations in Traditional Chinese.

## Three non-negotiables

1. **Chunks over words.** Teach `submit a report`, not `submit` and `report`.
   Native speech is largely pre-assembled phrases (Pawley & Syder; Nation), and
   listening speed comes from recognising whole chunks.
2. **Useful outside the exam.** Every chunk carries a real-life scenario. If
   there is no answer to "when would I say this tomorrow?", it is not worth a card.
3. **Always in context.** Stories, dialogues and scenes instead of bare lists.

## Research the design leans on

| Principle | What it changed |
|---|---|
| Minimum information principle (Wozniak) | One card tests one thing. Anki templates are split by skill instead of packing synonyms, grammar and antonyms onto one card. |
| Semantic clustering interference (Tinkham 1993, 1997) | Synonyms, antonyms and lookalikes are not taught side by side. `applicant / application / appliance` are deliberately kept apart on the day they are learned. |
| Thematic vs semantic clustering | Grouping by scene (eight job-hunting chunks in one story) helps; grouping by meaning (three synonyms on one card) hurts. Stories are thematic; synonym lists were removed. |
| Krashen i+1 | Stories reuse mostly known words plus the day's new chunks. |
| Testing effect (Roediger & Karpicke) | Pages default to recall first: the answer is hidden until you try. |
| Spaced repetition | Everything ends up in a schedule (Anki, plus the site's own speed-aware scheduler). |
| Dual coding (Paivio) | Every chunk has audio next to the text. |

## Decisions and the alternatives turned down

| Chose | Instead of | Why |
|---|---|---|
| Chunks | Single words | See above. |
| Neural TTS (edge-tts; ElevenLabs for stories when a key is set) | macOS `say` | `say` was tested and rejected as too flat: no linking, no natural stress. |
| HTML pages with inline audio | Markdown plus loose mp3 files | Eyes and ears on the same screen. |
| Three Anki card types: listening (audio → cloze), recognition (EN → ZH), production (ZH + scenario → EN) | One type, or five or more | Maps to the three exam skills without overloading a day. |
| Minimal cards | Cards with family, synonyms, antonyms, lookalikes and grammar | The rich version was tried first and felt slow and confusing in daily use; the research above explains why. |
| Keep synonym/antonym/lookalike fields in the data, but do not render them on the day | Delete them | They feed cross-day links later, when the target word is already stable, which avoids interference. |
| US and UK voices, male and female | One voice | The exam mixes accents; recognising a word across voices is the skill. |
| Template + data pipeline | Hand-written pages | 30 days of material; write the template once, run it 30 times. |

## Things not to do

- Do not put synonyms, antonyms or lookalikes on the same card or list on the day they are learned. Contrast cards come later, after the target word has settled.
- Do not regress to low-quality TTS.
- Do not make the book prettier and call it done. Ask whether a change improves retrieval. If it only adds visuals, skip it.
- Do not change a learning-method decision without a source. Propose two or three options with trade-offs, agree, then build.

## Architecture as it grew

The first version was one script: a day's chunks in YAML in, an HTML page, mp3s
and an Anki deck out. Three things were added once the daily routine showed
where the friction was:

1. **Extraction moved from chat to a script.** Day 01 was transcribed by hand in a
   chat session. For the remaining 29 days, `extract/parse.mjs` sends each photo
   to Claude with a JSON schema, caches every result, and checks headword numbers
   for gaps. The prompt rules all came from mistakes seen on Day 01: pages that
   continue a box from the previous page, half-visible neighbouring pages at the
   spine, fingers and glare over text.
2. **Scheduling moved from per-day to course-wide.** Answers used to live in each
   day's page and were lost when the tab closed. Now every item is keyed
   `dayNN:id`, intervals depend on answer speed (a right answer after 20 seconds
   is not a known word), and a local server writes progress to files instead of
   only `localStorage`.
3. **A relation graph.** Once all 5,000+ words existed, the next question was
   how they connect. The graph builder starts with plain rules over the book data
   and only uses the model where the rules run out, with a validation pass that
   prefers a missing link over a wrong one.

## Data formats

- `web/data/dayNN.js`: `{ word, pos, zh, example{en,zh}, related[{word,pos,zh}], star, tier, day }`, tiers `core / basic / t800 / t900`.
- `web/data/detail*.js`: per-word notes (meanings, preposition patterns, pitfalls, lookalikes, one-line takeaway). Checked by `extract/check.mjs`.
- `course/data/dayNN.yaml`: see `course/data/_template.yaml`. Anki model ID is fixed once published; changing it makes Anki treat every card as new.
