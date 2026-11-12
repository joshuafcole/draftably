# Layout API

`@draftably/runtime/graph` lays out and routes a graph that your app draws. You give it nodes,
groups and edges as plain data. It gives back a position and size for each box, and a routed line
and label box for each edge. Your app draws them its own way.

```sh
pnpm add @draftably/runtime
```

It uses the same compiler and router as `.draft` files, so a graph draws the same as the file it
equals. It runs in Node and in a browser, with no runtime dependencies.

Already use React Flow, Svelte Flow, elkjs, dagre or Cytoscape.js? [Drop in your graph
layout](#layout-drop-in) shows the one call to change for each, with before and after code.

## Lay out a graph

```ts
import { layout } from '@draftably/runtime/graph';

const placed = await layout({
  nodes: [
    { id: 'web', label: 'Web app' },
    { id: 'api', label: 'API gateway' },
    { id: 'orders', label: 'Orders', parent: 'services' },
    { id: 'db', label: 'Postgres', width: 140, height: 60 },
  ],
  groups: [{ id: 'services', label: 'Domain services' }],
  edges: [
    { source: 'web', target: 'api', label: 'HTTPS' },
    { source: 'api', target: 'orders' },
    { source: 'orders', target: 'db', dashed: true },
  ],
  direction: 'right',
});

placed.nodes.api; // { x, y, width, height }
placed.edges.e1; //  { points, path, label, sourceSide, targetSide, blocked }
```

IDs can be any string, such as `1` or `a b`. Results use your IDs, keyed by ID. An edge without
an `id` is `e1`, `e2` and so on, in order.

### Input

| Field       | Meaning                                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `nodes`     | `id`, `label`, `parent` (a group ID), `shape` (`box`, `pill`, `circle`, `diamond`, `text`), `width`, `height`. |
| `groups`    | `id`, `label`, `parent`, `arrange`, `direction`, `gap`. A group holds the nodes and groups that name it.       |
| `edges`     | `id`, `source`, `target`, `label`, `dashed`, `sourceSide` and `targetSide` (`left`, `right`, `top`, `bottom`). |
| `arrange`   | How the top level is arranged: `flow` (the default), `row`, `column`, `lanes`, `sequence` or `engine:<name>`.  |
| `direction` | `right` or `down`. Without one, `flow` picks the direction that fits best.                                     |
| `gap`       | Space between boxes in pixels.                                                                                 |
| `fit`       | The shape to aim for: `wide`, `slide`, `square`, `page` or `tall`.                                             |
| `fold`      | `auto` (the default) folds a long `flow` into rows when it is much wider than a page. `never` keeps one row.   |
| `routing`   | Router settings, as in [Routing](#routing), and `quality`.                                                     |

A node without a size fits its label in Draftably's fonts. Give a size when your app draws the
label in another font, or measures its nodes first. A size is kept within 40–1200 by 24–1200
pixels; the result's `warnings` say when one was changed.

The arrangements and engines are the ones the [Language](#overview) describes. See
[Layout engines](#layout-engines) for the `engine:` names.

### Output

| Field      | Meaning                                                                                |
| ---------- | -------------------------------------------------------------------------------------- |
| `nodes`    | `{ x, y, width, height, parent? }` by node ID.                                         |
| `groups`   | The same, by group ID. A group's box holds its title band and its members.             |
| `edges`    | By edge ID. See below.                                                                 |
| `bounds`   | The box round everything drawn.                                                        |
| `quality`  | `full` or `quick`: the router mode that drew the lines.                                |
| `warnings` | Messages about the result, such as a changed size or a line that found no clear way.   |
| `draft`    | The `.draft` file this graph equals. Open it in the viewer, or pass it to `renderSvg`. |

Each edge has:

- `points`: the line from the source's outline to the target's. Draw the arrowhead at the last
  point.
- `path`: SVG path data for the same line with Draftably's rounded corners.
- `label`: the label's box, or `null`. Draw a backing behind the text: other lines can pass under
  a label.
- `sourceSide` and `targetSide`: the sides the line leaves and enters.
- `blocked`: `true` when the router found no clear way and drew a fallback line.

## Route lines only

When your app places the nodes itself, `route` draws only the lines. Nodes stay where your app
put them.

```ts
import { route } from '@draftably/runtime/graph';

const { edges } = route({
  nodes: [
    { id: 'a', x: 0, y: 0, width: 120, height: 60 },
    { id: 'b', x: 400, y: 0, width: 120, height: 60 },
  ],
  groups: [],
  edges: [{ source: 'a', target: 'b', label: 'calls' }],
});
```

Group boxes and node shapes are obstacles, as in a `.draft` drawing. Give a group its `label` so
lines keep out of its title band. `route` runs synchronously.

## Synchronous layout

`layoutSync` is `layout` without a promise. The dagre and Cytoscape drop-ins use it. It cannot
run `engine:` arrangements or `fit`; use `layout` for those.

## Routing quality

The router can repair crossings and even out lanes after it routes each line. That pass costs
time that grows with the number of lines and how often they cross.

| `routing.quality` | Effect                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------- |
| `auto`            | The default. Routes each line once, then repairs the drawing when that will stay fast. |
| `full`            | Always repairs. Use it for a final export, or when time does not matter.               |
| `quick`           | Never repairs. Lines can cross more often on a dense graph.                            |

With `auto`, a tree of 100 nodes, or a graph of 100 nodes and 127 lines, lays out in about 20 ms
on a laptop. A large graph that flows one way gets planned lanes, so `full` adds little time and
crosses no fewer lines there. A tangled graph, whose lines skip across many ranks, routes each line
with a slower search: a random graph of 200 nodes and 260 lines takes about 2 seconds with `auto`.

## Errors and warnings

`layout` and `route` throw on input they cannot draw, with a message that names the object:
`Node "a" refers to unknown id "nope".` or `Duplicate node or group id "a".` A setting outside its
range throws with the range, such as `Expected gap from 8 to 300; got 500.`

Problems that still draw are in `warnings`.

## Run it off the main thread

Layout and routing run on the calling thread. A tangled graph of a few hundred nodes can take seconds. In a
browser, call `layout` from a Web Worker when your page must stay responsive while it runs. The
input and output are plain data, so they cross `postMessage` unchanged.
