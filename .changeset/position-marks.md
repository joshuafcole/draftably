---
'draftably': minor
---

A changed (`~`) line can say where a box was and how big: `was-at=x,y` (nodes and groups, in the parent's content area as `pin` gives it) and `was-size=w,h` (nodes). The merged drawing draws a dotted ghost of the old box, a hairline from a ghost that stands clear of its box, and, for an old corner off the frame, a line to the frame's edge; the legend counts them as moved and resized. Nothing moves. `compare` writes both words from changed `pin`, `stay` and `size` lines.
