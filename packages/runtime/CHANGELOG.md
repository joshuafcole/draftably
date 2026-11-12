# @draftably/runtime

## 0.4.0

### Minor Changes

- f98d285: Draw group members that inherit the group's color as pale cards, and key their legend swatch to match
- e539e30: Draw the lines after a node title's first line break as a smaller, muted detail line
- 7348833: Give the boxes in a column layout the widest one's width, so the column's edges line up
- 45923b9: The elements are the host contract. `<draft-diagram>` and `<draft-editor>` mount once, in a microtask after they connect, and take every mount option through `options`. A new options object with the same values does nothing; callbacks, `label`, `outline`, `toolbar` and render settings apply live, and only `execution`, `render.fonts` or `storageKey` mount anew. Both dispatch every event as a bubbling `draft-<name>` event that survives a re-mount, reflect `status="loading | ready | error"`, and warn once when a second copy of the runtime loads. `@draftably/runtime/host` exports `HOST_EVENTS`, and the event types are in `HTMLElementEventMap`. Every framework package builds its event props from `HOST_EVENTS`, takes `options` on the editor, re-exports `renderSvg`, and gives the element (Svelte adds `bind:element`).

  The editor works inside a shadow root: it finds its own root instead of the page. A press on the page outside every editor, or removing an editor, stops it taking shortcuts.

