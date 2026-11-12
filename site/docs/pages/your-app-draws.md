# Your app draws

Use Draftably's layout and routing, and draw every box and line with your own components. The
[Layout API](#layout-api) returns plain data, so this path works in any framework, or none.

## When to draw it yourself

Choose this path when your app already has a drawing of its own and wants Draftably's layout and
routing under it. Choose the [elements](#embed-concepts) when you want editing, the camera and the
keyboard outline: your app then draws nothing. [Choose how to embed](#embed) compares every route.

## Draw the result

`layout` returns a box for each node and a routed line for each edge. This sample draws them as
an SVG string; a framework draws the same data with its own components.

```ts
import { layout } from '@draftably/runtime/graph';

const nodes = [
  { id: 'web', label: 'Web app' },
  { id: 'api', label: 'API gateway' },
  { id: 'db', label: 'Postgres' },
];
const edges: { id: string; source: string; target: string; label?: string }[] = [
  { id: 'calls', source: 'web', target: 'api', label: 'HTTPS' },
  { id: 'reads', source: 'api', target: 'db' },
];
const placed = await layout({ nodes, edges, direction: 'right' });

const pad = 8;
const { x, y, width, height } = placed.bounds;
const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x - pad} ${y - pad} ${width + 2 * pad} ${height + 2 * pad}" font-family="system-ui" font-size="14">`,
  // The line ends at the target's outline, so the arrowhead's tip is the last point.
  '<defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0 0L10 5L0 10z" fill="#334155"/></marker></defs>',
];
for (const node of nodes) {
  const b = placed.nodes[node.id];
  parts.push(
    `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="6" fill="#fff" stroke="#334155"/>`,
    `<text x="${b.x + b.width / 2}" y="${b.y + b.height / 2}" text-anchor="middle" dominant-baseline="central">${node.label}</text>`,
  );
}
for (const edge of edges) {
  const e = placed.edges[edge.id];
  parts.push(`<path d="${e.path}" fill="none" stroke="#334155" marker-end="url(#arrow)"/>`);
  if (!e.label) continue;
  const l = e.label;
  // A backing behind the label: another line can pass under it.
  parts.push(
    `<rect x="${l.x}" y="${l.y}" width="${l.width}" height="${l.height}" fill="#fff"/>`,
    `<text x="${l.x + l.width / 2}" y="${l.y + l.height / 2}" text-anchor="middle" dominant-baseline="central">${edge.label}</text>`,
  );
}
parts.push('</svg>');
const svg = parts.join('');
```

Three rules make the drawing match Draftably's:

- **Sizes.** A node without a size fits its label in Draftably's fonts. When your app draws labels
  in another font, or draws larger components, measure each node and pass its `width` and
  `height`.
- **Arrowheads.** `points` and `path` run from the source's outline to the target's. Draw the
  arrowhead at the last point.
- **Labels.** `label` is the box for the edge's text, or `null`. Draw a backing behind it.

When the user drags a node, keep your positions and call `route` with them. It routes only the
lines, synchronously, so they follow the drag. See [Route lines only](#route-lines-only).

## From a `.draft` source

To place your components on a drawing that a `.draft` file describes, render it with
[`renderSvg`](#render-svg). A successful result has `geometry`: a box for each node and group, and
each edge's points, path and label box, in the SVG's `viewBox` units. The element's `geometry()`
gives the same shapes for a live diagram: see [Find where things are](#find-where-things-are).

```ts
import { renderSvg } from '@draftably/runtime';

const result = await renderSvg(source);
if (result.ok && result.value.geometry) {
  const { nodes, edges } = result.value.geometry;
  // nodes.api: { x, y, width, height, parent? }
}
```

Going the other way, a `layout` result's `draft` field is the `.draft` file the graph equals. Open
it in the viewer when you want Draftably's look for the same graph.
