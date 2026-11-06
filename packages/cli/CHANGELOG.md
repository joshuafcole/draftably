# draftably

## 0.11.0

### Minor Changes

- d31241d: The editor selects, edits in place and saves every piece of canvas text: sequence message labels, notes, legend rows, phase labels and soft group titles. Drag a note beside another shape, container or message to move it; the file gets its new near= and side=.
- a337f9d: The editor shows the open file's .draft source in a Source tab beside the canvas. It follows moves, Tidy and inline edits, and has Copy all.
- e935ae2: New `footnote` statement: a block of entries under the drawing, above the legend, with optional markers that labels point at as [1]. Notes and footnotes take [label](href) links that join config link-base= and stay clickable in the Editor, SVG and PDF.
- 0eaa8ac: The Source tab is editable. A valid edit redraws the canvas and saves the file; an invalid line keeps the last valid drawing and shows its error at the line. Press ` to open the tab.
- eb75538: New `draftably migrate <files|folder|glob>` rewrites flowchart and sequence `mermaid` fences in Markdown as `draft` fences. Other Mermaid charts stay. It prints a dry run with the importer's warnings; `--write` applies it, and `--accept-lossy` also converts fences with warnings.
- b03caa4: Add a native asynchronous SVG runtime facade with structured diagnostics, detached diagram summaries, validation, bounded resource overrides, cancellation checks, and XML text validation. Shared CLI rendering remains the current SVG writer.
- 652ec7c: Share the native SVG writer with the runtime. Add scoped inline IDs, safe HTTP(S) links, optional source metadata, and bounded SVG output. Version font family names by their bundled files and metrics. CLI exports keep authored links and embedded fonts.

### Patch Changes

- 2eb469f: Flow edges leave boxes on the right or bottom and enter on the left or top in a directed layout. Lines into members of a group that another line targets are no longer drawn along the member's border. A line to a group meets the group's side near its own line. A line out of a group crosses the title band when the way round reads backwards. `check` warns when a line has to leave or enter by a backward side.
- e063456: The viewer's editor state is per diagram, and an embeddable editor (mountEditor) can put several live canvases on one page.
- 29effde: Selecting a diagram, object or layer no longer changes its text weight, so long titles keep their wrapping and the list does not move.
- fe01bb5: The guides for every package moved to draftably.dev/docs, and each package README now links there. The Emphasis states page draws each state live.
- ba5f518: A line that runs between two sides, such as a container wall and a box or two container walls, now runs midway between them. Before, it could hug one side. Two lines on one side of a box, pill or circle now sit evenly about the side's middle more often, also when one of them is a straight line to another box.
- 81e76a8: `@draftably/editor` now holds only the editable canvas. It no longer bundles the Mermaid and D2 importers, the import dialogs or the app's panel state, so the package drops from about 20 MB to 1.7 MB unpacked. Importing it no longer reads the window size or writes to localStorage. A mounted editor keeps its canvas shortcuts; app-only shortcuts, such as the command palette, stay in the app.
- ae7bf20: An edge label too long for the gap between two boxes now stays inside their group and clear of other lines, instead of sitting on the group's border where another line crosses it.
- 5e6adc4: SVG exports name the drawing for screen readers: the root `<svg>` has `id="draft-svg"`, `role="img"` and `aria-labelledby` pointing at its title. Layout and embedded source are unchanged.

## 0.10.0

### Minor Changes

- 7a7ad49: check warns when a drawing is too wide to read in a page column and suggests fit=slide; vary ranks such a file for --fit slide. A layout line now ignores a setting it does not take, and a repeated layout line replaces the earlier one; both are warnings instead of errors. The agent skill says where diagrams are read.
- 127d456: The Editor's layout buttons say what they do. Improve is now **Tidy**, and **Lay out again** (Shift L) sits at the top of the Arrange panel and in the Layout menu. It replaces "Reset to the recipe" and "Rearrange from scratch".

### Patch Changes

- 2279452: A skip line that arrives at a diamond whose facing point already holds another line now comes down onto the diamond's top point, so the two lines no longer cross or loop over the diamond.
- 3fd351d: check warns when direction= on the layout root line keeps fit= from turning a drawing that stays too wide, and says to remove direction=.
- 6adc664: Under compound-flow and layered, a tall group that only receives lines no longer stacks on the group that calls it and leaves half the drawing empty. Two lines from one group to different targets are now routed instead of drawn straight through other boxes.
- 3e723ee: A node title with explicit line breaks now widens its box so each line fits on one row, instead of wrapping again into ragged lines. Wrapped node and group titles break into near-equal lines, and a short token such as the unit in `< 5 s` no longer sits alone on a line.
- 3849923: Edge label backgrounds match the surface under them. A label is one card in the fill under its center, and it no longer keeps the group fills of an earlier layout or file, so it never shows as a gray or split box.
- c498d06: Lay out again on a file with a `legend line` entry. Improve, Reset to the recipe and resize relayouts no longer fail with "Legend entries need a color family."
- ec02aa6: draftably is now released under the MIT License. The package includes the LICENSE file and sets `"license": "MIT"`.
- 8621133: Remove hover tooltips from the editor and exported SVG. Shapes, connections, ports, handles, link marks and the file list no longer show a tooltip or card on hover. Accessible names stay on `aria-label`.
- c45aa8c: Layout notes wrap inside their panel instead of scrolling sideways, and a toast shows centered so it no longer covers the right panel.
- d7dc128: A shape resize in the Editor no longer writes `stay` lines for the objects around it. The layout moves them to make room, and no "gave way" layout notes appear right after the resize.

## 0.9.0

### Minor Changes

- ce7f656: Open DOT, Mermaid flowchart and D2 files as editable native diagrams in the browser.
- 066a132: Add a read-only DOT import command that creates native diagram files and reports unsupported meaning.
- 43791be: Edges take `head=` and `tail=` with `arrow`, `none`, `triangle`, `open-triangle`, `diamond`, `open-diamond`, `circle` and `cross`. The canvas and the CLI draw the same marks. The inspector has a control for each end. Mermaid `--o`, `--x` and `<-->`, DOT `dir=` and `arrowhead=`, and D2 `<->` and arrowhead shapes now import as these marks instead of a refusal.
- 2c8e51c: The Editor's Layout lab and routing menu are now one Arrange tab beside Properties. Direction and Format show what the file says and preview a change at once, with no engine to pick. Every engine and routing value stays under Exact layout and Exact routing. Line corners moved to Appearance, the Layout menu is shorter, and Enter keeps a preview.
- 1ed934b: Press ⌘K in the editor to search every command, the folder's diagrams and the examples by name or
  by what they do, and run one with Enter.
- 3b78d10: Compare opens on the current drawing beside up to three alternatives that really differ, chosen from every engine. Each card says what it gains and costs in measured terms, repeats are dropped, and a drawing with a blocked line or an overlap comes last. Connections compare exact routing values, each card fits its own view, and method lists and parameter grids moved behind the options button.
- 0537b28: The editor has a menu bar: File, Edit, View, Layout and Help. File changes with where you are. With
  a folder open it creates diagrams in that folder, lists recent ones and exports the folder; without
  one it opens and saves files. Examples and every layout tool have one named home, the toolbar keeps
  only drawing tools and Tidy positions, and Edit disables commands that need a selection. ⌘O goes
  to a diagram when a folder is open.
- 791dd10: The editor's sidebar and inspector can be resized: drag the edge, use the arrow keys, or
  double-click to reset. The width is remembered. Diagrams and Objects now share one sidebar as tabs,
  so they no longer take two columns.
- 360d66e: A Before panel now draws the old shape, count and message order. `draftably compare` writes `was-shape=` and `was-count=` on `~` lines and a `was-order` line in a sequence, and `check` validates them. An image with panels lists any change it can't draw beside the Before label.
- 722777d: Wrap long connection labels in flow diagrams at about 140px, and start a new line at each `\n`. Gaps grow to fit the wrapped label, so a diagram with long labels draws narrower and a little taller.
- 47b1fa6: A long subtitle now wraps to the drawing's width (360px to about 70 characters) instead of widening the frame. `check` warns `heading-prose` on a subtitle that wraps and on a note with no `near=`.
- 5379c8a: The legend can now explain line styles with `legend line dashed "meaning"` and `legend line solid "meaning"`. The key runs left to right under the drawing and wraps only when it passes the drawing's width. `check` warns `legend-missing` when a legend leaves an accent color without a row, and notes `legend-lines` when dashed and solid lines appear with no line row. A diff legend counts shapes and lines apart: `5 added · 5 lines`, not `10 added`.
- 74c452a: Import Mermaid flowcharts and D2 graphs into new native files from the CLI.
- c1e3d86: `draftably import` and the editor's text import now read Mermaid sequence diagrams. Block branches become phase bands, with a warning, and notes anchor to their message.
- 9ddd801: A sequence `note` can now anchor to a message with `near=<message id>`. `side=right` (the default) and `side=left` place it in the margin level with the row, and the panel grows round it. `side=above` and `side=below` look for a clear spot along the row. A note never moves a lane or a row. Deleting a message or participant keeps the note's text and moves it under the subtitle.

### Patch Changes

- 54f4ee7: Show only the fields that apply when a sequence participant is selected in the Inspector.
- a8cd3de: Draw straight lines between two columns of grouped boxes. When each box faces one box in the group beside it, the box moves to its partner's line.
- f1bdf2e: The docs now say when to pick each layout engine, add a Fix a layout path, and match the Editor's routing menu names.
- 2f210ce: Use lowercase draftably in documentation, the website, editor labels, and CLI messages.
- c55b150: Make room for an old line label in a flow comparison, and draw it on its own line in Before.
- ff5e015: The editor toolbar and start screen now show the draftably logo, which links back home, and the site's Playground, Docs and GitHub links. The landing page offers to continue the diagram kept in this browser.
- 51e4a7e: Keep a short marked line whole where another line crosses it.
- 466766a: Make room for an old message label in a sequence comparison, and draw it above its line.
- 2483e83: Stop layout passes, the timeline and the brush from writing positions into a sequence.
- 0b35a7c: The Arrange panel answers a click at once on slow drawings, keeps its buttons at full height, and explains its buttons with their shortcuts. Its counts read correctly for one crossing or bend, and picking a format no longer moves the controls below it.
- f6bca86: `vary --try direction` works on a file with no `layout` line. `check` no longer warns about a cell
  marker, and `check --metrics` counts every warning that it prints. The parser now refuses
  attributes that had no effect: `kind`, `detail` and `priority` on nodes and groups, `importance` on
  edges, and `kind=data`. The hosted Editor no longer offers Export PDF.
- c607e0e: An unquoted URL such as `href=https://example.com/path` now keeps its path. Before, the `//` started a comment and `check` reported nothing.
- b82d70d: Keep Playground edits on immediate reload without overriding incoming shared links.
- 058fd34: Clarify that returning to Playground opens its separate copy.
- c647624: Compare fits a phone with Close always in reach, and tooltips now appear inside it and every other dialog. Cards name each method once, reserve Apply while drawing, and show cut-off text on hover. Enter applies a focused drawing, and the sidebar uses plain words.
- 55c445c: The editor's Compare sheet computes its candidates in parallel, so a full sheet finishes in about a quarter of the time.
- 18d3956: Compare now counts label collisions. A candidate with a connection label on another label, a shape, a group title or a line, or a title too long for its shape, says so on its card, marks the spot on the drawing, and ranks behind a candidate without one.
- 90647fa: `draftably compare` now marks a line when any attribute changes. It also lists changes with no old version to draw, such as a new shape, a changed layout or a new message order, instead of printing `No changes.`
- 648bbc1: Compare no longer moves cards under the pointer while results arrive, and the grid keeps its columns. Overlay offers Apply only for a drawing that can change, numbers its layers in order, and returns the sidebar to how it was.
- 900da88: Add D2 graph mapping to validated native source. Runtime controls and import entry points follow in a later change.
- 6d9ef67: The CLI reference in `draftably docs` uses commands that a reader can run, and the Examples section lists every example.
- c13e879: The language guide in `draftably docs` has headings for notes, links, shades, the legend and side-by-side panels. It lists the values and ranges of more attributes, and its Refinements and Emphasis states samples run as whole files.
- 931f8fb: Arrange now hides tools a sequence or cell diagram can't use, previews connection presets alongside direction and format, and can return a line from an engine to its built-in recipe.
- 97c2f02: The editor's diagram list is denser: one line per diagram, folders that fold, and search that
  marks the matching words. The full path shows on hover, and the folder name above the canvas links
  back to all of its diagrams.