- 65a875e: Hosts can read where things are drawn and hear more of what the user does. `geometry()` on the viewer and the editor returns every node, group and edge in world units, in the graph API's shapes, one object per revision (`null` for compare and states drawings); `renderSvg` returns the same `geometry` in its `viewBox` units, and the `render` event carries it. Both handles have `ready`. A right-click reports `contextmenu` with the item (cancelable on the element, to replace the browser's menu). The editor adds `select(ids)`, `selection()` and a `select` event with reason `user` or `api`. Listeners hear a commit before `update` resolves.
- 7af26f5: The viewer and the editor share one camera. Both handles have `getCamera`, `setCamera`, `fit(ids?, options?)` and `reveal(id, options?)`, with the camera `{ centerX, centerY, zoom }`, one zoom range (0.02–8), and one set of reasons. `fit` and `reveal` return `moved`, `unchanged`, `missing` or `pending`; a call before the view has a size runs once it has one. `padding`, `minZoom` and `maxZoom` shape them. The `camera` event comes at most once per animation frame, also during a drag, and `<draft-editor>` now dispatches `draft-camera`. Every editor camera write, including pinch and drag-zoom, goes through one path, so each is reported and saved.
- dd3ee13: **One host contract for every framework.** `<draft-diagram>` and `<draft-editor>` now give every
  host the same things: every option, every event as a `draft-<name>` event, a `status` attribute,
  one camera, geometry, and your own content on a node through `data-draft-slot` children. The
  React, Solid, Vue and Svelte packages map these to each framework's idiom and add nothing that
  plain DOM cannot reach. The framework guide has a complete, type-checked recipe for each
  framework and for plain HTML, and the stack is proven on server-rendered, hydrated pages in Vite,
  Next.js, SolidStart, Nuxt and SvelteKit under a strict nonce CSP.

  Also in this release:

  - `@draftably/react/server` exports `renderSvg` for React Server Components. The main entry is a
    client module, so a Next.js server component cannot call its exports.
  - The viewer and the editor create their workers as `new Worker(new URL("./assets/…",
import.meta.url))`, the form every bundler bundles. Next.js (Turbopack) and Nuxt lost the
    nested form the build wrote before, and the viewer failed to start there.
  - The Solid wrappers write no `style=""` when `style` is unset, so a strict CSP logs no violation.
  - The React, Solid and Vue wrappers write `options` only when the prop is set, so options a host
    sets through the element ref survive. Svelte writes the prop before `bind:element` gives the
    host the element, so it needed no change.
  - With Vite, exclude both packages from dependency optimization:
    `optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] }`. Without the editor in
    the list, the Vite dev server could not find the editor's worker, and the editor computed
    layouts on the main thread.

  ### Breaking changes

  The packages are 0.x, so this minor release carries every break, with no shims.

  | Change                                                  | Before                                        | After                                                                      |
  | ------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
  | `el.viewer` and `el.editor` after insertion             | set as the element connects                   | set in a microtask; `await el.updateComplete` or listen for `draft-update` |
  | `draft-change` detail and the wrappers' change callback | the source string                             | `{ source }`                                                               |
  | Setting `options`, `label` or `outline` on the viewer   | re-mounts the viewer and loses the camera     | applies live; only `execution` and `render.fonts` re-mount                 |
  | `ViewerOptions.toolbar: false`                          | no toolbar is built                           | the toolbar is built and hidden                                            |
  | `options` on `<draft-editor>`                           | none; options only through `mountEditor`      | applies live; a new `storageKey` mounts a new editor                       |
  | `MountedEditor.session`                                 | the editor's internal store                   | removed; use the handle's methods                                          |
  | `MountOptions` for `mountEditor`                        | every session option, including `urlState`    | `storageKey`, `openLink`, `confirm`, `onInteract`, `detail`                |
  | `MountedEditor.update(source)`                          | resolves to nothing                           | resolves to `{ status, revision }`                                         |
  | Editor zoom range                                       | 0.08–4                                        | 0.02–8, as the viewer                                                      |
  | Camera event reason                                     | `'user' \| 'resize' \| 'fit' \| 'api'`        | adds `'restore'`                                                           |
  | Viewer `camera` event during a pan                      | once, on pointer-up                           | at most once per animation frame                                           |
  | `viewer.fit()`                                          | returns nothing; fits 92 % of the view        | returns a `MoveResult`; 32 px padding                                      |
  | `link` on `<draft-diagram>`                             | reachable only through `el.viewer.on('link')` | `draft-link`, a cancelable event: call `event.preventDefault()`            |
  | `<draft-editor>` DOM                                    | the editor's DOM in the element's children    | in its shadow root; children are slot content                              |
  | Editor styles                                           | one sheet on the page                         | adopted in the element's shadow root                                       |
  | Editor color properties                                 | on `.draft-editor`                            | on `:host`; set them on `draft-editor`                                     |
  | Editor color properties with `mountEditor`              | on `.draft-editor`                            | on `.draft-editor-root`, the element you mount into                        |
  | Viewer viewport and frame                               | `overflow: hidden`                            | `overflow: clip`                                                           |

  #### The handles exist after a microtask

  ```ts
  // Before: the element mounted as it connected.
  document.body.append(diagram);
  diagram.viewer.on('camera', save);

  // After: the element mounts once, in a microtask, so every property set in the same tick lands
  // first. Until then `el.viewer` and `el.editor` are undefined.
  document.body.append(diagram);
  await diagram.updateComplete;
  diagram.viewer!.on('camera', save);

  // Or listen on the element, which works before the mount and survives a re-mount.
  diagram.addEventListener('draft-camera', e => save(e.detail));
  ```

  `<draft-editor>` has no `updateComplete`: listen for `draft-update`, or for `status="ready"`.

  #### The change callback receives `{ source }`

  ```tsx
  // Before
  <DraftEditor source={source} onChange={next => setSource(next)} />;
  editor.addEventListener('draft-change', e => save((e as CustomEvent<string>).detail));

  // After
  <DraftEditor source={source} onChange={({ source }) => setSource(source)} />;
  editor.addEventListener('draft-change', e => save(e.detail.source));
  ```

  Every wrapper event prop now receives the event's `detail`, so this holds for Solid `onChange`,
  Vue `@change` and Svelte `onchange` too.

  #### Options apply live

  ```ts
  // Before: each set re-mounted the viewer, so a React parent that passed a new object on every
  // render lost the camera on every render.
  diagram.options = { toolbar: false };

  // After: a new object with the same values does nothing; `label`, `outline`, `toolbar`,
  // callbacks and render settings apply live. Only `execution` and `render.fonts` re-mount.
  diagram.options = { toolbar: false };
  ```

  `toolbar: false` now builds a hidden toolbar, so a later `toolbar: true` shows it without a
  re-mount. Hide it with CSS if you relied on its absence from the DOM.

  #### The editor handle replaces `session`

  ```ts
  // Before
  const editor = mountEditor(host, { source, onChange, urlState: false });
  editor.session.fitView(); // the internal store, typed as public
  await editor.update(next);

  // After
  const editor = mountEditor(host, { source, onChange });
  editor.fit();
  editor.select(['api']);
  const result = await editor.update(next); // { status: 'committed' | 'error' | 'destroyed', revision }
  ```

  The handle has `getCamera`, `setCamera`, `fit(ids?, options?)`, `reveal(id, options?)`,
  `geometry()`, `select`, `selection`, `anchor` and `on(type, listener)`, as the viewer does.

  #### One camera and one zoom range

  ```ts
  // Before: fit() returned nothing and filled 92 % of the view; the editor zoomed 0.08–4.
  viewer.fit();

  // After
  const moved = viewer.fit(['api', 'db'], { padding: 48, maxZoom: 1 }); // 'moved' | 'unchanged' | 'missing' | 'pending'
  viewer.on('camera', ({ camera, reason }) => save(camera)); // reason may be 'restore'
  ```

  A `camera` listener now hears a pan as it happens, at most once per frame, not once at the end.
  Handle `'restore'` wherever you switch on the reason.

  #### Links are cancelable events on the element

  ```ts
  // Before
  diagram.viewer!.on('link', event => {
    event.preventDefault();
    router.push(event.href);
  });

  // After
  diagram.addEventListener('draft-link', event => {
    event.preventDefault();
    router.push(event.detail.href);
  });
  ```

  `viewer.on('link')` still works and still carries `preventDefault()`; listeners on the element now
  survive a re-mount.

  #### The editor renders in a shadow root

  ```css
  /* Before: page CSS could reach the editor's DOM, and its tokens sat on .draft-editor. */
  .draft-editor {
    --accent: #0f766e;
  }

  /* After: set tokens on the element. Children are slot content, not the editor's DOM. */
  draft-editor {
    --accent: #0f766e;
  }
  draft-editor[data-theme='dark'] {
    /* the dark set */
  }
  ```

  Code that queried the editor's DOM from the page (`document.querySelector('.canvas')`) must go
  through `el.shadowRoot`, or better, through the handle. Import `@draftably/runtime/host.css` once
  per page: it reserves both elements' heights and hides slot content until they load.

  #### `overflow: clip`

  The viewer's viewport and frame use `overflow: clip`, so focus in off-screen slot content never
  scrolls the diagram. A host rule that scrolled the element's frame no longer can.

