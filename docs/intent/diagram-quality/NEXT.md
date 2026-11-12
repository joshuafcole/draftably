# Diagram quality: what to work on next

The audit has now run five rounds ([r1](rounds/r1.md), [r2](rounds/r2.md), [r3](rounds/r3.md),
[r4](rounds/r4.md), [r5](rounds/r5.md)). Round 5 reran rounds 1–4 with its own script, so for the
first time the trend is on one scale:

- Corpus mean DI 28.4 → 17.0 → 13.5 → 10.5 → **8.2**. Held-out (the 7 original diagrams)
  25.4 → **5.8**. Examples 39.1 → **12.1**.
- The corpus mean score rose from 2.9 / 2.8 to 3.5 / 3.2 (v0 / follow-ups).
- Lines beside boxes 436 → 105, crossings flat at 29, expectations failed 18 → 11 of 78.
- Round 5 removed round 4's S1 (a return through `push to main`), every pair of labels that read
  as one, off-vertex diamond ports (40 → 12) and every strip over 5:1.
- **It added one corpus S1** (srcly-scan-lifecycle v0: a line drawn on three boxes' sides after a
  group fold) and **one held-out S1** (a diamond's third exit loops through the `no` label).
- **The three new held-out diagrams score 11.1, worse than the corpus (8.2).** They are the honest
  read on what is left: a growing `stress` map, a three-exit diamond, and a request path with a
  store outside its groups.

This is the ranked list of what is left. Each entry gives:

- its cause tag (the rubric's) and severity;
- the evidence from round 5 (`main` at `29128b6`);
- where the cause most likely lives, and an approach;
- the open product questions.

Counts are corpus (45 renders) unless marked. "Held-out" is the 23 held-out renders (14 with a
round-4 baseline, 9 new) and "examples" the 17 bundled examples. Re-measure with
[RUBRIC.md](RUBRIC.md)'s loop before starting, since main will have moved.

## Product decisions already made

These decisions stand unless an entry below argues otherwise, with evidence.

| Decision                                                                                      | PR       | Cost seen in round 5                                                                                                    | Verdict                                                        |
| --------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A theme switch holds rows and order (slots); a downward rank lines up by its top              | #64, #80 | none: release e2, annotations e1 and chess e2 (new) pass `still *` with aligned tops                                    | keep                                                           |
| A relabel widens only the gap that needs it, and promises `still-shape`, not `still *`        | #65, #74 | none by policy: 3/3 corpus and 2/2 held-out relabels pass `still-shape`; add-metric e2 still flips 10 pairs across rows | keep                                                           |
| Growth promises `keeps-order`; flat `layered` keeps the authored in-rank order                | #68, #73 | v2ctx e1 now 0 flips; stress and compound-flow growth still flip (chess e1, tasks e1, ufw e1)                           | keep; extend (item 5)                                          |
| Growth drops a viewer `stay` that went stale                                                  | #76      | none seen: hn-offline e1 13.8 → 6.2, e2 18.7 → 8.7; no stay that still fits was dropped                                 | keep                                                           |
| Returns blocked by a label take the longer side, else enter the target's side face            | #67, #82 | none: release's S1 is gone; the C-shaped arrival reads as drafted                                                       | keep                                                           |
| Chains of groups wrap into rows; aspect cap 5:1 (fold the longest group first, then the root) | #78      | group folds double lines back and leave half the group empty: scan v0 (S1), file-session e2 (worse), ufw e1             | **keep the cap; cost too high for group-first folds** (item 2) |
| A line may cross a title band straight into a member when the way round is over 1.75× longer  | #71      | none seen; long-edge 24 → 14 (with #78); no crossing runs through a title                                               | keep                                                           |
| Diamonds take one edge per vertex; extras go to side vertices                                 | #79      | a third exit takes a free vertex facing away from its target: credit e2 (S1, held-out), reading-flow e1's `no` loop     | **keep for two exits; cost too high for three** (item 4)       |
| Full fans spread at 12px on the facing side; fan siblings may run 10–16px apart               | #79      | uneven-channel 12 → 15 and ragged-bends 11 → 14: 12px and 16px pitches mix in one corridor                              | keep; even the pitch (item 6)                                  |
| A packed group gap widens only where an outside line would run through a label                | #81      | none seen                                                                                                               | keep                                                           |
| Routing channels may cost up to ~10% area; **drop-and-repack is deferred (#72)**              | #66, #72 | unused channels leave lopsided margins (uneven-padding 4 → 5, S3). #72 fixes two renders and doubles compile time       | **deferred** (item 7)                                          |
| A bundle into one side keeps the 16px stagger                                                 | #60, #69 | none seen                                                                                                               | keep                                                           |

### Kept: all ten rebuild engines and the current defaults

The layout and routing evaluation in #372 (72 diagrams, 24 held out, 8,203 trials at `f14d9b8`)
tested whether fewer engines would do. They would not:

- The best six-engine pool (boundary-align, tidy, force, layered, tree, grid) accepted 11, 12, 11,
  10 and 10 of 12 held-out diagrams across five preference profiles. That count assumes a perfect
  choice after seeing every output.
- A selector that picks an engine from graph features accepted only 5, 4, 3, 3 and 3 of 12.
- Compound-spring, compound-flow and flow each won a held-out case that no other engine drew
  well: architecture-05, cycles-06 and routing-06.
- `clearance=22` made 6 of 16 valid held-out drawings invalid. Keep it a Compare alternative, not a
  default.

The study instead led to a smaller editor (#373, #377, #379). Engine choice is out of the routine
panel, and every engine stays in Compare and Exact layout. Before you remove an engine or change a
default, freeze the rule and test it on new held-out diagrams that include lanes and cell routes.

### Deferred trade-off: #72 (drop unused channels and re-pack)

#72 routes each file with channels once more in `quick` mode, drops channel sides no line used,
and lays the scope out again, keeping the result only when routes are no worse. It fixed tasks v0
(Next.js server's empty 40px bottom) and order-pipeline (Fulfilment's unused top channel), held
file-session, web-app and mcp-call where dropping made routes worse, and changed nothing else.
Compile time over the corpus and held-out went 23.9 → 51.2ms per file. The defect it fixes is S3
(uneven-padding 5, padding-varies 3 in the corpus). Revisit when either:

- the router can take a channel's centre line as a waypoint, so channels bind instead of being
  re-packed (no second layout pass), or
- compile time has headroom (an incremental re-pack of only the scopes whose channels changed).

### Kept: Drafting `padding-y=20`

A hand-placed comparison of one daily-plan diagram (TASK-0028 in the planning workspace) found
draftably's 72px two-line nodes airy, against 56px in the reference. Lowering Drafting's
`padding-y` failed the corpus check, measured with
`pnpm audit:compare --base <column-widths layer>` on 10 November 2026:

| `padding-y` | Corpus DI | Held-out DI | Examples DI | `edge-hugs-node` (corpus / examples) |
| ----------- | --------- | ----------- | ----------- | ------------------------------------ |
| 20 (kept)   | 7.9       | 8.9         | 11.1        | 62 / 47                              |
| 16          | 8.3       | 8.8         | 12.5        | 83 / 63                              |
| 12          | 8.4       | 8.6         | 13.9        | 87 / 76                              |

At 12, ten unit tests that pin geometry also failed. One-line nodes shrink from 56 to 40px, but the
router's standoffs and the audit's 15px "beside a box" band are fixed in pixels. Lines then run
close along the shorter sides, and some group folds change (srcly-scan-lifecycle e2: 9.3 → 16.1).
Revisit together with item 6 (corridor pitch): scale standoffs with node height first, then
lower the padding. A file can still set `theme drafting padding-y=10` for a dense drawing.

## 1. Detours that leave the far side and come back under

> **Progress (viewer feedback, 23 October):** a far side now also pays half the route's length
> beyond the gap between the boxes, and arriving on a box's bottom costs 40 (right 12, leaving by
> top or left 12). The new `arrives-below` metric went 10 → 3 in the corpus and hooks 7 → 2;
> `many-bends` rose by 5 per set, the price of entering from the top instead of below. See
> [viewer-feedback-2026-10-23](../viewer-feedback-2026-10-23/README.md).

- **Cause**: `routing-detour`. **Severity**: S2 (17), S3 (4); 7 MISSED.
- **Evidence**: long-edge 24 → 14 and hook 5 → 7. The loops `long-edge` still catches are fewer;
  what remains is shorter loops that enter the target from the side facing away from the source.
  - hn-offline v0/e1: all comments runs under Upstream APIs into HN Firebase from below.
  - kroger e1/e2 (held-out, new): krogerRequest → Cart add leaves its bottom, runs ~450px under
    the server and enters Cart add from below-left. MISSED.
  - chess e1/e2 (held-out, new): PuzzleRunner → Board leaves the runner's left and enters Board
    from below; App.tsx → storage.ts climbs over the whole drawing (~1,300px).
  - reading-flow e1/e2: Online? `no` leaves the left vertex and runs ~1,300px over the drawing.
  - ingest e2: `unchanged` loops round the whole left margin into logs.txt.
  - ufw e1: Flow catalog → ELK runs ~800px under everything. MISSED.
  - v2ctx v0/e1: FFmpeg: extract audio → Parakeet climbs the full height.
  - code-layers v0: `engine tasks` loops under server/ round the left. MISSED.
  - add-metric e1: GET → Client metric store loops under test_metric_catalog.
- **Where**:
  - `find()` / `findIn()` and the side choice in
    [src/engines/routing-engine.js](../../../src/engines/routing-engine.js). Each edge is routed
    alone; the score prices length and bends, and `HOOK_PENALTY` (80) applies only to a route
    that leaves and enters by the same side. An entry into the side facing away from the source
    pays nothing extra.
  - The stress engine (chess, code-layers) places nodes without regard to the routes they force.
- **Approach**:
  1. Add the metric first (see "Metric work"): a line that enters its target from the side facing
     away from its source, without overrunning.
  2. Price a "back-side entry" in the route score like a hook, scaled by how far the line runs
     past the target's facing side, so a crossing or a shared port wins over a loop.
  3. For the reading-flow / credit case, see item 4: the loop comes from the vertex rule.
  4. For stress layouts, try one refinement pass that nudges a node toward the side its long
     line would enter (chess' Board, code-layers' lib/), checked by the same score.
- **Product questions**: Would you rather see one crossing than a loop round the outside? Where is
  the line: one crossing against a loop of 2× the direct length?

## 2. Folding inside groups, and empty quarters at the root

- **Cause**: `group-packing`. **Severity**: S1 (1), S2 (8), S3 (3); 1 MISSED.
- **Evidence**: wide-aspect 1 → 0 (held-out 4 → 0, examples 1 → 0), tight-group-gap 4 → 0,
  empty-area 15 → 16.
  - **scan v0 (S1, worse):** #78 folds Scan services into a column. scan_codebase → discover_files
    runs on ScanJobManager's bottom border and down the left sides of three boxes into
    discover_files' corner; `per file` doubles back left. No metric counts the line on the sides.
  - **file-session e2 (worse, 13.7 → 18.3):** Node server folds into two rows; Save handler
    wraps back left and down to Revision current?, with Folder watcher / SSE between the rows.
  - **ufw e1:** Diagram library folds 2 × 2; Graph parser wraps back left to Graph lint.
  - Root wraps read well: tasks-trpc v0 16.7 → 3.3, order-pipeline 9:1 → 4:1, hn-offline's
    Upstream APIs beside the server.
  - Empty quarters at the root remain: hn-offline v0/e1 (top left), vn-architecture v0/e1
    (Services' top left), hn-deploy e1 (lower left), kroger v0 (Postgres alone top right).
- **Where**: the fold loop near `PACKED_FOLD_ASPECT` in `layoutModel`
  ([src/dsl/compile.ts](../../../src/dsl/compile.ts), "A packed drawing whose run is more than
  …"). It folds the longest group first and wraps the root only when no group can fold. `packed()`
  then lays the folded group out with `foldRanks`, which doesn't know which members' lines leave the
  group.
- **Approach**:
  1. Score the candidates instead of preferring a group fold: lay out (a) the longest group folded
     and (b) the root wrapped, and keep the one with fewer back-runs (lines running against the
     reading direction inside a group) and less empty area. Both layouts already run in the loop.
  2. Fold a group only when its run is a straight chain (each member has one way in and one way
     out). scan's Scan services is a fan (scan_codebase → three), file-session's Node server holds
     a decision; both should wrap the root instead.
  3. For root empty quarters (hn-offline, kroger), extend #78's sink seat to a single node outside
     any group (kroger's Postgres) and to groups whose callers span two ranks.
- **Product questions**: When a long drawing has to wrap, which reads better: wrapping the groups
  as whole rows (a group stays one straight row), or folding inside a group (the drawing stays one
  row of groups)? Round 5's evidence favours the first.

## 3. Labels in gaps with no room

- **Cause**: `label-placement`. **Severity**: S2 (9), S3 (4); 4 MISSED.
- **Evidence**: labels-too-close 13 → 0, label-through-text 15 → 5, label-detached 5 → 5. The
  global pass (#82) places well; the five lines through text and the detached labels sit where no
  spot is clear:
  - decisory e2: the yes-with-context return runs through `cancel pending` (route is three
    segments under 25px).
  - add-metric e2: the Refresh → test line runs through `loaded before render` (label as long as
    its segment).
  - code-layers e2: the packages/cli loop runs through `viewer build`, which belongs to the short
    arrow beside it.
  - file-session e2: the 409 and revision lines run through `recompile` (after the fold).
  - vn-architecture e2: the clip-page line runs through `post markdown` on Clients' border.
  - mcp-call e1/e2 `missing` (56px off), scan e2 `fingerprint` (88px off, beside `thread per
job`).
- **Where**: `placeEdgeLabels` / `shiftedLabel` in
  [src/model/routes.ts](../../../src/model/routes.ts) (placement); `gapRoom` in
  [src/dsl/compile.ts](../../../src/dsl/compile.ts) widens only group gaps with an outside line,
  and `withLabelRoom` only the label's own gap.
- **Approach**:
  1. Feed placement failures back to layout: when `placeEdgeLabels` can't find a spot under cost 3
     (a line through the text), record the edge, and let `layoutModel` widen that edge's gap once
     (one more `arrange`, like stale stays, no loop). This covers root gaps and chains, which
     `gapRoom` skips.
  2. For a label whose own route is too short (decisory, mcp-call), allow it to sit at the source
     end, beside the port, with a 4px leader gap, before falling back to a detached spot.
- **Product questions**: Is a slightly wider gap (up to one label height) acceptable to keep a
  label clear, even in a drawing that was otherwise unchanged by the edit?

## 4. Diamonds with three exits, vertex S-steps, three-sided fans

- **Cause**: `routing-ports`. **Severity**: S1 (1, held-out), S2 (1), S3 (13); 10 MISSED.
- **Evidence**: off-axis-port 40 → 12, uneven-ports 6 → 6.
  - **credit e2 (S1, held-out):** Signature valid? has `yes`, `no` and `expired or failed`. The
    third takes the free left vertex though its target lies right, loops under the diamond and
    runs through the `no` label. Already processed? does the same with `no: grant credits`.
  - reading-flow e1/e2: Online?'s top vertex holds Open app, so `no` leaves the left vertex and
    goes round over the drawing.
  - Vertex S-steps: release v0–e2 (Release PR open → Approve release? steps ~23px), decisory v0,
    reading-flow e1. The diamond's centre sits off its column, so the line steps sideways just
    before the vertex. `jog` counts only steps under 12px. MISSED.
  - Three-sided fans: pgm v0/e2 (server → five stores over top, right and bottom); tasks e1
    (Prisma entered from below twice and from the right).
- **Where**: `vertexClosed` and the side loop in `find`'s candidate scoring in
  [src/engines/routing-engine.js](../../../src/engines/routing-engine.js) ("A diamond's ports sit
  on its four vertices…"); diamond placement within a rank in the layout recipes (centre vs
  column line).
- **Approach**:
  1. Close a taken vertex only while a free vertex **faces the target** (the target lies beyond
     that side). Otherwise share the facing vertex, splitting at the port gap just past the stub.
  2. Centre a diamond on its column's line when its in-edge comes straight down/across, so the
     vertex lines up with the source port (release, decisory).
  3. pgm's five-store fan: the decision's 8px spread is rejected by the rubric; instead stack the
     stores in a column whose height fits five 12px ports, or accept two sides.
- **Product questions**: For a third exit, would you rather share a vertex (two lines leave one
  point, then split) or use a side vertex that faces away (today)?

## 5. Growth and branches still move

- **Cause**: `stability`, `engine-order`. **Severity**: S2 (5 + 4), S3 (2 + 2); 3 MISSED.
- **Evidence**: corpus `keeps-order` 6/8, flips 309 → 274, mean move 163 → 143px. Held-out
  `keeps-order` 5/9.
  - chess e1 (held-out, new, stress): adding GameTrainer reshuffles the right column.
  - credit e2 (held-out, new, flow down): adding two branches reorders the lower half, and
    markCheckoutFailed lands far from its diamond (`near` fails).
  - tasks e1 (compound-flow): GitHub OAuth ~450px from /api/identity; flips.
  - ufw e1 (compound-flow regroup): flips.
  - add-metric e2: the relabel flips 10 pairs across fold rows.
  - hn-offline e2: 3 flips from Upstream shifting under the wider server.
  - scan e1: Analysis cache lands bottom left, fingerprint runs ~700px back.
- **Where**: `layeredTarget` in
  [src/engines/layout-engine.js](../../../src/engines/layout-engine.js) (#73's prior applies only
  to flat `engine=layered` roots); the stress/force refinement; `foldRanks` cut choice for
  flow-down folds.
- **Approach**:
  1. Extend #73's declared-order prior to grouped scopes, ranking each group's members with the
     outside edges as anchors (the reason it was held back), and measure scan, code-layers,
     vn-architecture and hn-offline, which regressed in #73's first try.
  2. For stress/force, seed the refinement from the declared order and stop it when the stress
     gain falls below a threshold, so a new node settles near its neighbours instead of moving
     the column.
  3. In `foldRanks`, keep a new branch with its source band (#75's pull) for flow-down folds too
     (credit e2's markCheckoutFailed).
- **Product questions**: none beyond the standing growth promise.

## 6. Corridors carry mixed pitches

- **Cause**: `routing-clearance`, `routing-order`. **Severity**: S2 (2), S3 (9 + 6); 1 MISSED.
- **Evidence**: uneven-channel 12 → 15, ragged-bends 11 → 14, edge-near-group-border 18 → 14,
  edge-in-slot 8 → 7.
  - code-layers v0: state/'s bottom has two exits 26px apart and a 6px jog (12px fan pitch next to
    a 16px edge gap).
  - node-tree e1/e2: src/'s three trunks turn at two heights.
  - hn-deploy e1: four lines in a 50px gap at 12/16/39/34.
  - kroger e1: router → Postgres and `error toast` both run in the server's top inset.
- **Where**: `slot()`, `fan()` and `TIGHT_PITCH` / `FAN_PITCH` in
  [src/engines/routing-engine.js](../../../src/engines/routing-engine.js); the tidy pass's
  corridor spacing.
- **Approach**: after routing, re-space each corridor (lines within 40px running the same way) to
  one pitch, the smallest any of its fans needs, and align a fan's trunks to one turn line when
  they share a side.
- **Product questions**: none.

## 7. Channels reserved and then unused (deferred)

- **Cause**: `container-fit`. **Severity**: S3 (3); 1 MISSED.
- **Evidence**: uneven-padding 4 → 5, padding-varies 3 → 3. file-session's Node server, mcp-call's
  MCP server (used, so not waste), tasks v0's Next.js server bottom.
- **Where / approach**: see "Deferred trade-off: #72" above.

## 8. Polish

- `palette`: shade ramps above 600 still merge on midnight (srcly-release). vn-architecture's 13
  fills say nothing. ufw's custom brand stays `low-contrast`.
- `routing-order`: regionshot e1's return crosses the wrap.
- `engine-order`: ci-checks e1's Pull request stands above pnpm install.
- All S3.

## 9. From the 23 October viewer feedback: crossings, leaf placement, sibling group order

Three requests from the [deploy walkthrough](../viewer-feedback-2026-10-23/README.md) need layout or
global routing work that the feedback stack did not take on. [FEEL.md](FEEL.md) states the intent.

- **Avoidable crossings** (R6; deploy 08, 09, 11). "It could have gone below this other one."
  Edges are routed one at a time in length order; a crossing is priced (360) when the later edge
  is routed but never repaired. Approach: after routing, for each crossing pair try rerouting
  either edge with the other's route as a hard obstacle on the shared corridor, and keep the
  pair if total cost drops. Measure with `crossings` and DI; watch `many-bends`.
- **A leaf far down the flow** (R7; deploy 11, 10:44). A node with one connection sits ranks away
  from its neighbour to keep the aspect ratio. Approach: in the flow recipes, seat a single-edge
  leaf in its neighbour's rank (beside it) when its own rank is more than one away, unless that
  widens the drawing past the 5:1 cap.
- **Sibling group order** (R8; deploy 13, 12:19). Configuration sat between Per-PR database and
  Operator tools although only Operator tools feeds it. Approach: order sibling groups in a row
  by the barycenter of edges between their members, as `layered` orders nodes, before packing.

## Metric work before the next round

- **A line on a box's own side** (0px): `edge-hugs-node` requires a gap over 0 and
  `edge-through-node` shrinks the box by 2px, so scan v0's S1 counted nothing. Count a run along a
  side at d ≥ 0 (item 2).
- **Back-side entry**: a line that enters its target from the side facing away from its source,
  without overrunning (item 1; 7 MISSED lines: kroger e1/e2, ufw e1, code-layers v0, hn-deploy v0,
  scan v0).
- **Vertex S-step**: a sideways step of 12–30px within one stub of a diamond's vertex (item 4;
  release v0–e2, decisory v0, reading-flow e1).
- **Sides used per fan**: a box whose out-edges to one cluster of targets leave by three sides
  (item 4; pgm, tasks).
- **Back-runs inside a group**: lines between members running against the reading direction, to
  score group folds against root wraps (item 2).
- **Which phase timed out**: in #372, 433 of 452 timeouts finished layout and stalled in routing
  or labels. Compare's 30 s timeout in `src/lib/engine-tasks.ts` does not say which. Time the two
  phases so a dense-route timeout points at the router.
- **Known false alarms to retire:** `left-of external server` (hn-offline v0, now intended by
  #78's sink seat), `left-of build runtime` (hn-deploy fold), `above …` on stress layouts
  (code-layers). Rewrite those expectations or teach the checks about folds and stress.

## Open product questions, together

1. Would you rather see one crossing than a loop round the outside, and where is the line? (item 1)
2. When a long drawing must wrap: wrap groups as whole rows, or fold inside a group? (item 2)
3. May a gap widen by up to a label's height to keep a label clear, even in an otherwise
   unchanged drawing? (item 3)
4. For a diamond's third exit: share the vertex that faces the target, or use a side vertex that
   faces away? (item 4)
5. Channels: when should #72's drop-and-repack come back, or should channels bind the router
   instead? (item 7)
