#!/usr/bin/env python3
"""Build a Chunk-cued Varied-Practice unit page for any day.

    python3 scripts/build_trr.py 3

Structure:
  Reading Speed   4 different texts sharing the same 40 chunks, cues fading across them
  Dictation       hear the example sentence, rebuild the chunk from word tiles
  Chunk Drill     every chunk, 2 questions each, same-root distractors
  Semantic Drill  one group per ASCII diagram field, distractors from inside the field
  Transfer Test   unseen lower-overlap text, single timed pass

Reads  data/dayNN.yaml + scripts/dayNN_questions.json
Writes output/dayNN/practice.html

YAML is parsed by ruby (macOS ships it) because the source files mix inline
flow-maps with block scalars, which a regex reader cannot handle safely.
"""
import json, re, html, os, sys, subprocess, random

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chunk_parts import split_parts, part_sizes

DAY = int(sys.argv[1]) if len(sys.argv) > 1 else 3
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YAML = os.path.join(ROOT, 'data', f'day{DAY:02d}.yaml')
QJSON = os.path.join(ROOT, 'scripts', f'day{DAY:02d}_questions.json')
OUT = os.path.join(ROOT, 'output', f'day{DAY:02d}', 'practice.html')

def load_yaml(path):
    r = subprocess.run(['ruby', '-ryaml', '-rjson', '-e',
                        f'puts YAML.load_file({path!r}).to_json'],
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'YAML parse failed:\n{r.stderr}')
    return json.loads(r.stdout)

Y = load_yaml(YAML)
Q = json.load(open(QJSON, encoding='utf-8'))

# ── answer-position balancing ────────────────────────────────────────────────
# Authored banks land on option A almost every time — a question set where the
# answer is always first teaches "pick A", not the language. Rotate here rather
# than rewriting hundreds of authored items, and seed it per-question so a
# rebuild always produces the same paper.

def rebalance(item, seed, opts_key='opts', ans_key='ans'):
    o = item.get(opts_key)
    if not o or ans_key not in item:
        return item
    idx = list(range(len(o)))
    random.Random(seed).shuffle(idx)
    item[opts_key] = [o[i] for i in idx]
    item[ans_key] = idx.index(item[ans_key])
    return item

for cid, items in Q.get('chunk_drill', {}).items():
    for n, it in enumerate(items):
        rebalance(it, f'{DAY}|drill|{cid}|{n}')
for f_i, spec in enumerate(Q.get('semantic_drill', [])):
    for n, it in enumerate(spec.get('qs', [])):
        rebalance(it, f'{DAY}|sem|{spec.get("anchor", f_i)}|{n}')
for sid, it in (Q.get('not_questions') or {}).items():
    rebalance(it, f'{DAY}|not|{sid}')
for n, it in enumerate(Q.get('transfer', {}).get('qs', [])):
    rebalance(it, f'{DAY}|transfer|{n}')

CHUNKS = Y['chunks']
STORIES = Y['stories']
PARTS = Y.get('parts') or []
assert len(CHUNKS) >= 4, f'need at least 4 chunks, got {len(CHUNKS)}'
assert len(STORIES) == 4, f'expected 4 stories, got {len(STORIES)}'
PART_CHUNKS = split_parts(CHUNKS)

# ── supplementary: audio index + semantic fields ─────────────────────────────
def field_key(art):
    """Members of one diagram share identical art apart from the ► pointer and
    the ✓/✗ that marks whichever word the card belongs to. Normalising those
    away groups them — matching on the first line breaks on contrast cards,
    whose first line is artwork ("IN PERSON ✓"), not a title."""
    s = re.sub(r'[►✓✗]', ' ', art.lower())
    return re.sub(r'\s+', ' ', s).strip()

SUPP, FIELDS = {}, {}
for tier, items in (Y.get('supplementary') or {}).items():
    for i, w in enumerate(items or []):
        if not isinstance(w, dict) or 'en' not in w:
            continue
        SUPP[w['en']] = {'zh': w.get('zh',''), 'pos': w.get('pos',''),
                         'audio': f'audio/supp_{tier}_{i:03d}_m.mp3'}
        dg = w.get('diagram')
        if dg and dg.get('ascii'):
            F = FIELDS.setdefault(field_key(dg['ascii']),
                                  {'members': [], 'audio': {}, 'art': dg['ascii']})
            if w['en'] not in F['members']:
                F['members'].append(w['en'])
                F['audio'][w['en']] = SUPP[w['en']]['audio']

# reverse index so a question set can name any one member as its anchor
ANCHOR = {m: k for k, F in FIELDS.items() for m in F['members']}

