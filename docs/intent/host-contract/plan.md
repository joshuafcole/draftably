---
title: 'Host contract — one contract for every framework'
slug: 'host-contract'
phase: plan
status: implemented
last_updated: '2026-11-11'
---

# One host contract for every framework

This plan sets the design goal in
[ARCHITECTURE.md](../../ARCHITECTURE.md#design-goal-one-host-contract-thin-framework-bindings).
It starts from five PRs by joshuafcole for Callsheet, a Solid app that embeds Draftably:
byronwall/draftably#498, #499, #500, #501 and #502.

**Sources.** A first plan, then two independent architecture reviews (a clean Opus agent and a
GPT 6.1 Sol thread, each designing blind before reading the plan), an audit of the four framework
packages, a browser spike, and a final review of performance, developer experience and end-user
experience by a second clean Opus agent and Sol thread. The spike's second round tested their
guesses. Every fact below was checked against `main` at `a8f6247b`.

## Status

**Built, in review, as one stack** (#528): #526 this plan, #527 step 1, #531 step 2, #535 step 3,
#537 step 4, #538 step 5, #539 step 6, and step 7 on `claude/hc-7-prove-docs`. The stack ships as
one minor release; `.changeset/host-contract-release.md` lists every breaking change with
before-and-after examples.

Shipped, as planned unless a "Changed in step N" note says otherwise:

- One contract on both elements: `options`, mount once, live fields, `draft-<name>` events from
  `HOST_EVENTS`, `status`, the version warning, typed events (step 2).
- A shared worker pool, one font set, constructable sheets, `--draft-*` tokens, the size from a
  `ResizeObserver`, and `pnpm bench:host` (step 3).
- One camera, `fit(ids)`, `reveal`, `MoveResult` (step 4); `geometry()`, `ready`, `select`,
  `contextmenu`, cancelable `link` (step 5).
- Slots, `data-draft-input`, level of detail, slot diagnostics, the editor in a shadow root and
  `host.css` (step 6).
- A complete recipe per framework and plain HTML, compiled in CI (`pnpm prove:recipes`). The host
  proof (`scripts/lib/host-proof.ts`) on server-rendered, hydrated pages in the four Vite apps
  (`pnpm prove:frameworks`, CI) and in Next.js, SolidStart, Nuxt and SvelteKit
  (`pnpm prove:meta`). The docs show `el.viewer`, `el.editor` and `diagnostics` for debugging,
  and a complete strict CSP (step 7).

**Changed in step 7.** The proofs found four problems, now fixed:

- The built packages created their workers in a nested form,
  `new URL("" + new URL("assets/x.js", import.meta.url).href, import.meta.url)`. Turbopack
  (Next.js) turned it into a `file://` URL, and Nuxt's `assets` alias took the bare `assets/`
  path. Both lost the worker, so the viewer failed to start. The runtime and editor builds now
  write the plain `new Worker(new URL("./assets/x.js", import.meta.url))`, which webpack,
  Turbopack and Vite all bundle.
- A Next.js server component cannot call `renderSvg` from `@draftably/react`, a client module.
  `@draftably/react/server` exports it.
- Solid's server HTML wrote `style=""` for an unset `style`, a CSP violation per element.
- A viewer update dropped a focused outline button (the screen-reader item below). Focus now
  returns to the same item, or to the drawing.

The review of step 7 found two more:

- The Vite dev server pre-bundled `@draftably/editor`, so the editor's worker URL pointed into
  `.vite/deps/assets/` and returned 404. The editor then computed layouts on the main thread.
  The docs, the recipes and the worker error now exclude both packages from `optimizeDeps`, and
  `pnpm prove:recipes` edits an editor under `vite` in development.
- The React, Solid and Vue wrappers wrote `options ?? {}` before the mount, which replaced
  options a host set through the element ref. They now write `options` only when the prop is
  set. Svelte writes the prop before `bind:element` gives the host the element. A Svelte spread
  would write the object as a string attribute on the editor, which registers late.

Every meta-framework passes the strict CSP with a per-request nonce. SvelteKit adds one hash:
its route announcer has an inline `style` attribute, so its policy adds
`style-src-attr 'unsafe-hashes' 'sha256-…'` for that one value.

**Deferred.**

- **Touch.** Pinch zoom in the viewer, and one-finger page scroll over a viewer until the user
  activates it, are not built. The viewport is still `touch-action: none`.
- ~~**The editor's dark theme through a wrapper.**~~ Done in the embedded-docs stack: every
  wrapper passes other attributes, such as `data-theme`, to its element.
- **The warm first-diagram budget** stays unmet; it is layout-bound (step 3).
- **`pnpm prove:meta` is not in CI.** Four production installs take minutes; Next.js alone
  downloads about 80 MB. Run it before a release.
- Already deferred: `hover`, `layout({ draft })`, Svelte Flow and Vue Flow edge components, and
  the open questions for Callsheet below.

## Facts

| Fact                                                                                                                                                                                                                                     | Evidence                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `@draftably/editor` bundles its own Solid. Its published entry is `mount.tsx`.                                                                                                                                                           | `scripts/build-editor.ts:87-111` has no `external`.                                            |
| `@draftably/runtime` has no Solid. The viewer renders in a worker by default.                                                                                                                                                            | `scripts/build-runtime.ts:18-22`, `src/runtime/viewer.ts:437`                                  |
| There are two renderers. The string renderer (`runtime/svg-renderer.ts`) serves `renderSvg`, the viewer, Markdown, the CLI and exports. The Solid scene (`components/scene/`) serves the editor and Compare.                             | `src/runtime/render.ts:1`, `src/components/canvas/Canvas.tsx:5-8`                              |
| The viewer copies the SVG through a tag allowlist without `foreignObject`, and replaces the whole SVG on every update.                                                                                                                   | `viewer.ts:93-97`, `viewer.ts:652`                                                             |
| The viewer camera is `{ centerX, centerY, zoom }` in world units, zoom 0.02–8. The editor camera is `{ x, y, k }` (screen offset of the world origin), zoom 0.08–4, saved in the document.                                               | `viewer.ts:15`, `viewer.ts:318`, `src/model/types.ts:246`, `src/state/session/editor.ts:39-40` |
| The viewer emits `camera` only on pointer-up during a pan. The editor emits nothing; pinch and drag write `doc.camera` directly.                                                                                                         | `viewer.ts:505`, `src/state/session/pointer.ts:189,469,477`                                    |
| The editor already has `fitView`, `fitRects`, `revealObject` and `centerSelection`, with a 42 px pad. #500 adds a second camera module with a 40 px pad.                                                                                 | `editor.ts:159-224`                                                                            |
| `MountedEditor.session` already makes the whole internal store a public type.                                                                                                                                                            | `src/editor/mount.tsx:38`                                                                      |
| `<draft-editor>` passes only `source` and `onChange` to `mountEditor`. No wrapper can set `storageKey`, `openLink`, `confirm`, `onInteract` or a style nonce.                                                                            | `src/editor/element.ts:47-55`                                                                  |
| `<draft-diagram>` dispatches only `draft-update`. Its `camera`, `itemactivate`, `link`, `diagnostics` and `render` events are reachable only through `el.viewer.on`, and those listeners are lost when the element re-mounts its viewer. | `src/runtime/element.ts:203,231,128-152`                                                       |
| `<draft-diagram>` re-mounts its viewer, and loses the camera, on every `options` set and on every `label` or `outline` change. A React parent that passes `options={{ … }}` re-mounts it on every render.                                | `element.ts:102-105,150-152`                                                                   |
| `<draft-diagram>` uses shadow DOM; `<draft-editor>` does not. Host CSS does not reach into the viewer.                                                                                                                                   | `element.ts:59-71`, `editor/element.ts:47`                                                     |
| The canvas supports a context menu, but `mountEditor` does not pass it on.                                                                                                                                                               | `Canvas.tsx:27`, `mount.tsx:68`                                                                |
| Geometry is published in one shape today: the graph API's `LayoutResult` (`Box`, `PlacedBox`, `EdgeOut`). `renderSvg` returns items without boxes.                                                                                       | `src/graph-api/core.ts:77-117`, `src/runtime/types.ts:65-93`                                   |
| With `compare` or `states`, one ID is drawn in more than one panel.                                                                                                                                                                      | `svg-renderer.ts:585-592`                                                                      |
| Item IDs match `[A-Za-z_][A-Za-z0-9_.-]*`, so they never contain `:`.                                                                                                                                                                    | `src/dsl/syntax.ts:477`                                                                        |
| An editor resize replaces the whole `size` line with an exact width and height.                                                                                                                                                          | `src/dsl/translate.ts:758-770`                                                                 |
| A host source update ends local undo: undo cannot step past it.                                                                                                                                                                          | `src/state/session/file-session.ts:840-843`                                                    |

## The common problem

There is no neutral way for a host to **address an item**: to find where it is, frame it, put
content on it, or hear what the user did to it. Each Callsheet PR cuts its own hole through the
editor's Solid internals: camera methods on `session` (#500), a Solid `Component` prop (#501), and
the Solid scene with the internal `Diagram` (#502). The published packages cannot carry these holes:
the editor bundles a second Solid, and the viewer has no Solid at all.

The same gap shows up in every framework package, because they all wrap the custom elements, and
the elements expose less than the handles behind them.

| Capability                        | React                     | Solid              | Vue                   | Svelte             | Root cause                                  |
| --------------------------------- | ------------------------- | ------------------ | --------------------- | ------------------ | ------------------------------------------- |
| Element and handle                | `ref`                     | `ref`              | `expose`              | **none**           | Svelte wrapper has no bind or ref.          |
| Viewer events other than `update` | via ref                   | via ref            | via ref               | **none**           | The element dispatches only `draft-update`. |
| Editor options                    | **none**                  | **none**           | **none**              | **none**           | The element passes only `source`.           |
| New `options` object              | **re-mount every render** | re-mount on change | re-mount on change    | re-mount on change | The setter always re-mounts.                |
| Flow edge component               | `DraftablyEdge`           | —                  | **none** for Vue Flow | write it yourself  | Only React got one.                         |
| Adding one event today            | edit                      | edit               | edit                  | edit               | Each wrapper lists events by hand.          |

#498 and #499 are plain fixes, not contract work.

## Options

Five approaches were scored. Dimensions come from the owner's goals (least code per framework,
parity, few future requests) and from the failure modes found in code.

| Dimension                                          | A. Merge PRs as written | B. Callbacks in the renderers (`mount(el)`, plan v1) |                                   C. Target registry + a portal helper per framework |            **D. Target registry + slots on both elements** | E. Display list; each framework draws |
| -------------------------------------------------- | ----------------------: | ---------------------------------------------------: | -----------------------------------------------------------------------------------: | ---------------------------------------------------------: | ------------------------------------: |
| Lines per framework for host content               |                       2 |                                                    6 |                          6: a portal helper, about 15–40 lines; Svelte has no portal |                              **10**: children pass through |                    3: a renderer each |
| Host context, reactivity and CSS reach the content |                       3 |                                    3: separate roots | 5: context yes, but host CSS does not reach a portal inside the viewer's shadow root | **10**: content stays a light-DOM child of the host's tree |                                     9 |
| Content keeps its identity across `update(source)` |                       6 |                       2: the viewer replaces the SVG |                                                                                    9 |                                                      **9** |                                     7 |
| Works on the viewer's worker and sanitizer path    |                       1 |                       1: `foreignObject` is stripped |                                                                                    9 |                                                      **9** |                                     6 |
| New events or content kinds need no wrapper change |                       2 |                                                    5 |                                                                                    8 |                                                     **10** |                                     3 |
| Editor rework needed                               |                       9 |                                                    8 |                                                                                    8 |                 **4**: the editor moves into a shadow root |                                     1 |
| Internal types made public                         |                       1 |                                                    8 |                                                                                    9 |                                                      **9** |                                     4 |

**Choice: D.** The editor rework is a one-time cost. The other options cost code in every framework
package for every future capability. C was the choice of both reviews. It fails one fact they missed:
`<draft-diagram>` renders in shadow DOM, so host CSS (Tailwind classes, theme rules) does not style
content portalled into it. Slots solve that, and need no portal at all.

**Gate: passed on 2026-11-10, in two rounds.** D needed three proofs before the slots step. Each
ran with real mouse and keyboard input in Chromium, Firefox and WebKit (Playwright 1.64). Round 2
followed a final review by a clean Opus agent and a GPT 6.1 Sol thread, and tested their guesses.

1. **Slots in an anchor layer work in all three browsers (round 1).** A prototype element replaced its whole
   SVG on every update, as the viewer does, and kept one stable target per item. Each target held a
   named `<slot>`. `body:` content filled its box and scaled with the camera. `overlay:` content
   stayed in screen space and did not scale. Content moved with an update, and content for a removed
   item drew nothing. Host CSS styled the content. An input inside it took typing, and
   `composedPath()` showed the element its `data-draft-input` marker. `document.elementFromPoint`
   found the content, and empty space passed through to the SVG.
2. **All four frameworks pass slot content through a wrapper, marked with `data-draft-slot`.**
   Round 1 put `slot="…"` children directly on the element, and React 19.2, Solid 1.9, Vue 3.5 and
   Svelte 5.57 all passed. Round 2 put them through a wrapper component, as the real packages do.
   There Svelte 5 fails to compile ``slot={`body:${id}`}`` ("Element with a slot='...' attribute
   must be a child of a component or a descendant of a custom element"). A static `slot="x"` under
   a component compiles as a legacy named slot, so it never reaches `children`. The fix is one rule
   for every framework: the host marks content with `data-draft-slot="body:api"`, and the element
   assigns it with manual slot assignment (`attachShadow({ slotAssignment: 'manual' })` and
   `slot.assign()`). The element never writes to the host's DOM. With that, all five pages (plain
   DOM and the four wrappers) passed all 13–14 checks in all three browsers, with no warnings:
   - the content moved, relabelled, was added and was removed with the framework's list;
   - the default `pointer-events: none` let a click on body text reach the drawing, and a nested
     `<button data-draft-input>` still took its click, through one page-level rule;
   - an input kept focus and its caret (`selectionStart`) across a source update;
   - `overflow: clip` kept the host from scrolling when off-screen content took focus. With
     `overflow: hidden`, Chromium and Firefox scrolled the host, which would move the content away
     from the camera. WebKit did not scroll in either case.
3. **The editor works in a shadow root after one small fix.** The built editor passed every check in
   light DOM: select, drag, Delete, undo, `N` with typing, inline edit, `C Enter Tab Enter`, and
   connect by dragging from a port. In a shadow root, three failed. An event from inside a shadow
   root reaches `document` with its target changed to the host, and `document` lookups cannot see
   inside. Six call sites read the page instead of the editor's own root. With them changed, every
   check passed in all three browsers, with the editor's CSS copied into the root:

   | Call site                                                                | Today                                          | Change                                       |
   | ------------------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------- |
   | `editor/mount.tsx:19`                                                    | `e.target`                                     | `e.composedPath()[0]`                        |
   | `state/canvas-keyboard.ts:66,243,251`                                    | `e.target`                                     | `e.composedPath()[0]`                        |
   | `state/canvas-keyboard.ts:111`                                           | `target === document.querySelector('.canvas')` | `target.matches('.canvas')`                  |
   | `state/canvas-keyboard.ts:170`                                           | `document.querySelector('[data-id=…]')`        | `target.closest('.canvas').querySelector(…)` |
   | `state/session/sculpt.ts:826`                                            | `e.target`                                     | `e.composedPath()[0]`                        |
   | `state/session/pointer.ts:689,738`, `components/canvas/StateBar.tsx:102` | `document.elementFromPoint`                    | `getRootNode().elementFromPoint`             |

   The handlers that Solid delegates already see the real target, so clicks and drags worked
   unchanged. Two of these lines also misbehave today with two editors on a page (from the code; not
   run): line 111 treats only the first editor's canvas as a canvas, and line 170 focuses the first
   shape with that ID on the page, which can be in the other editor.
   `pointer.ts:274` reads `document.activeElement` for the app's title field, which the embedded
   editor does not render.

The slots step also needs these, which the spike showed:

- The editor build injects its CSS into `document.head` (`scripts/build-editor.ts:49-54`). The element
  must put the same CSS into its shadow root instead.
- A guard keeps the fix: a test that fails on `document.elementFromPoint`, `document.activeElement`,
  `document.querySelector` or a bare `e.target` in a document-level listener, in the modules of the
  editor bundle only (`scripts/build-editor.ts` already walks that graph). App-shell files use
  `document` on purpose. Behavior proofs in a shadow root back the guard.

## Two ways in: Draftably draws, or the host draws

The graph API (`@draftably/runtime/graph`, in runtime 0.3.0) already serves a host that draws
everything itself. `layout(graph)` takes nodes, groups and edges and returns each box, each routed
line as points and SVG path data, the side where each line ends, and each label's box. A node can
carry a size that the host measured. `route(graph)` routes lines between boxes the host placed. It
runs synchronously, so lines can follow a drag. The input and output are plain data, with no DOM
and no framework, so this path needs no framework code at all (`src/graph-api/core.ts:29-117,398,435`).

| A host that wants                                                 | Uses                     | Draftably draws | The host draws           |
| ----------------------------------------------------------------- | ------------------------ | --------------- | ------------------------ |
| Draftably's look, pan and zoom, editing, and content on items     | the elements, with slots | the diagram     | slot content             |
| Its own look and components, with Draftably's layout and routing  | `layout`, `route`        | nothing         | everything               |
| A flow library (React Flow, Svelte Flow, elkjs, dagre, Cytoscape) | the drop-ins             | nothing         | nodes; lines from `path` |

**What it settles for Callsheet.**

- **#502.** If Callsheet wants every shape in its own Solid tree, `layout` gives the boxes and lines.
  No Solid scene, `draw` or `measureText` export is needed.
- **#501.** A host that draws its own nodes measures them and passes `width` and `height`. That path
  needs no `min-height`. Layout still never measures host content: the host gives numbers.

**What it does not cover.**

1. **`.draft` text.** Callsheet writes `.draft` files. The graph API takes a graph, and no public
   call returns a `LayoutResult` for a `.draft` source. `layout({ draft })` would close the gap. It
   needs fields that `PlacedBox` lacks today (`src/graph-api/core.ts:84-86`): `label`, `shape` and a
   `color` token for each node and group. It covers single-panel drawings only. Build it when a host
   asks, after Callsheet answers open question 2.
2. **The look.** A host that draws must draw shapes, group bands, labels, arrowheads and colors.
   The result's `draft` field opens the same graph in the viewer when the host wants Draftably's
   look.
3. **Fonts.** Draftably sizes a box without a size from its own font metrics. A host with other
   fonts passes sizes.
4. **Editing, the camera and accessibility.** These stay with the elements. Callsheet's editor (#500)
   still needs the element path.
5. **Views the graph input cannot state.** States, compare, panels, emphasis and icons draw through
   the elements, or later through `layout({ draft })`.

A host chooses by who draws. Both paths are framework-neutral. A Solid scene in the host's tree
(#502) is a third renderer for one framework, and neither path needs it.

## The contract

### Types (in `@draftably/runtime`, shared by the viewer and the editor)

```ts
import type { Box, PlacedBox, EdgeOut } from '@draftably/runtime/graph';

/** World units at the centre of the viewport. Independent of the viewport size. */
export interface Camera {
  centerX: number;
  centerY: number;
  zoom: number; // ZOOM_MIN 0.02 to ZOOM_MAX 8, for both the viewer and the editor
}
export type CameraReason = 'user' | 'api' | 'fit' | 'resize' | 'restore';
export type ItemKind = 'node' | 'group' | 'edge';
/** `pending`: the viewport has no size yet; the latest call runs once it has one. */
export type MoveResult = 'moved' | 'unchanged' | 'missing' | 'pending';
/** A slot name. IDs come from source text, so the type cannot check them; diagnostics do. */
export type DraftSlot = `body:${string}` | `overlay:${string}`;

/** The graph API's shapes, in world units, for the drawing now committed. */
export interface Geometry {
  revision: number;
  frame: Box; // everything drawn: heading, legend, notes, footnotes
  bounds: Box; // shapes, lines and labels only
  nodes: Record<string, PlacedBox>;
  groups: Record<string, PlacedBox>;
  edges: Record<string, EdgeOut>; // the routes as drawn
}

export interface FrameOptions {
  /** Screen pixels kept clear, for example under a host panel. Default 32. */
  padding?: number | { top: number; right: number; bottom: number; left: number };
  minZoom?: number;
  maxZoom?: number; // default 1 for fit: a small diagram is not blown up
}

export interface Anchor {
  slot: DraftSlot;
  id: string;
  kind: ItemKind;
  el: HTMLElement; // the stable target
}

export interface HostEvents {
  render: { revision: number; value: RenderValue; geometry: Geometry | null };
  diagnostics: { revision: number; diagnostics: readonly Diagnostic[]; stale: boolean };
  camera: { camera: Camera; reason: CameraReason }; // at most once per animation frame
  anchors: { anchors: readonly Anchor[] }; // after the DOM commit
  itemactivate: { id: string; kind: ItemKind; input: 'pointer' | 'keyboard'; revision: number };
  contextmenu: { id: string | null; kind?: ItemKind; clientX: number; clientY: number }; // cancelable
  select: { ids: readonly string[]; reason: 'user' | 'api' }; // the editor only
  link: { itemId: string; href: string; target: '_self' | '_blank' }; // cancelable
  change: { source: string }; // the editor only
}

export interface DiagramHandle {
  /** Resolves after the first commit or failure; then after each later one. */
  readonly ready: Promise<UpdateResult>;
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  fit(ids?: readonly string[], options?: FrameOptions): MoveResult; // no ids: the whole frame
  reveal(id: string, options?: FrameOptions): MoveResult; // least move; zooms out only if needed
  geometry(): Geometry | null; // null before the first commit, and for compare and states
  /** Plain-DOM hosts only. The elements set this from their marked children. */
  anchor(slots: readonly DraftSlot[]): void;
  on<K extends keyof HostEvents>(type: K, listener: (event: HostEvents[K]) => void): () => void;
  destroy(): void; // safe to call twice
}

export interface ViewerHandle extends DiagramHandle {
  update(source: string, options?: UpdateOptions): Promise<UpdateResult>;
  focusItem(id: string): boolean;
}

export interface EditorHandle extends DiagramHandle {
  source(): string;
  update(source: string): Promise<UpdateResult>; // the viewer's result union
  select(ids: readonly string[]): void;
  selection(): readonly string[];
}
```

`renderSvg` adds `geometry: Geometry | null` to a successful result. A cancelable event is a
`CustomEvent` with `cancelable: true`; `preventDefault()` stops Draftably's default (its menu, or
opening the link).

### Elements

- Both `<draft-diagram>` and `<draft-editor>` have an `options` property that takes every mount
  option, including `styleNonce`, `openLink`, `confirm`, `storageKey` and `onInteract`.
- **Mount once.** Each element mounts in a microtask after it connects, so every property a framework
  sets in the same tick lands before the first mount. Each element takes own properties set before
  it is defined (`source`, `options`), as `element.ts:47-58` does for the viewer today.
- **Live or re-mount, per field.** Callbacks, `label` and `outline` are live: a change takes effect
  with no re-mount, and callbacks are read through the latest reference. Only `execution`,
  `render.fonts` and `storageKey` re-mount. Nested values compare by structure, so a new object
  with the same values does nothing.
- Both re-dispatch every `HostEvents` type as a bubbling `draft-<type>` `CustomEvent`. Listeners on
  the element survive a re-mount.
- Both reflect `status="loading | ready | error"`, so host CSS styles each state with no wrapper
  code. A failed first update keeps the fallback and shows its diagnostics in the element.
- `el.viewer` and `el.editor` stay the handles. `el.updateComplete` is the handle's `ready`.
- Both render in a shadow root with manual slot assignment.
- If the element is already defined by another copy of the runtime with a different
  `runtimeVersion`, the second copy warns in the console once.

### Slots

A host puts content on an item with an ordinary child of the element, marked with
`data-draft-slot`:

```html
<draft-diagram source="…">
  <div data-draft-slot="body:api">…</div>
  <!-- fills node api, scales with the diagram -->
  <span data-draft-slot="overlay:db">3</span>
  <!-- covers db's box on screen, at screen size -->
</draft-diagram>
```

- **`body:<id>`** fills a node's box, in world space. It scales and clips with the node and replaces
  the visible title. The node keeps its title as its accessible name. Nodes only: a group's box
  holds its members.
- **`overlay:<id>`** is a box the size of the item on screen, at screen scale, with
  `overflow: visible`. Host CSS places a badge or menu anywhere in or around it. Any item kind.
- The element watches its children's `data-draft-slot` attributes and assigns each child to a
  stable target with `slot.assign()`. The target keeps its identity while the item exists, across
  source updates and camera moves. It writes nothing to the host's DOM.
- **Layers.** The anchor layer is a sibling of the SVG, above it, and is never detached:
  `replaceChildren` on the SVG (`viewer.ts:652`) and on the element host (`element.ts:137`) must not
  reach it. The viewport uses `overflow: clip`. The editor draws selection, ports and resize
  handles in its own top layer above the anchor layer, so a body never hides them.
- **Camera moves.** A camera move writes one transform on the body layer and one position per
  overlay, in one animation frame, with no layout reads. The viewport size comes from a
  `ResizeObserver`, not from `getBoundingClientRect` per move (`viewer.ts:289`). Body positions
  change only on a commit.
- **Level of detail.** The anchor layer carries `--draft-zoom` and
  `data-draft-detail="low | full"`. Below a zoom of 0.4 the default is `low`: bodies hide and titles
  show again, and low bodies are `inert`. A host can turn this off.
- A slot for an ID the drawing does not have, or in a `compare` or `states` drawing, shows nothing
  and adds a `DRAFT_SLOT_UNKNOWN` warning to `diagnostics`. Content that overflows its box adds
  `DRAFT_SLOT_OVERFLOW`, from a `ResizeObserver` on the content. Layout never reads it.
- Targets are in drawing order, so Tab moves through bodies in the order a reader sees them.

**Changed in step 6.** Details that settled in code:

- The option that turns level of detail off is `detail: 'auto' | 'full'` on both mount options and
  both elements' `options`. Low detail also sets `inert` on the body layer.
- A new target goes in at its drawing-order place, and a target that exists never moves. Moving
  it would drop focus in its content, so an update that reorders items keeps the old order for
  the targets it keeps.
- `DRAFT_SLOT_OVERFLOW` compares each assigned child's offset size with the node's box, from a
  `ResizeObserver` on the content. Content arrives after its target, so the layer observes a
  target's content again on `slotchange` (the element's `assign()` fires it) and when a host
  appends to the target itself. A box that changes size is checked again.
- A node keeps `data-draft-body` at every zoom; CSS on `data-draft-detail` shows its title again
  below 0.4. So a drawing committed while zoomed out hides the right titles once the user zooms in.
  In the editor, the drawing's own ports and handles show at low detail, and the top layer hides.
- A commit that adds or removes no target only moves the targets: no `anchors` event, no slot
  assignment, no new observing. An editor drag runs a commit each frame. With no slots, a camera
  frame writes nothing to the layer.
- Focus that enters content reveals its item only when no pointer press started in the layer, so a
  press on a marked button never moves the camera under it.
- The editor's top layer draws only the ports and resize handles of nodes that have a body. Their
  selection ring stays in the drawing: it sits outside the node's box, so a body does not cover
  it. A gesture that starts on the top layer captures the pointer there, so the layer takes the
  canvas's move and up handlers too.
- The editor's anchor layer reads `geometry()` only while the host has slots, so an editor
  without slots keeps geometry lazy (built on read, from step 5's review).
- The editor handle reports slot warnings through its own `diagnostics` event. The editor has no
  compile diagnostics to merge them with.
- The built editor registers its scoped CSS, and each mount adopts it where it renders: the page
  for `mountEditor`, the element's shadow root for `<draft-editor>`. `:root` in the editor's CSS
  maps to `:host` and to `.draft-editor-root`, the class a page mount gets.
- Host content never acts as a drawing item. The viewer ignores a click or context menu whose
  target is host content (a host card can carry its own `data-id`), or anything in the anchor
  layer, and the wheel over marked content.

### Input

- Slot content has `pointer-events: none` by default. The pointer selects, drags and edits the item
  underneath.
- An element marked `data-draft-input`, at any depth, takes its own pointer and keyboard input. A
  page-level rule makes it `pointer-events: auto`. The editor's key handler (`mount.tsx:16-21`),
  pointer handler and `sculptKey` check `composedPath()` for the marker and do nothing.
- Wheel and pinch over marked content belong to the host. Over other slot content they move the
  camera.
- Focus that enters a body calls `reveal(id)`. When an item with focused content is removed, focus
  moves to the canvas.
- An editor that is destroyed, or that the user leaves with a pointer press outside every editor,
  stops being the target of shortcuts. Today the active session outlives `destroy`
  (`mount.tsx:57-61,77-84`), and a key after a click on page whitespace still reaches it
  (`mount.tsx:20`).

### Styles and theming

- Each element type builds one constructable stylesheet per page and shares it across instances
  (`adoptedStyleSheets`). Today each viewer adds its own `<style>` (`element.ts:60-61`), and the
  editor build injects into `document.head` on import, with no nonce (`build-editor.ts:49-54`).
  Constructable sheets need no nonce under a strict CSP; the CSP proof confirms this.
- Color tokens move from `.draft-viewer` (`viewer.css:1-4`) to `:host`, so the host page's values
  win. `:root[data-theme=x]` in the editor's CSS maps to `:host([data-theme=x])`. The docs publish
  the list of `--draft-*` properties and a dark-mode example.
- `@draftably/runtime/host.css` is one small file that every quick start imports. It holds the rules
  that must work before the element is defined:
  `draft-diagram:not(:defined) > [data-draft-slot], draft-editor:not(:defined) > [data-draft-slot]
{ display: none }`, a reserved height for both elements, and
  `draft-diagram [data-draft-input], draft-editor [data-draft-input] { pointer-events: auto }`.

### Lifecycle

- One commit installs geometry, camera and anchors, then notifies listeners, then resolves
  `update` and `ready`. A superseded update installs nothing.
- `anchors` fires after each commit, after a change in marked children, and with `[]` before
  `destroy` detaches the targets.
- Handle calls are synchronous, also inside a listener. A listener that throws does not stop the
  others, as `viewer.ts:268-273` already does. Camera events coalesce to one per animation frame.
- `fit` and `reveal` before the viewport has a size return `pending` and run the latest call once
  it has one.
- `destroy` cancels pending work (the first fit at `mount.tsx:56`, layout, workers it owns) and
  is idempotent. A late result after `destroy` writes nothing.

### Server rendering and exports

- The server sends the `svg` fallback, which draws titles. Slot content appears after the element
  is defined. `host.css` hides it until then and reserves the element's height, so nothing shifts.
- Exports, the CLI and `renderSvg` never contain host content. Print fits the diagram on
  `beforeprint` and shows slot content as the page does.

### Layout input

- `size id height=auto min-height=N` (from #501) reserves room. Layout never measures a slot.
- An editor resize that changes only the width keeps `height=auto min-height=`. A height drag writes
  an exact height and drops the floor.

### Framework packages

Each package holds the same pieces. Only the idiom differs. Each wrapper builds its event props by
looping over one exported `HOST_EVENTS` list, so a new event adds no lines.

| Piece                                               | React                     | Solid               | Vue                   | Svelte               |
| --------------------------------------------------- | ------------------------- | ------------------- | --------------------- | -------------------- |
| Props: `source`, `state`, `label`, `outline`, `svg` | props                     | props               | props                 | props                |
| `options`, set as a property at creation            | prop                      | `prop:options`      | `.prop`               | property             |
| Element access                                      | `ref`                     | `ref`               | `expose({ element })` | `bind:element` (new) |
| Events from `HOST_EVENTS`                           | `onCamera`, `onSelect`, … | `onCamera`, …       | `@camera`, …          | `oncamera`, …        |
| Slot content                                        | `children`                | `children`          | default slot          | `children` snippet   |
| Load the editor in the browser only                 | `useEffect`               | `onMount`           | `onMounted`           | `$effect`            |
| Types                                               | JSX `IntrinsicElements`   | `IntrinsicElements` | `GlobalComponents`    | generated `.d.ts`    |

- `@draftably/runtime` adds `HTMLElementEventMap` entries for every `draft-<type>` event, so plain
  DOM `addEventListener` needs no cast.
- Each wrapper re-exports `renderSvg`, so server rendering needs no second install and loads one
  copy of the runtime.
- Each wrapper's editor component returns the import promise to a `status` and shows the error in
  the element when the import fails. Today the promise is dropped (`packages/react/src/editor.ts:29`).

### Invariants

1. One world coordinate space: layout units equal viewBox units equal geometry units, for the
   viewer, the editor and `renderSvg`.
2. One camera shape, one zoom range and one reason union for both handles. The editor converts
   `{ x, y, k }` at its edge and keeps it internal.
3. A slot target keeps its identity while its item exists, and the anchor layer is never detached.
4. Layout never measures host content.
5. Without a host, every diagram draws correctly, with titles in place of bodies.
6. No public type names `Diagram`, `DiagramSession`, `VisibleGraph`, Solid or font internals.
7. A wrapper adds no behavior that plain DOM cannot reach.
8. Draftably never writes to the host's DOM nodes.

## First experience

The goal is a first hour with no stall. Both reviews walked install, a diagram, the editor, a click,
an own component on a node, a theme and a release in nine setups. The stalls, and the fix for each:

| Stall                                                                                                               | Fix                                                                              |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Every framework guide links elsewhere; no page shows both components, events, slots and a theme                     | One complete typed recipe per framework, compiled from the packed packages in CI |
| Vite dev needs `optimizeDeps.exclude` for the worker; the error is "Viewer render worker failed."                   | The error names the worker URL and the Vite fix; each recipe has the config      |
| Slot content flashes before the element defines; the editor grows from 0 to 28rem                                   | `host.css` in every quick start; `status` attribute                              |
| Events need casts in plain DOM and React                                                                            | `HTMLElementEventMap` entries; typed event props from `HOST_EVENTS`              |
| Dark mode cannot reach the viewer                                                                                   | Tokens on `:host`; a published property list                                     |
| A strict CSP blocks the editor's `<style>` and the `data:` fonts (`viewer.ts:377`)                                  | Constructable sheets; the docs state `font-src data:`, or a URL font option      |
| Meta-frameworks (Next.js, SolidStart, Nuxt, SvelteKit) are not proven; `prove-frameworks.ts` builds plain Vite only | One proof app per meta-framework: server HTML, hydration, a slot, a click        |
| `window.diagramStudio` is the app's, not the library's                                                              | The docs show `el.viewer`, `el.editor` and `diagnostics` for debugging           |

End-user experience the plan now sets:

- Keyboard: Tab moves through bodies in drawing order; Escape from marked content returns focus to
  the canvas; shortcuts never fire while focus is in marked content.
- Screen readers: a body never removes the item's accessible name. Today a viewer update rebuilds
  the outline and drops a focused button (`viewer.ts:653`); the rebuild keeps focus by ID.
- Touch: the viewer adds pinch zoom. Over a viewer, one finger scrolls the page until the user
  activates the canvas (`touch-action: none` today, `viewer.css:45`).
- Motion: camera animation follows `prefers-reduced-motion`, as `viewer.css:97` does now; host
  content is the host's.
- Empty, loading and error states have a default look and the `status` attribute for host styles.

## Performance

Measured today on the built packages (gzip -9). A viewer-only page loads 125 KB gz on the main
thread, because `viewer.ts:1` imports `renderSvg` and with it the compiler, plus a 209 KB gz worker
that holds a second copy of the compiler. Each `update()` stops the worker and starts a new one
(`viewer.ts:545`). Each instance owns its worker and its font set (`viewer.ts:263`). The editor entry
is 321 KB gz, with a 104 KB gz engine worker.

**Runtime cost changes:** import the main-thread renderer only with `execution: { mode: 'main' }`; a pool of at most
min(4, cores − 1) render workers per page that stay up and end on idle; one font registry per page; the viewport size from
a `ResizeObserver`; shared constructable sheets.

**Budgets.** Each proof records median and p95 on one named laptop, with a 4× CPU throttle for the
cold numbers.

| Area                                 | Budget                                                                                                                                         | Proof                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Main-thread JS, viewer-only page     | ≤ 40 KB gz before the first render request; no editor request                                                                                  | Packed consumer build; network log                       |
| Workers                              | ≤ min(4, cores − 1) render workers per page, whatever the instance and update count; 20 instances of the bench file all commit with no timeout | Count workers on a page with 20 instances and 20 updates |
| First diagram, 28-box bench file     | ≤ 1 s cold, ≤ 300 ms warm, from navigation to the committed update                                                                             | Playwright trace                                         |
| Source update to commit, 28 boxes    | ≤ 200 ms                                                                                                                                       | `pnpm bench`                                             |
| 20 instances                         | 1 stylesheet per element type; 1 font set; no long task over 200 ms                                                                            | `Performance.getMetrics`; long-task observer             |
| Camera frame, 10 / 100 / 500 targets | ≤ 8 ms p95 at 500; 0 forced layouts                                                                                                            | Trace of pan and zoom; long-animation-frame observer     |
| Target reconcile per update          | ≤ 10 ms at 500; no target re-created for an unchanged ID                                                                                       | `MutationObserver` count on the shadow root              |
| `geometry()` at 200 nodes            | ≤ 1 ms; the same object for one revision                                                                                                       | Microbench; identity check                               |
| `route` during a drag, `quick`       | ≤ 16 ms p95 at 100 nodes, ≤ 50 ms at 200; `auto` again on drop                                                                                 | `bench:graph` with a drag mode                           |
| Mount and destroy, 50 cycles         | Heap within 5 %; listeners, workers and `document.fonts.size` at baseline                                                                      | CDP heap and listener counts                             |

The budgets use 500 targets, because the runtime limit is 500 objects (`render.ts:19`).

**Changed in step 3.** The warm first-diagram budget (≤ 300 ms) is not met, and the runtime cannot
meet it. A fresh layout of the 28-box bench file takes about 600 ms in the router (M3 Pro), and a
reload has no layout cache. Every other step-3 row passes. CDP's CPU throttle slows the page, not
the worker, so the cold row mostly measures the same layout. The budget stays as a target for the
router. `pnpm bench:host` reports it, and later steps must not make it slower.

**Changed in step 3, after review.** One worker per page ran jobs one at a time, so a page of
large diagrams drew serially, and a job's timeout counted its time in the queue. The page now has
a pool of at most min(4, cores − 1) workers. Jobs queue on the main thread, a superseded job leaves
the queue before a worker sees it, and a job's timeout starts when a worker takes it and stops only
that worker.

**Changed in step 5.** Two details of the types settled in code:

- A handle's cancelable event (`link`, `contextmenu`) carries `preventDefault()` in its payload, as
  the viewer's `link` did. The element strips it from `detail`, dispatches a `CustomEvent` with
  `cancelable: true`, and calls it when the host cancels. `HostEvents` describes the `detail`.
- The editor's `update` and `ready` resolve to `{ status: 'committed' | 'error' | 'destroyed',
revision }`. The editor draws in its own session, so it has no SVG `value` to return.

## Breaking changes

The packages are 0.x. The whole stack ships as one minor release, with every break listed and
before-and-after examples in the changelog. No shims. Runtime, editor and the four wrappers move to
one changesets `fixed` group (`.changeset/config.json` has none today).

| Change                                  | Before                                     | After                            |
| --------------------------------------- | ------------------------------------------ | -------------------------------- |
| `MountedEditor.session`                 | the internal store                         | removed; `EditorHandle`          |
| Viewer camera event reason              | `'user' \| 'resize' \| 'fit' \| 'api'`     | adds `'restore'`                 |
| `draft-change` detail                   | the source string (`editor/element.ts:53`) | `{ source }`                     |
| Wrapper `onChange` argument             | the source string                          | `{ source }`, the event's detail |
| `link` event                            | `preventDefault()` in the detail           | a cancelable `CustomEvent`       |
| Editor zoom range                       | 0.08–4                                     | 0.02–8                           |
| `viewer.on(...)` on a re-mounted viewer | listeners lost                             | listeners on the element survive |

`render` keeps `value` and adds `geometry`; `itemactivate` keeps `revision`. The `onUpdate` and
`onChange` wrapper props stay.

**Changed in step 2.** The plan kept `onChange`, but every wrapper now builds its event props by
looping over `HOST_EVENTS`, and each prop receives the event's `detail`. So `onChange` receives
`{ source }`, not the string. A special case for one event would break the measure that a new event
adds no wrapper lines.

## What to do with each PR

| PR                          | Verdict                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #498 canvas click activates | Merge as written.                                                                                                                                                                                                                                                                                                                                                               |
| #499 memoize `viewerFrame`  | Merge as written. `createScene` runs inside the session's root. The gain is smaller than stated, because `Frame.tsx` and `TextHits.tsx` already memoize their reads.                                                                                                                                                                                                            |
| #500 editor camera API      | Keep the change that sends every camera write through `setCamera` (`pointer.ts:189,469,477`). Rebuild the rest on the handle (step 4), folded into the existing `fitRects` and `revealObject`, with the viewer's camera shape.                                                                                                                                                  |
| #501 node content           | Hold `min-height` until three fixes land: diamonds return before the floor (`compile.ts:1027`), the second cells path drops it (`compile.ts:~3546`), and a resize drops it (`translate.ts:758`). Replace `nodeContent` with `body:` slots.                                                                                                                                      |
| #502 Solid host entry       | Close. Land its scene fixes as one PR: `fill="none"` on lines, text anchors, `LinkMark` without `state/`, and `NodeView` and `Lifelines` importing from `runtime/svg-renderer`, not `cli/`. Do not export `measureText`: host bodies use host fonts and CSS, and it would freeze `model/fonts.ts`. For shapes drawn in Callsheet's own tree, point to the graph API's `layout`. |

## Order of work

Each step is one PR in a stack. Each step ships its docs and its proof in the same PR. The stack
releases once, as one minor version.

1. **Small fixes.** Merge #498 and #499. Land the #502 scene fixes and the fixed `min-height`.
2. **Element parity.** `options` on both elements, mount once in a microtask, live and re-mount
   fields, `draft-<name>` re-dispatch, listeners that survive a re-mount, `status`, the version
   warning, Svelte `bind:element`, `HOST_EVENTS` event props in all four wrappers, the event-map
   and JSX types. Also the six root-lookup fixes and their guard, and the active-session fix. This
   fixes the parity gaps and two bugs on its own.
3. **Runtime cost.** Lazy main-thread renderer, one worker per page, one font registry, the
   viewport size from a `ResizeObserver`, shared constructable sheets, tokens on `:host`. Add the
   budgets to `docs/CHECKS.md` and `pnpm bench`; every later step holds them.
4. **One camera.** Shared `Camera`, zoom range, reasons, `fit(ids)`, `reveal`, `MoveResult`, one
   event per frame. Remove `MountedEditor.session` from the public type.
5. **Geometry and events.** `geometry()`, `renderSvg(...).geometry`, `ready`, `select`,
   `contextmenu`, cancelable `link`.
6. **Slots.** The editor in a shadow root with its own top handle layer, the anchor layer in both
   elements with manual assignment, `data-draft-slot`, `data-draft-input`, level of detail, slot
   diagnostics, `host.css`. Gate: the real viewer and editor pass round 2's checks through all four
   wrappers.
7. **Prove and document.** One recipe per framework, compiled from the packed packages. Proof apps
   for Vite in each framework and for Next.js, SolidStart, Nuxt and SvelteKit: server HTML,
   hydration, a body that reads host context and CSS, a caret that survives an update, a marked
   button, two instances with separate shortcuts, a failed update, a strict CSP, 50 mount cycles.

Deferred until a host asks: `hover` (it fires often), `layout({ draft })`, and Svelte Flow and Vue
Flow edge components (not host-contract work; the docs show a ten-line `BaseEdge`).

## Considered and not chosen

- **Callbacks in the renderer (plan v1).** The viewer's sanitizer strips `foreignObject`, and every
  update would destroy and re-mount the host content.
- **A portal helper per framework (first reviews).** It works, but host CSS does not reach the
  viewer's shadow root, and Svelte has no portal.
- **The `slot` attribute.** Svelte 5 rejects a dynamic `slot` through a wrapper component (round 2).
  `data-draft-slot` with manual assignment works in every framework and keeps the host's DOM
  untouched.
- **Geometry per panel for `compare` and `states`.** Panels can hold different items and routes
  (`svg-renderer.ts:592`), so offsets cannot describe them. `geometry()` returns `null` there, and
  slots stay off. Add per-panel geometry if a host needs it.
- **Occurrence keys for every drawn item (Sol).** Not needed while slots stay off in `compare` and
  `states`.
- **Named regions inside an item (Sol).** `body` fills the box. Add regions when a host needs content
  beside the title.
- **`worldToClient` and `clientToWorld` helpers (Sol).** Overlay slots cover the first use. Add them
  when a host draws its own layer.
- **A display list that each framework draws (first reviews).** A third renderer, and its drawings
  could drift from the other two. A host that wants to draw uses the graph API, and draws its own
  look, not a copy of Draftably's.
- **`options.theme`.** A dark host can set the `--draft-*` tokens. A diagram's own theme stays the
  author's choice in the source, unless Callsheet needs to override it (question 6).

## Open questions for Callsheet

1. Do you use the published `@draftably/editor`, or build from `src/` on your own Solid? #501 and
   #502 only work as written in the second case. Which `session` members do you call today?
2. Why do you want the scene in your own tree: one Solid in the bundle, reactivity per node, or your
   own handlers on shapes? Slots and events cover the last two. If you want to draw every shape
   yourself, `layout` from `@draftably/runtime/graph` gives the boxes and lines with no Solid at
   all. Would `layout({ draft })` meet that need?
3. Must node bodies take input (buttons, fields)? `data-draft-input` assumes yes.
4. Do you need selection sync both ways, or only events from Draftably?
5. Can `min-height` live in the user's saved `.draft` file?
6. In a dark host, must the diagram follow the host's theme, or is the source's theme correct?
7. How many diagrams per page, and how many items with bodies, do you show? Which meta-framework,
   and do you need phones?
8. Must host content appear in print or in exports?
