# Markdown

`@draftably/markdown` turns `draft` code fences into SVG image references during a Markdown build.
The SVG files are build assets. Readers need no Draftably JavaScript for static diagrams.

````markdown
```draft
node web "Web app"
node api "API"
edge request web -> api "HTTPS"
```
````

It has a remark plugin for Unified, MDX, Astro and Docusaurus, and a markdown-it plugin for
VitePress and others. For a ready setup on a documentation site, follow
[Documentation sites](#documentation-sites).

## Render a Markdown file

```sh
pnpm add @draftably/markdown markdown-it
```

Save this as `render-markdown.mjs` and run `node render-markdown.mjs`:

````js
import { mkdir, writeFile } from 'node:fs/promises';
import MarkdownIt from 'markdown-it';
import { createMarkdownItDraft } from '@draftably/markdown/markdown-it';
import { createFileAssets } from '@draftably/markdown/files';

const assets = createFileAssets({ directory: 'dist/diagrams', publicPath: '/diagrams/' });
const adapter = createMarkdownItDraft({ emitAsset: assets.emitAsset });
const md = new MarkdownIt().use(adapter.plugin);
const source = '```draft\nnode api "API"\n```';
const { html } = await adapter.render(md, source);
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
````

The script writes `dist/index.html` and the SVG to `dist/diagrams/`. The HTML contains an `<img>`
whose URL starts with `/diagrams/`, with alt text, width and height. Serve `dist/` as the site root.
If the site is mounted at `/manual/`, set `publicPath: '/manual/diagrams/'` and publish the files
at `dist/diagrams/`.

For Unified or MDX, keep your existing processor and add the remark plugin with the same asset
store. The site build must publish the store's output directory at the matching public URL:

```ts
import remarkDraft from '@draftably/markdown/remark';

processor.use(remarkDraft, { emitAsset: assets.emitAsset });
```

## Fence options

Options go in one brace group after `draft`, with quoted values:

````markdown
```draft {src="./diagrams/checkout.draft" alt="The web app sends requests to the API." caption="Checkout path"}

```
````

| Key       | Effect                                                                       |
| --------- | ---------------------------------------------------------------------------- |
| `alt`     | Alt text for the image. Without it, the diagram's title is used.             |
| `caption` | Wraps the image in a figure with this plain-text caption.                    |
| `src`     | Draws a `.draft` file instead of the fence body. Needs `sources.rootDir`.    |
| `id`      | A stable name for the image and its anchor.                                  |
| `state`   | Draws a declared [emphasis state](#emphasis-states).                         |
| `mode`    | `static` (the default) or `interactive`. See [below](#interactive-diagrams). |

An unknown or repeated key fails the build. Theme and layout belong in the `.draft` source. A
fence inside another code block stays code, because the plugin reads the parsed document and never
looks inside code.

## Assets and includes

`emitAsset` receives each SVG and returns its public URL. `createFileAssets` from
`@draftably/markdown/files` is a ready store: it names each file by its content hash and writes it
once.

```js
import { createFileAssets } from '@draftably/markdown/files';

const assets = createFileAssets({ directory: '.cache/diagrams', publicPath: '/docs/diagrams/' });
const options = { emitAsset: assets.emitAsset };
// After the build:
await assets.copyTo('dist/diagrams');
```

Keep the store between builds. A page cache can skip a transform, and `copyTo` puts back every SVG
that a cached page still links to.

To use `src`, set `sources.rootDir` to your content root. A path resolves from the Markdown file
that holds the fence and must stay inside the root. Remote paths, absolute paths, other file types
and symlinks that leave the root are refused. Each included file, even a missing one, is reported
through `onDependency`, so your watcher can rebuild the page when it changes or appears.

## Errors

A diagram error fails the build and names the Markdown file and line. To keep building, set
`errors: 'placeholder'`: a broken fence becomes the text "Diagram unavailable." Errors from your
own `emitAsset` or callbacks still fail the build. Read `file.data.draftably` (remark) or the
returned `manifest` (markdown-it) for the assets, dependencies and diagnostics of each page.

## markdown-it details

markdown-it renders fences synchronously, so `adapter.render(md, source, env)` does the async work
first. Pass the page path so `src` includes resolve:

```js
const env = { draftably: { documentPath: pagePath } };
const { html, manifest } = await adapter.render(md, markdown, env);
```

To render tokens yourself, parse, `await adapter.prepare(tokens, env)`, then render those same
tokens. Separate documents can render at the same time.

## Mermaid fences

Set `mermaid: 'convert'` to draw your existing `mermaid` fences too, with no Mermaid in the
browser. Both plugins take it:

```js
const options = { emitAsset: assets.emitAsset, mermaid: 'convert' };
```

A `flowchart`, `graph` or `sequenceDiagram` fence becomes an SVG image like a `draft` fence. Pie,
gantt and other Mermaid charts stay code blocks, so your Mermaid setup still draws them. A fence
that does not convert also stays code, with a `DRAFT_MERMAID` warning. The default, `'off'`,
leaves every `mermaid` fence alone. [Switch from Mermaid](#from-mermaid) has the other routes.

## Interactive diagrams

`mode="interactive"` adds zoom, pan and the keyboard outline over the static image. It publishes
the diagram source in a JSON file, so use it only when the source can be public. Give the plugin
an `interactive` bridge:

```js
interactive: {
  clientModuleUrl: '/assets/draftably-client.js',
  policyId: 'docs',
  emitInit: assets.emitInit,
}
```

`emitInit` writes the JSON and returns its filename and public URL. `clientModuleUrl` is metadata:
the plugin does not add a script tag or bundle that module. Your host must bundle and publish the
client entry, include it on the page, serve the JSON at the returned same-origin URL, and publish
the SVG assets as usual. For example, save this as the entry your bundler publishes at
`/assets/draftably-client.js`:

```ts
import { enhanceDrafts } from '@draftably/markdown/client';
import '@draftably/runtime/viewer.css';
import '@draftably/runtime/fonts.css';

const root = document.querySelector<HTMLElement>('#docs');
if (!root) throw new Error('Missing #docs content root');

const enhancement = enhanceDrafts(root, {
  policies: new Map([['docs', { render: { fonts: 'host', links: { mode: 'none' } } }]]),
});
// In a client-side router, call enhancement.destroy() before removing this content root.
```

Include it with `<script type="module" src="/assets/draftably-client.js"></script>` after the
content root. Set `#docs` to an element that contains the generated figures. Adapt the output URL,
asset copying and bundler setup to your host. The client accepts only same-origin JSON,
mounts the [viewer](#embed-concepts), and hides the image only after the first successful drawing. On a
failure the image stays. `destroy()` stops the work and puts the image back.
With Vite 5–7, see [Configure Vite 5–7](#configure-vite-57) so the viewer's worker loads in
development.

## Complete Unified build

For a complete static Unified build, install the processor plugins and write emitted SVGs beside the
HTML. This example reads a Markdown file, creates the output directory, and publishes image URLs
under `/docs/diagrams/`:

```sh
pnpm add @draftably/markdown unified remark-parse remark-rehype rehype-stringify
```

Save this as `build.mjs`:

```js
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import remarkDraft from '@draftably/markdown/remark';
import { createFileAssets } from '@draftably/markdown/files';

const output = resolve('dist');
const assets = createFileAssets({ directory: '.cache/diagrams', publicPath: '/docs/diagrams/' });
const source = await readFile('content/page.md', 'utf8');
const file = await unified()
  .use(remarkParse)
  .use(remarkDraft, { emitAsset: assets.emitAsset, sources: { rootDir: resolve('content') } })
  .use(remarkRehype)
  .use(rehypeStringify)
  .process({ path: resolve('content/page.md'), value: source });
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'index.html'), String(file));
await assets.copyTo(resolve(output, 'docs/diagrams'));
```

Run `node build.mjs`. The `path` value is the Markdown file path; it lets `src` includes resolve
relative to that file. The asset store writes content-hashed SVG files and restores assets that a
cached page may still reference. Copy its files to the matching public directory after each build.
To enable MDX, use `@mdx-js/mdx` and add the remark plugin to its Unified processor with the same
`emitAsset` callback.
