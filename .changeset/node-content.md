---
'draftably': minor
'@draftably/runtime': minor
'@draftably/editor': minor
---

A host can draw its own node bodies. `size id width= height=auto min-height=` sets a floor under a node's auto height, so a host that draws more than the title declares the room in the source, and the CLI, the runtime and an editor without the host lay the node out the same. `mountEditor`'s new `nodeContent` option names the nodes a host draws and the body to show in each: it fills the node in place of the title, over its shape and under its ports and handles. Exports and the CLI draw the title.
