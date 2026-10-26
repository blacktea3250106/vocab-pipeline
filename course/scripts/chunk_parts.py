"""How a day's chunks split into the four Part A–D units.

The book does not hand out a fixed number of numbered headwords per day — Day 21
has 42, Day 04 has 44 — but the build used to slice `CHUNKS[i*10:(i+1)*10]` and
assert exactly 40. That assert is why every yaml was trimmed to 40 and words like
`contrary` / `disturbing` / `externally` never made it in.

Both builders import `split_parts` so chunks.html and practice.html always agree
on which unit a chunk belongs to; two different ceil-divisions would file the same
chunk under Part A on one page and Part B on the other.
"""

N_PARTS = 4


def part_sizes(n, n_parts=N_PARTS):
    """Contiguous, as-even-as-possible group sizes, remainder to the front.

    40 -> [10, 10, 10, 10]   (unchanged, so existing days rebuild identically)
    42 -> [11, 11, 10, 10]
    44 -> [11, 11, 11, 11]
    """
    if n <= 0:
        return [0] * n_parts
    base, rem = divmod(n, n_parts)
    return [base + (1 if i < rem else 0) for i in range(n_parts)]


def split_parts(chunks, n_parts=N_PARTS):
    """Slice `chunks` into `n_parts` contiguous lists using `part_sizes`."""
    out, at = [], 0
    for size in part_sizes(len(chunks), n_parts):
        out.append(chunks[at:at + size])
        at += size
    return out
