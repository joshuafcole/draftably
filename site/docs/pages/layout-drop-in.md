# Drop in your graph layout

Keep your graph library and the code that draws it. Change one call, and Draftably places the
boxes and routes every line around them. Each drop-in takes the shape your library already uses
and gives back the shape your code already reads.

| You use now           | Change                                               | Read                         |
| --------------------- | ---------------------------------------------------- | ---------------------------- |
| React Flow            | `layout({ reactFlow })` and the `DraftablyEdge` edge | [React Flow](#react-flow)    |
| Svelte Flow           | `layout({ svelteFlow })` and a `BaseEdge`            | [Svelte Flow](#svelte-flow)  |
| elkjs                 | `new ELK()` → `new DraftablyELK()`                   | [elkjs](#elkjs)              |
| dagre                 | `dagre.layout(g)` → `dagreLayout(g)`                 | [dagre](#dagre)              |
| Cytoscape.js          | `name: 'dagre'` (or another layout) → `'draftably'`  | [Cytoscape.js](#cytoscapejs) |
| Your own drawing code | `layout(graph)`, or `route(graph)` for lines only    | [Layout API](#layout-api)    |

Every drop-in comes from one package, with no runtime dependencies:

```sh
pnpm add @draftably/runtime
```

The graph API is in `@draftably/runtime` 0.3.0 and later. It runs in Node and in a browser.

## What you get

- **Lines that go around boxes.** Each line is routed with right-angle turns that keep clear of
  other boxes and group title bands. dagre and React Flow draw lines that can cut through boxes.
- **A place for each label.** Each edge label gets a box beside its line. Draw a backing behind
  it.
- **Groups.** Nested groups get a box and a title band, and lines keep out of the title band.
- **Lines that follow a drag.** In React Flow and Svelte Flow, `route` draws the lines again
  where the nodes are now.
- **The same speed.** On a laptop, Draftably lays out and routes a tree of 100 nodes, or a graph
  of 100 nodes and 127 lines, in about 20 ms. elkjs takes 25–35 ms and dagre 13–20 ms on the same
  graphs.
- **The same drawing as a `.draft` file.** The result's `draft` is that file. Open it in the
  viewer to see what Draftably drew, or to share it.

## What to know first

- **A tangled graph is slow.** A graph whose lines skip across many ranks gets a slower search
  for each route. On a laptop, a random graph of 200 nodes and 260 lines takes about 2 s, where
  elkjs and dagre take about 60 ms. Call `layout` from a Web Worker for graphs like that.
- **Draftably chooses the line ends.** A line can end on a side that you name. ELK port positions
  and React Flow handle positions are not kept.
- **Label sizes come from Draftably's fonts.** A node without a size fits its label. The sizes you
  give to edge labels are not used.
- **Right or down.** `direction` is `right` or `down`. The ELK and dagre drop-ins also draw
  left and up, as a mirror image.
- **Each call lays out the whole graph.** To keep nodes where a user put them, call `route`, which
  draws only the lines.

## React Flow

React Flow does not place nodes. Most apps call dagre or elkjs in a helper, then draw React
Flow's own edges between handles.

**Before**, with dagre:

```tsx
import dagre from '@dagrejs/dagre';

const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
g.setGraph({ rankdir: 'LR' });
for (const n of nodes)
  g.setNode(n.id, { width: n.measured?.width ?? 0, height: n.measured?.height ?? 0 });
for (const e of edges) g.setEdge(e.source, e.target);
dagre.layout(g);
setNodes(
  nodes.map(n => {
    const { x, y, width, height } = g.node(n.id);
    return { ...n, position: { x: x - width / 2, y: y - height / 2 } };
  }),
);
```

**After**:

```sh
pnpm add @draftably/runtime @draftably/react
```

```tsx
import { layout } from '@draftably/runtime/graph';
import { DraftablyEdge } from '@draftably/react/flow';

const edgeTypes = { draftably: DraftablyEdge };

// After React Flow has measured the nodes (`useNodesInitialized`):
const { reactFlow } = await layout({ reactFlow: { nodes: getNodes(), edges }, direction: 'right' });
setNodes(reactFlow.nodes);
setEdges(reactFlow.edges);

<ReactFlow nodes={nodes} edges={edges} edgeTypes={edgeTypes} />;
```

`layout` returns your nodes and edges with all their fields, in the same shape:

- Each node gets a `position`, relative to its parent in a sub-flow, and a `width` and `height`.
  A node that React Flow measured keeps its measured size.
- A node with `type: 'group'`, or one that another node names in `parentId`, is a group.
- Each edge gets `type: 'draftably'` and `data.draftably`: the routed `path`, `points` and `label`
  box. `DraftablyEdge` draws them, with the edge's `label` on a white backing and React Flow's
  `markerEnd`. An edge that already has a `type`, such as `smoothstep`, keeps it. Remove the
  `type` to draw the routed line.
- Draftably chooses where each line meets its node. Hide the handle dots with
  `.react-flow__handle { opacity: 0 }`, unless users connect nodes by dragging.

To draw the lines again while a user drags a node, call `route` with the nodes where they are now.
`route` places no nodes and runs synchronously:

```tsx
import { applyNodeChanges, type NodeChange } from '@xyflow/react';
import { route } from '@draftably/runtime/graph';

const onNodesChange = (changes: NodeChange[]) => {
  const next = applyNodeChanges(changes, nodes);
  setNodes(next);
  const { reactFlow } = route({ reactFlow: { nodes: next, edges }, routing: { quality: 'quick' } });
  setEdges(reactFlow.edges);
};
```

`route` skips a node until React Flow has measured it, and that node's edges keep their last
routes.

| In your dagre or ELK helper                  | With Draftably                                                    |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `rankdir: 'LR'` or `elk.direction: 'RIGHT'`  | `direction: 'right'`                                              |
| `rankdir: 'TB'` or `elk.direction: 'DOWN'`   | `direction: 'down'`                                               |
| `ranksep` or `elk.spacing.nodeNode`          | `gap`, in pixels from 8 to 300                                    |
| Node `width` and `height` from `measured`    | Read for you                                                      |
| `parentId` and group nodes                   | Read for you                                                      |
| `sourceHandle` and `targetHandle`            | A handle ID of `left`, `right`, `top` or `bottom` fixes that side |
| `animated: true`                             | Drawn dashed                                                      |
| A custom node drawn as a diamond or a circle | `shape: n => (n.type === 'decision' ? 'diamond' : undefined)`     |

Without a `direction`, Draftably picks the one that fits best. A long flow folds into rows, like
lines of text. Pass `fold: 'never'` to keep one row, as dagre does.

The repository's `integration-examples/react-flow` is a complete React Flow app that does all of
this.

## Svelte Flow

Svelte Flow nodes and edges have the same shape as React Flow's. Pass them under `svelteFlow`:

```ts
import { layout } from '@draftably/runtime/graph';

const { svelteFlow } = await layout({ svelteFlow: { nodes, edges }, direction: 'right' });
nodes = svelteFlow.nodes;
edges = svelteFlow.edges;
```

Draw the routed line and label box in a custom edge with `BaseEdge`. Save it as
`DraftablyEdge.svelte`:

```svelte
<script lang="ts">
  import { BaseEdge, type EdgeProps } from '@xyflow/svelte';
  import type { DraftablyEdgeData } from '@draftably/runtime/graph';

  let { data, label, markerEnd }: EdgeProps = $props();
  const route = $derived(data?.draftably as DraftablyEdgeData);
  const box = $derived(route.label);
</script>

<BaseEdge
  path={route.path}
  {markerEnd}
  {label}
  labelX={box ? box.x + box.width / 2 : undefined}
  labelY={box ? box.y + box.height / 2 : undefined}
/>
```

Then register it as the `draftably` edge type:

```svelte
<SvelteFlow bind:nodes bind:edges edgeTypes={{ draftably: DraftablyEdge }} />
```

To use the sizes Svelte Flow measured, call `layout` once `useNodesInitialized()` is true, as in
React Flow. `route({ svelteFlow })` draws the lines again after a drag. The options are the same.

## elkjs

**Before**:

```ts
import ELK from 'elkjs';

const elk = new ELK();
const placed = await elk.layout(graph);
```

**After**:

```ts
import { DraftablyELK } from '@draftably/runtime/graph';

const elk = new DraftablyELK();
const placed = await elk.layout(graph);
elk.warnings; // ELK options that Draftably did not use
```

`graph` is the same ELK JSON, and `placed` comes back as elkjs returns it. Node `x` and `y` are
relative to the parent. Each edge gets its `container`, and its `sections` and labels are
relative to that container. The constructor takes `defaultLayoutOptions`, and `layout` takes
`{ layoutOptions }`, as in elkjs. Options on the graph itself win. You can also call
`layout({ elk: graph })`, which returns `{ elk, result }`.

| ELK option                                                          | With Draftably                                                                                                          |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `elk.algorithm`                                                     | `layered` is Draftably's flow. `force` and `stress`, `mrtree`, and `rectpacking` use its stress, tree and grid engines. |
| `elk.direction`                                                     | All four directions.                                                                                                    |
| `elk.layered.spacing.nodeNodeBetweenLayers`, `elk.spacing.nodeNode` | The gap between boxes, from 8 to 300. The first one wins.                                                               |
| `elk.port.side`                                                     | The side where the line ends. The port's position is not kept.                                                          |
| `elk.edgeRouting`, `elk.hierarchyHandling`, `elk.portConstraints`   | Accepted. Lines are always routed with right angles, across groups.                                                     |
| Any other option                                                    | Not used, and listed in `elk.warnings`.                                                                                 |

A node with `children` is a group. A hyperedge becomes one line for each source and target.
The first label of a node or an edge is its text. Options set on a child node are not read.

## dagre

Keep the graphlib graph you build. Replace one call.

**Before**:

```ts
import dagre from '@dagrejs/dagre';

const g = new dagre.graphlib.Graph({ compound: true });
g.setGraph({ rankdir: 'LR', ranksep: 60 });
g.setDefaultEdgeLabel(() => ({}));
g.setNode('web', { label: 'Web app', width: 120, height: 40 });
g.setNode('api', { label: 'API', width: 120, height: 40 });
g.setNode('services', { label: 'Services' });
g.setNode('orders', { label: 'Orders', width: 120, height: 40 });
g.setParent('orders', 'services');
g.setEdge('web', 'api', { label: 'HTTPS' });
g.setEdge('api', 'orders');

dagre.layout(g);
```

**After**: the same graph, then:

```ts
import { dagreLayout } from '@draftably/runtime/graph';

dagreLayout(g); // where you called dagre.layout(g)
```

`dagreLayout` writes the results into the graph as dagre does: `x` and `y` (the centre), `width`
and `height` on each node and cluster, `points` on each edge, a label's `x` and `y`, and `width`
and `height` on the graph. It runs synchronously, and it also returns the full result.

dagre's points are for a curve. Draftably's points are corners of a line with right angles, so
draw them with straight segments, such as d3's `curveLinear`. Or draw the result's `path`, which
has rounded corners:

```ts
const result = dagreLayout(g);
result.edges['web->api'].path; // SVG path data. A named edge is 'v->w:name'.
```

| dagre setting                                                 | With Draftably                               |
| ------------------------------------------------------------- | -------------------------------------------- |
| `rankdir`                                                     | `TB`, `BT`, `LR` and `RL`.                   |
| `ranksep`                                                     | The gap between boxes, from 8 to 300.        |
| Node `width`, `height`, `label`                               | Read.                                        |
| `setParent` clusters                                          | Groups with a title band.                    |
| `label` on an edge                                            | Read. Its `width` and `height` are not used. |
| `nodesep`, `edgesep`, `marginx`, `marginy`, `align`, `ranker` | Not used, with no warning.                   |
| `minlen`, `weight`, `labelpos` on an edge                     | Not used.                                    |

`dagreLayout` reads only the graphlib methods it needs, so a graph from `@dagrejs/graphlib` or
from `dagre.graphlib` works. Pass `dagreLayout(g, { routing: { quality: 'full' } })` to choose the
[routing quality](#routing-quality).

## Cytoscape.js

Register the layout once, then run it by name.

**Before**, with the `cytoscape-dagre` extension:

```ts
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';

cytoscape.use(dagre);
const options = { name: 'dagre', rankDir: 'LR' };
cy.layout(options).run();
```

**After**:

```ts
import cytoscape from 'cytoscape';
import { draftablyLayout } from '@draftably/runtime/graph';

cytoscape.use(draftablyLayout);
const options = { name: 'draftably', direction: 'right' };
const run = cy.layout(options).run();
```

The layout places the nodes. A compound parent is a group, and a node's `label` data is its text.
Each node keeps the size its style gives it. Cytoscape still draws the edges itself, so its edges
do not follow Draftably's routes. An app that draws its own edges reads the routed lines from
`run.result.edges`, by edge ID.

Cytoscape's TypeScript types do not know this layout's options or its `result`. Keep the
options in a variable, as above, and read the result with a cast:

```ts
import type { LayoutResult } from '@draftably/runtime/graph';

const { edges } = (run as unknown as { result: LayoutResult }).result;
```

| Option                                           | Meaning                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `direction`                                      | `right` or `down`. Without one, Draftably picks.                 |
| `gap`                                            | The gap between boxes, from 8 to 300.                            |
| `routing`                                        | As in the [Layout API](#routing-quality).                        |
| `fit`, `padding`, `animate`, `animationDuration` | Cytoscape's own layout options. They behave as in other layouts. |

## When none of these fit

Your app can give Draftably plain nodes, groups and edges, and draw the result its own way.
The [Layout API](#layout-api) describes `layout`, `route`, every option, the result, and the
errors.
