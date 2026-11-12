/**
 * Compiles the app on each framework page (`site/docs/pages/react.md`, `solid.md`, `vue.md`,
 * `svelte.md`, `plain-html.md`) from the packed packages, so a recipe that stops compiling fails CI.
 *
 *   pnpm runtime:build && pnpm editor:build && pnpm frameworks:build
 *   pnpm prove:recipes [react solid vue svelte plain]
 *
 * Every fenced block in the page's "Build the app" section whose first line names a file
 * (`// src/App.tsx`, `<!-- src/App.vue -->`, `/* src/theme.css *\/`) is written into a fresh Vite
 * app. The script then installs the packed packages
 * that the section's `pnpm add` line names, and only those,
 * type-checks (tsc, vue-tsc or svelte-check), builds, calls the recipe's server `render()`, and
 * loads the built page in Chromium: the diagram and the editor must reach `status="ready"`, the
 * body must be assigned, and the console must stay clean. Last, it starts `vite` in development
 * and deletes a node in the editor: the dev server serves the packages through its dependency
 * optimizer, so a worker URL that only a build resolves fails here. Screenshots go to `tmp/recipes/`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'tmp/recipes');

interface Recipe {
  /** The docs page, `site/docs/pages/<page>.md`. */
  page: string;
  deps: Record<string, string>;
  dev: Record<string, string>;
  check: string[];
  /** Mount element id for the generated index.html, and its entry. */
  mount?: { id: string; entry: string };
  tsconfig: Record<string, unknown>;
  server: string;
}

const vite = { vite: '6.4.5', typescript: '5.9.3' };
const RECIPES: Record<string, Recipe> = {
  react: {
    page: 'react',
    deps: { react: '19.2.0', 'react-dom': '19.2.0' },
    dev: {
      ...vite,
      '@vitejs/plugin-react': '4.7.0',
      '@types/react': '^19.2.0',
      '@types/react-dom': '^19.2.0',
    },
    check: ['tsc', '--noEmit'],
    mount: { id: 'root', entry: '/src/main.tsx' },
    tsconfig: { jsx: 'react-jsx' },
    server: '/src/server.tsx',
  },
  solid: {
    page: 'solid',
    deps: { 'solid-js': '1.9.9' },
    dev: { ...vite, 'vite-plugin-solid': '2.11.15' },
    check: ['tsc', '--noEmit'],
    mount: { id: 'root', entry: '/src/main.tsx' },
    tsconfig: { jsx: 'preserve', jsxImportSource: 'solid-js' },
    server: '/src/server.tsx',
  },
  vue: {
    page: 'vue',
    deps: { vue: '3.5.22' },
    dev: { ...vite, '@vitejs/plugin-vue': '5.2.4', 'vue-tsc': '3.3.14' },
    check: ['vue-tsc', '--noEmit'],
    mount: { id: 'app', entry: '/src/main.ts' },
    tsconfig: {},
    server: '/src/server.ts',
  },
  svelte: {
    page: 'svelte',
    deps: { svelte: '5.57.3' },
    dev: { ...vite, '@sveltejs/vite-plugin-svelte': '5.1.1', 'svelte-check': '4.7.8' },
    check: ['svelte-check', '--fail-on-warnings'],
    mount: { id: 'app', entry: '/src/main.ts' },
    tsconfig: {},
    server: '/src/server.ts',
  },
  plain: {
    page: 'plain-html',
    deps: {},
    dev: vite,
    check: ['tsc', '--noEmit'],
    tsconfig: {},
    server: '/src/server.ts',
  },
};

/** The page's "Build the app" section: the app, and nothing from its other sections. */
function sectionText(page: string): string {
  const docs = readFileSync(path.join(root, 'site/docs/pages', `${page}.md`), 'utf8');
  const start = docs.indexOf('\n## Build the app\n');
  if (start < 0) throw new Error(`${page}.md has no "## Build the app" section`);
  const end = docs.indexOf('\n## ', start + 1);
  return docs.slice(start, end < 0 ? undefined : end);
}

