---
'draftably': patch
'@draftably/runtime': minor
'@draftably/editor': minor
---

`<draft-editor>` now sends `draft-update` for its first source and for each source update, as `<draft-diagram>` does. Its result is an `EditorUpdate`: a commit has no `value` or `diagnostics`, and a source that does not parse is an `error` with a `DRAFT_PARSE` diagnostic. The element's `status` is then `error`. The editor's `draft-diagnostics` now holds that parse error too, before its slot warnings.

The editor also sends a cancelable `draft-link` when the user presses a link mark, with `{ itemId, href, target: '_blank' }`. Call `preventDefault()` to open the link yourself. The editor sends no `draft-render` or `draft-itemactivate`: a press selects an item, so listen for `draft-select`. The events table now says which element sends each event.

A slot name with an unknown prefix, such as `bdy:api`, now adds `DRAFT_SLOT_UNKNOWN` and shows nothing. Before, its content drew over the item.

Breaking for TypeScript: `HostEvents['update']` is now `UpdateResult | EditorUpdate`. On a commit, `value` may be `undefined`: check it, as in `detail.status === 'committed' && detail.value`.
