import { chmodSync, cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = path.join(root, 'packages/cli');
rmSync(path.join(pkg, 'dist'), { recursive: true, force: true });
cpSync(path.join(root, 'dist'), path.join(pkg, 'dist'), { recursive: true });
await build({
  root,
  configFile: false,
  // The package has no runtime dependencies, so pdf-lib is bundled into the CLI.
  ssr: { noExternal: ['pdf-lib', '@ts-graphviz/ast', '@ts-graphviz/common'] },
  build: {
    ssr: 'src/cli/main.ts',
    target: 'node22',
    outDir: path.join(pkg, 'dist/cli'),
    rollupOptions: {
      output: { inlineDynamicImports: true, banner: '#!/usr/bin/env node' },
    },
  },
});
chmodSync(path.join(pkg, 'dist/cli/main.js'), 0o755);
cpSync(path.join(root, 'examples'), path.join(pkg, 'examples'), { recursive: true });
cpSync(path.join(root, 'docs/DSL.md'), path.join(pkg, 'DSL.md'));
cpSync(path.join(root, 'LICENSE'), path.join(pkg, 'LICENSE'));
rmSync(path.join(pkg, 'skills'), { recursive: true, force: true });
cpSync(path.join(root, 'skills'), path.join(pkg, 'skills'), { recursive: true });
writeFileSync(
  path.join(pkg, 'THIRD_PARTY_NOTICES'),
  'Meld prototype\n\n' +
    readFileSync(path.join(root, 'reference/meld/original/LICENSE'), 'utf8') +
    '\n\nSolidJS\n\n' +
    readFileSync(path.join(root, 'node_modules/solid-js/LICENSE'), 'utf8') +
    '\n\npdf-lib\n\n' +
    readFileSync(path.join(root, 'node_modules/pdf-lib/LICENSE.md'), 'utf8') +
    '\n\n@ts-graphviz/ast and @ts-graphviz/common\n\n' +
    readFileSync(path.join(root, 'node_modules/@ts-graphviz/ast/LICENSE'), 'utf8') +
    '\n\nMermaid\n\n' +
    readFileSync(path.join(root, 'node_modules/mermaid/LICENSE'), 'utf8') +
    '\n\njsdom\n\n' +
    readFileSync(path.join(root, 'node_modules/jsdom/LICENSE.txt'), 'utf8') +
    '\n\nresvg-js\n\n' +
    readFileSync(path.join(root, 'node_modules/@resvg/resvg-js/LICENSE'), 'utf8') +
    '\n\nPDFKit\n\n' +
    readFileSync(path.join(root, 'node_modules/pdfkit/LICENSE'), 'utf8') +
    '\n\nsvg-to-pdfkit\n\n' +
    readFileSync(path.join(root, 'node_modules/svg-to-pdfkit/LICENSE'), 'utf8') +
    '\n\nD2\n\n' +
    readFileSync(path.join(root, 'node_modules/@d2lang/d2/LICENSE.txt'), 'utf8') +
    '\n\nD2 third-party notices\n\n' +
    readFileSync(path.join(root, 'node_modules/@d2lang/d2/THIRD_PARTY_NOTICES.txt'), 'utf8') +
    // Diagram fonts, embedded in the viewer and in exported SVG files.
    ['Inter', 'SourceSerif4', 'JetBrainsMono']
      .map(
        name =>
          `\n\n${name} font\n\n` +
          readFileSync(path.join(root, `src/assets/fonts/LICENSE-${name}.txt`), 'utf8'),
      )
      .join(''),
);
