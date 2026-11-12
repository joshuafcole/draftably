# `@draftably/react`

Draftably diagrams in React. `DraftDiagram` wraps the `<draft-diagram>` element from
`@draftably/runtime`, so every framework gets the same viewer: zoom, pan, keyboard outline, and
cleanup when it unmounts. Any number of diagrams can share a page.

```sh
pnpm add @draftably/react @draftably/runtime
```

Import `@draftably/runtime/host.css` once in your client entry: it reserves each element's height
and hides slot content until the element loads, and it lets marked content take the pointer. With
Vite 5–7, add `optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] }` to
`vite.config`.

[React and Next.js](https://draftably.dev/docs/react) has a complete, type-checked app: both components,
an event, your content on a node, a dark page and server rendering with the `svg` prop. CI
compiles it from the packed packages. The same page has the Next.js server and strict-CSP code.

## React Flow

`@draftably/react/flow` exports `DraftablyEdge`, a React Flow custom edge that draws the lines
and labels that `layout({ reactFlow })` from `@draftably/runtime/graph` routed. It does not need
React Flow as a dependency. See [Drop in your graph layout](https://draftably.dev/docs/layout-drop-in#react-flow).

```tsx
import { DraftablyEdge } from '@draftably/react/flow';

<ReactFlow nodes={nodes} edges={edges} edgeTypes={{ draftably: DraftablyEdge }} />;
```