- f14d9b8: Tighten the editor: a denser Inspector, one tooltip everywhere, folders first and remembered in the diagram list, a Save as file command for examples, and a toolbar that stays on two rows at 800 px.
- 8efddd0: The editor's buttons, menus and form controls have a new look: graphite keys with a pressed state,
  tighter corners and softer shadows. Violet now marks only what is selected on the canvas.
- 562e9b5: Properties now offers only what the open diagram can keep. In a file, it hides emphasis, bends, label positions, icons, start and end, and container settings that were refused after a click, and Snap no longer says it was not saved. Alignment is one row of icons, a group links to Arrange, and the toolbar has one sidebar button.
- 6972e2b: Toolbar buttons in the editor now show an instant tooltip with their name, shortcut and what they
  do, on hover and on keyboard focus.
- 978c451: Changing a layout engine keeps the line's `fit=` and `direction=`. A `direction=` beside `fit=` now holds, so `fit=` only tries folding. The layout preview shows the line that Keep will save and how many hand placements it removes. Compare no longer offers settings that a diagram file ignores.
- d72e684: Drop the empty side margin of a message note from comparison and state panels.
- 506ff0e: Hovering a diagram in the files list now opens a card to the right of the sidebar, so it never covers the list. It waits about half a second, then shows the full title, the subtitle, the path and when the file changed. Moving to the next row switches the card at once. Leaving the list, scrolling or pressing Esc closes it.
- 7d03d01: The hosted Editor no longer requests a local workspace that does not exist there.
- 869fc25: Add the first DOT import adapter and native source validation. The import command and editor controls follow in later changes.
- 425f0ae: Slide a bend when no straight run of a flow line is wide enough for its label, so a long label sits beside one straight run instead of across a corner.
- 624fafc: Layout actions in the Edit menu state what they change, with the scope from the live selection, and how to reverse them. The Layout tools docs compare them.
- e8c972a: Add Mermaid flowchart parsing and conversion into validated native diagram source. Import controls follow in a later change.
- 7a76d11: The Editor shows where work is kept on phone-width screens.
- d973a6b: Native edge declarations accept directed=false for undirected connections. Formatting, visual edits, comparison, layout projection, and SVG output preserve the flag.
- cfa1f11: New from an example opens one blank draft from every entry point. The draft has its own name and no longer promises a browser save it does not make.

  The start dialog opens at once. Example thumbnails draw one at a time as they scroll into view.

