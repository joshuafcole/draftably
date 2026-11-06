// Builds @draftably/editor: the editor with Solid bundled in, and its CSS scoped to the editor
// element so it never styles the host page.
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';
import { scopeEditorCss as scope } from './lib/scope-css.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = path.join(root, 'packages/editor');
const out = path.join(pkg, 'dist');
const APP_CSS = path.join(root, 'src/styles/app.css');

/** Every stylesheet the editor imports is scoped and injected once, instead of styling the page. */
const scopedCss: Plugin = {
  name: 'draft-editor-css',
  enforce: 'pre',
  resolveId(id, importer) {
    if (!importer || !id.endsWith('.css') || importer.startsWith('\0')) return;
    const file = path.resolve(path.dirname(importer), id);
    if (file.startsWith(path.join(root, 'src')))
      return `\0draft-css:${file.slice(0, -'.css'.length)}`;
  },
  load(id) {
    if (!id.startsWith('\0draft-css:')) return;
    const file = `${id.slice('\0draft-css:'.length)}.css`;
    const css =
      (file === APP_CSS
        ? 'draft-editor{height:28rem}draft-editor,.draft-editor{display:flex;flex-direction:column;position:relative}\n'
        : '') + scope(readFileSync(file, 'utf8'));
    const key = path.relative(root, file);
    return `const css = ${JSON.stringify(css)};
if (typeof document !== 'undefined' && !document.querySelector('style[data-draft-css="${key}"]')) {
  const style = document.createElement('style');
  style.dataset.draftCss = ${JSON.stringify(key)};
  style.textContent = css;
  document.head.append(style);
}`;
  },
};

/** The editor is the canvas only: importers, file handling and the app's panel state stay out. */
const SHELL =
  /\/src\/(?:import\/|state\/(?:files|ui|commands|keyboard|launch|comparison|open-link)\.)|\/node_modules\/.*\/(?:mermaid|@d2lang)\//;
const boundary: Plugin = {
  name: 'draft-editor-boundary',
  generateBundle() {
    const bad: string[] = [];
    for (const id of this.getModuleIds()) {
      if (!SHELL.test(id)) continue;
      // Name the import chain from the entry, so the fix is easy to find.
      const chain = [id];
      for (let at = id, seen = new Set([id]); ;) {
        const next = this.getModuleInfo(at)?.importers.find(i => !seen.has(i));
        if (!next) break;
        chain.push(next);
        seen.add((at = next));
      }
      bad.push(chain.map(i => path.relative(root, i)).join(' <- '));
    }
    if (bad.length) throw Error(`App-shell modules in @draftably/editor:\n${bad.join('\n')}`);
  },
};

rmSync(out, { recursive: true, force: true });
execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.editor.json'], {
  cwd: root,
  stdio: 'inherit',
});
await build({
  root,
  configFile: false,
  base: './',
  publicDir: false,
  plugins: [scopedCss, solid(), boundary],
  worker: {
    format: 'es',
    plugins: () => [solid()],
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  build: {
    target: 'es2022',
    outDir: out,
    emptyOutDir: false,
    lib: {
      entry: {
        index: path.join(root, 'src/editor/mount.tsx'),
        element: path.join(root, 'src/editor/element.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js' } },
  },
});
cpSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
