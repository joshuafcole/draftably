---
'@draftably/editor': minor
'draftably': patch
---

A host drives an editor's camera through its session: `getCamera()` and `setCamera()` read and set it, `fitTo(ids)` frames some objects, and `reveal(id)` brings one into view with the least move (nothing if it is already on screen, zooming out only when it can't fit, never below 55%). `mountEditor`'s new `onCamera` option, and the `draft-camera` event on `<draft-editor>`, report every move with its `reason`: `api` for the host's calls, `user` for everything else. Pinch, drag-pan and drag-zoom now move the camera through the session, so they are reported (and saved) like wheel and button zooms.
