# Architecture

draftably is a SolidJS single-page app. All editor state lives in the browser; computation-heavy work
runs in a Web Worker. The editor code is split into three layers, each depending only on the ones below it. The portable runtime and adapters are described later.

```
components/  →  state/  →  model/  →  engines/
                   ↘  dsl/  ↗
cli/  →  dsl/
```

## Design goal: one host contract, thin framework bindings

A host app (React, Solid, Vue, Svelte or plain DOM) gets every capability from one
framework-neutral layer: functions and JSON from `@draftably/runtime`, the `mountViewer` and
`mountEditor` handles, and the `<draft-diagram>` and `<draft-editor>` elements. A framework package
in `packages/` only maps that layer to its framework's idiom: props, a ref, event props and
children. The packages differ only in that idiom.

- **The element is the contract.** Each custom element exposes everything its handle has: an
  `options` property for every mount option, and every handle event as a bubbling `draft-<name>` DOM
  event. A wrapper adds no behavior that plain DOM cannot reach.
- **One contract for the viewer and the editor.** Both use one camera shape (`centerX`, `centerY`,
  `zoom` in world units), one set of methods (`fit`, `reveal`, `geometry`), one zoom range and one
  event-reason union. A capability that both have uses the same types and the same behavior. The
  editor adds editing; it does not change what the shared parts mean.
- **Host content goes in slots.** A host puts content on an item by rendering an ordinary child,
  such as `<div data-draft-slot="body:api">`. The element assigns it with manual slot assignment and
  never writes to the host's DOM. Draftably keeps one element per anchored item across updates,
  positions it and moves it with the camera. The child stays in the host's own tree, so it keeps the
  host's framework, context, reactivity and CSS. Content never goes into the string renderer.
- **Two ways in, by who draws.** When Draftably draws, a host uses the elements and puts content in
  slots. When the host draws, it uses the graph API (`@draftably/runtime/graph`): a graph in,
  boxes and routed lines out. Neither path has framework code.
- **JSON at the boundary.** Geometry, diagnostics and the camera cross as plain data, in the shapes
  the graph API already publishes. Internal types, such as `Diagram` or the session store, stay
  internal.
- **Layout never reads host content.** A host declares the room it needs in the source (for example
  `size … min-height=`). The CLI, exports, server rendering and a page without the host draw the
  same layout, with titles in place of host content. Exports never contain host content.
- **Measure.** A new event, method, option or content kind adds no lines to any framework package,
  in its source or its types. Each wrapper loops over one exported list of events. If a feature
  needs wrapper lines, the neutral layer is missing a piece.
