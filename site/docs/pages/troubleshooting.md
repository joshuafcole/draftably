# Troubleshooting

Find the symptom, then the fix. Most problems show up in the element's `status` attribute and its
`diagnostics` event.

## Symptoms

| Symptom                                                                                        | Cause and fix                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Failed to resolve import "@draftably/runtime/host.css"`                                       | pnpm lets an app import only what it lists. Install the runtime beside your framework package: `pnpm add @draftably/react @draftably/runtime`.                                                                                         |
| A worker error, or a 404 for `.vite/deps/assets/…worker…`, in Vite development                 | Vite 5–7 pre-bundle the packages away from their workers. Add `optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] }`. Vite 8 and production builds need nothing.                                                     |
| "Invalid hook call … more than one copy of React" after adding `DraftEditor` while `vite` runs | Vite optimized the editor entry late and loaded React twice. Add `optimizeDeps.include: ['@draftably/react', '@draftably/react/editor']`, or restart the development server.                                                           |
| The diagram stays empty and the element says the render worker could not start                 | The page loads the package from another origin, such as a CDN, and a module worker must come from the page's origin. Serve `dist` from your origin, or set `options = { execution: { mode: 'main' } }`. See [From a CDN](#from-a-cdn). |
| `[engine] Worker failed to start; computing on the main thread`                                | The editor's worker did not load, as in the Vite row above. The editor still works, more slowly.                                                                                                                                       |
| A button or field on a node takes no clicks                                                    | Mark it `data-draft-input` and import `@draftably/runtime/host.css`. With `mountViewer`, import `viewer.css`.                                                                                                                          |
| Slot content does not show                                                                     | The slot names an item the drawing lacks, or its prefix is not `body:` or `overlay:`. `diagnostics` has a `DRAFT_SLOT_UNKNOWN` warning that names it.                                                                                  |
| Slot content is cut off                                                                        | Layout never measures your content. Give the node room: `size api width=220 height=auto min-height=120`. `DRAFT_SLOT_OVERFLOW` says which.                                                                                             |
| Bodies vanish when zoomed out                                                                  | Below a zoom of 0.4, bodies give way to titles. Set `options.detail` to `'full'`.                                                                                                                                                      |
| `el.viewer` is `undefined`                                                                     | The element mounts in a microtask and only with source. `await el.updateComplete` first.                                                                                                                                               |
| `status="error"`                                                                               | The first update failed or the element could not mount. The element shows the message; `updateComplete` resolves to `{ status: 'error', error }`, and `error.diagnostics` has the details.                                             |
| A later edit does not draw, and `status` stays `ready`                                         | The new source has an error. The element keeps the last drawing and shows the message under it. Listen for `update` or `diagnostics`.                                                                                                  |
| CSP violations for fonts                                                                       | The viewer embeds fonts as `data:` URLs: allow `font-src data:`, or use `render: { fonts: 'host' }` with `fonts.css`.                                                                                                                  |
| CSP violations for a `<style>`                                                                 | Pass your nonce: `styleNonce` to `renderSvg`, and `render: { styleNonce }` to the viewer. See [Strict CSP](#strict-csp).                                                                                                               |
| `onSelect` fires with `ids: []` as the editor loads                                            | The editor reports its first, empty selection. Treat an empty selection as nothing selected.                                                                                                                                           |
| `<draft-editor>` shows an error and `status="error"`                                           | The editor's script failed to load. The reason is in its `data-error` attribute, which `host.css` shows.                                                                                                                               |
| An image URL returns 404                                                                       | Match `publicPath` to the served folder and the site's base path.                                                                                                                                                                      |
| An edit to an included `.draft` file is not shown                                              | Follow your [site's setup](#documentation-sites) for watching includes.                                                                                                                                                                |

## Debug a diagram

The element is the way in. `el.viewer` and `el.editor` are the handles, and every handle event
reaches the element as a `draft-<name>` event:

```ts
const el = document.querySelector('draft-diagram')!;
el.addEventListener('draft-diagnostics', event => console.table(event.detail.diagnostics));
el.getAttribute('status'); // 'loading', 'ready' or 'error'; a later failed update keeps 'ready'
await el.updateComplete; // the latest update's result
el.viewer?.geometry(); // every node, group and edge, in world units
el.viewer?.getCamera();
```

`diagnostics` lists source errors and warnings with line numbers, and slot problems:
`DRAFT_SLOT_UNKNOWN` for a body on an ID the drawing lacks, `DRAFT_SLOT_OVERFLOW` for content
larger than its node. A failed update keeps the last drawing and shows the message under it.

`window.diagramStudio` exists only on the page `draftably open` serves. In your app, use the
element and its handle as above.
