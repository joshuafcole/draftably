# @draftably/runtime

Render `.draft` diagrams to SVG in Node or a browser, or show them in an interactive
`<draft-diagram>` element. No runtime dependencies, DOM shim or install scripts. Needs Node 22.21
or later.

```sh
pnpm add @draftably/runtime
```

```ts
import { renderSvg } from '@draftably/runtime';

const result = await renderSvg('node api "API"');
if (result.ok) console.log(result.value.svg);
```

```ts
import { layout } from '@draftably/runtime/graph';

// Positions, routed lines and label boxes for a graph your app draws.
const placed = await layout({
  nodes: [{ id: 'a' }, { id: 'b' }],
  edges: [{ source: 'a', target: 'b' }],
});
```

```ts
import '@draftably/runtime/element';
import '@draftably/runtime/host.css'; // once per page: heights and slot rules before the element loads
// <draft-diagram source='node api "API"' label="API diagram"></draft-diagram>
```

## Docs

- [Render SVG](https://draftably.dev/docs/render-svg): options, validation, inline output, links
  and limits
- [Layout API](https://draftably.dev/docs/layout-api): lay out and route a graph your app draws
- [Drop in your graph layout](https://draftably.dev/docs/layout-drop-in): replace the layout in
  React Flow, Svelte Flow, elkjs, dagre or Cytoscape.js with one changed call
- [How embedding works](https://draftably.dev/docs/embed-concepts) and the [API reference](https://draftably.dev/docs/api-reference): the element, `mountViewer`, fallback
  images and SSR
- [Embed diagrams](https://draftably.dev/docs/embed): every route, including framework components
