---
'@draftably/editor': minor
---

The editor's own automatic fits and reveals (fitting a set of frames, bringing a new shape into view) now report to `onCamera` as `'fit'` rather than `'user'`, and `fitView(by)` takes the reason, so the Fit command reports `'user'`. A host tells the reader's moves from the editor's by the reason.
