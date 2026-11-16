---
'@draftably/editor': patch
'@draftably/runtime': patch
---

The language is data: `LANGUAGE` lists every statement, the attributes each takes and what each value may be, and `parseModel` reads its attribute lists and closed vocabularies from it, so a host can list the language without reading the parser. `draftably/lib` exports it with the vocabularies it is built from (`ENGINES`, `ENGINE_PARAMS`, `ROUTING_PARAMS`, `THEME_ATTRS`, `CONFIG_KEYS`, `DSL_SHAPES`, `MARKERS`, `THEME_IDS`, `NOTE_SIDES`, `MARKS`). What the parser accepts and the diagnostics it gives are unchanged.