- 54d916b: Removed objects in a diff now stay readable: a paler red fill, a dashed red border and a − disc on the corner, with no strike-through. Set `config strike-removed=on` to strike removed titles through again.
- 6b6151f: Draw sequence diagrams on colored lanes without canvas-colored patches. Line breaks, message label cards and participant headers now take the lane color under them, and the outer frame is gone when lanes already hold every participant.
- 3fae469: Sequence diagrams now draw what the file says. Root and group `order` both apply. A phase must be a run of consecutive messages, a message must end on a participant, and a band needs a participant. Distant labels and self-messages get their full room, and plain headers get a visible outline. Deleting a message or participant cleans its phase, and a drag saves a lane order. Changing the theme keeps the subtitle, notes, legend and states. In any diagram, the editor can now delete a selected connection while the Inspector is open.
- 61ccd09: Space activates a focused Editor button again. Space-drag still pans on the canvas and after a toolbar click.
- 1819b87: The Editor's start dialog names `npx draftably open`, the command a visitor can run.
- f0777d2: The Editor status bar shows the running Draftably version.

## 0.8.0

### Minor Changes

- 304a7b2: The viewer draws the export frame: the title and subtitle above the drawing and the legend under it. Double-click the title or subtitle to edit it, and drag the frame's right edge to widen it; the width saves as diagram width=N. A first open in a small window now fits the diagram.
- 51dd609: The viewer copies a diagram to the clipboard: Copy image (⇧⌘C, the export menu and the canvas right-click menu) writes PNG, SVG, HTML and SVG text in one copy, falling back to what the browser accepts, and the toast names the formats. With something selected it copies only the selection. Copy as gives SVG markup, the .draft source or a link. One export dialog for PNG, SVG, PDF and Copy shows a preview and remembers scale, background and heading. `inspect --clipboard` puts a PNG and the SVG text on the macOS clipboard.
- ce5b6ae: Viewers from draftably open stop after 2 hours with no open tab or when their folder is deleted, and the CLI notes on stderr when npm has a newer version (checked once a day; DRAFTABLY_NO_UPDATE_CHECK=1 skips it).
- 1ea8aca: draftably docs prints the language guide that ships with the CLI: its contents, one section (docs legend), or all of it.
- 4393e15: New `draftably pdf <files|folder> -o out.pdf` writes one vector PDF of a diagram set: a page per diagram (or per state with `--states`) with its heading and key, `--page fit|letter|a4|slide`, `--order given|name|title`, a cover and contents with `--title`, bookmarks, and each file's source attached. `check`, `extract` and `open` read a PDF's sources back (`out.pdf#name.draft` names one). The viewer has Export PDF… in the export menu and a PDF button in the files panel to pick, order and export several diagrams.
- 59d0134: New `note "…"` statement: a sentence on the diagram that never moves the layout. Without `near=` it sits in the frame under the subtitle; `note "…" near=id side=below|above|left|right` places it beside an object in free space after layout. Notes wrap at 280px (`width=` changes that) and draw in the viewer, `inspect --svg` and exports. `check` warns `note-overlap` when an anchored note has no clear spot.

### Patch Changes

