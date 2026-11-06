# @draftably/editor

## 0.2.0

### Minor Changes

- 13e3bd5: Add `@draftably/editor`: the diagram editor as `mountEditor()` and a `<draft-editor>` element. Drag boxes and lines, and get the `.draft` source back on every edit. Any number of editors can share a page. Each framework package adds `DraftEditor` under its `/editor` subpath.

### Patch Changes

- fe01bb5: The guides for every package moved to draftably.dev/docs, and each package README now links there. The Emphasis states page draws each state live.
- ba5f518: A line that runs between two sides, such as a container wall and a box or two container walls, now runs midway between them. Before, it could hug one side. Two lines on one side of a box, pill or circle now sit evenly about the side's middle more often, also when one of them is a straight line to another box.
- 81e76a8: `@draftably/editor` now holds only the editable canvas. It no longer bundles the Mermaid and D2 importers, the import dialogs or the app's panel state, so the package drops from about 20 MB to 1.7 MB unpacked. Importing it no longer reads the window size or writes to localStorage. A mounted editor keeps its canvas shortcuts; app-only shortcuts, such as the command palette, stay in the app.