/** The Draftably packages the section's `pnpm add` line installs, and nothing else. */
function installs(page: string): string[] {
  const line = sectionText(page).match(/```sh\npnpm add ([^\n]+)\n```/)?.[1];
  if (!line) throw new Error(`${page}.md has no pnpm add line`);
  return line.split(/\s+/).filter(name => name.startsWith('@draftably/'));
}

/** The files a section names in its fenced blocks. */
function files(page: string): Map<string, string> {
  const text = sectionText(page);
  const found = new Map<string, string>();
  for (const [, body] of text.matchAll(/```[\w-]*\n([\s\S]*?)```/g)) {
    const name = body.match(/^(?:\/\/ |\/\* |<!-- )([\w./-]+)(?: \*\/| -->)?\n/)?.[1];
    if (name) found.set(name, body);
  }
  if (!found.size) throw new Error(`${page}.md names no files`);
  return found;
}

const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css' };
function serve(dir: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let file = path.join(dir, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
    if (!existsSync(file) || file.endsWith('/')) file = path.join(dir, 'index.html');
    res.setHeader('content-type', types[path.extname(file)] ?? 'text/html');
    res.end(readFileSync(file));
  });
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() });
    }),
  );
}

/** Starts `vite` in `app`, loads the page and deletes `db` in the editor. */
async function dev(app: string): Promise<void> {
  const proc = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '0'], {
    cwd: app,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  try {
    const url = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`vite did not start:\n${log}`)), 30000);
      const read = (chunk: Buffer) => {
        log += chunk.toString();
        // eslint-disable-next-line no-control-regex
        const found = log.replace(/\x1b\[[0-9;]*m/g, '').match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (found) {
          clearTimeout(timer);
          resolve(found[0]);
        }
      };
      proc.stdout.on('data', read);
      proc.stderr.on('data', read);
      proc.on('exit', code => reject(new Error(`vite exited with ${code}:\n${log}`)));
    });
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors: string[] = [];
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', e => errors.push(e.message));
    page.on('response', r => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
    await page.goto(url);
    await page.waitForFunction(
      () =>
        document.querySelector('draft-diagram')?.getAttribute('status') === 'ready' &&
        document.querySelector('draft-editor')?.getAttribute('status') === 'ready',
      undefined,
      { timeout: 30000 },
    );
    const node = page.locator('draft-editor [data-kind="node"][data-id="db"]');
    await node.scrollIntoViewIfNeeded();
    await node.click();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    const source = await page.evaluate(() =>
      (
        document.querySelector('draft-editor') as HTMLElement & { editor: { source(): string } }
      ).editor.source(),
    );
    await page.close();
    if (/node db /.test(source)) throw new Error('Delete in the editor did not remove db');
    if (errors.length) throw new Error(`errors: ${errors.join(' | ')}`);
  } catch (error) {
    throw new Error(`${(error as Error).message}\nvite log:\n${log.slice(-1500)}`, {
      cause: error,
    });
  } finally {
    proc.kill();
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'packs'), { recursive: true });
const pack = (dir: string) =>
  path.join(
    out,
    'packs',
    JSON.parse(
      execFileSync('pnpm', ['pack', '--json', '--pack-destination', path.join(out, 'packs')], {
        cwd: path.join(root, 'packages', dir),
        encoding: 'utf8',
      }),
    )
      .filename.split('/')
      .pop(),
  );
const runtime = pack('runtime');
const editor = pack('editor');

