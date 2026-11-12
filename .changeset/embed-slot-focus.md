---
'draftably': patch
'@draftably/editor': patch
---

A press on the editor's drawing now moves focus into the editor. Before, a focused field outside it, such as a `data-draft-input` field in a `<draft-diagram>` slot, kept the focus: Backspace and Delete edited the field, not the selected node. A press on a field, or on content marked `data-draft-input`, still keeps its own focus.
