# Architecture

draftably is a SolidJS single-page app. All editor state lives in the browser; computation-heavy work
runs in a Web Worker. The editor code is split into three layers, each depending only on the ones below it. The portable runtime and adapters are described later.

```
components/  →  state/  →  model/  →  engines/
                   ↘  dsl/  ↗
cli/  →  dsl/
```

## model/ — pure data and operations

Plain TypeScript with no DOM or Solid dependencies, so it is unit tested directly.

| File              | Responsibility                                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| `types.ts`        | The `Diagram` document and everything in it.                                                                      |
| `document.ts`     | `normalize` validates any input (files, storage, clipboard) and migrates v1 files.                                |
| `graph.ts`        | Lookups and hierarchy: children, ancestors, collapsed containers, selection roots.                                |
| `edits.ts`        | Every document change: add, connect, wrap, delete, align, paste, intent, … Each mutates the document it is given. |
| `geometry.ts`     | Rectangles, rounding and SVG path helpers.                                                                        |
| `labels.ts`       | Title area, wrapping and label placement for every shape, shared by the compiler and the canvas.                  |
| `rich-text.ts`    | `[label](href)` links in notes and footnotes, wrapped as plain words wrap.                                        |
| `footnote.ts`     | The footnote block between the drawing and the key.                                                               |
| `appearance.ts`   | Five preset themes, color families with numeric shades, and `resolveAppearance` (preset, then file overrides).    |
| `fonts.ts`        | The bundled faces and deterministic text measurement from `font-metrics.json` (see `pnpm font-metrics`).          |
| `routes.ts`       | Ports, edge-label placement and the call into the routing engine.                                                 |
| `static-scene.ts` | A read-only scene for comparison candidates.                                                                      |
| `samples.ts`      | The example catalog backed by `src/samples/*.json`.                                                               |

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

| File              | Responsibility                                                                               |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `syntax.ts`       | Source lines with comments, the formatter, and the validated model.                          |
| `compile.ts`      | Layout recipes and refinements for one fixed render context; diagnostics with lines.         |
| `channels.ts`     | Routing channels: extra room inside a group where lines must travel; compile lays out twice. |
| `lanes.ts`        | Lanes outside a flow's band for returns and skips; fold wraps keep theirs (compile.ts).      |
| `cells.ts`        | The `cells` recipe: a group's nodes edge to edge under a title band.                         |
| `translate.ts`    | One committed editor edit as source changes: declarations, `near`/`pin`/`size` refinements.  |
| `source-edits.ts` | Helpers that add, change and remove single statements.                                       |
| `project.ts`      | A compiled scene as an editor `Diagram`, and the canonical geometry the CLI prints.          |

`server/file-session.ts` owns one open file: it serves the source with a content revision,
watches its folder (so rename-based saves are seen), streams changes as server-sent events, and
writes saves atomically. A save based on an older revision is refused with 409, and invalid
source with 422. `state/session/file-session.ts` is the browser side: it detects a session at
startup, switches browser storage off, and projects each valid revision into the document. While a
file is open, `commit` in `state/session/document.ts` hands every edit to the session, which translates it, shows
the recompiled result and saves it; undo and redo walk source versions instead of snapshots.

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

The user guides live on the site: [Support](https://draftably.dev/docs/support), [Render SVG](https://draftably.dev/docs/render-svg), [Markdown](https://draftably.dev/docs/markdown), [Element and viewer](https://draftably.dev/docs/element) and [Build an adapter](https://draftably.dev/docs/build-an-adapter). Their source is in `site/docs/pages/`.

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

## engines/ and workers/

The layout, routing, comparison and brush engines are self-contained, deterministic JavaScript
from the original release, with `.d.ts` files describing their public APIs. `pnpm test:engines`
compares their output with the original release in `reference/v7/` across all examples.

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
