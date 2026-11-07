---
name: draftably
description: Create, edit, check and render draftably `.draft` diagram files — a readable text DSL for architecture, flow, pipeline, event and container diagrams with automatic layout. Use when the user asks for a diagram, an architecture or system drawing, a flowchart, or mentions a `.draft` file or draftably.
---

# draftably diagrams

A `.draft` file is plain text that compiles to a laid-out diagram. You declare objects, groups
and connections; automatic layout places them. The same file always draws the same picture, so
edit the source, never coordinates you guessed.

Run the CLI with `npx draftably` (or `draftably` if installed globally, or `pnpm draftably`
inside the draftably repo). It needs Node 22.21 or later.

## Workflow

1. **Plan the model.** List the boxes, the containers they belong to, and the connections. Pick
   short stable IDs (`api`, `orders_db`) and human labels (`"Orders DB"`).
2. **Write the file** with declarations first, then edges, then `layout` lines.
   **Diagram text is prose.** The title, subtitle, labels and notes are what a reader sees first.
   Before you render a diagram for other readers, apply the user's writing-style or voice
   guidance to that text, if they have it. Keep the text concrete: name the actual process or
   change ("Orders move to the new queue"), not the document section ("Key flow overview").
3. **Check it:** `npx draftably check diagram.draft`. Fix every `error`; read every `warning`.
   Exit code 1 means errors. Warnings ending in `[edge-through-node]`, `[edge-through-title]`,
   `[node-overlap]`, `[label-collision]` or `[outside-group]` are drawing conflicts. Each names
   the ids, and the refinement line that caused it with a fix ("Remove the pin on line 12, or
   change it to x=140 y=60"). Apply the fix, or remove the refinement, and run `check` again
   until no conflict is left. A conflict with no line means layout could not avoid it: move the
   boxes apart with `near`, or split the group.
   Check several files at once with `check a.draft b.draft` or a folder (one line per file;
   exit 1 if any fails), and add `--quiet` to leave out `info` notes. Every command has `--help`.
   When a box sits in an odd place, `check --hints` shows each refinement's target with its raw
   (layout only) and final position and the distance between them. A large distance means the
   refinement, not layout, put it there.
4. **Let the tool choose the layout.** Don't hand-tune `layout` or `routing` lines.
   `npx draftably vary diagram.draft` tries the layouts that suit the diagram's shape and writes
   `diagram.vary/contact-sheet.png` (one image with every variant, `v0` is the file as it is)
   and a table of crossings, bends, size and warnings. Look at the sheet, pick one (the table
   marks a `recommended` variant), and run `npx draftably vary diagram.draft --apply v2` (or
   `--apply best`). It rewrites only the layout lines and runs `check`.
   To explore a setting yourself, `--try engine=layered --try direction` or `--try
engine=layered,flow --try rank-gap` sweeps exact values (12 at most; `same as v1` means the setting had no effect),
   `--grid` sweeps the main engines in both directions (on a lanes root too, keeping the lanes
   as `v0`; add `--budget 120s` on a large diagram), and `--scope <group>` varies one
   group's layout line. Say what the drawing is for: `--fit slide` (or `wide`, `square`, `page`,
   `tall`) ranks by closeness to that shape, and `--prefer compact` or `--prefer stable` changes
   what wins a tie. When a variant is close, `--from v2` tries small changes around it.
   `vary` also offers to drop refinements that `check` blames for conflicts, to draw change marks
   as panels, and to soften groups (`frame=soft`) for fewer containers.
   **For a crossing** (`check --metrics` warns `Edges a and b cross.`): first put boxes in the order of the
   boxes they connect to (`node` line order or an `order` line), then try
   `--try ordering=stable,crossings` or `--try crossing-penalty=360,900`. Some crossings cannot be
   removed; keep the variant with the fewest.
