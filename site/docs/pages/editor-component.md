# Editor component

Put the Draftably editor in your own page. Users drag boxes and lines, add shapes with **N**, edit
labels and undo, and you get the `.draft` source back after every edit.

```sh
pnpm add @draftably/editor @draftably/runtime
```

```ts
import '@draftably/editor/element';
import '@draftably/runtime/host.css';
```

```html
<draft-editor source='node api "API"'></draft-editor>
```

The element is 28rem tall by default; set its height with CSS. It renders in a shadow root, so its
styles apply only inside the editor and page styles do not change it. Any number of editors can share a page, and each keeps its own selection, undo history and
camera. Keyboard shortcuts go to the editor the user last pointed at.

## Read and set the source

Listen for `draft-change`. Its `detail` is `{ source }`, after every kept edit, undo and redo:

```ts
const editor = document.querySelector('draft-editor')!;
editor.addEventListener('draft-change', e => save(e.detail.source));
```

Set `source` to load other text, such as a file the user picked. The editor does not redraw for a
value it reported itself, so you can pass each change straight back.

Set `options` for the other `mountEditor` options (see the table below):

```ts
editor.options = { openLink: href => router.open(href), onInteract: closeMenus };
```

The editor mounts in a microtask after it connects, so options set in the same task apply from the
start. Callbacks apply live. Only a new `storageKey` mounts a new editor. Like `<draft-diagram>`,
the element reflects `status="loading | ready | error"`.

A shortcut goes to the editor the user last pointed at or focused. A press on the drawing moves
focus into the editor, so a field elsewhere on the page, such as one in a viewer's slot, gives up
its keys. A press on the page outside every editor ends that, so typing on the page after a click
on empty space never edits a diagram. A removed editor never takes shortcuts.

## Editor colors

The editor's colors are CSS properties on the element. A value you set on `draft-editor` wins
over the default. The editor sets each property on its own element, so a value on an ancestor
does not reach it, and a page's own `--bg` or `--text` never changes the editor:

```css
draft-editor {
  --accent: #0f766e; /* selection, ports and handles */
}
```

The editor's controls follow the page's color scheme, as its drawing does. Set
`data-theme="dark"` or `data-theme="light"` on the element to choose them yourself. The properties include `--bg`,
`--surface`, `--surface-2`, `--hover`, `--line`, `--line-strong`, `--text`, `--muted`, `--ink`,
`--ink-hover`, `--ink-on`, `--accent`, `--accent-hover`, `--accent-soft`, `--accent-ink`,
`--success`, `--warning`, `--danger`, `--font` and `--mono`.

The canvas and the drawing follow the page's color scheme, as `<draft-diagram>` does (see
[Dark pages](#dark-pages)). On a page whose `color-scheme` allows dark, a source with no `theme`
line or with `theme drafting` draws dark, and a page that declares no scheme stays light.
`draft-editor { color-scheme: light }` keeps one editor light. A padding or font change in the editor
writes a `theme drafting` line, and the drawing still follows the page. `data-theme` sets the editor's controls, not
the drawing.

## Content on nodes in the editor

The editor takes the same slot content as `<draft-diagram>`: children marked
`data-draft-slot="body:<id>"` or `"overlay:<id>"`. [Content on nodes](#content-on-nodes) has the
rules, and [In the editor](#in-the-editor) says how a body works with selecting, connecting and
resizing.

## In a framework

| Framework | Import                                        | Change callback |
| --------- | --------------------------------------------- | --------------- |
| React     | `DraftEditor` from `@draftably/react/editor`  | `onChange`      |
| Solid     | `DraftEditor` from `@draftably/solid/editor`  | `onChange`      |
| Vue       | `DraftEditor` from `@draftably/vue/editor`    | `@change`       |
| Svelte    | `DraftEditor` from `@draftably/svelte/editor` | `onchange`      |

Each callback receives `{ source }`. Each component also takes `options`, and the same element
access and event props as `DraftDiagram` (see [How embedding works](#embed-concepts)). The editor sends
`update`, `anchors`, `diagnostics`, `camera`, `link`, `contextmenu`, `select` and `change`. It
sends no `render` or `itemactivate`: a press selects an item, so listen for `select`. See
[Events and status](#events-and-status).

```tsx
import { useState } from 'react';
import { DraftEditor } from '@draftably/react/editor';

export function DiagramField() {
  const [source, setSource] = useState('node web "Web"\nnode api "API"\nedge e1 web -> api');
  return (
    <DraftEditor
      source={source}
      onChange={change => setSource(change.source)}
      style={{ height: '28rem' }}
    />
  );
}
```

The editor loads in the browser after the component mounts. Server rendering and pages that only
show diagrams never download it. To show a diagram without editing, use `DraftDiagram` from the
same package: see [Choose how to embed](#embed).

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
editor.fit(['api']); // the viewer's camera methods: fit, reveal, getCamera, setCamera
editor.on('camera', ({ camera, reason }) => saveView(camera));
editor.destroy(); // when the host is removed
```

The editor's handle has the viewer's camera, with the same `{ centerX, centerY, zoom }` shape,
zoom range and rules: see [Steer the camera](#steer-the-camera). It also has the viewer's
`geometry()` (see [Find where things are](#find-where-things-are)), and `ready`, which resolves
once the first text is drawn. The editor's `revision` counts changes to the drawing, by the user
or by `update()`. `update()` and `ready` resolve with the revision they drew, so it equals
`geometry().revision`. The editor builds geometry when you first read it for a revision, so a
drag costs nothing extra when no host reads it.

```ts
editor.select(['api', 'db']); // unknown IDs are dropped; [] clears
editor.selection(); // ['api', 'db']
editor.on('select', ({ ids, reason }) => showInspector(ids)); // reason: 'user' or 'api'
editor.on('contextmenu', ({ id, clientX, clientY }) => openMyMenu(id, clientX, clientY));
```

The editor shows no menu of its own; a right-click selects the item and reports `contextmenu`.
`anchors` lists the slot targets, and `diagnostics` reports slot warnings, as in the viewer.

| Option       | Effect                                                                        |
| ------------ | ----------------------------------------------------------------------------- |
| `source`     | The `.draft` text to edit.                                                    |
| `onChange`   | Receives the new text after every kept edit, undo and redo.                   |
| `storageKey` | Keeps the diagram in browser storage under this key, so a reload keeps it.    |
| `openLink`   | Opens an object's link. Without it, a URL opens in a new tab.                 |
| `confirm`    | Asks before an action that replaces the diagram.                              |
| `onInteract` | Called when the user starts a gesture, so you can close your own menus.       |
| `detail`     | `'full'` keeps slot bodies at every zoom. Default `'auto'`: hidden below 0.4. |

[Using the Editor](#editing-in-the-viewer) and [Shortcuts](#shortcuts) describe what your users can
do in it.
