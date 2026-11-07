# `@draftably/solid`

Draftably diagrams in Solid. `DraftDiagram` wraps the `<draft-diagram>` element from
`@draftably/runtime`, so every framework gets the same viewer: zoom, pan, keyboard outline, and
cleanup when it unmounts. Any number of diagrams can share a page.

```sh
pnpm add @draftably/solid
```

See [Frameworks](https://draftably.dev/docs/frameworks) for the component, server
rendering with the `svg` prop, and a complete example.

## In your own tree: `@draftably/solid/host`

`DraftDiagram` brings its own viewer. An app that lays diagrams out and draws them inside its own
Solid components imports the pieces instead. They run on the app's Solid, a peer dependency.

```tsx
import '@draftably/runtime/fonts.css';
import { compile, draw, StaticScene } from '@draftably/solid/host';

const drawing = draw(await compile(source));
const b = drawing.bounds;

<svg viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}>
  <StaticScene scene={drawing} idPrefix="d1-" />
</svg>;
```

Names marked `@experimental` in its types may change in a minor release.
