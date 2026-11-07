# Editor component

Put the Draftably editor in your own page. Users drag boxes and lines, add shapes with **N**, edit
labels and undo, and you get the `.draft` source back after every edit.

```sh
pnpm add @draftably/editor
```

```ts
import '@draftably/editor/element';
```

```html
<draft-editor source='node api "API"'></draft-editor>
```

The element is 28rem tall by default; set its height with CSS. Its styles apply only inside the
editor. Any number of editors can share a page, and each keeps its own selection, undo history and
camera. Keyboard shortcuts go to the editor the user last pointed at.

## Read and set the source

Listen for `draft-change`. Its `detail` is the new source after every kept edit, undo and redo:

```ts
const editor = document.querySelector('draft-editor')!;
editor.addEventListener('draft-change', e => save((e as CustomEvent<string>).detail));
```

Set `source` to load other text, such as a file the user picked. The editor does not redraw for a
value it reported itself, so you can pass each change straight back.

## In a framework

| Framework | Import                                        | Change callback |
| --------- | --------------------------------------------- | --------------- |
| React     | `DraftEditor` from `@draftably/react/editor`  | `onChange`      |
| Solid     | `DraftEditor` from `@draftably/solid/editor`  | `onChange`      |
| Vue       | `DraftEditor` from `@draftably/vue/editor`    | `@change`       |
| Svelte    | `DraftEditor` from `@draftably/svelte/editor` | `onchange`      |

```tsx
import { useState } from 'react';
import { DraftEditor } from '@draftably/react/editor';

export function DiagramField() {
  const [source, setSource] = useState('node web "Web"\nnode api "API"\nedge e1 web -> api');
  return <DraftEditor source={source} onChange={setSource} style={{ height: '28rem' }} />;
}
```

The editor loads in the browser after the component mounts. Server rendering and pages that only
show diagrams never download it. To show a diagram without editing, use `DraftDiagram` from the
same package: see [Frameworks](#frameworks).

## Mount it yourself

`mountEditor` gives you the lifecycle. Give the host a size; the canvas fills it.

```ts
import { mountEditor } from '@draftably/editor';

const editor = mountEditor(document.querySelector('#editor')!, {
  source: 'node web "Web"',
  onChange: source => save(source),
});
await editor.update('node web "Web"\nnode api "API"'); // show text you changed
editor.source(); // the text the editor holds now
editor.destroy(); // when the host is removed
```

| Option        | Effect                                                                     |
| ------------- | -------------------------------------------------------------------------- |
| `source`      | The `.draft` text to edit.                                                 |
| `onChange`    | Receives the new text after every kept edit, undo and redo.                |
| `storageKey`  | Keeps the diagram in browser storage under this key, so a reload keeps it. |
| `openLink`    | Opens an object's link. Without it, a URL opens in a new tab.              |
| `confirm`     | Asks before an action that replaces the diagram.                           |
| `onInteract`  | Called when the user starts a gesture, so you can close your own menus.    |
| `nodeContent` | Draws some nodes' bodies yourself: see below.                              |

## Draw a node's body yourself

`nodeContent` puts your own drawing inside some nodes, in place of their titles. `draws(id)` says
which nodes; `Body` returns the DOM to show in each. The body fills the node, sits over its shape
and under its ports and handles, and takes no pointer events, so the pointer still selects and
edits the node.

```ts
mountEditor(host, {
  source: 'node api "API"\nsize api width=200 height=auto min-height=120',
  nodeContent: {
    draws: id => id === 'api',
    Body: ({ id, width, height }) => {
      const body = document.createElement('div');
      body.textContent = `${id}: ${width}×${height}`;
      return body;
    },
  },
});
```

Layout never measures the body. Give the node the room it needs in the source with
`size id width= height=auto min-height=`: the height fits the title, and never goes below
`min-height`. Because the room is in the source, the CLI, exports and an editor without
`nodeContent` lay the node out the same way; they draw the title instead of the body.

[Using the Editor](#editing-in-the-viewer) and [Shortcuts](#shortcuts) describe what your users can
do in it.
