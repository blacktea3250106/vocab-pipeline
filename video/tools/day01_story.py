#!/usr/bin/env python3
"""SAMPLE story for the synthetic Day 01 (course/data/day01.yaml).

Two short episodes that together use every word of the sample day.
Tom (L, en-US-GuyNeural) and Mia (R, en-GB-SoniaNeural) work in the same office.

Per-turn tuple: (speaker, text, carded_spots, highlights)
  carded_spots  chunk / 800 / 900 words: sidebar card + pronunciation
  highlights    basic words: highlighted in the sentence only
build_story.py checks that every canonical word exists in the day's YAML and
that the realized form literally appears in the line.

    python video/tools/build_story.py --day 01 --tts
"""

SPEAKERS = {"left": "TOM", "right": "MIA"}

S = lambda c, r=None: (c, r or c)

EPISODES = [
    {
        "id": "ep01",
        "title_en": "EP1 · Monday Plans",
        "title_zh": "星期一的計畫",
        "location": "OPEN OFFICE",
        "time": "09:05",
        "status_from": "NO PLAN",
        "status_to": "A PLAN",
        "left_icon": "📅",
        "right_icon": "📊",
        "turns": [
            ("L", "Mia, can we schedule a meeting for Tuesday morning? I put a slot in the calendar.",
             [S("schedule a meeting")], [S("calendar")]),
            ("R", "Sure. Is it about the report? We still have to meet the deadline on Friday.",
             [S("meet the deadline")], []),
            ("L", "Yes. I want to submit a report that finance can approve the budget from.",
             [S("submit a report"), S("approve the budget")], []),
            ("R", "Then we must stay within the budget. Check the agenda in my attachment.",
             [S("stay within the budget"), S("agenda"), S("attachment")], []),
            ("L", "Got it. If I get stuck with the numbers, I will ask a colleague in the office.",
             [S("ask a colleague")], [S("office")]),
        ],
    },
    {
        "id": "ep02",
        "title_en": "EP2 · The Package",
        "title_zh": "包裹",
        "location": "FRONT DESK",
        "time": "13:40",
        "status_from": "WAITING",
        "status_to": "READY",
        "left_icon": "📦",
        "right_icon": "🤝",
        "turns": [
            ("R", "Are you available this afternoon? I have to meet a client at three.",
             [S("be available this afternoon", "available this afternoon"), S("meet a client")], []),
            ("L", "I am free. The courier will deliver a package with your samples before then.",
             [S("deliver a package")], []),
            ("R", "Great. Could you review a draft of my slides while I wait?",
             [S("review a draft")], []),
            ("L", "Happy to. Keep the taxi receipt and finance will reimburse you.",
             [S("reimburse")], []),
            ("R", "I always itemize my expenses, so that part is easy.",
             [S("itemize")], []),
        ],
    },
]
