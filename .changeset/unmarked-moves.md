---
'draftably': minor
'@draftably/editor': minor
'@draftably/runtime': minor
---

A box that only moved need not be changed. `was-at=` and `was-size=` go on a line with no `~` mark: the box draws its ghost, the legend counts it as `moved` or `resized` and not as `changed`, and a document with any such line is a diff (change colors, panels, the key). A `~` line with `was-at=` is counted under both, as before; `was`, `was-shape` and `was-count` still need `~`. In a side-by-side view an unmarked move is in both panels.