- 666998f: The viewer shows the draftably mark on its start screen and in the browser tab.
- 337c0c7: The editor keeps unsaved edits to an example or a Playground diagram in browser storage. A reload brings them back and says so.
- cc8fcb7: A layout preview that does not fit the visible canvas is now fitted, so the whole result shows next to the layout panel.
- 74994ef: The viewer opens source shared from the playground in a #s= link as a scratch copy.
- 15cd3ac: The editor's File menu starts with New diagram and lists the same curated examples as the Playground. The layout test cases move to a closed section at the bottom.
- 93ffbae: The language guide's Rules table renders as one table, and its full examples are tagged `draft` so the site draws them.
- ec1bff2: `count=` takes a short symbol as well as a number: `count=N` draws a `×N` badge on the stack, for "one per item" when no real number fits.
- bb573bf: Routing is about twice as fast on large diagrams: each line searches near its two boxes first and the whole drawing only when that fails. Some lines take slightly different paths.
- bcae043: A node dropped in the viewer keeps the place it was dropped. It is saved `near` a neighbour it lines up with, and a node under another in a layout that reads down is saved below it, not beside the node across the gap. When that `near` would draw it somewhere else, the drop saves a `stay` at the exact point instead, and the saved message offers "Keep exact position".
- c064b52: The viewer now calls itself draftably in the page title and start screen.
- 60d4b2b: The viewer's debug API waits for the canvas before exporting, and adds ready().
- a2760db: The editor's File menu and shortcuts dialog link to the Docs and open the current source in the Playground. An example opened from the Playground offers Back to Playground.
- 432ceea: check warns when a legend swatch's shade matches none of its family's nodes, and names the shade to add (legend-shade).
- 80485f5: In a compound-flow layout, a group member with no edge to another member now sits across where its outside neighbours are. Two outcomes fed by one node in another group sit together on that node's side, and their return lines run side by side.
- 698b1e9: A bare quote inside a quoted string now fails with its line and column and suggests `\"`. The language guide and agent skill list the escapes: `\"`, `\\` and `\n`.
- be079ef: Diamonds are always square. A long question grows the square and wraps wider, a `size` line keeps the larger side, and `check` notes a diamond much larger than the shapes around it.

## 0.7.0

### Minor Changes