- bc0a6e5: A page of diagrams costs less. A viewer-only page loads about 11 KB gz of JavaScript on the main thread before it draws, down from about 124 KB: the compiler loads only for `execution: { mode: 'main' }`. Every viewer on a page shares a pool of at most min(4, cores − 1) render workers. Work that a newer update replaced leaves the queue before a worker sees it, a timeout counts from when a worker takes the job and stops only that worker, and an idle worker stops after 30 seconds; 20 diagrams updated 20 times start four workers, not 420. A source update to a drawn 28-box diagram commits in about 120 ms, down from about 730 ms. Viewers share one copy of each font face and one constructable stylesheet, which needs no nonce under a strict CSP; the editor's CSS is a constructable sheet too. The viewer reads its size from a `ResizeObserver` instead of measuring on each camera move. The viewer's frame colors are public `--draft-*` properties that a host sets on the element or any ancestor.
- acbd88f: Hosts can put their own content on a node. A child of `<draft-diagram>` or `<draft-editor>` marked `data-draft-slot="body:<id>"` fills that node and scales with the drawing; `overlay:<id>` covers a node, group or edge at screen size. Both elements assign marked children to stable targets in their shadow roots and never change the host's DOM, so a framework keeps rendering them, page CSS styles them, and focus and a caret survive a source update. Slot content takes no pointer input unless marked `data-draft-input`; there it takes its own pointer and keys, and no editor shortcut fires. Below a zoom of 0.4 bodies give way to titles (`detail: 'full'` keeps them). An unknown slot adds `DRAFT_SLOT_UNKNOWN` to `diagnostics`, and content larger than its node adds `DRAFT_SLOT_OVERFLOW`. A new `anchors` event lists the targets; `viewer.anchor(slots)` and `editor.anchor(slots)` give the same layer without the element. The four wrappers pass slot content through as `children` or the default slot.

  `@draftably/runtime/host.css` holds the rules that must work before the elements load: their heights, hidden slot content, and `pointer-events` for marked content. Import it once per page.

  The editor now renders in a shadow root, with its styles adopted there instead of on the page. Its color properties sit on `:host`, so a page value on `draft-editor` wins, and `data-theme="dark"` on the element selects the dark set. A node with a body keeps its ports and resize handles above the body.

- e46dd29: `size id width= height=auto min-height=N` puts a floor under a node's auto height, for a host that puts more than the title in a node. It works for boxes, diamonds and `cells` members, and an editor resize that changes only the width keeps `height=auto` and the floor. The editor's scene draws its lines unfilled and its labels centred without the editor's stylesheet, and its link marks no longer load the editor's state.

### Patch Changes

- 34c0845: Keep near-fitting group titles on one line, and stop a dashed side input from ranking a box a solid edge already places
- c0f7e7c: Nest the ports of lines that share a box side, so a fan in or out does not cross itself
- 0f0df75: Draw notes and sequence panels on a dark panel in dark themes, so their text reads
- 54a5098: Keep each edge label on its own line, sliding along it first, and step beside it only when another line or label would crowd it

## 0.3.0

