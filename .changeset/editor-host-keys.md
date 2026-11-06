---
'draftably': patch
'@draftably/editor': patch
---

The editor entry exports `registerFonts`, `handleCanvasKey` and `handleKeyUp`, so a host that mounts `Editor` inside its own tree can set up the fonts and shortcuts `mountEditor` sets up.