5. **Look at it.** `npx draftably inspect diagram.draft --svg > diagram.svg` renders a static SVG
   you can open or convert to an image; `--png diagram.png --max-width 2000` saves a PNG sized
   for viewing and prints its pixel size. `npx draftably inspect diagram.draft` prints node and
   route geometry as JSON, useful for spotting overlaps or odd placement without an image.
   **Size it for where it is read.** Most diagrams are read in a page or chat column about
   700–1000px wide. A drawing wider than 2:1 shrinks to fit that column, and its text shrinks with
   it, so `check` warns `[aspect]`. Unless the user asks for a wide drawing, add `fit=slide` to the
   `layout root` line: compile tries folding and both directions and keeps the closest shape.
   Readable text matters more than one avoided crossing.
   **Review before handing over:** `npx draftably check diagram.draft --metrics --fit slide`
   (or the shape the drawing is for) prints size, aspect, crossings and bends, and warns on
   crossings, detours, stranded nodes and an aspect far from the target. Fix what it names, or run
   `vary --fit slide`, and compare the metrics line before and after.
6. **Hand it to the user:** `npx draftably open diagram.draft` serves an editor (default port
   5180, use the URL on its `Viewer:` line). Edits made in the viewer are written back to the
   file, and edits to the file show in the viewer at once. If a viewer already serves the folder,
   `open` prints its URL and exits instead of starting another; `open --status` lists running
   viewers, and `open --replace` restarts one left over from an older version. Run a new one in
   the background; it does not
   exit by itself.
7. **Recover a diagram from an image.** PNG and SVG exports carry their source.
   `npx draftably extract diagram.png` prints it (`--write diagram.draft` saves it), and `check`,
   `inspect`, `format`, `compare` and `open` accept the image in place of the `.draft`. Use
   `--no-source` on `--png`/`--svg` exports when the labels must not travel with the picture.
   **A PDF of several diagrams:** `npx draftably pdf diagrams/ -o diagrams.pdf --title "…"` writes
   one vector page per diagram with its heading and key, a cover with contents, bookmarks, and
   each file's source attached (`--order name|title`, `--page letter|a4|slide`, `--states`). Use
   it instead of joining PNGs with image tools. `check diagrams.pdf` reads the sources back, and
   `diagrams.pdf#name.draft` names one.
8. **Edit by id, not by text.** `npx draftably set diagram.draft node.api label="Orders API" color=teal` changes a declaration (`key=` removes an attribute; `edge.x`, `group.x` work too), `rm diagram.draft cache` removes an object with its edges, refinements and state mentions, and `mv diagram.draft cache store` renames an id everywhere. Each rewrites the file and runs `check`. Prefer them to `sed` or string replacement on labels.
9. **Tidy:** `npx draftably format diagram.draft --write` normalizes the source and keeps
   comments. A `[relaxed]` warning means a `near`, `stay` or `nudge` no longer holds after other
   edits; `format --drop-stale --write` removes those lines.
10. **Move from Mermaid:** `npx draftably migrate docs/` lists the Markdown `mermaid` fences a
    run would rewrite as `draft` fences (flowcharts and sequences only; other charts stay) and
    the importer's warnings. Add `--write` to apply, and `--accept-lossy` for fences with
    warnings. `import chart.mmd --output chart.draft` converts one Mermaid, DOT or D2 file.

## Syntax

One statement per line. Indentation means nothing. Strings use JSON double quotes; escape an
inner quote as `\"` (`node n "Says \"hi\""`), a backslash as `\\`, and a line break as `\n`. IDs match
`[A-Za-z_][A-Za-z0-9_.-]*` and are unique across nodes and groups (edges have their own IDs).
References may point to later lines. Comments start with `#` or `//`.

```text
diagram "Checkout architecture" version=1
subtitle "Orders persist before payment is authorized"

group clients "Customer channels" color=blue
node web "Web app" in=clients
node mobile "Mobile app" in=clients

group platform "Commerce platform" color=mint
node api "API gateway" in=platform
group services "Domain services" in=platform
node orders "Orders" in=services
node payments "Payments" in=services shape=pill

node db "Postgres" color=violet

legend blue "Clients"
legend mint "Our services"
legend violet "Data stores"
legend line solid "Request path"
legend line dashed "Background write"

edge checkout web -> api "HTTPS"
edge native mobile -> api "HTTPS"
edge dispatch api -> orders "create order"
edge charge orders -> payments "authorize"
edge persist orders -> db "persist" kind=async

layout root flow gap=48
layout platform column gap=28
layout services row gap=56
```

