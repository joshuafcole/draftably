# How embedding works

Two custom elements are the whole contract. `<draft-diagram>` shows a diagram and
`<draft-editor>` edits one. The React, Solid, Vue and Svelte packages are thin components around
them, so everything on this page holds in every framework.

## The element is the contract

Each element sets itself up: its styles, a worker, fonts, zoom controls, and cleanup when it
leaves the page. It renders in a shadow root, so page styles do not change the drawing, and the
drawing's styles do not leak into the page.

A framework component adds only its framework's idiom:

| Piece            | React                     | Solid         | Vue                     | Svelte                    |
| ---------------- | ------------------------- | ------------- | ----------------------- | ------------------------- |
| The element      | `ref`                     | `ref`         | `ref` → `.element`      | `bind:element`            |
| Events           | `onUpdate`, `onCamera`, … | `onUpdate`, … | `@update`, `@camera`, … | `onupdate`, `oncamera`, … |
| Server SVG       | `renderSvg`, re-exported  | the same      | the same                | the same                  |
| Slot content     | `children`                | `children`    | default slot            | `children`                |
| Other attributes | passed to the element     | the same      | the same                | the same                  |

An event prop is `on` and the event's lowercase name, such as `onItemactivate`. It receives the
event's `detail`. [Events and status](#events-and-status) lists every event.

## Props and attributes

| Prop or attribute | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `source`          | The `.draft` text. A change redraws the diagram and keeps the camera.                  |
| `label`           | The accessible name.                                                                   |
| `outline`         | `'visible'` keeps the item list under the drawing. Default: hidden until it has focus. |
| `state`           | A declared [emphasis state](#emphasis-states) to show.                                 |
| `svg`             | Static SVG shown until the viewer draws. See [Server rendering](#server-rendering).    |
| `options`         | Every `mountViewer` option, as a property. See [API reference](#viewer-options).       |

On the element, `source`, `label`, `state` and `outline` are attributes and properties; `options`
is a property only. Any other attribute, such as `data-theme`, `id` or `aria-*`, goes to the
element unchanged, and so does your framework's class: `className` in React, `class` in the others.

## One mount, in a microtask

An element mounts once, in a microtask after it connects. Every property you set in the same
task lands before the first draw, so the order of `source` and `options` does not matter.
Properties set before the element's script loads survive its upgrade.

Most options apply live and keep the camera: `label`, `outline`, `toolbar`, callbacks and render
settings. Only these mount a new viewer or editor:

- `execution` or `render.fonts`, on `<draft-diagram>`;
- `storageKey`, on `<draft-editor>`.

`options` compares by value, so a new object with the same values does nothing. A React parent can
pass `options={{ detail: 'full' }}` on every render.

`el.viewer` and `el.editor` are the handles under the elements. They are `undefined` until the
mount runs, so wait for the first update before you read them:

```ts
document.body.append(diagram);
await diagram.updateComplete;
diagram.viewer?.fit();
```

## Status

Both elements reflect their state in a `status` attribute: `loading`, `ready` or `error`, and no
attribute while `source` is empty. A later failed update keeps `ready` and the last drawing.
[The status attribute](#the-status-attribute) has the full table.

## World units

Positions and sizes in `geometry()`, the camera and the `.draft` source share one unit: a pixel of
the drawing at zoom 1. The camera is the world point at the center of the view and a zoom from
0.02 to 8. [Camera and geometry](#camera-and-geometry) has the calls.

## Your content on a node

Children marked `data-draft-slot="body:<id>"` or `"overlay:<id>"` go on a node. The element puts
them in place without changing your DOM, so your framework keeps rendering them and your page CSS
styles them. [Content on nodes](#content-on-nodes) has the rules.

## Workers and fonts

Diagrams compile in module workers that load from beside each package, and every diagram on a
page shares them. [Performance](#many-diagrams-on-a-page) gives the pool's size and costs.
