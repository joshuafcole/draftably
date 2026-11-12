# `@draftably/editor`

The Draftably diagram editor. Drag boxes and lines, add shapes, edit labels, undo, and get the
`.draft` source back after every edit. Any number of editors can share a page; each keeps its own
document, selection, undo history and camera.

```sh
pnpm add @draftably/editor @draftably/runtime
```

```ts
import '@draftably/editor/element';
import '@draftably/runtime/host.css'; // once per page
```

```html
<draft-editor source='node api "API"'></draft-editor>
```

Listen for `draft-change`; its `detail` is `{ source }`. Set `source` to load other text. Give
the element a height; it is 28rem by default. It renders in a shadow root, so its styles apply only inside the editor. Put your own content on
a node with a child marked `data-draft-slot="body:<id>"`.

In React, Solid, Vue or Svelte, use `DraftEditor` from `@draftably/react/editor` and the
others. For your own lifecycle, call `mountEditor(host, { source, onChange })`.

[Editor component](https://draftably.dev/docs/editor-component) has the options and the framework
props.
