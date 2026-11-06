---
'@draftably/editor': patch
---

The step that scopes the editor's stylesheets to `.draft-editor` is its own module, `scripts/lib/scope-css.ts` (`scopeEditorCss`), so a host compiling the editor from source can scope the same stylesheets the published editor does.
