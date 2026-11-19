---
'draftably': patch
'@draftably/runtime': patch
'@draftably/editor': patch
---

Document code nodes on every docs surface: a Code page in the docs sidebar, a "Code behind a step" recipe, the `src=` safety limits, and a `code-review` example with SQL, a diff, named ranges and edges that end on a range. The docs site's `.draft` highlighter now reads a code node's body as text, not as statements. The `code-wrap` and `code-clip` warnings now read "1 line wraps" and "1 line is cut off". A refused `src=` path in the CLI now names the `.draft` file's git root (or its folder) instead of "the folder draftably serves".
