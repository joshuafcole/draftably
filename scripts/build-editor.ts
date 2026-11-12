// Builds @draftably/editor: the editor with Solid bundled in, and its CSS scoped to the editor
// element so it never styles the host page.
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { relativeWorkerUrls } from './lib/worker-urls.ts';
import { fileURLToPath } from 'node:url';
import postcss, { type Rule } from 'postcss';
import { build, type Plugin } from 'vite';
import solid from 'vite-plugin-solid';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkg = path.join(root, 'packages/editor');
const out = path.join(pkg, 'dist');
const APP_CSS = path.join(root, 'src/styles/app.css');

/**
 * Every rule applies inside the editor only. `:root` holds the tokens: it becomes `:host` in the
 * element's shadow root, where the host page's values win, and the mounted host
 * (`.draft-editor-root`) elsewhere; `:root[data-theme=x]` follows. `html` and `body` become the
 * editor itself.
 */
/**
 * The elements that hold the tokens of `:root<attr>`. The dark set also applies when the page is
 * dark (the editor sets `data-draft-scheme`) and the element has no `data-theme` of its own, so
 * the editor's controls follow the page as its drawing does.
 */
function hostsFor(attr: string) {
  const own = [`:host${attr ? `(${attr})` : ''}`, `.draft-editor-root${attr}`];
  if (!/data-theme=['"]?dark/.test(attr)) return own;
  return [
    ...own,
    `:host([data-draft-scheme='dark']:not([data-theme]))`,
    `.draft-editor-root[data-draft-scheme='dark']:not([data-theme])`,
  ];
}

function scope(css: string) {
  const ast = postcss.parse(css),
    made = new Set<Rule>();
  ast.walkRules((rule: Rule) => {
    if (made.has(rule)) return;
    if (rule.parent?.type === 'atrule' && /keyframes/.test((rule.parent as { name: string }).name))
      return;
    // `color-scheme` styles the editor's own controls. On the host it would hide the page's
    // scheme, which the drawing follows, so it moves inside: to the editor in a shadow root, and
    // to the mounted host's children, other than the scheme probe, where the host is the editor.
    const scheme = /^:root(\[[^\]]*\])?$/.exec(rule.selector);
    if (scheme)
      rule.walkDecls('color-scheme', decl => {
        const attr = scheme[1] ?? '';
        const inside = postcss.rule({
          selectors: hostsFor(attr).map(host =>
            host.startsWith(':host')
              ? `${host} .draft-editor`
              : `${host} > :not([data-draft-probe])`,
          ),
          nodes: [decl.clone()],
        });
        made.add(inside);
        rule.after(inside);
        decl.remove();
      });
    rule.selectors = rule.selectors.flatMap(sel => {
      const root = /^:root(\[[^\]]*\])?/.exec(sel);
      if (root) {
        const rest = sel.slice(root[0].length),
          attr = root[1] ?? '';
        return hostsFor(attr).map(host => `${host}${rest}`);
      }
      if (/^(html|body)\b/.test(sel)) return [sel.replace(/^(html|body)/, '.draft-editor')];
      return [`.draft-editor ${sel}`];
    });
  });
  return ast.toString();
}

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
        ? ':host{display:flex;flex-direction:column;position:relative;height:28rem}.draft-editor{display:flex;flex-direction:column;position:relative;flex:1;min-height:0}\n'
        : '') + scope(readFileSync(file, 'utf8'));
    const key = path.relative(root, file);
    // Registered, then adopted where the editor renders: the page, or the element's shadow root.
    return `import { registerEditorCss } from ${JSON.stringify(path.join(root, 'src/editor/css.ts'))};
registerEditorCss(${JSON.stringify(key)}, ${JSON.stringify(css)});`;
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
relativeWorkerUrls(out);
cpSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
