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

| Option       | Effect                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| `source`     | The `.draft` text to edit.                                                 |
| `onChange`   | Receives the new text after every kept edit, undo and redo.                |
| `storageKey` | Keeps the diagram in browser storage under this key, so a reload keeps it. |
| `openLink`   | Opens an object's link. Without it, a URL opens in a new tab.              |
| `confirm`    | Asks before an action that replaces the diagram.                           |
| `onInteract` | Called when the user starts a gesture, so you can close your own menus.    |
| `onCamera`   | Called after every camera move with `{ camera, reason }`: see below.       |

## Move the camera

The session moves the camera for you. `fitTo` frames some objects, and `reveal` brings one into
view without jumping: nothing moves if it is already on screen, otherwise the camera pans the
least it can, and zooms out only when the object can't fit, never below 55%.

```ts
const editor = mountEditor(host, {
  source,
  onCamera: ({ camera, reason }) => console.log(reason, camera),
});
const { session } = editor;

session.fitTo(['api', 'db']); // frame these, centred
session.reveal('cache', { margin: 40 }); // bring this into view
session.setCamera({ x: 0, y: 0, k: 1 }); // the screen point of the origin, and the zoom
session.getCamera();
```

| Call                  | Effect                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------- |
| `getCamera()`         | The camera now: `x` and `y` are where the drawing's origin is on screen, `k` is the zoom. |
| `setCamera(camera)`   | Move it there.                                                                            |
| `fitTo(ids, options)` | Frame shapes, groups or connections, centred. `margin` (40), `minZoom`, `maxZoom` (1).    |
| `reveal(id, options)` | Bring one object into view with the least move. `margin` (40), `minZoom` (0.55).          |

`fitTo` and `reveal` return whether the camera moved; an id the diagram does not have is skipped.
Asked before the canvas has a size, they wait for it. `onCamera` reports every move once, with
`reason: 'api'` for these calls and `'user'` for everything else, the editor's own fit included.
`<draft-editor>` fires the same as a `draft-camera` event, and its `editor.session` takes the calls.

[Using the Editor](#editing-in-the-viewer) and [Shortcuts](#shortcuts) describe what your users can
do in it.
