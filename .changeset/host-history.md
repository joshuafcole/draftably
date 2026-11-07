---
'draftably': minor
---

A host can keep a session's undo history: `SessionOptions.history` takes a `HistoryHandler` (`undo`, `redo`, `canUndo`, `canRedo`) that the keys and menus call in place of the session's own steps, or `false` to turn undo and redo off.
