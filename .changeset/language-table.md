---
'@draftably/editor': patch
'@draftably/runtime': patch
---

`draftably/lib` exports the closed vocabularies the language is built from (`ENGINES`, `ENGINE_PARAMS`, `ROUTING_PARAMS`, `THEME_ATTRS`, `CONFIG_KEYS`, `DSL_SHAPES`, `MARKERS`, `THEME_IDS`, `NOTE_SIDES`, `MARKS`), so a host can hold its own tables to them. What the parser accepts and the diagnostics it gives are unchanged.
