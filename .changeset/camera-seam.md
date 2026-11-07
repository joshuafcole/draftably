---
'@draftably/editor': minor
---

A host drives a session's camera: `camera()` reads it and `moveCamera` sets it, `fitTo(ids, margin)` frames some objects, and `reveal(id)` brings one into view the way an automatic move should: nothing moves if it is already on the canvas, otherwise the least pan, zooming out only when it can't fit and never below a legible floor (`LEGIBLE_ZOOM`, 55%). A fit asked for before the canvas has a size waits for it. `SessionOptions.onCamera` hears every move with who made it, `host` or `user`.