- **The first hour has no stall.** Each framework has one complete, typed recipe that CI compiles
  from the packed packages. The [host contract budgets](CHECKS.md#host-contract-budgets) hold for
  every change.

A framework-native entry, such as a Solid scene in the host's own tree, is an exception. Add one only
when a host shows a need that slots, events and JSON geometry cannot meet, and build it on the
neutral layer.

The contract keeps these invariants:

1. One world coordinate space: layout units equal viewBox units equal geometry units, in the
   viewer, the editor and `renderSvg`.
2. One camera shape, zoom range (0.02–8) and reason union for both handles. The editor converts
   to its internal `{ x, y, k }` at its edge.
3. A slot target keeps its identity while its item exists. The anchor layer is a sibling of the
   SVG and is never detached, so an update that replaces the SVG keeps host content and focus.
4. Layout never measures host content. Without a host, every diagram draws correctly.
5. No public type names `Diagram`, `DiagramSession`, `VisibleGraph`, Solid or font internals.
6. Draftably never writes to the host's DOM nodes.
7. One commit installs geometry, camera and anchors, then notifies listeners, then resolves
   `update` and `ready`. A superseded update installs nothing. Handle calls are synchronous, a
   listener that throws does not stop the others, and `destroy` is idempotent.

The editor renders in a shadow root. A document-level listener there sees events retargeted to
the host, and `document` lookups cannot see the editor. So code in the editor bundle reads
`composedPath()[0]` and its own root node, never `document.elementFromPoint`,
`document.activeElement` or `document.querySelector`. `tests/editor-root-lookups.test.ts` fails on
those lookups. App-shell files may use `document` on purpose.

Considered and not chosen, with the reason:

- **Callbacks in the renderer.** The viewer's sanitizer strips `foreignObject`, and every update
  would destroy and re-mount host content.
- **A portal helper per framework.** Host CSS does not reach into the viewer's shadow root, and
  Svelte has no portal.
- **The `slot` attribute.** Svelte 5 rejects a dynamic `slot` through a wrapper component.
  `data-draft-slot` with manual assignment works in every framework.
- **Geometry per panel for `compare` and `states`.** Panels can hold different items and routes,
  so offsets cannot describe them. `geometry()` returns `null` there, and slots stay off.
- **A display list that each framework draws.** It is a third renderer that could drift from the
  other two. A host that wants to draw uses the graph API.
- **`options.theme`.** A dark host sets the `--draft-*` tokens. The diagram's theme stays the
  author's choice in the source.

## model/ — pure data and operations

Plain TypeScript with no DOM or Solid dependencies, so it is unit tested directly.

| File              | Responsibility                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| `types.ts`        | The `Diagram` document and everything in it.                                                                        |
| `document.ts`     | `normalize` validates any input (files, storage, clipboard) and migrates v1 files.                                  |
| `graph.ts`        | Lookups and hierarchy: children, ancestors, collapsed containers, selection roots.                                  |
| `edits.ts`        | Every document change: add, connect, wrap, delete, align, paste, intent, … Each mutates the document it is given.   |
| `geometry.ts`     | Rectangles, rounding and SVG path helpers.                                                                          |
| `labels.ts`       | Title area, wrapping and label placement for every shape, shared by the compiler and the canvas.                    |
| `rich-text.ts`    | `[label](href)` links in notes and footnotes, wrapped as plain words wrap.                                          |
| `link.ts`         | `href=` kinds (URL, `.draft`, file with `:line:col`), link-base joins, editor URLs and the ↗ mark's position.       |
| `status.ts`       | One paint layer for diff marks and emphasis states. `withState` changes paint only, never geometry.                 |
| `footnote.ts`     | The footnote block between the drawing and the key.                                                                 |
| `code.ts`         | Code nodes: `codeLayout` sizes, wraps and clips a listing by mono columns. Each row points back to its source line. |
| `highlight.ts`    | Syntax colors for code nodes: a regex lexer per `lang=`, mapped to each theme's families at 4.5:1 contrast.         |
| `ranges.ts`       | Named line ranges on a code node: the band, margin bar and label tag (`rangeMarks`), drawn under the text.          |
| `code-src.ts`     | `src=` on a code node: the path and `#La-Lb` range, `lang=` from the extension, and the placeholder body.           |
| `appearance.ts`   | Five preset themes, families with numeric shades, `resolveAppearance` and the dark variant (`forScheme`).           |
| `fonts.ts`        | The bundled faces and deterministic text measurement from `font-metrics.json` (see `pnpm font-metrics`).            |
| `routes.ts`       | Ports, edge-label placement and the call into the routing engine.                                                   |
| `static-scene.ts` | A read-only scene for comparison candidates.                                                                        |
| `samples.ts`      | The example catalog backed by `src/samples/*.json`.                                                                 |

## state/ — reactive application state

State has two halves. A **diagram session** holds everything about one diagram being edited. The
**app shell** holds what the page has once: panels, menus, commands, files and Compare.

### state/session/ — one diagram

`createDiagramSession(options)` (`session/index.ts`) builds one session. Each file below exports a
`create…` part; the parts are built in dependency order on one object, so a part reads earlier
parts through `s`. A page can hold any number of sessions.

| File                        | Responsibility                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `document.ts`               | The committed diagram store, selection, undo/redo and browser persistence.                        |
| `editor.ts`                 | Tool, drag feedback, inline editing and camera helpers. Never saved.                              |
| `scene.ts`                  | Derived drawing data: visible graph, rectangles and memoized routes.                              |
| `actions.ts`                | Editor operations used by the UI; each wraps a model edit in one undo step.                       |
| `pointer.ts`                | Canvas gestures.                                                                                  |
| `canvas-text.ts`            | Text ids (`@note:0`, `@legend:1`, `@phase:id`) for text that is not an object, and its selection. |
| `layout.ts`                 | Layout passes, previews, the layout lab's settings and checkpoints.                               |
| `sculpt.ts`                 | The layout timeline and the layout brush.                                                         |
| `emphasis.ts`, `routing.ts` | The shown emphasis state, and router settings.                                                    |
| `file-session.ts`           | The diagram's `.draft` source: a served file, an example, or text a host owns.                    |

Session options replace hooks into the app: `storageKey` (browser persistence), `urlState`
(`?state=`), `confirm`, `openLink` and `onInteract`. Components read the session from context with
`useDiagramSession()`.

### The app shell

The shell acts on `activeSession()` (`active-session.ts`): the session whose canvas the user last
pointed at or focused. The app creates one session in `index.tsx` and marks it active.

| File                        | Responsibility                                           |
| --------------------------- | -------------------------------------------------------- |
| `canvas-commands.ts`        | Commands that act only on the session: undo, add, zoom.  |
| `canvas-keyboard.ts`        | Canvas shortcuts and shape copy and paste.               |
| `commands.ts`               | All named commands for the toolbar, menus and shortcuts. |
| `keyboard.ts`               | App shortcuts and paste, around the canvas ones.         |
| `comparison.ts`             | Compare: candidates, cameras, overlay layers and Apply.  |
| `files.ts`                  | Import, image embedding and JSON / SVG / PNG export.     |
| `launch.ts`, `workspace.ts` | What the viewer opens, and the served folder.            |
| `links.ts`, `open-link.ts`  | Where object links go, and opening them.                 |
| `ui.ts`, `toast.ts`         | Panels, menus, dialogs and status messages.              |

The canvas and the `canvas-*` modules never import the shell. The embeddable editor is built from
them alone, and `scripts/build-editor.ts` fails when a shell module gets into its bundle.

### Rules

- **Every saved change is one undo step.** `transact(label, fn)` snapshots the document, applies
  `fn` through Solid's `produce`, and records the step only if something changed.
- **Previews never touch the document.** Layout animation, timeline scrubbing and brush strokes
  draw from temporary geometry in `scene.ts`. Keeping a step or finishing a stroke commits it.
- **Finish pending work before an edit.** Modules register `onBeforeEdit` handlers to commit an
  inline label, accept a layout preview, close a timeline or finish a drag.
- **Camera movement is not an edit.** It saves with the document but never creates undo steps.
- **Every camera change goes through `setCamera`.** It is the one place `SessionOptions.onCamera`
  is called, with who moved it: `'host'` (the camera part), `'fit'` (the editor's own automatic
  fits and reveals) or `'user'` (the reader's drag, pinch, wheel, keys and buttons). Never write
  `setDoc('camera', ...)` from a gesture: the host would not hear it.

## import/ — foreign diagram source

`import/` detects supported text formats and converts DOT, Mermaid flowchart and sequence, and D2 graph
facts to validated native source. It reports unsupported meaning and loss before opening. The CLI `import`
command writes a new `.draft` file. Viewer entry points are planned separately.

## dsl/ and cli/ — diagram files

`dsl/` reads, formats and compiles `.draft` files (see [Diagram files](DSL.md)). It is pure
TypeScript shared by the browser and the command line.

| File                | Responsibility                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `syntax.ts`         | Source lines with comments, the formatter, and the validated model.                             |
| `compile.ts`        | Layout recipes and refinements for one fixed render context; diagnostics with lines.            |
| `channels.ts`       | Routing channels: extra room inside a group where lines must travel; compile lays out twice.    |
| `lanes.ts`          | Lanes outside a flow's band for returns and skips; fold wraps keep theirs (compile.ts).         |
| `cells.ts`          | The `cells` recipe: a group's nodes edge to edge under a title band.                            |
| `translate.ts`      | One committed editor edit as source changes: declarations, `near`/`pin`/`size` refinements.     |
| `source-edits.ts`   | Helpers that add, change and remove single statements.                                          |
| `project.ts`        | A compiled scene as an editor `Diagram`, and the canonical geometry the CLI prints.             |
| `inline-sources.ts` | Exports: each `src=` on a code node becomes an inline `<<TAG` body, so the export stands alone. |

Groups and the opinionated root layouts follow a few rules:

- **A group's frame decides its layout role.** A boxed group is a layout scope: it pads its
  members and takes one place, so it takes one rank, in its parent. A `frame=soft` or
  `frame=none` group is never a scope. `layoutParent` (`syntax.ts`) gives its members the nearest
  boxed container, so they rank by their own connections. The model parent stays for color,
  change marks, `in=` and source edits. The router treats only boxed groups as frames.
- **Soft is an attribute, not a new statement.** A group already has the label, the color for
  `auto` members and the change marks. Thus `vary` can soften a group with a one-line edit (the
  "fewer containers" variant in `cli/variants.ts`), and `frame=box` stays the default.
- **A soft tint follows layout.** `compile.ts` sizes the tint from the members after layout and
  keeps members side by side in each rank. It joins their padded boxes where one rectangle would
  cover a non-member, and `check` reports `soft-split` and `soft-overlap` for what remains. In the
  viewer, a drag on a tint writes one `stay` per member, as Tidy does.
- **Lanes and sequence are root recipes, not engines.** `layout root lanes` (`swimLanes`) ranks
  every leaf across the whole drawing, so one rank is one column across every lane. Every node
  must sit in a top-level group. `layout root sequence` (`sequenced`) puts participants in file
  order and one message per row in edge order; messages are straight lines (`messageRoute` in `model/routes.ts`) and skip the router. Both
  reuse `node`, `group`, `edge` and `layout`, with no second syntax. The arithmetic of lanes,
  label gaps and phase blocks is in `dsl/sequence-layout.ts`.
- **A kind of message is a field on its edge.** `message=` and `answers=` stay on the edge
  record, and an `action` line is an edge from a participant to itself with `message: 'action'`,
  so order, phases, states, notes, deletion and renaming work for it as for any message.
  `headOf` and `tailOf` (`model/markers.ts`) draw each kind's ends, `messageRoute` draws an
  action's box, and `messageKey` (`model/status.ts`) adds the key rows. With `activations=on`,
  `activationSpans` (`dsl/sequence-layout.ts`) reads the bars from call and reply pairs, the
  compiler stores their boxes in `layout.sequence.activations`, and `messageRoute` ends each
  message on a bar's side. No style field holds a
  kind, so a source edit never writes one as `kind=` or `head=`.
- **A sequence never guesses.** It explains one exchange, so each meaning comes from a word in
  the file. A dashed line is not a reply until the file says `answers=` or `message=reply`, and
  `kind=async` stays a style. A reply pairs with a message only through `answers=`, never by
  direction or nearness. The editor moves a message one place at a time and refuses a move that
  puts a reply above its message or splits a phase; it never edits a phase to follow a move
  (`moveEvents` in `dsl/translate.ts`). `draftably compare` refuses a file with kinds, because a
  change mark cannot show a change of kind.
- **Rows are order, not time.** Every sequence draws `SEQUENCE_CAPTION` (`model/status.ts`) in
  its key, and an author cannot remove it. Row spacing comes only from what each row draws.
  This is why the language has no measured time, and why it has no fragments (`alt`, `opt`,
  `loop`, `par`) or other UML operators: each needs order and join rules that a row band cannot
  state. A phase is a narrative band and nothing more.
- **Sequence measures.** A one-line header is 32 high and headers stand on one line. A label
  sits in one gap between two lifelines, with 8 clear at each end; between distant lanes it
  takes one gap, inside one band when it can (`labelSlot`). A phase label wraps at 96; its band
  holds its label and the margin notes on its messages; bands stand 16 apart (`eventRows`). A
  self-message or an action keeps 8 clear of the next lifeline and the next row. The panel has
  20 of padding. The numbers are the `SEQ_*` constants in `dsl/compile.ts` and `PHASE_WRAP`,
  `ACTIVATION` and `ACTION_PAD` in `model/labels.ts`.
- **Activation bars follow calls.** A bar opens where a participant receives a `call` and
  closes at the last reply that answers it. With no reply it closes at that participant's next
  message to another participant, or it is a 16-high stub. A second call on an open bar steps 4
  to the right. A send, a plain message and a call to itself open no bar. The Mermaid import
  turns bars on only when the source's bars match these rules.

Flow lines and their labels follow a few rules:

- **A flow label wraps at 140.** `LABEL_WRAP` in `model/labels.ts` is about 24 characters of the
  annotation type, so a short phrase stays on one line. Across the repository's 566 flow labels the
  median is 44 and the 95th percentile is 109. Sequence messages wrap at `MESSAGE_WRAP` (168),
  about the same character count in their larger type.
- **A long label gets a straight run.** A label on a bend reads as part of neither run. When no
  run of a route holds the label, `roomForLabel` (`model/routes.ts`) slides one bend. The slide
  stands only when the route stays clear of every box, crosses no more lines and runs beside no
  more. A route with no room keeps its label where it was.
- **Lines between two columns run straight.** When each member of one packed column connects to
  one member of the next, the group packing pass in `dsl/compile.ts` moves each target down to
  its source's centre line. Targets only move down, and the added height has a cap, so a tall
  column can still bend a line.

`server/file-session.ts` owns one open file: it serves the source with a content revision,
watches its folder (so rename-based saves are seen), streams changes as server-sent events, and
writes saves atomically. A save based on an older revision is refused with 409, and invalid
source with 422. `state/session/file-session.ts` is the browser side: it detects a session at
startup, switches browser storage off, and projects each valid revision into the document. While a
file is open, `commit` in `state/session/document.ts` hands every edit to the session, which translates it, shows
the recompiled result and saves it; undo and redo walk source versions instead of snapshots.

Code nodes with `src=` read other files, so they follow a few rules of their own:

- **The host reads the files, not the compiler.** `server/code-files.ts` reads each file a
  `.draft` names and gives the compiler its text as `CodeFiles`. The compiler stays pure. The
  static app has no files, so a `src=` node there draws a placeholder.
- **Files stay inside one root.** For the viewer, the root is the folder `draftably open`
  serves. For the CLI, it is the `.draft` file's git root, or its folder outside a repository. A
  path or link that leaves the root is refused, and so is a file that is not a regular file or
  is over 200 KB.
- **Only a `.draft` file reads files.** The CLI never reads `src=` for a source embedded in a
  PNG, SVG or PDF, because that source can come from anyone. An export already carries its code
  inline (`dsl/inline-sources.ts`).
- **The viewer follows the files.** `server/file-session.ts` watches each `src=` file's folder
  and sends a `files` event when one changes, so the page redraws without a reload. A folder
  that cannot be watched stays unwatched, and the server keeps running.
- **The API answers localhost only.** `/api` requests need a `localhost`, `127.0.0.1` or
  `[::1]` Host header (`server/workspace.ts`), so a page that rebinds its DNS name cannot read
  the served folder.

A file-backed session follows a few rules:

- **The file holds intent, not a picture.** The editor writes statements (declarations, `near`,
  `nudge`, `stay`, `pin`, `size`), never the positions that layout computed. A drag writes a
  relative preference by default, so the layout can still adapt when an agent adds content. The
  same source gives the same geometry in Node and in the browser; `pnpm prove:file` compares them.
- **The disk is the authority.** Browser storage is off while a file is open, and a camera move
  never writes the file. Invalid source keeps the last valid drawing, and the viewer writes
  nothing until the source is valid again.
- **An edit the file cannot hold is refused.** `translate.ts` throws `UnsupportedEdit` (for
  example for bends, label positions and images), and the session puts the drawing back with a
  toast. The viewer never shows an edit as saved when the file did not get it.
- **A layout result is a recipe or an arrangement.** A result that the source can compute again
  (Rebuild, an Apply in Compare, connection settings) is saved as a recipe: `layout scope engine=…`
  or the `routing` line. The compiler runs the engine cold for that scope each time, so an added
  object lays the scope out again. A result that depends on the earlier drawing (Tidy, a timeline
  step, a brush stroke) is saved as soft `stay` lines for the objects that moved. Those tools
  commit with kind `'arrangement'`, so the session writes positions and does not infer `near`
  lines from the diff. A file never stores an engine step to replay, because the first edit would
  change what that step means.
- **An engine change moves every recipe diagram.** Files depend on engine output, so
  `pnpm test:engines` holds that output fixed. `pnpm prove:layout` checks that the saved file and
  the browser agree after each tool.

`server/workspace.ts` serves a folder: it lists its `.draft` files, creates new ones (never
overwriting, never outside the folder), draws SVG thumbnails cached until a file changes, and routes
`?file=` requests to one file session per path. The dev server loads it through Vite
(`ssrLoadModule`) so it can use asset imports. `state/launch.ts` decides what the viewer opens from the URL and the server: a file, an
example (`model/examples.ts` bundles `examples/*.draft`), the start page, or the static app's
browser copy. With files in the folder, the start page and the editor's `FilesPanel` list them and
poll the folder while visible (`watchWorkspace`); examples show only when the folder is empty. An example runs through the same session code with saving switched off.

`cli/` is the `pnpm draftably` command. `scripts/draftably.mjs` rebuilds it with `vite build --ssr` when a
source file is newer than `dist-cli/`.

## runtime/ and packages/ — portable distribution

`src/runtime/` exposes native source rendering, validation, diagnostics, and an independent read-only viewer. `packages/runtime/` builds the portable package and its viewer worker. The runtime uses the native compiler and deterministic font metrics; it does not expose the editor store or compiled scene.

`packages/markdown/` owns shared fence metadata, local-source resolution, diagnostics, and static asset preparation. Its remark and markdown-it adapters map host syntax to that core. The optional browser client adds the independent viewer and owns its cleanup. Host adapters own file identity, asset publication, cache replay, and public URLs; they do not implement another compiler.

`src/graph-api/` is `@draftably/runtime/graph`: `layout()` turns plain nodes, groups and edges into the statements a `.draft` file parses to, compiles them, and returns geometry under the caller's IDs with the file it built. `route()` routes lines between boxes the caller placed. `pnpm bench:graph` checks both against `scripts/bench/graph-corpus.mjs`.

The user guides live on the site: [Support](https://draftably.dev/docs/support), [Render SVG](https://draftably.dev/docs/render-svg), [Markdown](https://draftably.dev/docs/markdown), [How embedding works](https://draftably.dev/docs/embed-concepts) and [Build an adapter](https://draftably.dev/docs/build-an-adapter). Their source is in `site/docs/pages/`.

## editor/ — the embeddable editor

`editor/index.ts` is the surface a host builds on. `Editor` draws the canvas for one session.
`mountEditor(host, { source, onChange })` creates a session, edits `source` in it, reports each kept
edit as text, and takes `update(source)` from the host. The app renders `Editor` for its own canvas.
A mounted editor listens for the canvas shortcuts only (`canvas-keyboard.ts`); the app adds its own
keys, such as the palette and panel toggles, in `keyboard.ts`.

## components/ — the interface

Components read state and call actions; they hold only local UI state. The canvas renders the
diagram declaratively with `scene/NodeView`, `GroupView` and `EdgeView`. The same components draw
comparison candidates through `scene/StaticScene`, so the editor and Compare always match.

Styles are plain CSS. Design tokens and shared controls are in `styles/app.css`; each larger
component imports its own stylesheet. The editor's light and dark modes switch through
`data-theme` on the document element.

The drawing itself is styled by the diagram's appearance (`doc.appearance`), not by CSS: scene
components, `cli/svg.ts` and the exports all read colors, padding and type from
`resolveAppearance`. Its canvas color reaches the stage as `--diagram-canvas`. Fonts are bundled
in `src/assets/fonts`, registered at startup and embedded in exported SVG by `lib/font-data.ts`.
Text is wrapped from stored advance widths, never DOM measurement, so geometry never depends on
which fonts have loaded.

Appearance follows a few rules:

- **Only padding and type move things.** They change node sizes, so they change the layout. Colors
  and shades never move anything: a shade edit, a theme color or a dark page keeps every box.
- **A theme switch keeps rows and order.** Nodes sit on slots sized in Drafting with the file's
  own overrides. Each theme draws its node in the slot, and a slot grows only where the node does
  not fit (`tests/theme-slots.test.ts`).
- **The file owns the look.** The `theme` and `theme-color` lines hold every override. The
  viewer, the CLI, exports and save/reopen all read them; nothing is kept in view state.
- **Contrast is a test.** `tests/themes.test.ts` holds every shade of every family in every theme
  to its WCAG target and to light-to-dark order. A palette change must keep it passing.
- **A dark page changes only colors.** `forScheme` swaps a default-theme file to `drafting-dark`.
  `runtime/color-scheme.ts` watches the element's computed `color-scheme`, and `renderSvg` with
  `colorScheme: 'auto'` draws both schemes from one layout as `light-dark()` colors. Any other
  theme, or a file color, keeps its colors on every page.
- **A gap takes the color under it.** Line breaks (halos) and label cards fill with the surface
  under them, such as a lane or a phase band, not the canvas color (`surfaces` and `haloPieces` in
  `model/surface.ts`). A canvas-colored card on a tinted lane reads as a patch. For the same
  reason a sequence draws no panel border when its lanes hold every participant (`panelDrawn`).

The status bar shows the running version and, for a build from a checkout, its commit
(`__DRAFTABLY_BUILD__`, set by `define` in `vite.config.ts`). A review screenshot then says which
build it saw. The commit is read at build time, so a dev server started before a commit shows
the older one.

The research behind the palettes, and the textured-theme study that did not ship, is in
[research/README.md](research/README.md#themes-and-palettes).

## engines/ and workers/

The layout, routing, comparison and brush engines are self-contained, deterministic TypeScript,
ported from the original release's JavaScript. Each has one entry module with the API it always
had (`LayoutLab`, `RouteLab`, `ExplorerLab`, `SculptLab`) and the types callers import.
`pnpm test:engines` compares their output with the original release in `reference/v7/` across
all examples.

- **Node runs them as they are.** The engine suites import the entry modules with no build. So
  an engine module imports other engine modules with the `.ts` extension, and imports only types
  from outside `engines/`.
- **Output is fixed.** A change must not alter a constant, an iteration order or the order of a
  float sum unless it means to change drawings: parity is byte for byte.

| Module                                                     | Role                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `layout-engine.ts`                                         | `LayoutLab`. Its phases are in `layout/`.                                             |
| `layout/settings`, `topology`, `intent`                    | Algorithms, defaults and checks; ranks and feedback links; start and end hints.       |
| `layout/layered`, `trees`, `grid`                          | The targets: ranks with sweeps and folding; trees; the seed and soft grid.            |
| `layout/scene`, `seed`                                     | One run's view of the document and its guarded moves; a rebuild's first placement.    |
| `layout/arrange`                                           | The solve of one container's children: target, ticks, best state.                     |
| `layout/forces`, `separation`, `packing`, `objective`      | Forces per tick; overlap removal; the packing fallback; the energy.                   |
| `layout/report`, `compute`                                 | Rounding, the pass limit and the report; scope and the walk over containers.          |
| `routing-engine.ts`                                        | `RouteLab`. Its phases are in `routing/`.                                             |
| `routing/geometry`, `conflicts`, `cost`, `tuning`          | Segments and obstacles; line against line; path cost; penalties and limits.           |
| `routing/context`                                          | One run's view of the scene: boxes, edges in order, obstacles per edge.               |
| `routing/ports`, `sidepairs`                               | Port choice: the slot on a side, and each allowed pair of sides with its stubs.       |
| `routing/score`                                            | The score of a candidate route.                                                       |
| `routing/doglegs`, `search`, `heap`, `find`                | Path search: lines of up to two bends, A\* over the grid, the best route of one edge. |
| `routing/paths`, `planned`                                 | Path validity and staircase removal; a `flow` scope's planned routes.                 |
| `routing/improve`, `repair`, `nudge`, `tidy`, `tidy-ports` | The passes over the whole drawing.                                                    |
| `routing/compute`                                          | Each edge in turn, then the passes, then the report.                                  |
| `explorer-engine.ts`, `sculpt-engine.ts`                   | `ExplorerLab` (comparison candidates) and `SculptLab` (brush dabs, timelines).        |

`lib/engine-tasks.ts` runs layout, comparison candidates and timelines in a single module worker
(`workers/engine.worker.ts`). Tasks can be cancelled; if the browser blocks workers they run on
the main thread instead.

## Storage

| Key                              | Contents                                        |
| -------------------------------- | ----------------------------------------------- |
| `diagram-studio-v5`              | The current diagram (older keys are read once). |
| `diagram-studio-v5-ui`           | Which side panels are open.                     |
| `diagram-studio-v7-last-journey` | The most recent layout timeline.                |

Brush holds and the clipboard last for the session only.

## Scripting

`window.diagramStudio` exposes a small API (get/set, layout, compare, timeline, brush, export,
diagnostics) for automated browser checks and the console. The app does not use it.
