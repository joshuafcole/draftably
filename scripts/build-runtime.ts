import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { relativeWorkerUrls } from './lib/worker-urls.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'packages/runtime/dist');
await build({
  root,
  configFile: false,
  base: './',
  worker: { format: 'es', rollupOptions: { output: { inlineDynamicImports: true } } },
  plugins: [
    {
      name: 'native-runtime-boundary',
      generateBundle() {
        for (const id of this.getModuleIds())
          if (/\/node_modules\/|\/src\/(?:cli|server|state|components)\//.test(id))
            throw Error(`Non-native runtime dependency: ${path.relative(root, id)}`);
      },
    },
  ],
  build: {
    target: 'es2022',
    outDir: out,
    lib: {
      entry: {
        index: path.join(root, 'src/runtime/index.ts'),
        viewer: path.join(root, 'src/runtime/viewer.ts'),
        element: path.join(root, 'src/runtime/element.ts'),
        host: path.join(root, 'src/runtime/host.ts'),
        graph: path.join(root, 'src/graph-api/index.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      output: { chunkFileNames: '[name]-[hash].js', assetFileNames: '[name]-[hash][extname]' },
    },
  },
});
relativeWorkerUrls(out);
execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.runtime.json'], {
  cwd: root,
  stdio: 'inherit',
});
// TypeScript does not copy input declarations used by the native engine modules.
const engineTypes = path.join(out, 'types/src/engines');
mkdirSync(engineTypes, { recursive: true });
for (const file of readdirSync(path.join(root, 'src/engines')))
  if (file.endsWith('.d.ts'))
    cpSync(path.join(root, 'src/engines', file), path.join(engineTypes, file));
const { FACES } = await import('../src/model/font-faces.ts');
const { fontMetricsVersion } = await import('../src/model/font-faces.ts');
const identity = createHash('sha256').update(
  readFileSync(path.join(root, 'src/model/font-metrics.json')),
);
for (const face of Object.values(FACES))
  identity.update(readFileSync(path.join(root, 'src/assets/fonts', face.file)));
if (identity.digest('hex').slice(0, 12) !== fontMetricsVersion)
  throw Error('Update fontMetricsVersion after changing font bytes or metrics.');
// Emitted declarations must also work with NodeNext, which requires file extensions.
for (const file of readdirSync(path.join(out, 'types'), { recursive: true }) as string[]) {
  if (!file.endsWith('.d.ts')) continue;
  const full = path.join(out, 'types', file);
  const text = readFileSync(full, 'utf8');
  writeFileSync(
    full,
    text.replace(/(from\s+|import\()(['"])(\.[^'"]+)\2/g, (match, lead, quote, name) =>
      /\.(?:js|json|ts)$/.test(name) ? match : `${lead}${quote}${name}.js${quote}`,
    ),
  );
}
mkdirSync(path.join(out, 'fonts'), { recursive: true });
const css = Object.values(FACES)
  .map(face => {
    cpSync(path.join(root, 'src/assets/fonts', face.file), path.join(out, 'fonts', face.file));
    return `@font-face{font-family:'${face.family}';font-weight:${face.weight};font-style:normal;font-display:block;src:url('./fonts/${face.file}') format('woff2')}`;
  })
  .join('\n');
writeFileSync(path.join(out, 'fonts.css'), css);
cpSync(path.join(root, 'src/runtime/viewer.css'), path.join(out, 'viewer.css'));
cpSync(path.join(root, 'src/runtime/host.css'), path.join(out, 'host.css'));
cpSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
writeFileSync(
  path.join(out, 'THIRD_PARTY_NOTICES'),
  ['Inter', 'SourceSerif4', 'JetBrainsMono']
    .map(
      name =>
        `${name}\n${readFileSync(path.join(root, `src/assets/fonts/LICENSE-${name}.txt`), 'utf8')}`,
    )
    .join('\n\n'),
);