# ── phrase-cue segmentation ──────────────────────────────────────────────────
CUE = {'in','on','at','to','for','with','by','from','of','about','into','through',
       'during','before','after','under','over','and','but','or','so','because',
       'although','while','if','when','since','that','which','who','as','than'}

def mark(text, chunks):
    """Wrap known chunks, then insert sense-group boundaries between them."""
    slots = []
    for c in sorted(chunks, key=len, reverse=True):
        # whole-word, but allow a regular inflection so "colleague" catches
        # "colleagues" while "manage" never eats the front of "managers"
        pat = (r'(?<![A-Za-z])' + re.escape(c).replace(r'\ ', r'\s+')
               + r'(?:s|es|d|ed|ing)?(?![A-Za-z])')
        def sub(m):
            slots.append(m.group(0))
            return f'\x00{len(slots)-1}\x00'
        text = re.sub(pat, sub, text, count=1, flags=re.I)

    out, since = [], 0
    for tok in text.split(' '):
        if not tok:
            continue
        bare = re.sub(r"[^\w']", '', tok).lower()
        if since >= 2 and bare in CUE and '\x00' not in tok:
            out.append('\x01'); since = 0
        out.append(tok); since += 1
        if re.search(r'[,.;:—?!]$', tok):
            out.append('\x01'); since = 0

    s = html.escape(' '.join(out))
    s = s.replace('\x01', '<i class="bd">|</i>')
    return re.sub(r'\x00(\d+)\x00',
                  lambda m: f'<b class="ck">{html.escape(slots[int(m.group(1))])}</b>', s)

def wc(t):
    return len(re.findall(r"[A-Za-z0-9$'-]+", t))

# ── dictation ────────────────────────────────────────────────────────────────
# Hear the example sentence, rebuild the chunk out of scrambled word tiles.
# Tiles instead of a text field: production recall without typing, so it still
# works on a phone. The sentence stays hidden until the answer is in — showing
# it first turns a listening task back into a reading task.

FUNC_POOL = ['to', 'for', 'of', 'in', 'on', 'with', 'at', 'from', 'by', 'about',
             'into', 'the', 'a', 'an', 'up', 'out', 'off', 'over', 'and']
FAM_STOP = {'adj', 'adv', 'prep', 'phr', 'etc', 'and', 'the', 'use', 'used', 'not',
            'that', 'with', 'for', 'from', 'noun', 'verb'}
TOKEN = r"[^\W_]+(?:['’-][^\W_]+)*"

def tokens(s):
    return re.findall(TOKEN, s or '', flags=re.UNICODE)

def family_words(fam):
    """English tokens out of the `family` note. Same-root and near-synonym forms
    make far harder tiles than random function words, and they are already
    authored per chunk — no extra content to write."""
    out, seen = [], set()
    for w in re.findall(r"[A-Za-z][A-Za-z'-]+", fam or ''):
        lw = w.lower()
        if len(lw) < 3 or lw in FAM_STOP or lw in seen:
            continue
        seen.add(lw)
        out.append(lw)
    return out

def blank_span(example, cloze):
    """`example_cloze` carries one hand-authored blank; diffing it against
    `example` recovers exactly which surface form was blanked, so the reveal can
    highlight the right word without re-deriving it by guesswork."""
    i = (cloze or '').find('______')
    if i < 0:
        return None
    pre, post = cloze[:i], cloze[i:].lstrip('_')
    if example.startswith(pre) and example.endswith(post) and len(example) > len(pre) + len(post):
        return len(pre), len(example) - len(post)
    return None

def dictation_item(c, i, unit_id):
    ex = (c.get('example') or '').strip()
    if not ex:
        return None
    answer = tokens(c['chunk'])
    if not answer:
        return None
    low = {w.lower() for w in answer}

    n_dis = 2 if len(answer) <= 2 else 3
    dis = [w for w in family_words(c.get('family', '')) if w not in low][:n_dis]
    for f in FUNC_POOL:
        if len(dis) >= n_dis:
            break
        if f not in low and f not in dis:
            dis.append(f)

    tiles = answer + dis
    rnd = random.Random(f'{DAY}-{c["id"]}-dict')
    for _ in range(6):
        rnd.shuffle(tiles)
        if tiles[:len(answer)] != answer:      # never hand back the answer pre-sorted
            break

    sp = blank_span(ex, c.get('example_cloze') or '')
    sent = (html.escape(ex[:sp[0]]) + '<em>' + html.escape(ex[sp[0]:sp[1]]) + '</em>' +
            html.escape(ex[sp[1]:])) if sp else html.escape(ex)

    return {
        'cid': c['id'], 'unit': unit_id,
        # Play the CHUNK, not the example sentence. Half the chunks do not appear
        # verbatim in their own example ("a job opening" vs "several job
        # openings"; "apply for a position" vs a sentence with no "apply for" at
        # all), so playing the sentence asked the learner to rebuild something
        # they had not actually heard. The sentence still gets played, but only
        # after the answer is in, as context.
        # Guy carries most of it, Sonia every third item.
        'audio': f"audio/chunk{c['id']}_{'f' if i % 3 == 2 else 'm'}_chunk.mp3",
        'exAudio': f"audio/chunk{c['id']}_m_ex.mp3",
        'chunkAudio': f"audio/chunk{c['id']}_m_chunk.mp3",
        'chunk': c['chunk'], 'answer': answer, 'tiles': tiles,
        'sent': sent, 'zh': c.get('meaning_zh', ''), 'exZh': c.get('example_zh', ''),
        'grammar': c.get('grammar', ''),
    }

