---
'draftably': minor
---

`inspect --json --metrics` adds a `findings` list: every diagnostic `check --metrics` prints. The library entry exports `checkScene(scene, { metrics, fit })`, the same check as one call, so a host that compiles a source itself gets the findings `check` would print.
