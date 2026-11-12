# Diagram quality audit: rubric and loop

Goal: measure how good draftably's drawings look for real software-explanation diagrams, both
the **first render** and **after a few follow-up requests**, then fix the biggest defects and
measure again. The corpus stays fixed across rounds so results compare.

**Where things stand:** five rounds ran ([r1](rounds/r1.md), [r2](rounds/r2.md),
[r3](rounds/r3.md), [r4](rounds/r4.md), [r5](rounds/r5.md)). Round 5 reran every earlier round
with its script: corpus mean DI 28.4 → 8.2 over five rounds, held-out 25.4 → 5.8.
[FEEL.md](FEEL.md) says what good looks and feels like; it is the tie-breaker when a metric and the eye disagree. [NEXT.md](NEXT.md) is the ranked list of remaining issues, with evidence, code locations,
approaches and open product questions. Start there.

Three signals, each doing one job:

| Signal                              | Answers                                      | Source                          |
| ----------------------------------- | -------------------------------------------- | ------------------------------- |
| **Defect ledger**, tagged by cause  | What is wrong, and which fix would remove it | Reviewer, seeded by the metrics |
| **Pairwise verdict** vs. last round | Did this round's change help this render?    | Reviewer, on `compare-*.png`    |
| **Metrics + checked expectations**  | How much, objectively; was the request met?  | `scripts/diagram-audit.mjs`     |

One overall 1–5 score per render gives a coarse trend line. It is not broken into dimensions:
one scorer giving nine scores across 45 renders drifts more than it informs. The dimension table
below is a checklist for finding defects, not a scoresheet.

## The loop

1. **Generate**: write each corpus diagram as `corpus/<slug>/v0.draft`, the way an agent would
   on a first request: declarations, edges, one `layout` line, no refinements.
2. **Follow up**: apply two follow-up requests as `e1.draft` and `e2.draft`. `requests.md`
   records each request word for word. Each file states what the request should achieve in
   `# expect` lines (below). Some follow-ups go through the viewer (see "Viewer follow-ups").