- 79bb1f2: `check --metrics` prints what `vary` measures (size, aspect, crossings, bends, line length, warnings) and warns on crossing edges, detours, stranded nodes and an extreme aspect, or one far from `--fit <shape>`. `inspect --json --metrics` adds the same numbers as a `metrics` object.
- 4b813f2: Add `draftably set <file> <id> key=value…` (change a declaration: `label=` or any attribute, `key=` removes it), `rm <file> <id>…` (remove nodes, groups or edges with their edges, refinements and state mentions; a group's members move to its container) and `mv <file> <old> <new>` (rename an id everywhere). Each rewrites the file through the formatter and runs `check`.
- 5e128e4: `check` takes several files or a folder, prints each line with its file, and exits 1 if any file fails (before, it checked only the first file). Every command prints its own help with `--help` instead of running (`open --help` no longer starts a server), and `--version` prints the version. `check --quiet` leaves out info notes. `inspect --png` and `compare --png` print the image size, and `--max-width <px>` caps the image width.
- 233cee3: `edge … constraint=false` draws and routes an edge without letting it rank or order anything, so a feedback edge no longer pulls its target's section below its source.
- 52206a5: In a grouped `layered` or `compound-flow` layout reading down, a group whose chain is at least 1.5 times as tall as every other column folds into side-by-side columns when that makes the drawing smaller. `fold=never` on the `group` line keeps it in one column.
- 53c4885: An edge may end on a boxed group: `edge e owner -> questions "owes"` draws the line to the group's frame and ranks the group like any other end. A soft or frameless group, or a group around the other end, is still refused with a reason.
- 28303e7: `layout root … fit=wide|slide|square|page|tall` aims the drawing at an image shape: compile also lays it out reading the other way and with folding on and off, keeps the layout closest to that shape (the file as written wins a tie), and names the choice in an `info` note.
- 9301ac2: `near id ref` accepts a `ref` inside a sibling group: `id` goes beside that group, lined up with `ref`. An edge to a group now names the group's members to connect to instead.
- 6213217: `draftably open` reuses a viewer that already serves the folder: it prints that viewer's URL and exits instead of starting a second one. `open --status` lists running viewers (URL, folder, version, pid), and `open --replace` stops a viewer, for example one left from an older version, and starts this one. Viewers register in `~/.draftably/viewers`.
- b839b0e: Sequence diagrams draw on a framed panel with outlined participant headers and a thin color stripe instead of solid fills. A top-level `group` now gathers participants into a light column band (before, groups were an error), and a new `phase id "label" message ids…` statement draws a run of messages as a row band with its label in a tab at the left.
- 037a92d: Sequence diagrams take about a quarter less room: message labels wrap to about 170px and sit just above their arrow in a slightly larger type, participants are spaced for the wrapped labels, short participant titles get narrower boxes, and rows are tighter. A self-message's label sits beside its loop.
- be1527d: `check` warns (`[relaxed]`) when a `near`, `stay` or `nudge` gives way by 16 px or more, instead of an `info` note. `format --drop-stale` removes those refinements and stays the arrangement outgrew. `size id width=… height=auto` fits the title's height at that width, so a size line survives label edits.
- 8ce5b22: `config link-base=` may be a URL, such as source pinned at one commit: relative `href`s join it, open as web links in the viewer and are written that way into SVG and PNG exports.
- 10c63e1: `vary` prints a line per variant to stderr as it finishes and takes `--budget 60s` to stop trying new variants and rank the ones found. On a `lanes` root, `--grid` and `--try engine=…` now try engines (the lanes stay as `v0`) instead of refusing. `vary --help` prints help instead of reading `--help` as a file.
- 03d0d78: A long group title wraps to its members' width (up to three lines) and its title band grows taller, instead of the title setting the group's width on one line.

### Patch Changes

- 5cd00ce: Routing a busy diagram is about 40% faster: the crossing repair stops after four tries, where every repair that helped in the test diagrams was found.
- bd8086f: Opening, reloading or switching back to a diagram you have opened before is near instant: the viewer keeps each compiled file and its routes in the browser across reloads and tabs.
- afab665: Route connections about 2.8 times faster on large diagrams, with identical lines: one search where a short one used to fail and start over, and each step checks only what lies on its grid line.
- e908dc6: The viewer no longer routes a large diagram file on the page itself: it draws quick routes at once and shows the full ones from the engine worker, routing each change once. Grid view and returning to a drawing reuse routes already computed.
- da8dbbf: Dragging a box in a nested group no longer freezes for a second: a quick route could escape round the router's group walls, millions of pixels out, and placing its label along that line stalled the page.
- 2994cbf: A change to a large diagram file shows in a fraction of a second: the viewer draws the new layout with quick routes as soon as it is laid out, then the full routes.
- bcc0116: The link mark on a `diamond` or `circle` sits against the shape's top-right side instead of floating at the empty corner of its bounding box.
- 6b2019e: An edge's canvas-colored halo is drawn only where it crosses another line or a group's frame, not along its whole length, so lines inside tinted groups no longer look doubled. Edge labels keep their own background.
- 9934574: The viewer's Grid view of emphasis states pans and zooms: the wheel zooms and a drag pans every panel together, so the same region is compared across states. A click without a drag still opens a state, and **Fit** shows the whole panels again.
- 676e340: Engine layouts no longer depend on how objects are named: where the connections leave a choice, file order decides, so renaming an id no longer moves it (or the groups around it). A scope's `order` line now overrides file order under engines too; before, `order` did nothing under `engine=layered`.
- b2e1b81: The viewer marks a box placed by a `near`, `stay`, `nudge` or `pin` line with a small pin inside its corner (filled when pinned) instead of a "Manual" or "Pinned" text tag above it. Hovering the pin names the line that placed it.
- 8176e1b: Routing is about twice as fast with identical results (a 28-shape diagram drops from 9.1 s to 3.8 s in `inspect`), which speeds up `check`, `inspect`, `vary` and the viewer's first draw. While dragging in the viewer, quick routes reuse each line's sides from the previous frame instead of searching every line again.
- 9356ccf: The agent skill says when lanes, sequence diagrams, cells and emphasis states fit and when they don't. `check` notes on stderr when an installed copy of the skill (in `.claude/skills`, `.agents/skills` or `~/.claude/skills`) differs from the one this version ships, with the command to update it.

## 0.6.0

### Minor Changes

- 143251a: Cells can form a table: `columns=N` fills rows of N cells with shared column widths, and `span=N` covers several columns. Lines meet a cell on its outer side, and reach a cell inside a grid across the cells around it, ending in a dot.
- bd419ad: Add `layout <group> cells`: a group's nodes touch edge to edge under a title band, for sequences such as the parts of a request. `shape=marker` marks a seam between cells, and lines can end on any cell.
- e688453: `check` reports drawing conflicts as warnings: a line through a box or a group title, overlapping boxes, a label on a box or another label, and a box outside its group. Each warning names the refinement line that caused it and a fix. `check --hints` shows how far each refinement moved its target, and `inspect --json --hints` adds the unrefined `raw` position of every moved node.
- c44e1d0: New theme palettes. `drafting` is the new default: navy ink on cool paper with drafting blue and marker gold. `ink` replaces `mulberry`, `blueprint` replaces `midnight`, `fieldnotes` now pairs indigo with terracotta, and `signal` uses Okabe–Ito's color-blind-safe hues. Rename `theme graphite`, `theme mulberry` and `theme midnight` lines to `drafting`, `ink` and `blueprint`. Amber and orange stay bright with dark text at shades 400–500, and change marks differ in lightness so they read for red-green color blindness.
- 2ff30bc: PNG and SVG exports carry their `.draft` source. `draftably extract` reads it back, the other commands accept an exported image in place of a `.draft` file, and the viewer opens a dropped or pasted export as a diagram. `--no-source` and an export menu checkbox leave the source out.
- 28a96a0: A `config` line holds file settings: `link-base=` sets where relative links start, and `editor=` picks the editor file links open in (`vscode`, `cursor`, `zed`, …). `check` warns about a file link that does not exist and suggests the path it probably meant.
- d41d3fe: `inspect --svg --states` (and `--png`) draws every emphasis state as its own labelled panel in one aligned grid.
- d713423: The viewer shows a file's emphasis states as chips over the canvas. Pick one, or step with `[` and `]`, to draw it in place; **Grid** shows all of them side by side. The chosen state is kept in the URL (`?state=`), never in the file.
- 2fa4dd6: `state id "label" ids…` lines name emphasis states: the listed nodes, groups and connections draw in focus and the rest fades (`rest=plain` keeps it and rings the focus instead). `inspect --svg --state id` draws one state. States never move anything.
- 2f58775: `inspect --svg` and the viewer's SVG export draw the link mark, give each link a tooltip and a hover outline, and tag each object with `data-id`. File links become paths from the diagram's folder; the viewer's SVG export now keeps links at all.
- 51edc02: Linked nodes and containers show a ↗ mark. In the viewer the mark opens the link: a URL in a new tab, a `.draft` in the viewer, or a file path in VS Code, with `path:42` opening at that line. Relative paths start at the diagram's git root.
- 0d84670: Cells can draw byte and bit layouts: `unit=byte` or `unit=bit` gives every unit one width, so `span=N` is a field's size. A ruler numbers the units, long fields run on into the next row, and `span=var` draws a field of variable length.
- 8c8f18e: Add sequence diagrams: `layout root sequence` puts every node in a row of participants with dashed lifelines and draws each edge as a message on its own row, in file order. Adds the `login-sequence` example.
- e9a1f93: Add `frame=soft` and `frame=none` on groups. Members lay out as if the group line were not there, and the group draws as a light tint behind them (soft) or not at all (none). `check` reports `soft-overlap` when a tint covers an object outside its group.
- 1a86116: Add swim lanes: `layout root lanes` makes each top-level group a lane and ranks every step across the whole drawing, so one rank is one column across all lanes. `direction=down` sets the lanes side by side. Adds the `support-lanes` example.
- 61405c6: `vary` also suggests dropping refinements that `check` blames for conflicts, drawing change marks as `compare` panels, and softening groups for fewer containers. `check` no longer reports `node-overlap`, `outside-group` or `edge-through-title` for soft and frameless groups, whose tints lines may cross.
- b5cb444: Add `draftably vary`. It tries layout and routing variants that suit the diagram's shape, measures each one (crossings, bends, size, warnings, movement) and ranks them against the file as it is. It writes a contact sheet, one PNG per variant and `variants.json`. `--apply <id>` (or `--apply best`) writes the chosen variant's lines into the file and checks it.

  `vary --try key=a,b` sweeps exact settings (two `--try` make a grid; `--try key` alone uses the viewer Compare's steps), `--grid` sweeps the main engines in both directions, and `--scope <group>` varies one group's layout line.

  `vary --fit wide|slide|square|page|tall` aims for an image shape, `--prefer compact|stable` changes what ranks first, and `--from <id>` searches around a variant from the last run.

### Patch Changes

- 0441ade: In the viewer, dragging a cell among its group's cells reorders them and writes the group's `order` line, and the inspector has a Span field for cells.
- cb66113: A layered or flow run that fits the canvas without its edge labels no longer folds when the labels make it slightly longer.
- 89d4771: Layered and compound-flow layouts no longer rank a group past a node that its members feed and that feeds them back. The group now sits where its first member ranks.
- 7ded53c: A compare panel now trims each container to its remaining members on every side, so a container that lost its top members no longer keeps an empty band above them.
- 5738658: Switching between open diagrams no longer routes connections twice, so a file opened before shows at once. A hovered file link starts compiling before the click.
- 942f8d5: Keep a soft group's members side by side in each rank, leave room for its tint and label, and draw the tint as one rectangle when it covers nothing else, or as the members joined by strips. `check` notes `soft-split` when members cannot be joined.
- 91675cd: Select a soft group in the viewer by clicking its tint, and drag the tint to move its members; each member gets a `stay` at its new place.

## 0.5.1

### Patch Changes

- ead0b11: `draftably compare` now keeps a node that moved to another container in its old container in the older panel: the old node and its lines are removed under `<id>-was`, and the new ones added, so the merged drawing shows the move.

## 0.5.0

### Minor Changes

- 2172d0b: compare takes direction=right|down to set panels side by side or stacked, and otherwise picks the arrangement nearest aspect= (1.6).
- c9266f2: draftably compare old.draft new.draft prints one file holding both versions, with + - ~ change marks; --write saves it and --svg draws it.
- b20773e: A compare "before" "after" line draws a marked file as two aligned panels in exports, with every unchanged object at the same place in both.
- 1f74e5b: inspect and compare take --png <file> [--scale N] to save a PNG, rendered by an installed Chrome or Chromium.
- 25599b3: Exports draw the diagram title, and a new subtitle line, above the drawing so a copied image stands alone.
- 370f54b: Nodes take count=N to draw as a stack with a ×N badge, and nodes and groups take href= to link from exported SVGs.
- 6dcb3dc: Mark node, group and edge lines with +, -, ~ or . to draw a change: added, removed, changed or context, with matching legend rows.
- 9176af7: New `legend family "meaning"` statement (optional `shade=`): one row of a color key per line, in file order. The viewer shows the key in the canvas corner in the diagram's own colors, and `inspect --svg` and the editor's SVG and PNG exports draw it under the drawing. A legend never moves anything. The agent skill and the language guide ask for one legend line per color used.

### Patch Changes

- 73d9931: Comparison panels now reuse the merged drawing's line routes, so every line both versions keep runs in the same place in each panel. The change key is one row with counts (`3 added · 1 changed · 2 removed`), and `draftably compare` prints the same counts on stderr.

  `draftably compare` now splits an edge that joins different objects into a removed and an added line, so the older panel draws the line it had, and it names nodes or groups that moved to another container.

- 8d708e6: In a downward engine layout, boxes in one rank now share their top, so wrapped titles or a taller theme no longer leave a row with ragged tops.
- e480e9b: Side-by-side panels shrink to fit their own version: containers that lost members get smaller, and nothing moves out of alignment.
- da925dd: Layered layouts keep the declared order within each rank unless reordering clearly removes crossings, so adding a node no longer reshuffles the rest.
- 2be823d: Viewer stays that no longer fit a grown diagram (two anchored boxes now landing on each other) are ignored with a stale-stay note, instead of sliding one under the other.
- 2f9cd29: A gap inside a group widens where a line leaving or entering the group would otherwise turn through the label of an edge crossing that gap. It gets a standoff each side, 20px per extra line through it and, between rows, each label's height, so the line passes clear of the label.
- 969908b: A collapsed container keeps its title where the open frame had it, with the shape count under the title. In a diagram file, collapsing or expanding is a view change: it no longer runs as an unsaved edit (and no longer shows "That change is not saved to diagram files"), draws at once with quick routes and swaps in full routes from the worker. The frame grows or shrinks over 200ms and revealed shapes fade in, unless the system asks for reduced motion.
- 801e458: After an edit in a diagram file, the viewer compiles and routes the new version in a long-lived engine worker instead of on the page, and keeps quick routes on screen until it arrives. A drag no longer freezes the page for the layout and routing of the whole file.
- 2e69ef1: The router repairs crossings between pairs of lines after routing: it reroutes one line with the
  other as a wall, or routes them in the other order, and keeps the pair when the drawing costs less
  and no line comes to enter from below, by a far side or with a U-turn.
- 21ff8fb: Lines meet a diamond at its four vertices, one line per vertex, leaving a full standoff out
  before they turn; a further line takes a free side vertex instead of a slanted face. A fan out of
  one side with more lines than full-gap ports spreads on that side at a 12px pitch, where that
  makes room, before it opens a second side, nested so the lines don't cross. Lines fanning out of
  or into one side may run 10–16px apart in the gap beside it, so a tree's third child no longer
  pulls its line out of the parent's side.
- 8056067: Nested groups of one color family are drawn in stepped shades (100, 200, 300; 900, 800, 700 in Midnight) instead of one repeated fill, and a node whose shade is within two steps of its own-family container moves three steps past it. `check` notes more than four accent families (`many-colors`) and members that repeat their container's family (`color-matches-container`). The language guide and the agent skill give concrete color rules: two to four accent families with a role each, no red-next-to-green, color the outer group and let members inherit.
- 00c1762: Connections draw over a canvas-colored halo, so where a line crosses a container border (or an earlier line) the border breaks and the connection reads as the stronger mark. Container borders are thinner and partly transparent (1px at 65%); a selected or hovered container still shows a full border.
- f15a642: Edge labels are placed together once every route exists, instead of one by one as routes are
  drawn. A label keeps clear of lines drawn after it, of other edges within 8px, and of other labels
  within its own height; labels that have a clean spot are placed first, then one repair sweep
  moves each to its best spot given the rest. On an upright segment a label can shift off-centre
  to clear a parallel line while its own line still crosses it.
- 62f6397: A folded flow keeps a side branch with its source. A box that would start the next band only
  because its source ends the band before (such as an "on failure" upload after the last proof)
  now sits at the end of its source's band, lined up with it, when that shortens its lines and the
  band still fits. Cuts are also scored by how far the edges they create run back along the gap,
  not only by how many there are.
- b7dc866: When a served folder has diagrams in sub-folders, the start page and the diagrams panel offer a **Folders** order that groups diagrams under their folder, nested folders indented beneath their parent.
- bbfe27d: Shapes, containers and lines show on hover that they can be dragged or picked: a shape lifts with its ring, a container's border and a line take the accent colour.
- df57bb2: Editing a title in place now happens on the object itself: the editor takes the shape's face (or a container's title band, or a connection's label) with its fill, text color, font and line height, grows with the text instead of scrolling, and hides the drawn title underneath. Below about 12px text it draws larger around the same center so it stays legible.
- cd65cea: Connection labels keep about 10px clear of boxes when their line offers such a spot, so a label no longer sits pressed against a shape it doesn't belong to.
- c33439d: A connection between a box inside a container and something outside it now leaves (or enters) the container by the short way and runs outside, instead of travelling along the container's inside: the router charges a line's run inside a container that holds only one of its ends, beyond the shortest way out.
- 29704d4: A packed drawing (`compound-flow` or `layered` with groups) no longer flattens into a strip. When it is wider than the canvas and more than five times longer than it is deep, its longest group folds into rows, one group at a time, so the groups keep their order; only when no group can fold do the groups wrap into rows like text. A group that only receives lines, such as an upstream API, now sits beside the group that calls it instead of in a rank of its own past it. `fold=never` on the root engine keeps one line.
- b6c4a15: Connections follow the reading convention more often: arriving on a box's bottom costs extra (right side and leaving by top or left slightly), and a route that enters or leaves by a side facing away from the other end also pays for the loop it draws. Lines that went round a group to come into a box from below now come in from the top or left.
- 03333c7: A return or skip lane no longer turns through another edge's label. When the label in the gap
  beside its target reaches across the turn (down a column), the lane arrives square on the target's face toward
  the lane instead of running through the label's text.
- 4ab72dd: A flow orders each rank by where its connections point: siblings, groups included, sit in the
  order of their neighbours in the rank before, as `layered` orders nodes, instead of in declaration
  order. A group fed by another group sits on that group's side.
- bf4994e: Pressing or clicking a shape no longer redraws every connection: quick routing starts only once a drag actually moves, so lines stay put while you select.
- d8495cc: Opening a diagram from the start page or the diagrams panel, going back to the start page, and the browser's back and forward buttons switch files in the page instead of reloading it, so the screen no longer flashes blank. A pending save finishes first. Files changed in the last week show the day and time instead of only the date, so a Recent list of same-day files reads in order.
- bcaeab1: A line may now cross a group's title band straight across, into any member, when going round the
  group would make it more than 1.75 times as long. It still never runs along the band or through the
  title. A line that leaves or enters by a side facing away from its other end is routed again once
  the edges after it have settled, so it takes a facing side that has since come free (state/ →
  model/ in a stress layout no longer climbs over its neighbours).
- d137202: The mouse wheel zooms the canvas around the pointer without a modifier, in steps of about 18% a notch; Shift + wheel pans and a pinch still zooms. Holding Cmd while moving the mouse no longer zooms. Fit leaves the drawing about 92% of the stage and never zooms past 100%.

## 0.4.0

### Minor Changes

- 22883f0: Edges keep a 20px standoff from box sides and stay off group borders, and stacked neighbours in a tight gap connect through their facing sides instead of hooking round. New `routing standoff=` setting (0 turns the band off).
- 1966827: `flow` keeps a loop along its direction: only the edge that closes the loop runs backwards,
  instead of the whole loop collapsing into one column or row. A long run of ranks in `flow` or
  `engine=layered` now folds into rows (or columns) that each read from the start once it is wider
  than the canvas and more than three times longer than it is deep. `fold=never` keeps one line.

### Patch Changes

- fc4cbe6: Routes look drafted on purpose: ports on a shared side sit symmetrically about its centre, and fans out of one side turn on one line where that keeps lines apart.
- d0755d3: Edge labels stay on their own edge: flow, column and engine layouts widen a gap to fit the labels that cross it, and a label no longer lands on another edge, a group border or far from its line.
- f521a91: Folded flows read like wrapped text: a fold keeps each decision with its branches and each loop whole when a cut of similar balance allows, and the edges from one band into the next return along evenly spaced lanes in the gap between them instead of looping separately.
- 0ad8d64: Ports on a side now centre about its middle even when a straight line has to slide with them: the
  tidy pass accepts the small standoff cost of the shift, turns the other lines a full standoff out
  from the side instead of hugging it, and never trades the move for a new hug.
- 803f062: Groups now fit their contents with the same padding on every side, instead of a 260px minimum width that left wide gaps on the right. A group still grows to fit its title, and `min-width`/`min-height` still win.
- 594ccde: Frame the whole drawing in `inspect --svg`, workspace thumbnails, SVG and PNG exports, and fit to
  content. Connections that loop outside the shapes, their arrowheads, and their labels no longer get
  cut off at the edge.
- 9d79011: Groups arranged by `compound-flow` or `layered` are packed tight. Members of a group rank by the connections between them, so a chain inside a group reads as one straight row or column instead of stepping diagonally across the drawing's rank columns. Each rank still keeps the engine's order. Sibling groups keep one gap across the drawing, wide enough for the lines that pass between them.
- edf45e6: Adding a side exit or note beside a step no longer refolds a long flow. A node with no way out that shares its rank with another is left out when the fold decides how many bands to cut, so the bands, cuts and order of everything already there hold.
- 00eea33: Labelling or relabelling an edge no longer refolds a long flow. The fold's rows and cuts are planned without edge labels, so every object keeps its row; labels only widen the gaps they need, and a row is added only when the labelled rows run more than a quarter past the canvas.
- 759f230: Labelling an edge that turns between two rows no longer widens its gap when the label fits on the edge's run between the rows, clear of every box. Only the gaps whose labels have nowhere else to go widen.
- 6cc8a26: Returns and skips in a flow take planned lanes outside their row (or column): out of the side
  facing the lane, along it, and into the target's side that faces back toward the source, one port
  gap off centre. The router also prefers a line into a perpendicular side over a U-turn into the
  same side it left from.
- 334a496: Groups grow a routing channel where lines have to travel inside them (a member boxed in by its
  neighbours, or a link between children that can't go straight across), so lines run a full
  standoff from members and borders instead of squeezing through the inset. Lines no longer
  cross a group's title band except straight into or out of a top member, and the router's
  search now keeps its standoff from boxes and borders.
- 28ff13b: Fans stay on the side that faces their other ends: a node's second and third connections to one side spread along it instead of looping round to a far side, and an edge arrives on a target's far side only when the facing sides are blocked.
- db2e7fa: Lines keep the full `standoff` from group borders instead of half of it, and only a group's title blocks its header band. A line between stacked groups now drops straight in beside the title instead of riding the border 10–15px away.
- 7678890: Routes no longer carry tiny steps. A step under 12px between two parallel runs straightens by sliding one run onto the other's line, moving its port when the side has room, and a fold's wrap edge now runs straight out to its lane instead of stepping 7px past its stub.
- d62e85a: A line that leaves a box and turns to run alongside it turns a full `standoff` out instead of at the 13px stub, so it no longer hugs its own box.
- 63635a8: In a layout with a declared `direction`, forward edges leave and enter along it: a downward tree's edges run from a parent's bottom into each child's top, turning on the rank gap's midline, instead of arriving on a child's side.
- 3c06939: Switching the theme no longer moves the drawing. Nodes are laid out on slots measured in the default theme and drawn at the theme's size in their slot, so rows, order and positions hold; a slot grows only where the theme's node is larger than the gap around it can absorb.
- 0306b95: Node titles no longer break in the middle of a word. A long identifier breaks where its parts meet (`annotation` / `Commands`, `src/` / `viz/`, `code-` / `annotations.md`), and a node without a `size` grows wider, up to twice its default width, so a word with no such break (`installed?` in a diamond) stays whole.

## 0.3.1

### Patch Changes

- 2e4409a: Close live file-update streams when leaving a diagram and reconnect when a cached page is restored. This prevents rapid diagram switching from exhausting browser HTTP connections and stalling navigation.

## Unreleased

### Patch Changes

- Close live file-update streams when leaving a diagram and reconnect on cached-page restoration, preventing rapid switching from exhausting browser HTTP connections.

## 0.3.0

### Minor Changes

- d4019cb: draftably open puts your diagrams first: the start page shows every diagram in the folder as a live thumbnail (examples move to a closed section once you have files), and the editor has a Diagrams panel (F, ⌘P to search) for moving between files. Both lists pick up files the CLI or an agent writes without a reload.

## 0.2.0

### Minor Changes

- 57c021f: Add an agent skill for writing `.draft` diagrams. `draftably skill install` copies it into
  `./.claude/skills/draftably` (`--global` for `~/.claude/skills`, `--dir` for another skills folder,
  `--force` to replace a copy), and `draftably skill print` prints it. The repository's `skills/`
  folder also lets `npx skills add byronwall/draftably` install it.
- 22a53ba: Diagrams have themes. A `theme` line picks Graphite (the default), Fieldnotes, Signal, Mulberry or
  Midnight and can override padding, corner radius, title and annotation fonts, and the canvas, text
  and connection colors. Colors come in families with numeric shades from 50 to 950 (`color=blue
shade=800`); `theme-color` lines adjust built-in shades or define new families such as `brand`.
  Titles wrap with bundled font metrics, so the viewer, `inspect` and both SVG exports agree, and
  exported SVG files embed the fonts they use. Explicit `size` lines are now kept exactly; a title
  that no longer fits is reported instead of growing the node. `teal` and `orange` are now their own
  colors rather than aliases of `mint` and `amber`.
- Diagram files use the `.draft` extension, and the bundled example is `examples/checkout.draft`.
  The file contents are unchanged, so rename existing `.meld` files to keep using them.
- 0b071ae: A `.draft` file can arrange a scope with one of the editor's layout engines
  (`layout root engine=layered rank-gap=96`) and set the router with a `routing` line. Engines run
  from scratch on every compile, so the same file always draws the same diagram.
- The viewer's layout tools work while a `.draft` file is open, and their results are saved to the
  file. Rebuild and Compare write the scope's `layout … engine=` line, and the routing menu writes
  the `routing` line. Improve, timeline steps and brush strokes save the new positions as `stay`
  lines.

### Patch Changes

- 56bded1: `draftably open` now uses the first free port from 5180 instead of failing or sharing a port with
  another `localhost` server. An explicit `--port` that is already in use, on IPv4 or IPv6, is an
  error, and `--port 0` picks any free port. The `Viewer:` line always shows the actual URL.
- c6545c1: Keep the first title entered for a new connected shape. Make New diagram open the creation screen in file mode and name the save and export menu for assistive tools.
- 11d137d: Place connection labels clear of nearby shapes when the line is too short. Dock layout and property panels so Fit uses the visible canvas and layout previews keep their camera controls available.
- 73edb51: Separate Tidy positions from Automatic layout, add diagram type choices, and put engine tuning under Advanced layout settings. On phones, keep Add, Connect, Properties, Fit, and More visible. Show properties below the canvas and keep one panel open in smaller windows.

## 0.1.0

### Minor Changes

- Publish the draftably CLI with a bundled viewer and two-way diagram file editing.
