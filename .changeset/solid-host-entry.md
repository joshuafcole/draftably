---
'@draftably/solid': minor
'@draftably/editor': patch
'draftably': patch
---

`@draftably/solid/host` lays out and draws diagrams inside a Solid app's own tree, on the app's own Solid: `compile`, `draw` and `StaticScene`, the source reader and printer, the resolved appearance and the compiler's text measurement. Scene lines and labels carry their own fill and anchor, so a drawing reads correctly without the editor's stylesheet.
