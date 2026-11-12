# API reference

Every export, element property, option and handle method for embedding, in one place. The guides
show each one in use, and the [Layout API](#layout-api) documents the graph functions.

## Packages

| Import                                            | Gives                                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `@draftably/runtime`                              | `renderSvg` and `validate`, in Node and the browser                                    |
| `@draftably/runtime/element`                      | Registers `<draft-diagram>`                                                            |
| `@draftably/runtime/viewer`                       | `mountViewer` and its types                                                            |
| `@draftably/runtime/host`                         | `HOST_EVENTS`, `hostDetail` and the event, camera and geometry types. No side effects. |
| `@draftably/runtime/graph`                        | `layout`, `layoutSync`, `route` and the drop-ins: see [Layout API](#layout-api)        |
| `@draftably/runtime/host.css`                     | The page rules: heights, hidden slot content, pointer for marked content               |
| `@draftably/runtime/viewer.css`                   | The viewer's styles, for `mountViewer`                                                 |
| `@draftably/runtime/fonts.css`                    | The fonts as files, for `render: { fonts: 'host' }`                                    |
| `@draftably/editor/element`                       | Registers `<draft-editor>`                                                             |
| `@draftably/editor`                               | `mountEditor` and its types                                                            |
| `@draftably/react`, `/editor`, `/server`, `/flow` | The React components, `renderSvg` for server components, React Flow lines              |
| `@draftably/solid`, `/editor`                     | The Solid components                                                                   |
| `@draftably/vue`, `/editor`                       | The Vue components                                                                     |
| `@draftably/svelte`, `/editor`                    | The Svelte components                                                                  |

Each framework package re-exports `renderSvg` and `HOST_EVENTS`.

## Elements

| Member           | On              | Meaning                                                                           |
| ---------------- | --------------- | --------------------------------------------------------------------------------- |
| `source`         | both            | Attribute and property: the `.draft` text.                                        |
| `label`          | `draft-diagram` | Attribute and property: the accessible name.                                      |
| `state`          | `draft-diagram` | Attribute and property: an emphasis state to show.                                |
| `outline`        | `draft-diagram` | Attribute and property: `visible` or `hidden` (default).                          |
| `options`        | both            | Property: [viewer options](#viewer-options) or [editor options](#editor-options). |
| `status`         | both            | Attribute the element sets: `loading`, `ready` or `error`.                        |
| `viewer`         | `draft-diagram` | The [viewer handle](#viewer-handle), after the mount.                             |
| `editor`         | `draft-editor`  | The [editor handle](#editor-handle), after the mount.                             |
| `updateComplete` | `draft-diagram` | A promise for the latest update's result, or `undefined` with no source.          |

`draft-<name>` events: see [Events and status](#events-and-status). The mount: see [How embedding
works](#one-mount-in-a-microtask).

## Viewer options

Set `options` before you add an element when you need custom execution or link rules. It takes
the same options as `mountViewer`:

```ts
const diagram = document.createElement('draft-diagram');
diagram.options = { label: 'Checkout flow', render: { links: { mode: 'none' } } };
diagram.source = source;
document.querySelector('#diagrams')!.append(diagram);
```

| Option                               | Default            | Meaning                                                                       |
| ------------------------------------ | ------------------ | ----------------------------------------------------------------------------- |
| `label`                              | `Diagram viewer`   | The accessible name.                                                          |
| `toolbar`                            | `true`             | Shows the zoom and fit buttons. `false` hides them; they can show again live. |
| `outline`                            | `hidden`           | `visible` keeps the item list under the drawing.                              |
| `detail`                             | `auto`             | `full` keeps slot bodies at every zoom; `auto` hides them below 0.4.          |
| `execution.mode`                     | `worker`           | `main` compiles on the page's thread: for small diagrams, or a link resolver. |
| `execution.createWorker`             | the package worker | A function that returns a `Worker`, for a bundler or a path of your own.      |
| `execution.timeoutMs`                | `5000`             | How long one render can take in a worker before it fails.                     |
| `render.fonts`                       | `embed`            | `host` uses `@draftably/runtime/fonts.css` instead of `data:` fonts.          |
| `render.styleNonce`                  | none               | A nonce for the drawing's `<style>`, for a strict CSP.                        |
| `render.links`                       | `{ mode: 'none' }` | The link policy. See [Links](#links-and-source).                              |
| `render.title`, `render.description` | from the source    | The SVG's accessible title and description.                                   |
| `render.includeSource`               | `false`            | Puts the source in the drawing's metadata.                                    |
| `render.limits`                      | the defaults       | Lower caps on source size, objects, edges, depth and output bytes.            |

A new `execution` or `render.fonts` mounts a new viewer. Every other option applies live.

## Viewer handle

| Member                                  | Meaning                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `update(source, opts?)`                 | Draws new source. `opts`: `camera` (`preserve` or `fit`), `state`, `signal`. Resolves to an `UpdateResult`. |
| `ready`                                 | Resolves after the first drawing or failure, then after each later one.                                     |
| `geometry()`                            | Where each item is drawn, in world units. See [Find where things are](#find-where-things-are).              |
| `on(type, listener)`                    | Listens for an event; returns the function that stops it.                                                   |
| `getCamera()`, `setCamera(camera)`      | Reads or sets `{ centerX, centerY, zoom }`.                                                                 |
| `fit(ids?, opts?)`, `reveal(id, opts?)` | Moves the camera. See [Steer the camera](#steer-the-camera).                                                |
| `focusItem(id)`                         | Focuses an item's outline button. `false` when the item does not exist.                                     |
| `anchor(slots)`                         | Keeps a target for each slot, for content without the element. See [Content on nodes](#content-on-nodes).   |
| `destroy()`                             | Removes the viewer and its listeners.                                                                       |

## Editor options

`mountEditor(host, options)` and `<draft-editor>`'s `options` property take these. The element
sets `source` and `onChange` itself.

| Option       | Default   | Meaning                                                                     |
| ------------ | --------- | --------------------------------------------------------------------------- |
| `source`     | none      | The `.draft` text to edit.                                                  |
| `onChange`   | none      | Receives the new text after every kept edit, undo and redo.                 |
| `storageKey` | none      | Keeps the diagram in browser storage under this key. A new key mounts anew. |
| `openLink`   | a new tab | Opens an object's link.                                                     |
| `confirm`    | none      | Asks before an action that replaces the diagram.                            |
| `onInteract` | none      | Called when the user starts a gesture, so you can close your own menus.     |
| `detail`     | `auto`    | `full` keeps slot bodies at every zoom; `auto` hides them below 0.4.        |

## Editor handle

`el.editor`, or the value `mountEditor` returns:

| Member                                  | Meaning                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| `source()`                              | The text the editor holds now.                                                  |
| `update(source)`                        | Shows text the host changed. Resolves to `{ status, revision }` once drawn.     |
| `ready`                                 | Resolves once the first text is drawn.                                          |
| `geometry()`                            | Where each item is drawn, in the viewer's shapes. The same object per revision. |
| `select(ids)`, `selection()`            | Sets or reads the selection. Unknown IDs are dropped; `[]` clears it.           |
| `getCamera()`, `setCamera(camera)`      | The same camera as the viewer.                                                  |
| `fit(ids?, opts?)`, `reveal(id, opts?)` | Moves the camera, as in the viewer.                                             |
| `on(type, listener)`                    | Listens for an event; returns the function that stops it.                       |
| `anchor(slots)`                         | Keeps a target for each slot, for content without the element.                  |
| `destroy()`                             | Removes the editor. Safe to call twice.                                         |

## Mount a viewer yourself

`mountViewer` is the API under the element. The viewer owns the children of its host: give it an
empty element, mount after the DOM exists, then call `update` with source text. Each handle owns
its camera and cleanup.

```ts
import { mountViewer } from '@draftably/runtime/viewer';
import '@draftably/runtime/viewer.css';

const host = document.querySelector<HTMLElement>('#diagram');
if (!host) throw new Error('Missing #diagram host');
const viewer = mountViewer(host, { label: 'Checkout diagram' });
void viewer.update(source).then(result => {
  if (result.status === 'error') console.error(result.error.diagnostics);
});
// Call viewer.update(nextSource) when the source changes.
// Call viewer.destroy() when the host is removed.
```

Give the host a height in your stylesheet. The viewer fills that height, follows size changes and
waits to fit while hidden.

In a framework, mount in the mount hook, update in a separate effect and destroy in the cleanup.
Two effects let React Strict Mode run setup, cleanup and setup again without sharing a handle:

```tsx
import { useEffect, useRef } from 'react';
import { mountViewer, type ViewerHandle } from '@draftably/runtime/viewer';
import '@draftably/runtime/viewer.css';

export function DraftDiagram({ source }: { source: string }) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef<ViewerHandle | null>(null);
  useEffect(() => {
    if (!host.current) return;
    const viewer = mountViewer(host.current, { label: 'Diagram' });
    current.current = viewer;
    return () => {
      viewer.destroy();
      if (current.current === viewer) current.current = null;
    };
  }, []);
  useEffect(() => {
    void current.current?.update(source);
  }, [source]);
  return <div ref={host} className="diagram-host" />;
}
```

### Worker and fonts

The viewer compiles in a module worker, served from the same origin as a module-relative asset. All
viewers on a page share a small pool of them. A restrictive CSP must allow that worker. The element's styles are a
constructable stylesheet, so a strict `style-src` needs no nonce for them. A worker that does not start or times out returns an
update error; the viewer does not switch to main-thread compilation by itself. Set
`execution: { mode: 'main' }` only for known small inputs, or when you pass a host link resolver,
because worker messages cannot carry functions.

The viewer embeds the fonts it uses as `data:` URLs and waits for them to load before it commits
a drawing, so a CSP needs `font-src data:`. A blocked font returns an error and keeps the
previous drawing. To serve fonts from your origin instead, import `@draftably/runtime/fonts.css`
and set `render: { fonts: 'host' }`. [Strict CSP](#strict-csp) has a complete policy.