const only = process.argv.slice(2);
const browser = await chromium.launch();
const failures: string[] = [];
for (const name of only.length ? only : Object.keys(RECIPES)) {
  const recipe = RECIPES[name];
  const app = path.join(out, name);
  const step = { now: 'write' };
  try {
    mkdirSync(app, { recursive: true });
    for (const [file, body] of files(recipe.page)) {
      mkdirSync(path.dirname(path.join(app, file)), { recursive: true });
      writeFileSync(path.join(app, file), body);
    }
    // Only what the recipe's install line names: pnpm does not let an app import a package it
    // does not list, so a missing package fails here as it would for a reader.
    const deps: Record<string, string> = { ...recipe.deps };
    for (const name of installs(recipe.page)) {
      const dir = name.slice('@draftably/'.length);
      deps[name] = `file:${dir === 'runtime' ? runtime : dir === 'editor' ? editor : pack(dir)}`;
    }
    writeFileSync(
      path.join(app, 'package.json'),
      JSON.stringify(
        {
          name: `recipe-${name}`,
          private: true,
          type: 'module',
          dependencies: deps,
          devDependencies: recipe.dev,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(app, 'pnpm-workspace.yaml'),
      `packages: []\noverrides:\n  '@draftably/runtime': 'file:${runtime}'\n  '@draftably/editor': 'file:${editor}'\nallowBuilds:\n  esbuild: true\n`,
    );
    writeFileSync(
      path.join(app, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            isolatedModules: true,
            types: ['vite/client'],
            ...recipe.tsconfig,
          },
          include: ['src', 'vite.config.ts'],
        },
        null,
        2,
      ),
    );
    if (recipe.mount && !existsSync(path.join(app, 'index.html')))
      writeFileSync(
        path.join(app, 'index.html'),
        `<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><title>${name}</title></head>\n<body><div id="${recipe.mount.id}"></div><script type="module" src="${recipe.mount.entry}"></script></body></html>\n`,
      );
    const run = (...args: string[]) =>
      execFileSync('pnpm', args, { cwd: app, stdio: 'pipe', encoding: 'utf8' });
    step.now = 'install';
    run('install');
    step.now = 'type check';
    run('exec', ...recipe.check);
    step.now = 'build';
    run('exec', 'vite', 'build');
    step.now = 'server render';
    writeFileSync(
      path.join(app, 'ssr.mjs'),
      `process.env.NODE_ENV = 'production';
import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
const html = await (await vite.ssrLoadModule(${JSON.stringify(recipe.server)})).render();
await vite.close();
process.stdout.write(html);`,
    );
    const html = execFileSync('node', ['ssr.mjs'], { cwd: app, encoding: 'utf8' });
    if (!/<draft-diagram[\s\S]*<svg/.test(html)) throw new Error('server HTML has no diagram SVG');

    step.now = 'browser';
    const server = await serve(path.join(app, 'dist'));
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors: string[] = [];
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(
      () =>
        document.querySelector('draft-diagram')?.getAttribute('status') === 'ready' &&
        document.querySelector('draft-editor')?.getAttribute('status') === 'ready',
      undefined,
      { timeout: 20000 },
    );
    const state = await page.evaluate(() => {
      const el = document.querySelector('draft-diagram')!;
      const slot = el.shadowRoot!.querySelector(
        '[data-draft-anchor="body:api"] slot',
      ) as HTMLSlotElement;
      return {
        body: slot?.assignedElements().length === 1,
        dark: getComputedStyle(document.querySelector('.app')!).backgroundColor,
        editorTheme: document.querySelector('draft-editor')!.getAttribute('data-theme'),
      };
    });
    await page.locator('.card input').fill('ok');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    await page.close();
    server.close();
    if (!state.body) throw new Error('the body on api is not assigned');
    if (state.dark !== 'rgb(2, 6, 23)' || state.editorTheme !== 'dark')
      throw new Error(`the dark theme is not applied: ${JSON.stringify(state)}`);
    if (errors.length) throw new Error(`console errors: ${errors.join(' | ')}`);

    step.now = 'dev server';
    await dev(app);
    console.log(
      `PASS ${name}: type check, build, server render, diagram and editor ready, body, dark theme, dev server edit`,
    );
  } catch (error) {
    const e = error as Error & { stdout?: string; stderr?: string };
    failures.push(name);
    console.log(
      `FAIL ${name} (${step.now}): ${e.message.split('\n')[0]}\n${`${e.stdout ?? ''}${e.stderr ?? ''}`.slice(-3000)}`,
    );
  }
}
await browser.close();
if (failures.length) process.exit(1);
