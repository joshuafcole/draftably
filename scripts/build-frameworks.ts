// Builds the React, Solid and Vue wrappers with tsc. Svelte ships its component source.
// @draftably/solid also ships ./host, built from src/host.ts with Solid as a peer.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';

const root = fileURLToPath(new URL('../', import.meta.url));
for (const name of ['react', 'solid', 'vue']) {
  const pkg = path.join(root, 'packages', name);
  rmSync(path.join(pkg, 'dist'), { recursive: true, force: true });
  execFileSync('pnpm', ['exec', 'tsc', '-p', path.join(pkg, 'tsconfig.json')], {
    cwd: root,
    stdio: 'inherit',
  });
}

/** The host entry is the compiler and the scene: no editor state, importers or other packages. */
const boundary: Plugin = {
  name: 'draft-host-boundary',
  generateBundle() {
    for (const id of this.getModuleIds())
      if (/\/node_modules\/|\/src\/(?:state|import|editor|server|workers)\//.test(id))
        throw Error(`Not part of @draftably/solid/host: ${path.relative(root, id)}`);
  },
};
const host = path.join(root, 'packages/solid/dist/host');
await build({
  root,
  configFile: false,
  publicDir: false,
  plugins: [solid(), boundary],
  build: {
    target: 'es2022',
    outDir: host,
    emptyOutDir: true,
    lib: {
      entry: { host: path.join(root, 'src/host.ts') },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: [/^solid-js(?:\/|$)/],
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.host.json'], { cwd: root, stdio: 'inherit' });
// TypeScript does not copy input declarations used by the native engine modules.
const engineTypes = path.join(host, 'types/src/engines');
mkdirSync(engineTypes, { recursive: true });
for (const file of readdirSync(path.join(root, 'src/engines')))
  if (file.endsWith('.d.ts'))
    cpSync(path.join(root, 'src/engines', file), path.join(engineTypes, file));
