---
'draftably': minor
'@draftably/editor': minor
---

A host can draw its own node bodies. `size id width= height=auto min-height=` sets a floor under a node's auto height, so a host that draws more than the title declares the room in the source and a compile without the host lays the node out the same. The editor entry exports `NodeContentProvider`: inside it, a node the host draws shows the host's body in a `foreignObject` the size of the node, in place of its title, with the shape, selection and ports still the scene's. Exports and the CLI draw the title.