| Statement                          | Options                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `diagram "title" version=1`        | Optional, at most one. Exports and the viewer draw the title above the drawing; `width=` widens the frame                                                                                                                                                                                                                                                                                                                      |
| `compare "before" "after"`         | Optional, at most one. Exports draw a marked file as two aligned panels with these labels                                                                                                                                                                                                                                                                                                                                      |
| `subtitle "text"`                  | Optional, at most one. One short line under the title in exports: the takeaway in about 10 words, not a second title or a paragraph                                                                                                                                                                                                                                                                                            |
| `+node`, `-node`, `~node`, `.node` | Change marks (also on `group` and `edge`): added, removed, changed, unchanged context. `~` takes `was="old label"` and `was-at=x,y`; `~node` also takes `was-shape=`, `was-count=` and `was-size=w,h`                                                                                                                                                                                                                          |
| `node id "label"`                  | `in=group`, `color=`, `shade=`, `shape=box\|pill\|circle\|diamond\|text\|marker`, `href=`, `count=N`, cells: `span=N`                                                                                                                                                                                                                                                                                                          |
| `group id "label"`                 | `in=group` (groups nest), `color=`, `shade=`, `frame=box\|soft\|none`, `fold=never` (keep a tall group in one column)                                                                                                                                                                                                                                                                                                          |
| `theme name`                       | Preset look (see below); optional, at most one                                                                                                                                                                                                                                                                                                                                                                                 |
| `legend family "meaning"`          | `shade=`. One entry of the key drawn under the diagram; one per accent color you use. `legend line dashed\|solid "meaning"` explains a line style                                                                                                                                                                                                                                                                              |
| `note "text"`                      | A sentence that never moves layout. `near=id side=below\|above\|left\|right` places it beside an object or sequence message; without `near` it sits under the subtitle and `check` warns `heading-prose`. `width=` (280 default). `note id "text"` gives it an ID a tool can address; `states=a,b` shows it only in those states; `leader=on` draws a line to its object                                                       |
| `footnote 1 "text"`                | An entry in the block under the drawing, above the legend, in file order. The marker is optional; a label points at it as `[1]`. Text in notes and footnotes takes `[label](href)` links, joined to `config link-base=`.                                                                                                                                                                                                       |
| `theme-color family`               | `shade=50..950`, `fill=`, `stroke=`, `ink=`: change a built-in shade or define a new family                                                                                                                                                                                                                                                                                                                                    |
| `edge id source -> target "label"` | Ends are nodes, or a boxed group (the line ends on its frame). Label optional. `kind=async` draws dashed; `from=`/`to=` `auto\|left\|right\|top\|bottom` pick sides; `constraint=false` leaves it out of layout; `head=`/`tail=` `arrow\|none\|triangle\|open-triangle\|diamond\|open-diamond\|circle\|cross` mark its ends; a long label wraps to about 140px and `\n` breaks a line                                          |
| `layout scope flow\|row\|column`   | `gap=8..300`, `direction=auto\|right\|down`, `min-width=`, `min-height=`; flow: `fold=auto\|never`. One `layout` line per scope; a later one replaces it with a warning                                                                                                                                                                                                                                                        |
| `layout group cells`               | The group's nodes touch, edge to edge, under a title band (see Cells). `direction=`, `columns=N` grid                                                                                                                                                                                                                                                                                                                          |
| `layout scope engine=name`         | Layout engine for a scope's whole subtree (see below). Spacing is `node-gap=` and `rank-gap=`, not `gap=`                                                                                                                                                                                                                                                                                                                      |
| `routing ...`                      | Router settings for all connections, e.g. `routing edge-gap=24 clearance=12 standoff=20`. Defaults (range): `clearance` 10 (4–30), `standoff` 20 (0–40), `port-gap` 16 (6–28), `edge-gap` 16 (4–48), `bend-penalty` 32 (0–100), `crossing-penalty` 360 (0–1200), `shared-penalty` 8 (0–20), `parallel-penalty` 18 (0–60), `port-stability` 20 (0–150), `fanout-penalty` 50 (0–160), `passes` 3 (1–5), `corner-radius` 6 (0–16) |
| `phase id "label" ids...`          | Sequence diagrams: listed messages drawn as a labelled row band                                                                                                                                                                                                                                                                                                                                                                |
| `state id "label" ids...`          | Emphasis state: listed nodes, groups and edges in focus, the rest faded; `rest=plain` keeps the rest                                                                                                                                                                                                                                                                                                                           |
| `config key=value ...`             | File settings: `link-base="path"` (where relative links start; a URL such as a pinned `…/blob/<sha>/` joins relative hrefs to it), `editor=vscode\|cursor\|zed\|...`, `strike-removed=on` (strike removed titles through in a diff)                                                                                                                                                                                            |

