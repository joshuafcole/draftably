---
'draftably': minor
---

Make room by the warp alone and redraw only the lines it bent. `redrawBent(made)` takes `makeRoom`'s result and leaves every box where the warp put it. A line whose course was stitched from two drawings (into an opened container) is redrawn; so is one a cut ran across whose warped course the router will not hold as its plan (a diagonal piece, an end off its port or not leaving square, a piece through a box, a frame or a title band). Every other line keeps the warp's course point for point and is held by the router while the bent ones are routed around it. `makeRoom` now reports `joined` and `reshaped` lines, and warps a line's authored bends (`route`) with its points, so a redrawn line runs through them where the warp put them.

`relaxRoom`, `RELAX_MAX_MOVE` and `RelaxOptions` are removed: the redraw replaces the relaxation, which moved boxes off the warp by up to its cap to straighten lines.
