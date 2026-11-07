---
'draftably': minor
'@draftably/editor': minor
---

A note takes `states=a,b`: it shows only while one of those emphasis states is drawn, in the Editor, `inspect --svg --state` and the runtime, and in no drawing without a state. A note without `states=` shows everywhere and keeps its spot in every state. `check` reports `note-overlap` per state and an unknown state by name. A session's `viewerFrame()` marks a note the drawn state leaves out `hidden`.
