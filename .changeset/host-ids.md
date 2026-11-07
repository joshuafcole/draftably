---
'draftably': minor
---

A host can give new objects and connections their ids: `translateEdit`'s `newId`, and a session's `SessionOptions.newId`, receive the kind, the label, a connection's ends and a `taken` check, and return the id. With it, ids are never made from labels.