`scope` is `root` or a group ID. Colors: `auto` (inherit the family of the nearest colored
group), `primary` and `secondary` (the theme's accents), `slate`, `stone`, `blue`, `sky`, `teal`,
`mint`, `green`, `amber`, `orange`, `red`, `rose`, `violet`. `shade=` picks `50` (palest) to `950`
(darkest); a colored node defaults to `500`. Without `layout` lines, `root` uses `flow gap=48`
and groups use `column gap=24`.

Themes: `drafting` (the default), `fieldnotes`, `signal` (color-blind-safe), `ink`, `blueprint`
(dark). A `theme` line may also set `padding-x=`, `padding-y=`, `radius=`, `title-font=sans|serif|mono` and
`annotation-font=`. Padding and fonts change node sizes and so the layout; colors never move
anything. Hex colors go in double quotes (`fill="#405D48"`), since `#` starts a comment.

### Layout engines

`layout root engine=layered direction=down` hands a scope to a layout engine. A setting a layout
line does not take is ignored with a warning that names the right one. Engines:
`compound-flow`, `boundary-align`, `compound-spring`, `tidy`, `stress`, `force`, `flow`,
`layered`, `tree` (`root=nodeId`), `grid`. An engine on `root` arranges everything, except groups
that have their own `layout` line. Useful settings: `node-gap=4..160`, `rank-gap=12..220`,
`group-gap=12..180`, `ordering=stable|crossings`, `fold=auto|never`,
`aspect=1|1.333|1.6|2|0.75`. For a document or slide, add `fit=slide` (or `wide`, `square`,
`page`, `tall`) to the root layout line: compile tries folding and, unless the line sets
`direction=`, both directions, keeps the shape closest to that, and names the choice in an `info`
note. Where the connections leave a choice, file order decides and an
`order` line overrides it (`order root start ask rule ctx` puts `rule` left of `ctx` in their
rank); ids never affect placement.

Good defaults:

- Pipelines and request flows: `layout root engine=layered direction=right` or
  `layout root flow direction=right`.
  A loop's return edge runs backwards; a run longer than the canvas folds into rows, like lines
  of text. Add `fold=never` to keep one long line. Adding or changing edge labels keeps every
  object in its row, so a relabel is safe to make without rechecking the layout.
- Hierarchies and org charts: `layout root engine=tree root=top direction=down`.
- Nested architecture (several container levels): `layout root engine=compound-flow`.
  Reading down, a group much taller than the others folds into columns when that makes the
  drawing smaller (`fold=never` on the group stops it).
  A long chain of groups folds its longest groups, then wraps into rows, so the drawing stays
  within 5:1; `fold=never` keeps one line. A called-only group sits beside its caller.
- A group of peers: `layout groupId row gap=24` or `layout groupId engine=grid`.
- A process with roles: `layout root lanes` makes each top-level group a swim lane (bands,
  `direction=down` for columns). Every node must sit in a lane; steps line up in rank columns
  across all lanes. **Fits** one flow that passes between roles (a request moving from client
  to server to storage). **Doesn't fit** several independent flows: each one crosses every lane
  and the lines tangle. Draw independent flows as groups side by side instead.
- An exchange between participants: `layout root sequence`. Nodes are participants across the
  top; each `edge` line is one message, in file order; `kind=async` for replies. A top-level
  `group` makes a column band of its participants (client, server); it needs a participant, and
  a message ends on a participant, not a group. `order root` places bands and ungrouped
  participants, and `order group` places a band's members. `phase id "label" m1 m2 ...` draws a
  run of consecutive messages as a labelled row band (preview, apply). A phase can't skip a
  message; include it or split the phase. Rows show order, not elapsed time.
  **Fits** the order of calls and replies in one exchange. **Doesn't fit** structure (what
  contains or depends on what) or more than about eight participants; use groups and a flow.
