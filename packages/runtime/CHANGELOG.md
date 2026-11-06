# @draftably/runtime

## 0.2.0

### Minor Changes

- 3b77f78: Add a diagram element with automatic viewer setup and cleanup
- b05bb95: Add the optional read-only viewer with an owned module worker, accessible controls, and packed React, Solid, and browser proofs.
- a0786b0: Add the portable native SVG runtime with TypeScript declarations, exact font assets, Node and browser ESM consumers, and a packed-artifact proof.
- fdb759b: The viewer's item outline is now visually hidden by default. Screen readers keep it, and it appears over the bottom of the drawing while it holds keyboard focus. Set `outline: 'visible'` in `mountViewer`, `outline="visible"` on `<draft-diagram>`, or the `outline` prop on `DraftDiagram` to keep it on screen.

### Patch Changes

- fe01bb5: The guides for every package moved to draftably.dev/docs, and each package README now links there. The Emphasis states page draws each state live.
- ba5f518: A line that runs between two sides, such as a container wall and a box or two container walls, now runs midway between them. Before, it could hug one side. Two lines on one side of a box, pill or circle now sit evenly about the side's middle more often, also when one of them is a straight line to another box.
