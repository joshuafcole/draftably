# Camera and geometry

Move the view from your code, save and restore it, and find where each item is drawn. The viewer
and the editor share one camera and one set of calls.

## Pan and zoom

The viewer zooms with the wheel, pans with a background drag, and has zoom and fit buttons. While
its viewport has focus, `+`, `-` and `f` zoom and fit. **Fit diagram** shows the whole diagram with
a margin, capped at actual size. Your camera changes stay through source updates and resizes;
call `fit()` or update with `{ camera: 'fit' }` for a new overview.

## Steer the camera

The viewer and the editor share one camera: the world point at the centre of the view, and a
zoom from 0.02 to 8. The same call moves both the same way.

```ts
await diagram.updateComplete; // the viewer exists after the first update
const viewer = diagram.viewer!;
viewer.fit(['api', 'db']); // frame these items; no ids frames the whole drawing
viewer.reveal('queue'); // the least move that shows it; zooms out only if it does not fit
viewer.fit(undefined, { padding: { top: 16, right: 16, bottom: 16, left: 320 } }); // a side panel
const camera = viewer.getCamera(); // { centerX, centerY, zoom }, to save and restore
viewer.setCamera(camera);
```

`fit` and `reveal` return `moved`, `unchanged` or `missing` (no such item). Before the viewport
has a size or a drawing, they return `pending` and run the latest call once it has both.
`padding` (screen pixels, default 32), `minZoom` and `maxZoom` (default 1 for `fit`) shape both.

The `camera` event (`draft-camera` on the element) comes at most once per animation frame, also
during a drag, with a `reason`: `user`, `api`, `fit`, `resize`, or `restore` when the editor
brings a saved or undone view back.

`focusItem(id)` moves keyboard focus to an item's button in the outline and shows it, as a user
pressing Tab would. It returns `false` when the drawing has no such item.

### Restore the user's view

Keep the camera when the user moves it, and set it again after the first drawing:

```tsx
import { useRef } from 'react';
import { DraftDiagram, type DraftDiagramElement } from '@draftably/react';

export function SavedView({ source }: { source: string }) {
  const el = useRef<DraftDiagramElement>(null);
  const restored = useRef(false);
  return (
    <DraftDiagram
      ref={el}
      source={source}
      onCamera={({ camera, reason }) => {
        if (reason === 'user') localStorage.setItem('view', JSON.stringify(camera));
      }}
      onUpdate={result => {
        const saved = localStorage.getItem('view');
        if (result.status !== 'committed' || restored.current || !saved) return;
        restored.current = true;
        el.current?.viewer?.setCamera(JSON.parse(saved));
      }}
    />
  );
}
```

The same calls work on `el.editor`. The editor also saves its view with `storageKey`, and sends
`restore` as the reason when it brings a saved or undone view back.

## Find where things are

`geometry()` returns where every node, group and edge is drawn, in world units, in the
[graph API's shapes](#layout-api): a `Box` per node and group, and per edge its points, its SVG
path and its label box. `frame` is the whole drawing, with the heading and legend; `bounds` holds
the shapes and lines only. It is `null` before the first drawing, and for `compare` and `states`
drawings, which draw an item more than once.

```ts
const g = diagram.viewer?.geometry();
const api = g?.nodes.api; // { x, y, width, height, parent? }
```

The object is the same until the next drawing, whose `revision` it carries; the `render` event
brings the new one. `renderSvg` returns the same `geometry` with a successful result, in the SVG's
`viewBox` units. `ready` resolves after the first drawing or failure, then after each later one.

To place your own element over an item, prefer an [overlay slot](#content-on-nodes): it follows
every pan and zoom with no code.

## The outline

The outline is a numbered list of item buttons, one for each node, group and edge. Screen readers
and keyboard users always have it. By default it is visually hidden: press Tab from the viewport
and it shows over the bottom of the drawing while it has focus. Selecting an item centers it at
actual size or larger. Set `outline: 'visible'` to keep the list under the drawing:

```ts
mountViewer(host, { label: 'Checkout diagram', outline: 'visible' });
```

`detail: 'full'` keeps [slot bodies](#put-your-content-on-a-node) at every zoom; the default,
`'auto'`, hides them below a zoom of 0.4.
