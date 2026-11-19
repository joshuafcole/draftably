---
'draftably': minor
'@draftably/runtime': minor
'@draftably/editor': minor
---

Read a code node's body from a file with `src="queries/orders.sql#L10-L40"`, relative to the `.draft`. `lang=` and `start=` default from the file, the viewer redraws when the file changes, and every export inlines the code so an exported image opens on its own. The static app draws a placeholder that names the file, and `check` reports a missing file, a range past its end and a path outside the served folder.
