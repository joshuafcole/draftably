---
'draftably': patch
---

`draftably/editor` exports `copyShapes` and `pasteShapes`, the `copy` and `paste` handlers `mountEditor` installs, for a host that mounts `Editor` in its own tree and listens for them itself.
