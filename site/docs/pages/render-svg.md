# Render SVG

`renderSvg` from `@draftably/runtime` turns `.draft` text into an SVG string in Node or a browser. Use it in a
script, a build step or a server route. It uses the same compiler and renderer as the CLI.

```sh
pnpm add @draftably/runtime
```

The package has no runtime dependencies, DOM shim or install scripts. It needs Node 22.21 or later
and is ES modules only. Use `.mjs`, or set `"type": "module"` in your `package.json`.

## Render with renderSvg

Save this as `render.mjs` and run `node render.mjs`:

```ts
import { writeFile } from 'node:fs/promises';
import { renderSvg } from '@draftably/runtime';

const result = await renderSvg('node api "API"');
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
await writeFile('api.svg', result.value.svg);
console.log(`Wrote api.svg (${result.value.width} × ${result.value.height})`);
```

The SVG embeds the fonts it uses. Serve it as an ordinary image. Links and source metadata are off
until you turn them on.

The result also holds a summary: the title, size, viewBox, item IDs, labels, lines, edge endpoints
and emphasis states. `geometry` gives where each node, group and edge is drawn, in the SVG's
`viewBox` units, in the [graph API's shapes](#layout-api); it is `null` for `compare` and `states`
drawings, which repeat items. The result does not expose the compiled scene.

| Option          | Effect                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`         | Draws a declared [emphasis state](#emphasis-states).                                                                                                                    |
| `sourceId`      | Names the source in diagnostics, such as `architecture.draft`.                                                                                                          |
| `signal`        | Asks to cancel. Compilation runs on the calling thread, so it can finish first.                                                                                         |
| `title`         | Accessible title text in the SVG.                                                                                                                                       |
| `description`   | Accessible description text in the SVG.                                                                                                                                 |
| `styleNonce`    | A nonce for the generated style element, for your CSP.                                                                                                                  |
| `links`         | The link policy. See [Links](#links-and-source).                                                                                                                        |
| `target`        | `'inline'` for SVG pasted into an HTML page. See [Inline output](#inline-output).                                                                                       |
| `idPrefix`      | Required with `target: 'inline'`: a prefix that keeps IDs unique on the page.                                                                                           |
| `fonts`         | `'embed'` (default) or, inline only, `'host'` to use fonts the page loads.                                                                                              |
| `includeSource` | Embeds the `.draft` source in the SVG's metadata.                                                                                                                       |
| `limits`        | Lower caps on source size, objects, edges, depth and output bytes.                                                                                                      |
| `colorScheme`   | `'light'` (default) or `'dark'`: the colors of a source in the default theme. `'auto'` writes both as `light-dark()` colors, for a page whose `color-scheme` picks one. |

## Validate

```ts
import { validate } from '@draftably/runtime';

const result = await validate('node web "Web"\n', { sourceId: 'architecture.draft' });
```

Validation runs the full compiler, including the layout engines, and returns structured
diagnostics without SVG. Each diagnostic has a stable `DRAFT_*` category, a message, the source
line, the optional source ID and the item IDs.

## Inline output

An image file can repeat IDs. SVG pasted into a page cannot, so give each inline diagram its own
prefix:

```ts
const result = await renderSvg(source, {
  target: 'inline',
  idPrefix: 'checkout-one',
  description: 'The web app calls the API and saves an order.',
});
```

A prefix matches `[A-Za-z][A-Za-z0-9_-]{0,63}`. Every SVG ID, reference and link style uses it.
This is the form for [server rendering](#server-rendering) in a framework.

Image output always embeds its fonts. Inline output can use `fonts: 'host'` with the package's
`@draftably/runtime/fonts.css`. Font family names include a hash of the font files, so they never
collide with an older copy.

## Links and source

Links default to `{ mode: 'none' }`. To allow HTTP(S) destinations, set
`links: { mode: 'safe', baseUrl: 'https://example.com/docs/' }`. Relative destinations need that
base. A `link-base` written in the file cannot change this policy. A host
`resolve({ itemId, href })` callback can return a replacement or `null`; the HTTP(S) check always
applies to the result. A callback that throws rejects the render.

Safe links open in `_self`. `target: '_blank'` adds `noopener noreferrer`. A denied link loses its
anchor and mark, and its destination does not show in tooltips.

`includeSource: true` adds `.draft` source metadata, so `draftably open` can edit the SVG later.
It can expose comments and paths written in the source, so it is off by default.

## Limits and errors

Pass positive integer limits to reduce work and output size. They cannot go above the built-in
ceilings:

| Limit                | Ceiling   |
| -------------------- | --------- |
| Source characters    | 300,000   |
| Source bytes (UTF-8) | 1,000,000 |
| Nodes and groups     | 500       |
| Edges                | 1,200     |
| Containment depth    | 12        |
| SVG output bytes     | 8,000,000 |

The SVG writer checks output bytes as it writes. The limits do not cap all compiler memory.
Validation takes compile limits only. An invalid limit throws `RangeError`, and source that is not
a string throws `TypeError`.

Syntax, compile, limit and cancel failures return structured results, not exceptions. Characters
that are not valid XML return `DRAFT_TEXT_INVALID`. An unexpected failure returns `DRAFT_INTERNAL`
without a stack trace.

For an interactive diagram on a page, use the [element](#embed-concepts) from the same
package.
