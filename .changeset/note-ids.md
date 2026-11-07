---
'draftably': minor
'@draftably/editor': minor
---

A note may take an ID before its text: `note billing "Billed monthly." near=seat`. The SVG marks it `data-note="billing"`, and a diagram session treats it as a view item of kind `note`: `showSelection` and `onSelect` select and report it, and `fitTo` and `reveal` frame it. A note's ID is unique among notes, objects and connections. A note without one is unchanged.
