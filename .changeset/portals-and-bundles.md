---
'draftably': minor
---

Portals and bundles. `shape=portal` is a node for something outside the drawing: layout leaves it out, and it is placed after layout just outside the frame, on the side facing what it connects to, with room for its lines' labels. `routing bundle=N` runs N or more lines between one pair of ends as one trunk labelled with its count, and `bundle a b "name"` names a pair's trunk. The viewer spreads a trunk into its lanes while it is pointed at, focused or picked, keeps a selected member out of the trunk, and names a trunk on a double click of its label (a `bundle` statement); exported SVG draws the trunk.