- One object made of parts, or a table: `layout groupId cells` (see Cells). **Fits** a request
  body, a record, a schema. **Doesn't fit** steps that happen in order; those are nodes and edges.
- Several readings of one diagram (a write path, a read path): `state` lines, not separate
  files. **Fits** paths through the same boxes. **Doesn't fit** different structure; that is a
  second diagram. States are interactive; for a document use `inspect --states` or `--state`.

### Cells

`layout groupId cells` turns a group into one object made of parts: the parts of a message in
order, the rows of a table. Its nodes are its cells. They touch and share borders, in declaration
order (or `order`), under a band that holds the group's title. One row by default;
`direction=down` makes one column. `columns=N` makes a grid, such as a table: cells fill rows of N
columns in order, each column as wide as its widest cell, and `span=N` covers N columns. Lines
can end on any cell; a cell inside a grid is reached across the cells around it, ending in a dot.
A cell stays in its place: place the group, not the cell. Reorder cells with `order group id...`.

`shape=marker` marks a seam between two cells, such as a cache point. It takes no room: a bar
cuts the object before the next cell, with its label above. Lines reach it from below.

```text
node client "Agent loop" color=blue
group req "Request" color=slate
layout req cells
node sys "System prompt" in=req
node hist "Conversation so far" in=req
node cp "cache point" in=req shape=marker
node turn "New user turn" in=req color=amber shade=200
node cache "Prompt cache" color=violet
edge build client -> sys "assembles"
edge hit cache -> cp "cached prefix"
```

A database table: one row per column, name and type side by side, so lines reach the row.

```text
group users "users" color=blue
layout users cells columns=2
node users.id "id" in=users
node users.id_t "uuid" in=users
node users.org "org_id" in=users
node users.org_t "uuid" in=users
group orgs "orgs" color=teal
layout orgs cells columns=2
node orgs.id "id" in=orgs
node orgs.id_t "uuid" in=orgs
edge member users.org_t -> orgs.id
```

A byte or bit layout, like a file format or packet header: `unit=byte` or `unit=bit` makes each
column one unit wide, so `span=N` is the field's size. Rows hold `columns=` units (16 bytes or 32
bits by default); a long field runs on into the next row; `span=var` is a field of variable
length with broken sides. A ruler numbers the units (`ruler=off` hides it); `unit-width=` sets a
unit's width.

```text
group tcp "TCP header" color=blue
layout tcp cells unit=bit columns=32 unit-width=26
node sport "Source Port" in=tcp span=16
node dport "Destination Port" in=tcp span=16
node seq "Sequence Number" in=tcp span=32
node options "Options" in=tcp span=var
```

Use cells for "is made of"; use separate nodes and edges for "flows to".

### Refinements

Use these only when automatic layout needs a nudge. Positions are relative to the parent's
content area.

