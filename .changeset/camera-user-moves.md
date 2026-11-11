---
'@draftably/editor': minor
---

A reader's drag pan, drag zoom, pinch and an undo that brings the view back now report to `SessionOptions.onCamera` as `by: 'user'`, on every pointer move the way the wheel reports on every wheel event, so a host can remember a dragged view and cancel its own glide when the reader takes over. `CameraMover` gains `'fit'` for the editor's own automatic fits and reveals (the first fit once the canvas has a size, a fit after a layout, an opened diagram, a new shape brought into view); `'user'` is now only the reader (the Fit command included) and `'host'` is unchanged. A host that treats anything but `'host'` as the reader behaves as before; one that tests `by === 'user'` stops hearing the editor's fits, and a callback annotated `(camera, by: 'user' | 'host')` no longer type-checks until it names `'fit'`.