# ── units ────────────────────────────────────────────────────────────────────
UNITS = []
for i, st in enumerate(STORIES):
    part = PARTS[i] if i < len(PARTS) else {'icon':'📘','name':f'Unit {i+1}','color':'#4a6fa5'}
    unit_chunks = PART_CHUNKS[i]
    turns = st.get('turns') or []
    text = ' '.join(t['text'] for t in turns) if turns else ' '.join(
        l.strip() for l in st.get('text','').split('\n') if l.strip())
    sc = st.get('story_chunks') or []

    cued = ([{'sp': t.get('speaker',''), 'html': mark(t['text'], sc)} for t in turns]
            if turns else [{'sp': '', 'html': mark(text, sc)}])

    qs = st.get('questions') or []
    for n, q in enumerate(qs):
        rebalance(q, f'{DAY}|story|{st["id"]}|{n}', 'options', 'correct')
    by = lambda *ts: [q for q in qs if q.get('type') in ts]
    p2 = (by('main_idea')[:1] + by('detail')[:1] + by('vocab')[:1]) or qs[:3]
    used = {q['q'] for q in p2}
    p3 = [q for q in qs if q['q'] not in used][:2]
    nq = Q.get('not_questions', {}).get(st['id'])
    if nq:
        p3.append({'q': nq['stem'], 'options': nq['opts'], 'correct': nq['ans'], 'type': 'not'})

    dictation = [d for d in (dictation_item(c, k, st['id']) for k, c in enumerate(unit_chunks)) if d]

    drill = []
    for c in unit_chunks:
        # qid identifies the question, not the chunk. A chunk carries two drill
        # questions and the log only ever stored the cid, so "what did I get
        # wrong" could not tell them apart — it could only say which chunk was
        # involved. Stable across rebuilds because it is positional.
        for k, item in enumerate(Q['chunk_drill'].get(c['id'], [])):
            drill.append({**item, 'cid': c['id'], 'qid': f"{c['id']}:{k}",
                          'chunk': c['chunk'], 'zh': c.get('meaning_zh',''),
                          'audio': f"audio/chunk{c['id']}_m_chunk.mp3",
                          'grammar': c.get('grammar','')})

    UNITS.append({
        'id': st['id'], 'icon': part['icon'], 'name': part['name'], 'color': part['color'],
        'title': st.get('title',''), 'format': st.get('format','monologue'),
        'words': wc(text), 'cued': cued, 'p2': p2, 'p3': p3,
        'dictation': dictation,
        # Same story, same question bank, but by ear and with no transcript on
        # screen — so listening and reading comprehension are measured on
        # identical items instead of on two different tests.
        'boss': {
            'audio': ([f"audio/story_{st['id']}_{i:02d}.mp3" for i in range(len(turns))]
                      if turns else [f"audio/story_{st['id']}_m.mp3"]),
            'qs': qs,
        },
        'drill': drill,
        'chunkList': [{'id': c['id'], 'chunk': c['chunk'], 'zh': c.get('meaning_zh',''),
                       'audio': f"audio/chunk{c['id']}_m_chunk.mp3"} for c in unit_chunks],
        'fields': [],
    })

# ── semantic drill: attach authored questions to the auto-extracted fields ───
missing = []
for spec in Q.get('semantic_drill', []):
    a = spec.get('anchor')
    F = FIELDS.get(ANCHOR.get(a, ''))
    if not F:
        missing.append(a or spec.get('title')); continue
    spec['members'] = F['members']
    spec['audio'] = F['audio']
    spec.setdefault('title', ' / '.join(F['members'][:3]))
    # Every answer is logged under `cid` and the review schedule ages that key.
    # Semantic questions used to carry none, so the 128 supplementary words a
    # day were answered but never scheduled: nothing could bring them back.
    # The anchor names the field and is stable across rebuilds, so it is the key.
    for k, it in enumerate(spec.get('qs', [])):
        it['cid'] = 's_' + (a or spec['title'])
        it['qid'] = it['cid'] + ':' + str(k)