| Statement                                           | Meaning                                                                                                                  |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `near id ref side=right\|left\|above\|below gap=28` | Place beside a sibling, or beside the sibling group holding `ref`, lined up with `ref`. `strength=required` enforces it. |
| `order scope id1 id2 ...`                           | Preferred order of a scope's children.                                                                                   |
| `align x\|y id1 id2 ...`                            | Align sibling centers. `strength=required` locks them.                                                                   |
| `size id width=164 height=56`                       | Requested node size; `height=auto` fits the title; a diamond stays square.                                               |
| `nudge id dx= dy=`                                  | Offset from the automatic position.                                                                                      |
| `pin id x= y=`                                      | Exact position; layout never moves it. Use sparingly.                                                                    |
| `stay id x= y= weight=8`                            | Soft position. The viewer's tools write these; leave them.                                                               |

## Guidance

- Prefer structure over coordinates: groups, `layout` recipes, `order` and `align` survive
  later edits; `pin` and `nudge` do not adapt when content grows.
- A boxed group pads its members and moves as one block. When a group only says "these belong
  together" and its frame makes the drawing bigger or pushes lines across it, write
  `frame=soft`: members lay out with the container around the group and draw on a light tint.
  `frame=none` keeps the membership (and `color=auto`) but draws nothing. A soft group takes no
  `layout`, `near` or `pin` of its own. `check` reports `soft-split` when its members end up apart
  and `soft-overlap` when its tint covers an object outside it; soften leaf groups first.
- Keep labels short (two to four words). Put detail in edge labels or comments, not in boxes.
- Use `kind=async` for events, queues and background work, so sync and async paths read apart.
- Use `directed=false` on an `edge` for an undirected connection. Keep the `->` endpoint
  separator; no arrowhead is drawn. It does not impose a flow/swim-lane rank, but layout engines
  may use it as adjacency. Omission or `directed=true` means the usual directed edge.
  `constraint=false` independently removes it from engine layout. For undirected relationship
  graphs, try `layout root engine=stress`.
- Use `head=` (target end, default `arrow`) and `tail=` (source end, default `none`) only when an
  end means something: `tail=arrow` for a two-way link, `tail=diamond head=none` for composition,
  `tail=open-diamond head=none` for aggregation, `head=open-triangle` for inheritance. `circle` and
  `cross` are the other marks. `head=none` hides the head but keeps a directed relation that ranks
  layout. `check` rejects `head=` or `tail=` on a `directed=false` edge. Crow's feet and cardinality
  don't exist; say them in the edge label.
- A feedback edge (a refetch, a retry back to the start) pulls the section it points at below its
  source. Add `constraint=false` to draw it without letting it rank anything.
- Use color to mean something, not for decoration:
  - Two to four accent families, each for one role (external systems, data stores, the failure
    path), and `slate` or `stone` for everything else. More reads as noise.
  - Give the most common role a pale shade (100–200) and save strong shades for the few
    things that should stand out. `amber` and `orange` at 400–500 are bright fills with dark
    text, good for one highlight.
  - Say what each color means with one `legend family "meaning"` line per accent color; the
    viewer and exports draw them as a key under the drawing. A key that names some colors and
    not others misleads, so give every accent color a row (`check` warns `legend-missing`). The
    swatch is shade 500 unless the line sets `shade=`, so match it to the nodes' shade; `check`
    warns when no node of that family uses it.
  - When dashed (`kind=async`) and solid lines both mean something, say what with
    `legend line dashed "meaning"` and `legend line solid "meaning"` (`check` notes
    `legend-lines` when they are missing).
  - Avoid red next to green and complementary pairs side by side (red and blue, orange and blue)
    unless they encode opposites.
  - Color the outer group and let members inherit (`color=auto`); nested groups of one family
    are drawn in stepped shades. Never give a member its container's family at a pale shade.
  - `check` reports `many-colors` and `color-matches-container`; fix both before handing back.
