# @draftably/svelte

## 0.4.0

### Minor Changes

- 45923b9: The elements are the host contract. `<draft-diagram>` and `<draft-editor>` mount once, in a microtask after they connect, and take every mount option through `options`. A new options object with the same values does nothing; callbacks, `label`, `outline`, `toolbar` and render settings apply live, and only `execution`, `render.fonts` or `storageKey` mount anew. Both dispatch every event as a bubbling `draft-<name>` event that survives a re-mount, reflect `status="loading | ready | error"`, and warn once when a second copy of the runtime loads. `@draftably/runtime/host` exports `HOST_EVENTS`, and the event types are in `HTMLElementEventMap`. Every framework package builds its event props from `HOST_EVENTS`, takes `options` on the editor, re-exports `renderSvg`, and gives the element (Svelte adds `bind:element`).

  The editor works inside a shadow root: it finds its own root instead of the page. A press on the page outside every editor, or removing an editor, stops it taking shortcuts.

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

- acbd88f: Hosts can put their own content on a node. A child of `<draft-diagram>` or `<draft-editor>` marked `data-draft-slot="body:<id>"` fills that node and scales with the drawing; `overlay:<id>` covers a node, group or edge at screen size. Both elements assign marked children to stable targets in their shadow roots and never change the host's DOM, so a framework keeps rendering them, page CSS styles them, and focus and a caret survive a source update. Slot content takes no pointer input unless marked `data-draft-input`; there it takes its own pointer and keys, and no editor shortcut fires. Below a zoom of 0.4 bodies give way to titles (`detail: 'full'` keeps them). An unknown slot adds `DRAFT_SLOT_UNKNOWN` to `diagnostics`, and content larger than its node adds `DRAFT_SLOT_OVERFLOW`. A new `anchors` event lists the targets; `viewer.anchor(slots)` and `editor.anchor(slots)` give the same layer without the element. The four wrappers pass slot content through as `children` or the default slot.

  `@draftably/runtime/host.css` holds the rules that must work before the elements load: their heights, hidden slot content, and `pointer-events` for marked content. Import it once per page.

  The editor now renders in a shadow root, with its styles adopted there instead of on the page. Its color properties sit on `:host`, so a page value on `draft-editor` wins, and `data-theme="dark"` on the element selects the dark set. A node with a body keeps its ports and resize handles above the body.

### Patch Changes

- Updated dependencies [34c0845]
- Updated dependencies [f98d285]
- Updated dependencies [e539e30]
- Updated dependencies [c0f7e7c]
- Updated dependencies [7348833]
- Updated dependencies [0f0df75]
- Updated dependencies [54a5098]
- Updated dependencies [45923b9]
- Updated dependencies [65a875e]
- Updated dependencies [7af26f5]
- Updated dependencies [dd3ee13]
- Updated dependencies [bc0a6e5]
- Updated dependencies [acbd88f]
- Updated dependencies [e46dd29]
  - @draftably/runtime@0.4.0
  - @draftably/editor@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [544be76]
- Updated dependencies [2f625b2]
- Updated dependencies [da6799e]
- Updated dependencies [dbf251a]
- Updated dependencies [f170a08]
- Updated dependencies [9260ac2]
- Updated dependencies [7259d8c]
- Updated dependencies [1ff30f9]
- Updated dependencies [e8754d1]
- Updated dependencies [3eba208]
- Updated dependencies [b4a84ab]
  - @draftably/runtime@0.3.0
  - @draftably/editor@0.3.0

## 0.2.0

### Minor Changes

- 13e3bd5: Add `@draftably/editor`: the diagram editor as `mountEditor()` and a `<draft-editor>` element. Drag boxes and lines, and get the `.draft` source back on every edit. Any number of editors can share a page. Each framework package adds `DraftEditor` under its `/editor` subpath.
- 16c24d2: Add `DraftDiagram` for Svelte: the `<draft-diagram>` element with Svelte props, an update callback, and an `svg` prop for server rendering.
- fdb759b: The viewer's item outline is now visually hidden by default. Screen readers keep it, and it appears over the bottom of the drawing while it holds keyboard focus. Set `outline: 'visible'` in `mountViewer`, `outline="visible"` on `<draft-diagram>`, or the `outline` prop on `DraftDiagram` to keep it on screen.

### Patch Changes

- fe01bb5: The guides for every package moved to draftably.dev/docs, and each package README now links there. The Emphasis states page draws each state live.
- Updated dependencies [3b77f78]
- Updated dependencies [fe01bb5]
- Updated dependencies [ba5f518]
- Updated dependencies [81e76a8]
- Updated dependencies [13e3bd5]
- Updated dependencies [b05bb95]
- Updated dependencies [a0786b0]
- Updated dependencies [fdb759b]
  - @draftably/runtime@0.2.0
  - @draftably/editor@0.2.0