3. **Measure**:

   ```bash
   node scripts/diagram-audit.mjs docs/intent/diagram-quality/corpus tmp/audit/rN --baseline tmp/audit/rN-1
   ```

   This writes per-diagram `metrics.json`, PNGs, `sheet.png` (v0 | e1 | e2), `compare-<v>.png`
   (last round | this round) and `summary.md` (with each render's previous defect index).

4. **Review**: for each render, start from its metric issues, look at the image, and write the
   defect ledger. Give the pairwise verdict from the compare sheet, then the overall score.
5. **Triage**: count ledger entries by cause tag, weighted by severity. Pick the top three to
   five causes.
6. **Fix**: change the engine, defaults or skill guidance. Never edit the corpus to dodge a
   defect: the corpus is the test.
7. **Held-out check**: write two or three fresh diagrams (new repo areas, same rules) and run
   them once with the fix. They join `heldout/` and are never tuned against. If the corpus
   improves but held-out renders don't, the fix was overfitted.
8. **Repeat** from step 3.

**Metric versions.** The defect index is only comparable when both rounds ran the same script.
When the script changes, re-run the previous round's code with the new script before comparing:
`pnpm audit:compare --base <that round's commit>` does this for the corpus, the held-out set and
the examples (add `--shots` if you also need its images).

## Corpus rules

- 10–15 diagrams, 5–20 objects each, drawn from real repositories on disk (see
  [CORPUS.md](CORPUS.md)).
- Spread across kinds: architecture, request flow, user flow, build/CI pipeline, release
  process, state/lifecycle, data pipeline, dependency map, hierarchy.
- Spread across layouts: `flow` right/down, `layered`, `compound-flow`, `tree`, `grid`,
  `stress`, `force`, and default (no layout line). Mix groups: none, one level, nested.
- Write v0 as a typical agent would: no `near`/`order`/`pin`. Labels two to four words.
- Vary color on purpose, so the audit covers both control and taste. Across the corpus use every
  preset theme (`graphite`, `fieldnotes`, `signal`, `mulberry`, `midnight`) and these color
  strategies, roughly evenly:

  | Strategy      | What the source does                                                    |
  | ------------- | ----------------------------------------------------------------------- |
  | none          | No `color=` at all; theme neutrals only                                 |
  | by group      | One family per group, members `auto`                                    |
  | semantic      | Color marks a role (error path red, external systems slate, data amber) |
  | shade ramp    | One family, `shade=` steps along the flow (100 → 800)                   |
  | accent        | Neutral everywhere, one or two `primary` highlights for the main path   |
  | custom brand  | `theme-color` defines a new family or overrides a built-in shade        |
  | many families | Six or more families, to see where it turns noisy                       |

- Follow-up requests are the kinds users ask for, applied as an agent would apply them:

  | Kind     | Example request                           | Source edit                               | Typical `# expect`                     |
  | -------- | ----------------------------------------- | ----------------------------------------- | -------------------------------------- |
  | grow     | "Add the cache between API and DB"        | new `node` + rewired `edge`s              | `near cache api 120`                   |
  | branch   | "Show what happens when the check fails"  | new node, back/side edge                  | `below fail check`                     |
  | relabel  | "Label the arrows with what flows"        | edge labels added or lengthened           | `still-shape *`, `keeps-order`         |
  | regroup  | "Put the workers in their own box"        | new `group`, `in=` changes                | `near workers queue 120`               |
  | place    | "Move the DB under the API"               | `near`, `order` or `align`                | `below db api`                         |
  | relayout | "Make it read top to bottom"              | `direction=` or `engine=` change          | `order-y a b c`                        |
  | recolor  | "Make the failure path red", "dark theme" | `color=`/`shade=`, `theme`, `theme-color` | `still *` (color never moves anything) |

### Checked expectations

A follow-up's request and the diagram's declared intent are written as comments, so the script
can check whether they were met:

```text
# expect left-of a b       # also right-of, above, below (a relative to b, no overlap)
# expect order-x a b c     # centers run left to right; order-y for top to bottom
# expect reads-x a b c     # reading order like text: right along a row, or back and down to the
                           # next row; most steps must go along (reads-y: down columns)
# expect aligned-x a b     # centers within 4px; aligned-y
# expect near a b 80       # gap at most 80px
# expect still a b         # moved at most 24px since the previous version; `still *` for all
# expect still-shape *     # moved at most 24px once each band's own shift along the reading
                           # direction is removed: a relabel widens a gap and slides what follows
# expect keeps-order       # no two old objects swapped sides (growth may push things aside)
# expect back-edges 0      # at most this many edges against the reading direction
```

Group IDs work as well as node IDs. Put the reading-order expectation on `v0` too. Each failed
expectation is an `expectation-failed` issue.

Each `still` is also checked with the drawing's median shift removed, and the summary's
**Follow-ups** table counts both: a `still` that fails raw but passes after the shift is a drawing
that slid as a whole (a wider title moved the origin) and kept its shape; one that fails both
changed shape. Only the raw check counts as a defect. The table also gives `keeps-order` passes,
the mean move over follow-ups and the total order flips.

A relabel promises `still-shape *` plus `keeps-order`, not `still *` (round 5). A label that no
longer fits widens only the gap that needs it, so everything past that gap slides along the
reading direction. `still-shape` groups the previous version's boxes into rows (split by a clear
gap across the reading direction, as a fold makes) and, within a row, bands (boxes whose spans
along the reading direction overlap). It removes each band's median shift along the reading
direction and the drawing's median shift across it, then checks that nothing moved more than
24px. A group follows its first member's band at its start and its last member's at its end.

### Viewer follow-ups

Agents edit source, but people drag things in the viewer. A drag writes `near` and soft `stay`
anchors, and growth afterwards should make room around the anchored regions. For about a third of
the corpus, make one follow-up through the viewer:

1. `pnpm draftably open corpus/<slug>/e1.draft` (copy v0 first), drag one or two objects the way
   a person tidying the drawing would, and let it save.
2. Copy the saved file to `e2.draft` and apply a grow request there as source edits.
3. In `requests.md`, record what was dragged and where. Add `# expect still *` to e2 for the
   objects that existed before (anchored regions should hold).

This is the only way to test the `stay` path.

## Automatic metrics (scripts/diagram-audit.mjs)

Hard defects (should be zero): **node-overlap**, **edge-through-node** (an edge crosses an object
it does not connect), **clipped** (a route or label outside the exported drawing).

Label defects: **label-on-node**, **label-near-node** (within 6px of a box it doesn't cover, so it reads
as the box's; added after the 23 October viewer feedback), **label-overlap**, **label-through-text** (another edge runs through the label's text: a reader
can take the label for that line's, S1), **label-on-edge** (another edge runs only under the
label's padding), **labels-too-close** (two labels on different edges closer than a label's height:
they read as one phrase, or as two labels on one edge), **label-detached** (label farther than its own height from its edge),
**label-beside-line** (label clear of its own line, though near it: labels read as one set when
each line runs through its own),
**label-on-group-title**, **label-on-group-border**.