- To show a change, write one file with both versions merged and mark only the lines that
  differ: `+` added, `-` removed, `~` changed (`was="old label"`, `was-shape=circle`,
  `was-count=2`, with `was-count=1` for one box; `was-at=x,y` and `was-size=w,h` for a box
  that moved or resized, drawn as a ghost where it was), `.` unchanged context. Never
  write two near-identical diagrams for the reader to compare. Marked files draw in change colors
  only, so don't add colors or legend lines to show the change. With two plain versions on disk,
  `draftably compare old.draft new.draft --write diff.draft` writes the marked file and prints
  the change's size (`3 added · 2 lines, 1 changed, 2 removed.`) on stderr, then any
  `Changes with no old version to draw: …`, which both panels show as they are now; say so when
  you hand the diagram back. `compare` writes the `was` words for you. In a sequence, `was-order`
  lists the older message order (`was-order m1 m2 m3`), and it leaves out `+` messages. To mark a
  node that moved
  container by hand, remove the old one as `-node <id>-was ... in=<old>` and add the new one. Add
  `compare "main" "PR 123"` when the reader needs each version whole; leave it out for one merged
  drawing. `direction=right` (rows align) or `direction=down` (columns align) fixes the
  arrangement; by default it follows `aspect=` (1.6).
- Give a diagram that will be shared as an image a `diagram` title naming what it shows and a
  `subtitle` with one short takeaway: one line, about 10 words. The drawing says the rest, so the
  exported picture stands alone. Don't add a paragraph of context; `check` warns
  `heading-prose` on a subtitle that wraps and on a note with no `near=`.
- Add a note only when the drawing cannot say it, and put it beside the object it explains:
  `note "…" near=id side=below`. Never fake one with `node … shape=text`:
  a node takes part in layout and pushes rows and ranks apart. `check` warns `note-overlap` when
  an anchored note has no clear spot; try another side or leave out `near=`. In a sequence,
  `note "…" near=m1` sits level with that message in the right margin; `side=left` takes the left
  margin. Rows are tight, so `side=above` and `side=below` often warn `note-overlap`.
- Put references and detail that would crowd the drawing in footnotes, not in labels or long
  notes: `edge m2 api -> queue "retry later [1]"` with
  `footnote 1 "[#1997](pull/1997) moved retries to the queue."` and
  `config link-base="https://github.com/org/repo/"`. Links in `[label](href)` form are clickable
  in the Editor, SVG and PDF. `check` warns `footnote-missing` when a label points at a marker no
  footnote has.
- Collapse many similar things into one node with `count=42` (drawn as a stack with a `×42` badge)
  instead of drawing each one. For "one per item" with no real number, use a symbol: `count=N`
  draws `×N` (also `count=many`), so no one asks where a made-up number came from.
- When one diagram answers several questions (the write path, the read path, what a PR touches),
  add a `state` line for each instead of drawing several diagrams:
  `state write "Write path" api orders db`. Listed IDs are in focus and the rest fades; a
  connection between two listed nodes is in focus too. `draftably inspect f.draft --svg` takes
  `--state write` to draw one state and `--states` to draw them all side by side. States never
  move anything. `chips=hidden` keeps a state off the Editor's chips and `--states`, for states a
  host steps through itself; `--state` still draws it. `context=a,b` draws those IDs as usual
  between the focus and the fade, for one step of a route shown inside the whole route.
- When a box names real code, a file or a page, link it: `href="src/orders/service.ts"`. Write
  file paths from the repository root (relative links start at the git root of the `.draft`), and
  add `:42` to open at a line. Use the URL as it is for anything on the web, such as a GitHub link.
  If the diagram's paths start somewhere else, set `config link-base="../.."` (relative to the
  `.draft`) instead of rewriting every link. `check` warns about a file link that does not exist
  and suggests the path it probably meant.
- About 5–30 nodes per diagram reads well. Split very large systems into several files.
- When editing an existing file, keep its IDs and any `stay`/`near`/`pin` lines the user's viewer
  edits wrote; add new statements rather than rewriting the file.
- Always run `check` after editing and fix what it reports before handing the file back.
- Not supported yet: views, checkpoints, edge bends, label positions and images. `view`,
  `snapshot` and `box` statements are errors.

The full language guide ships with the CLI package as `DSL.md`: `draftably docs` lists its
sections and `draftably docs legend` prints one. The package's `examples/` folder holds more than
twenty diagrams to copy from.