### Minor Changes

- 544be76: `layout` and `route` from `@draftably/runtime/graph` take React Flow and Svelte Flow graphs under `reactFlow` and `svelteFlow`, and return them in the same shape: nodes with positions relative to their group and sizes, edges with routed paths and label boxes in `data.draftably`. `route` routes the lines again where the nodes are now, so lines follow a dragged node.
- da6799e: Add `@draftably/runtime/graph`: lay out and route a graph your app draws. `layout()` takes plain nodes, groups and edges with any IDs, and returns each box's position and size, each edge's routed line and label box, and the equal `.draft` file. `route()` routes lines between boxes your app placed. `routing.quality` chooses between full and quick routing; `auto` keeps large graphs near a second.
- dbf251a: Add drop-ins for other layout libraries to `@draftably/runtime/graph`: `DraftablyELK` takes and returns ELK JSON like elkjs's `ELK` class, `dagreLayout(g)` lays out a graphlib graph in place like `dagre.layout(g)`, and `draftablyLayout` registers a Cytoscape.js layout. `layoutSync` lays out without a promise, and `fold: 'never'` keeps a long drawing in one row.
- f170a08: A large `flow` (40 or more forward lines) now lays out and routes like a layered layout: each line that skips ranks gets its own corridor between the boxes of the ranks it passes, and every forward line follows a planned route, out of the bottom (or right) of its source and along its own track in each gap. `layout()` on a new 100-node graph with 127 lines takes about 20 ms instead of 280 ms, with fewer crossings and bends, and full routing of the same graph about 0.1 s instead of 2.6 s. A flow whose ranks cross more than twice per line keeps the router's searched routes, which cross less there. Smaller diagrams draw as before.
- 9260ac2: `flow` lines each object up with what it connects to in the rank before, and widens a gap between ranks until each line that turns in it has its own lane. Trees and dense graphs draw with far fewer crossings and bends, and route several times faster: a 63-node tree has no crossings and lays out in about 0.3 s instead of 5 s. The router's grid search is also about a third faster, with the same routes.

### Patch Changes

- 2f625b2: Route lines faster, with the same routes as before. The router skips line pairs that are too far apart to meet, compares segments as plain numbers, scores a candidate against other lines only while it can still win, and counts totals once per pass. A 100-node chain routes about 7 times faster, a 60-node tree and a 100-node DAG about 5 times faster, and a node with 16 children about 2.4 times faster.
- 7259d8c: `flow` orders the objects in each rank so fewer lines cross. It sweeps down and up the ranks and swaps neighbours while a swap removes crossings, as layered layouts do. A 100-node graph with 127 lines now draws 77 crossings instead of 113.
- 1ff30f9: The router skips detours that must cross other lines sooner. It counts the crossings a detour cannot avoid before it scores the detour, so `layout()` on a new 100-node graph with 127 lines takes about 30% less time again, with the same lines.
- e8754d1: The router draws the same lines faster. It tries candidate paths best first, builds a side's detours only when they can still win, and stops scoring a path once it has lost. `layout()` on a new 100-node graph with 127 lines takes about 40% less time.
- 3eba208: Route fresh graphs faster with the same drawings. The router reuses crossing bounds for each port pair and counts crossings once per search grid line.
- b4a84ab: `layout({ svelteFlow })` keeps each node's CSS `style` string and takes Svelte Flow's own `Node` and `Edge` types. Before, it spread a style string into an object, and Svelte Flow lost the node's style. The `@draftably/react` README now links to the drop-in layout guide.

## 0.2.0

### Minor Changes

- 3b77f78: Add a diagram element with automatic viewer setup and cleanup
- b05bb95: Add the optional read-only viewer with an owned module worker, accessible controls, and packed React, Solid, and browser proofs.
- a0786b0: Add the portable native SVG runtime with TypeScript declarations, exact font assets, Node and browser ESM consumers, and a packed-artifact proof.
- fdb759b: The viewer's item outline is now visually hidden by default. Screen readers keep it, and it appears over the bottom of the drawing while it holds keyboard focus. Set `outline: 'visible'` in `mountViewer`, `outline="visible"` on `<draft-diagram>`, or the `outline` prop on `DraftDiagram` to keep it on screen.

### Patch Changes

- fe01bb5: The guides for every package moved to draftably.dev/docs, and each package README now links there. The Emphasis states page draws each state live.
- ba5f518: A line that runs between two sides, such as a container wall and a box or two container walls, now runs midway between them. Before, it could hug one side. Two lines on one side of a box, pill or circle now sit evenly about the side's middle more often, also when one of them is a straight line to another box.
