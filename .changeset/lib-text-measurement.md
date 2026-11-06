---
'draftably': patch
---

The library entry exports the text measurement the compiler wraps and sizes with (`measureText`, `wrapLines`, `widestPiece`, `wordPieces`, `typeProfile`), so a host that draws text inside a node can size it from the bundled faces' width tables, as the compiler does, with no DOM.