Routing: **crossings**, **bends per edge**, **many-bends** (≥ 4), **hook** (a U-turn: the line
overruns its target and arrives in the side facing away from the source, as into a box's bottom
from a source above it; or it leaves one way and comes back the opposite way into a box that
doesn't share the exit's span. A C down a channel into the facing side of a box in the same
column or row reads as drafted and doesn't count, nor does a fold's wrap or a return lane that
arrives along the reading direction into a box's leading side), **shared-segment**
(unrelated edges run along the same line), **edge-through-group** (an edge cuts through a group
holding neither end), **edge-through-title-band** (a line enters a group's title band. Two
crossings don't count: straight into or out of a top member, and, since round 5's decision 3, a
line to or from any member that crosses the whole band straight across, clear of the title text,
which the router allows when going round the group would be over 1.75× longer. A line running
along the band, through the title, or to something outside the group still counts),
**arrives-below** (the last run climbs into the target's bottom although the source does not sit
below it: reads as backwards; added after the 23 October viewer feedback), **back edges** (against the reading direction; an edge that wraps onto the next row of a folded
flow reads forward and doesn't count).

Clearance (can a reader tell which line is which?): **edge-hugs-node** (a line runs alongside a
box, under 15px from its side, for more than 16px, including a box it connects; this catches the
U-turn hooks and lines squeezed between stacked boxes), **edges-too-close** (two lines run side
by side 2–10px apart; exactly on top of each other is **shared-segment**),
**edge-on-group-border** (a line runs along a group's border, under 8px from it), and
**edge-near-group-border** (a line rides a group's border 8–15px inside or outside it, the same
distance that counts as a hug on a box), and **edge-in-slot** (a line runs inside a group between
one of its members and its border, under 24px from both: the inset round a group's members is no
channel). Only parallel runs count; a line crossing a border or
entering a box is fine.

Orderliness (does the routing look drafted on purpose?): **uneven-channel** (three or more lines
sharing a corridor, within 40px of each other and overlapping, are spaced at different pitches),
**ragged-bends** (edges fanning out of one side of a node, or into one side, turn at different
places instead of sharing a trunk; a bundle whose turns step by exactly the edge gap, 16px or the
file's `edge-gap`/`port-gap`, is the accepted stagger and doesn't count), **uneven-ports** (the ports on a side sit lopsided about its
centre; a symmetric bunch around the middle is fine; ports on a diamond's slanted faces aren't on a
side; `off-axis-port` counts those), **off-axis-port** (with a declared `direction`, a forward edge arrives sideways, as into a
child's side in a downward tree, or leaves against the direction; on a diamond, any line that meets it off its four vertices, or
leaves or enters a vertex sideways), **jog** (a tiny step under 12px inside a
route). The target is a skilled draftsman's look, not bundling: common gaps, bends taken at the
same place, symmetric fans.

Container fit: **uneven-padding** (a group's left, right and bottom padding differ by more than
12px) and **padding-varies** (groups in one drawing use different padding). The top holds the
title, so it is only compared across groups. Fitting must converge: a fix may not loop between
parent size and child placement.

Group packing (how members sit inside a group, and groups beside each other): **sparse-group**
(a group's members cover under 35% of the area they span: two boxes at opposite ends of a wide
frame), **group-staircase** (inside a group, a chain link, a member with one way on to a sibling
with one way in, whose ends sit diagonally: neither their starts, centres nor ends line up on
either axis and they are more than 16px apart on both; a fan out of one member may spread
diagonally. Also three or more sibling groups whose centres step monotonically on both axes),
**tight-group-gap** (a group and the nearest sibling straight across from it, group or box, are
under 16px apart) and **uneven-group-gap** (facing gaps of up to 160px between sibling groups in
one drawing differ by more than 16px). `metrics.json` records each group's fill (`groupFill`)
and each facing gap (`groupGaps`).

Text: **mid-word-wrap** (a node or group title wraps inside a word, as `annotationCommand / s`,
rather than at a space or where an identifier's parts meet, or strands one or two characters
after a break, as `installed / ?`; a short word wrapped at a space is not counted).

Space: **empty-band** (a row or column gap over 120px with nothing in it); **empty-area** (the
largest empty rectangle among the boxes and edge labels, at least 160px on each side, covers over
15% of the drawing and has room for 11 or more of its average boxes: a quarter left empty. A group
frame with nothing inside counts as empty; the box count keeps a small flow's natural corners
out); **wide-aspect** (the drawing is wider or taller than 5:1); **long-edge** (a line over 400px
that runs more than twice the gap between its two boxes, a detour, or a forward line longer than
0.6 of the drawing's diagonal; a return or a fold's wrap counts only when longer than the
diagonal). Also aspect ratio, density (object area / drawing area), and the share of objects
aligned with another. `metrics.json` records the hole (`emptyArea`) and each long line's ratios
(`edgeStretch`).

Color: **low-contrast** (label text under 4.5:1 on its fill, or connections under 3:1 on the
canvas), number of distinct fills, minimum text contrast, theme.

Follow-ups: **expectation-failed**; mean / max movement of objects present in both versions;
how many moved more than 24px, before and after removing the median shift (a drawing that slid
as a whole kept its shape); **order flips** (pairs whose left/right or above/below order
swapped).

**Defect index (DI)** = weighted defect count per 10 edges: overlap 10; clipped, edge-through-node
8; label on node, label overlap, label through text 6; expectation failed 4; hook, shared segment, label on edge,
detached, on title, empty area 3; edge-through-group, edge-through-title-band, empty band, low contrast, edges too close, labels too
close, wide aspect 2; crossing, edge hugs node (per line and box), many
bends, long edge, group border (label or edge), edge in slot, uneven channel, ragged bends, uneven ports, off-axis port, jog, mid-word wrap 1;
uneven padding, padding varies, tight group gap 2; sparse group, group staircase (per link), uneven group gap 1;
back edge 0.5. Lower is better. It ranks and tracks; the ledger explains.

## Review

Look at each render at the size a reader would see it (`v0.png`, not the sheet), with its issue
list from `metrics.json` open. Zoom in on a spot with `pnpm shoot <slug>/v0.png tmp/zoom.png --crop
x,y,w,h` (in the PNG's pixels) rather than judging spacing from a scaled-down view.

### Checklist

Use these to find defects. Each finding becomes a ledger line.

| Area          | A clean render                                                  |
| ------------- | --------------------------------------------------------------- |
| Reading path  | Start and end obvious; follows the declared direction           |
| Edge routing  | Straight or one clean bend; no U-turns, no lines through things |
| Edge labels   | Each label on its own edge, clear of lines, boxes and borders   |
| Grouping      | Groups tight, members aligned, edges enter groups cleanly       |
| Spacing       | Even gaps, siblings aligned, sensible aspect, no dead zones     |
| Intent        | `direction`, `order`, `near` and groups land as the source asks |
| Color         | Color carries meaning, one palette, crisp text, theme fits      |
| Color control | A recolor lands exactly where asked and nothing else moves      |
| Follow-up     | The edit shows up where expected; the rest holds still          |

Color questions that need an eye: does `auto` inheritance do what the author expected, do groups
and members separate, do labels and connections stay legible on dark themes, does a shade ramp
read as an order, and how many families before it gets noisy.

### Defect ledger

One line per defect a reader would notice:

```text
<render> | <severity> | <cause> | <what a reader sees> | <metric that caught it, or MISSED>
```

- **Severity**: `S1` misleading or unreadable (wrong edge owns a label, clipped content, overlap);
  `S2` a reader notices and slows down (hook, detached label, lost reading order); `S3` polish
  (uneven gap, one extra bend).
- **Cause tags**: `label-placement`, `routing-ports`, `routing-detour`, `export-bounds`,
  `engine-order`, `engine-spacing`, `routing-clearance`, `routing-order`, `container-fit`, `group-packing`, `recipe-default`, `theme-metrics`,
  `palette`, `stability`, `dsl-gap`, `skill-guidance`. Add a tag when none fits, and list it in
  the round summary.
- `MISSED` marks a defect no metric counted. Two or more MISSED lines of the same kind in a round
  means the script needs a new metric before the next round.
- Metric issues that aren't real problems go under **False alarms**, so the metric gets fixed.

### Pairwise verdict and score

- **Verdict** (round 2 on), from `compare-<v>.png`: `better`, `same` or `worse` than the last
  round, with the reason in a few words. Any `worse` needs a ledger line tagged with its cause.
- **Score** 1–5: 5 = would ship in docs as is; 3 = readable but a reader notices problems;
  1 = misleading or unreadable.

## Round record (rounds/rN.md)

```text
## <slug> (<kind>, <layout>, <color strategy> / <theme>, N nodes)
v0  3  DI 17.9   verdict: better (labels now on their edges)
e1  3  DI 19.3   verdict: same      expect 1/2
e2  2  DI 29.3   verdict: worse (new hook staging → smoke)   expect 2/3

v0 | S2 | engine-order    | browser group sits right of the API it calls | expectation-failed
e2 | S1 | export-bounds   | "start scan" cut off at the left edge        | clipped
e2 | S2 | label-placement | "fingerprint" 124px from its edge            | label-detached
False alarms: …
```

Round summary:

- Mean score for v0 and for follow-ups.
- Mean DI, issue totals, and expectations met.
- Verdict counts (better / same / worse).
- Held-out result.
- Ledger totals by cause × severity.
- The causes chosen for the next fix, with the evidence.
