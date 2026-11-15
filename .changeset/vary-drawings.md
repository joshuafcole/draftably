---
'draftably': minor
---

`vary(source, { drawings: true })` keeps the drawing it measured for each listed variant on its `drawn` entry, as `drawing`: the scene, its rects and routes. A host that wants a variant's geometry reads it there instead of compiling and routing the variant's source again. Without the option the result is unchanged.
