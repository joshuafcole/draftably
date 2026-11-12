---
'@draftably/runtime': patch
---

Content marked `data-draft-input` in a `mountViewer` slot target takes the pointer with only
`viewer.css`. Before, a button there took no clicks unless the page copied the rule from
`host.css`.