for n, spec in enumerate([s for s in Q.get('semantic_drill', []) if s.get('members')]):
    UNITS[n % 4]['fields'].append(spec)

TRANSFER = dict(Q['transfer'])
TRANSFER['words'] = wc(TRANSFER['text'])
TRANSFER['paras'] = [html.escape(p) for p in TRANSFER['text'].split('\n') if p.strip()]

DATA = {'day': DAY, 'themeEn': Y.get('theme_en',''), 'themeZh': Y.get('theme_zh',''),
        'icon': Y.get('day_icon','📘'), 'units': UNITS, 'transfer': TRANSFER}

tpl = open(os.path.join(ROOT, 'scripts', 'trr_template.html'), encoding='utf-8').read()
out = tpl.replace('/*__DATA__*/', json.dumps(DATA, ensure_ascii=False))
out = out.replace('__TITLE__', f"Day {DAY:02d} · {Y.get('theme_en','')} · Practice")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
open(OUT, 'w', encoding='utf-8').write(out)

# ── review bank ──────────────────────────────────────────────────────────────
# Only items carrying a cid can come back on a later day: the schedule ages a
# chunk, not a question, so an item with no key behind it has nothing to age.
# Written per day and merged by build_bank.py, so a page opened on Day 21 can
# still ask a Day 03 question it has no data for of its own.
ITEMS = []
for u in UNITS:
    for d in u['dictation']:
        if d.get('cid'):
            ITEMS.append({'kind': 'dict', 'unit': u['id'], 'q': d})
    for q in u['drill']:
        if q.get('cid'):
            ITEMS.append({'kind': 'drill', 'unit': u['id'], 'q': q})
    for f in u['fields']:
        # The field map travels with the question: without it a semantic item
        # pulled up weeks later has four plausible options and no context.
        field = f['title'] + '\n' + '\n'.join('  · ' + m for m in f['members'])
        for q in f['qs']:
            if not q.get('cid'):
                continue
            # Carry the answer word's audio, not the anchor's: a word reviewed
            # weeks later has to be heard, and the answer is the word the item
            # is actually teaching.
            ans_word = q['opts'][q['ans']] if q.get('opts') else ''
            ITEMS.append({'kind': 'sem', 'unit': u['id'],
                          'q': {**q, 'field': field,
                                'audio': (f.get('audio') or {}).get(ans_word, '')}})

ITEMS_OUT = os.path.join(ROOT, 'output', f'day{DAY:02d}', 'items.json')
json.dump({'day': DAY, 'theme': Y.get('theme_en', ''), 'icon': Y.get('day_icon', '📘'),
           'items': ITEMS}, open(ITEMS_OUT, 'w', encoding='utf-8'), ensure_ascii=False)

tot_drill = sum(len(u['drill']) for u in UNITS)
tot_sem = sum(len(f['qs']) for u in UNITS for f in u['fields'])
tot_read = sum(len(u['p2']) + len(u['p3']) for u in UNITS)
tot_dict = sum(len(u['dictation']) for u in UNITS)
print(f'✓ {OUT}')
print(f'  reading Q  : {tot_read}')
print(f'  dictation  : {tot_dict}   (expect {len(CHUNKS)})')
print(f'  chunk drill: {tot_drill}   (expect {len(CHUNKS) * 2})')
print(f'  semantic   : {tot_sem} across {sum(len(u["fields"]) for u in UNITS)} fields')
print(f'  transfer   : {len(TRANSFER["qs"])} Q / {TRANSFER["words"]} words')
print(f'  TOTAL      : {tot_read + tot_dict + tot_drill + tot_sem + len(TRANSFER["qs"])}')
for u in UNITS:
    print(f'   · Unit {u["id"]} [{u["format"]:9s}] {u["words"]:3d}w  dict {len(u["dictation"])}  '
          f'drill {len(u["drill"])}  sem {sum(len(f["qs"]) for f in u["fields"])}')
noex = [c['id'] for c in CHUNKS if not (c.get('example') or '').strip()]
if noex:
    print(f'  ⚠ chunks with no example (no dictation item): {noex}')
if missing:
    print(f'  ⚠ semantic fields not found in yaml: {missing}')
gaps = [c['id'] for c in CHUNKS if len(Q['chunk_drill'].get(c['id'], [])) < 2]
if gaps:
    print(f'  ⚠ chunks with fewer than 2 questions: {gaps}')

# The review queue reads bank.js, not this day's page. Rebuilding it here means
# a newly built day is reviewable immediately instead of on the next time
# someone remembers to run build_bank.py by hand.
print()
sys.stdout.flush()      # otherwise the child's output lands above this day's
subprocess.run([sys.executable, os.path.join(ROOT, 'scripts', 'build_bank.py')], check=True)
