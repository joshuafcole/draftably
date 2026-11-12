# Documentation sites

Add `draft` fences to Astro Starlight, Docusaurus or VitePress. Each fence becomes an SVG at
build time. Readers load no Draftably JavaScript.

```sh
pnpm add @draftably/markdown
```

| Host                   | Integration                                          |
| ---------------------- | ---------------------------------------------------- |
| Astro 7 with Starlight | Remark plugin in Astro's Unified processor           |
| Docusaurus 3           | Remark plugin in the docs preset                     |
| VitePress 1            | Prebuild script writes Markdown with SVG image links |

Each setup below uses `/manual/` as the site base. Change `base` or `baseUrl` and the matching
`publicPath` for your site. Keep generated assets outside source control.

## Astro and Starlight

In an existing Astro 7/Starlight site, install the Unified processor this setup uses:

```sh
pnpm add -D @astrojs/markdown-remark@7.3.5
```

Astro 7.4 requires Node 22.22.0 or newer. This example pairs Astro 7.4 with
`@astrojs/markdown-remark` 7.3.5.

Put this in `astro.config.mjs`. Set `contentRoot` to the directory that contains your Markdown.
The hooks serve generated images during development and copy them into the build output.

```js
// astro.config.mjs
import { resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import remarkDraft from '@draftably/markdown/remark';
import { createFileAssets } from '@draftably/markdown/files';

const root = fileURLToPath(new URL('.', import.meta.url));
const contentRoot = resolve(root, 'src/content/docs');
const assets = createFileAssets({
  directory: resolve(root, '.cache/draftably/public/_draftably'),
  publicPath: '/manual/_draftably',
});
const options = { emitAsset: assets.emitAsset, sources: { rootDir: contentRoot } };

export default defineConfig({
  base: '/manual/',
  integrations: [
    starlight({ title: 'Docs' }),
    {
      name: 'draftably-assets',
      hooks: {
        'astro:server:setup': ({ server }) =>
          server.middlewares.use((req, res, next) => {
            const path = new URL(req.url, 'http://localhost').pathname;
            const name = path.startsWith('/_draftably/') ? path.slice('/_draftably/'.length) : '';
            if (!/^draft-[0-9a-f]{64}\.svg$/.test(name)) return next();
            res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
            createReadStream(resolve(assets.directory, name)).on('error', next).pipe(res);
          }),
        'astro:build:done': ({ dir }) => assets.copyTo(resolve(fileURLToPath(dir), '_draftably')),
      },
    },
  ],
  markdown: { processor: unified({ remarkPlugins: [[remarkDraft, options]] }) },
});
```

Astro watches Markdown pages, but not files included by a fence. Restart the dev server after an
included `.draft` file changes so Astro reruns the page transform. For include syntax, see
[Markdown](#markdown).

## Docusaurus

Use an async CommonJS config to load Draftably's ES modules. `staticDirectories` serves images in
development; `postBuild` restores the full asset set after the build. This docs-only example puts
docs at `/manual/` and disables the default blog. In an existing site, keep its current docs route
and blog settings.

```js
// docusaurus.config.cjs
const path = require('node:path');
module.exports = async () => {
  const [{ default: remarkDraft }, { createFileAssets }] = await Promise.all([
    import('@draftably/markdown/remark'),
    import('@draftably/markdown/files'),
  ]);
  const root = __dirname;
  const assets = createFileAssets({
    directory: path.resolve(root, '.cache/draftably/public/_draftably'),
    publicPath: '/manual/_draftably',
  });
  const options = { emitAsset: assets.emitAsset, sources: { rootDir: path.resolve(root, 'docs') } };
  return {
    title: 'Docs',
    url: 'https://example.com',
    baseUrl: '/manual/',
    staticDirectories: ['static', '.cache/draftably/public'],
    presets: [
      [
        'classic',
        {
          docs: { routeBasePath: '/', remarkPlugins: [[remarkDraft, options]] },
          blog: false,
        },
      ],
    ],
    plugins: [
      () => ({
        name: 'draftably-assets',
        async postBuild({ outDir }) {
          await assets.copyTo(path.join(outDir, '_draftably'));
        },
      }),
    ],
  };
};
```

Included files do not invalidate Docusaurus' MDX cache. Clear it before builds. After an included
`.draft` changes in development, touch the Markdown page that includes it to rebuild that page.
For example, use `touch docs/index.md`. The package scripts can clear the cache before each build:

```json
{
  "scripts": {
    "start": "docusaurus start --host 127.0.0.1",
    "build": "docusaurus clear && docusaurus build"
  }
}
```

For several locales, set `publicPath` to each locale's base plus `/_draftably`.

## VitePress

VitePress renders Markdown synchronously. Prepare Markdown first, then point `srcDir` at the
generated folder. This example prepares `docs/index.md`; repeat the transform for each source page.
Install the Unified processor packages used by the preparation script:

```sh
pnpm add -D unified remark-parse remark-stringify
```

```js
// scripts/prepare.mjs
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkDraft from '@draftably/markdown/remark';
import { createFileAssets } from '@draftably/markdown/files';

const docs = resolve('docs');
const generated = resolve('generated-docs');
const assets = createFileAssets({
  directory: resolve(generated, 'public/_draftably'),
  publicPath: '/_draftably',
});
const input = resolve(docs, 'index.md');
const result = await unified()
  .use(remarkParse)
  .use(remarkDraft, {
    emitAsset: assets.emitAsset,
    sources: { rootDir: docs },
  })
  .use(remarkStringify)
  .process({ path: input, value: await readFile(input, 'utf8') });
await mkdir(generated, { recursive: true });
await writeFile(resolve(generated, 'index.md'), String(result));
```

```js
// .vitepress/config.mjs
import { defineConfig } from 'vitepress';
export default defineConfig({ base: '/manual/', srcDir: 'generated-docs' });
```

Run preparation before both commands. The generated `public/_draftably` folder is copied into
VitePress output, and the configured base is added to image URLs.

```json
{
  "scripts": {
    "docs:prepare": "node scripts/prepare.mjs",
    "docs:dev": "pnpm docs:prepare && vitepress dev",
    "docs:build": "pnpm docs:prepare && vitepress build"
  }
}
```

Re-run `docs:prepare` when a source page or included `.draft` file changes during development.
Keep `generated-docs/` out of git. See [Markdown](#markdown) for fence options and include paths.

## Other sites

A site with a Unified or markdown-it pipeline can use the plugins directly. For other hosts, commit
SVG images with `draftably inspect --svg`, or generate them with the [GitHub Action](#github-action).
