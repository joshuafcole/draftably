---
'draftably': minor
---

An edit reports the statements it changed. `translateEdit`'s result carries `operations`: each statement it added, removed or set, as `{ kind, statement, id, fields, was? }`, named by what the statement is about (a node's id, the object a `stay` places, a `layout` line's scope). `sourceOperations(before, after)` computes the same for any two sources, and is exported from `./lib`. A file save ignores them.

A session that edits a source a host opened tells the host about every kept edit: `SessionOptions.onEdit` receives the label, the source before and after, its operations, notes and new ids, and whether it amends the edit before it. `SessionOptions.onRefused` hears why an edit the source cannot take snapped back.
