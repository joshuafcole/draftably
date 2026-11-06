---
'draftably': minor
---

`check --score` weighs every warning into one number per drawing and, with several files, ranks them, highest first. It ranks; it does not judge: a file passes `check` whatever its score. `inspect --json --metrics --score` adds the score as an object, and the library exports `drawingScore` and `checkScene(scene, { score: true })`.
