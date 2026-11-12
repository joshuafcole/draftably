/**
 * Installs the packed runtime and framework packages into the React, Solid, Vue and Svelte
 * examples, then proves each one end to end: a production build, a server render that already
 * holds every diagram as SVG, and a browser page where three diagrams draw, one updates and one
 * is removed, and two editors where a drag in one changes only its own source, all without
 * console errors. Run `pnpm runtime:build && pnpm editor:build && pnpm frameworks:build` first.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { proveHost, report, type HostProof } from './lib/host-proof.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'tmp/frameworks');
const only = process.argv.slice(2);
const FRAMEWORKS = (only.length ? only : ['react', 'solid', 'vue', 'svelte']) as string[];
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'packs'), { recursive: true });

const pack = (dir: string) =>
  JSON.parse(
    execFileSync('pnpm', ['pack', '--json', '--pack-destination', path.join(out, 'packs')], {
      cwd: path.join(root, 'packages', dir),
      encoding: 'utf8',
    }),
  ).filename as string;
const runtime = pack('runtime');
const editor = pack('editor');
cpSync(path.join(root, 'integration-examples/frameworks'), path.join(out, 'apps'), {
  recursive: true,
});

const types: Record<string, string> = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};
/** The strict CSP the proof page is served with: nonces, no unsafe-inline, fonts from data:. */
const NONCE = 'proof-nonce';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'nonce-${NONCE}'`,
  `style-src 'self' 'nonce-${NONCE}'`,
  "font-src 'self' data:",
  "img-src 'self' data:",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');
function serve(dir: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let file = path.join(dir, decodeURIComponent(url.pathname));
    if (!existsSync(file) || file.endsWith('/')) file = path.join(dir, 'index.html');
    if (file.endsWith('proof.html')) res.setHeader('content-security-policy', CSP);
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

/** Page helpers for the slot checks: events at the document, and boxes from the public API. */
const helpers = () => {
  const w = window as unknown as Record<string, unknown>;
  const log = { diagnostics: [] as string[], activate: [] as string[], select: [] as string[] };
  w.__slotLog = log;
  document.addEventListener('draft-diagnostics', e =>
    log.diagnostics.push(
      ...(e as CustomEvent).detail.diagnostics.map(
        (d: { code: string; itemIds: string[] }) => `${d.code}:${d.itemIds.join()}`,
      ),
    ),
  );
  document.addEventListener('draft-itemactivate', e =>
    log.activate.push((e as CustomEvent).detail.id),
  );
  document.addEventListener('draft-select', e =>
    log.select.push((e as CustomEvent).detail.ids.join()),
  );
  type Box = { x: number; y: number; w: number; h: number };
  const rect = (e: Element | null | undefined): Box | null => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  };
  w.__rect = rect;
  /** An item's box on screen, from the handle's camera and geometry only. */
  w.__itemBox = (el: HTMLElement & { viewer?: never; editor?: never }, id: string) => {
    const h = (el.viewer ?? el.editor) as unknown as {
      geometry(): {
        nodes: Record<string, { x: number; y: number; width: number; height: number }>;
      };
      getCamera(): { centerX: number; centerY: number; zoom: number };
    };
    const b = h.geometry().nodes[id],
      c = h.getCamera(),
      p = rect(el.shadowRoot!.querySelector('.draft-viewer__viewport, .stage'))!;
    if (!b) return null;
    return {
      x: p.x + p.w / 2 + (b.x - c.centerX) * c.zoom,
      y: p.y + p.h / 2 + (b.y - c.centerY) * c.zoom,
      w: b.width * c.zoom,
      h: b.height * c.zoom,
    };
  };
};
type Box = { x: number; y: number; w: number; h: number } | null;
const near = (a: Box, b: Box, t = 1.5) =>
  !!a &&
  !!b &&
  Math.abs(a.x - b.x) <= t &&
  Math.abs(a.y - b.y) <= t &&
  Math.abs(a.w - b.w) <= t &&
  Math.abs(a.h - b.h) <= t;
type W = Record<string, never> & {
  __rect(e: Element | null | undefined): Box;
  __itemBox(el: Element, id: string): Box;
  __slotLog: { diagnostics: string[]; activate: string[]; select: string[] };
  __slotUpdate(): void;
  __clicks?: number;
  __kept?: Element | null;
};

const browser = await chromium.launch();
const failures: string[] = [];
const hostProofs: HostProof[] = [];
for (const fw of FRAMEWORKS) {
  const app = path.join(out, 'apps', fw);
  const tarball = pack(fw);
  const manifest = JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8'));
  manifest.dependencies[`@draftably/${fw}`] = `file:${tarball}`;
  manifest.dependencies['@draftably/runtime'] = `file:${runtime}`;
  manifest.dependencies['@draftably/editor'] = `file:${editor}`;
  writeFileSync(path.join(app, 'package.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    path.join(app, 'pnpm-workspace.yaml'),
    `packages: []\noverrides:\n  '@draftably/runtime': 'file:${runtime}'\n  '@draftably/editor': 'file:${editor}'\nallowBuilds:\n  esbuild: true\n`,
  );
  const errors: string[] = [];
  const run = (...args: string[]) =>
    execFileSync('pnpm', args, { cwd: app, stdio: 'pipe', encoding: 'utf8' });
  try {
    run('install');
    run('exec', 'vite', 'build');

    // Server render: every diagram is already in the HTML as SVG, before any JavaScript runs.
    const entry = existsSync(path.join(app, 'src/entry-server.tsx'))
      ? '/src/entry-server.tsx'
      : '/src/entry-server.ts';
    writeFileSync(
      path.join(app, 'ssr-check.mjs'),
      `import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
const html = await (await vite.ssrLoadModule(${JSON.stringify(entry)})).render();
await vite.close();
process.stdout.write(html);`,
    );
    const html = execFileSync('node', ['ssr-check.mjs'], { cwd: app, encoding: 'utf8' });
    // The host proof page: server HTML with its hydration props, filled into the built template.
    writeFileSync(
      path.join(app, 'proof-ssr.mjs'),
      `// Production mode, as the client build is: Svelte's dev server HTML has extra markers.
process.env.NODE_ENV = 'production';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true } });
const { html, props, head } = await (await vite.ssrLoadModule(${JSON.stringify(entry.replace('entry-server', 'proof-server'))})).render(${JSON.stringify(NONCE)});
await vite.close();
const json = JSON.stringify(props).replace(/</g, '\\\\u003c');
const page = readFileSync('dist/proof.html', 'utf8')
  .replace('<!--ssr-->', () => html)
  .replace('<!--head-->', () => head)
  .replace('<!--props-->', () => '<script type="application/json" id="proof-props">' + json + '</script>');
writeFileSync('dist/proof.html', page);`,
    );
    execFileSync('node', ['proof-ssr.mjs'], { cwd: app, encoding: 'utf8' });
    assert.equal(html.match(/<draft-diagram/g)?.length, 3, `${fw}: SSR draws three elements`);
    assert.equal(html.match(/<svg/g)?.length, 3, `${fw}: SSR holds three static SVGs`);
    assert.match(html, /Gamma user/, `${fw}: SSR SVG holds the diagram's text`);
    assert.equal(html.match(/<draft-editor/g)?.length, 2, `${fw}: SSR keeps two editor elements`);

    // Browser: three viewers draw, the first updates, the last unmounts.
    const server = await serve(path.join(app, 'dist'));
    const page = await browser.newPage();
    await page.addInitScript(helpers);
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(server.url);
    const drawn = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('draft-diagram')].map(
          el =>
            el.shadowRoot?.querySelector('.draft-diagram__viewer:not([hidden]) svg')?.textContent ??
            '',
        ),
      );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('draft-diagram')].filter(el =>
          el.shadowRoot?.querySelector('.draft-diagram__viewer:not([hidden]) svg'),
        ).length === 3,
      undefined,
      { timeout: 20000 },
    );
    await viewerSlots(page, fw);
    const before = await drawn();
    const outlines = await page.evaluate(() =>
      [...document.querySelectorAll('draft-diagram')].map(
        el => el.shadowRoot?.querySelector('.draft-viewer__outline')?.clientHeight ?? 0,
      ),
    );
    assert.ok(outlines[0] > 20, `${fw}: outline="visible" shows the first outline`);
    assert.ok(outlines[1] <= 1, `${fw}: the default outline is visually hidden`);
    assert.ok(before[1].includes('Beta worker'), `${fw}: second diagram shows its own source`);
    // The host contract: status, the element from the wrapper, live options, event props.
    const contract = () =>
      page.evaluate(() => {
        const els = [...document.querySelectorAll('draft-diagram')];
        const w = window as { __first?: Element; __events?: Record<string, number> };
        return {
          status: els.map(el => el.getAttribute('status')),
          first: w.__first === els[0],
          toolbar: (els[1].shadowRoot!.querySelector('.draft-viewer__toolbar') as HTMLElement)
            .hidden,
          camera: w.__events?.camera ?? 0,
        };
      });
    // Camera events come on the next animation frame; editors report ready after their first draw.
    await page
      .waitForFunction(
        () => ((window as { __events?: Record<string, number> }).__events?.camera ?? 0) >= 3,
        undefined,
        { timeout: 5000 },
      )
      .catch(() => {});
    const parity = await contract();
    assert.deepEqual(parity.status, ['ready', 'ready', 'ready'], `${fw}: status="ready"`);
    assert.ok(parity.first, `${fw}: the wrapper gives the element (ref, expose or bind)`);
    assert.ok(parity.toolbar, `${fw}: options reach the element`);
    assert.ok(parity.camera >= 3, `${fw}: the camera event prop fires`);
    await page.evaluate(() => {
      (window as { __second?: unknown }).__second =
        document.querySelectorAll('draft-diagram')[1].viewer;
    });
    await page.click('#update');
    await page.waitForFunction(
      () =>
        document
          .querySelector('draft-diagram')
          ?.shadowRoot?.querySelector('svg')
          ?.textContent?.includes('Updated API'),
      undefined,
      { timeout: 10000 },
    );
    const after = await drawn();
    assert.equal(after[1], before[1], `${fw}: updating the first diagram leaves the second alone`);
    assert.ok(
      await page.evaluate(
        () =>
          document.querySelectorAll('draft-diagram')[1].viewer ===
          (window as { __second?: unknown }).__second,
      ),
      `${fw}: a new options object with the same values does not re-mount`,
    );
    await page.click('#remove');
    await page.waitForFunction(() => document.querySelectorAll('draft-diagram').length === 2);
    const updates = await page.evaluate(() => (window as { __updates?: string[] }).__updates ?? []);
    assert.ok(
      updates.filter(s => s === 'committed').length >= 4,
      `${fw}: onUpdate reports commits`,
    );
    // Editors: a drag in the first one changes its source only.
    const box = page.locator('draft-editor').nth(0).locator('[data-kind="node"][data-id="web"]');
    await box.waitFor({ timeout: 20000 });
    await page
      .locator('draft-editor')
      .nth(1)
      .locator('[data-kind="node"][data-id="queue"]')
      .waitFor();
    await box.scrollIntoViewIfNeeded();
    // The editor fits its view after the first draw; drag once the box stops moving.
    let b = (await box.boundingBox())!;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(150);
      const next = (await box.boundingBox())!;
      if (next.x === b.x && next.y === b.y && next.width === b.width) break;
      b = next;
    }
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(
      () => ((window as { __changes?: string[][] }).__changes?.[0].length ?? 0) > 0,
      undefined,
      { timeout: 10000 },
    );
    const changes = await page.evaluate(() => (window as { __changes?: string[][] }).__changes!);
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('draft-editor')].every(
            el => el.getAttribute('status') === 'ready',
          ),
        undefined,
        { timeout: 10000 },
      )
      .catch(() => {});
    const editorState = await page.evaluate(() => ({
      status: [...document.querySelectorAll('draft-editor')].map(el => el.getAttribute('status')),
      interact: (window as { __events?: Record<string, number> }).__events?.interact ?? 0,
    }));
    assert.deepEqual(editorState.status, ['ready', 'ready'], `${fw}: editor status="ready"`);
    assert.ok(editorState.interact > 0, `${fw}: an editor callback option runs`);
    assert.equal(changes[1].length, 0, `${fw}: the second editor reports no change`);
    assert.match(
      changes[0].at(-1)!,
      /node web "Alpha web"/,
      `${fw}: the first editor's source stays its own`,
    );
    const sources = await page.evaluate(() =>
      [...document.querySelectorAll('draft-editor')].map(el => el.source),
    );
    assert.notEqual(sources[0], sources[1], `${fw}: each editor holds its own source`);
    assert.equal(sources[0], changes[0].at(-1), `${fw}: the editor holds the source it reported`);
    await editorSlots(page, fw);
    await page.screenshot({ path: path.join(out, `${fw}.png`), fullPage: true });
    // The page sets no color-scheme, so a dark system setting leaves every diagram light. One CSS
    // line opts the page in, and then the same setting draws every diagram dark.
    const canvases = () =>
      page.evaluate(() => [
        ...[...document.querySelectorAll('draft-diagram')].map(
          el =>
            getComputedStyle(el.shadowRoot!.querySelector('.draft-viewer__viewport > svg > rect')!)
              .fill,
        ),
        ...[...document.querySelectorAll('draft-editor')].map(
          el => getComputedStyle(el.shadowRoot!.querySelector('.stage')!).backgroundColor,
        ),
      ]);
    const frames = () =>
      page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.emulateMedia({ colorScheme: 'dark' });
    await frames();
    const unset = await canvases();
    assert.ok(
      unset.every(c => c === 'rgb(247, 247, 244)'),
      `${fw}: with no color-scheme, a dark system setting leaves every diagram light ${JSON.stringify(unset)}`,
    );
    await page.addStyleTag({ content: ':root { color-scheme: light dark }' });
    await page
      .waitForFunction(
        () =>
          [
            ...[...document.querySelectorAll('draft-diagram')].map(
              el =>
                getComputedStyle(
                  el.shadowRoot!.querySelector('.draft-viewer__viewport > svg > rect')!,
                ).fill,
            ),
            ...[...document.querySelectorAll('draft-editor')].map(
              el => getComputedStyle(el.shadowRoot!.querySelector('.stage')!).backgroundColor,
            ),
          ].every(c => c === 'rgb(22, 25, 30)'),
        null,
        { timeout: 5000 },
      )
      .catch(() => {});
    const dark = await canvases();
    assert.ok(
      dark.every(c => c === 'rgb(22, 25, 30)'),
      `${fw}: color-scheme: light dark on a dark system draws every diagram dark ${JSON.stringify(dark)}`,
    );
    await page.screenshot({ path: path.join(out, `${fw}-dark.png`), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
    assert.deepEqual(errors, [], `${fw}: no console errors`);
    await page.close();
    const proof = await proveHost(browser, `${server.url}proof.html`, `vite-${fw}`, out);
    hostProofs.push(proof);
    server.close();
    assert.deepEqual(proof.failed, [], `${fw}: the host proof passes`);
    console.log(
      `PASS ${fw}: build, SSR (3 SVGs, 2 editors), 3 live diagrams, status, element access, options without re-mount, camera event prop, update, remove, onUpdate, editor drag and options, slots in the viewer and the editor, dark only on an opted-in page`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const detail = (error as { stdout?: string; stderr?: string }).stderr ?? '';
    failures.push(fw);
    console.log(
      `FAIL ${fw}: ${message}\n${detail.slice(-2000)}\npage errors: ${errors.join('\n')}`,
    );
  }
}
await browser.close();
report(hostProofs);
if (failures.length) process.exit(1);

/**
 * The spike's round-2 checks on the real viewer, through the wrapper: marked children pass
 * through and land in their targets, a body fills its node and scales with the camera, an overlay
 * stays at screen size, host CSS applies, content follows a framework update with the same
 * target, orphan content draws nothing, the pointer passes through body text, a marked button
 * takes its click, a caret survives an update, and `overflow: clip` never scrolls on focus.
 */
async function viewerSlots(page: import('playwright-core').Page, fw: string) {
  const first = 'draft-diagram';
  const ev = <T, A>(fn: (arg: A) => T, arg: A) => page.evaluate(fn as never, arg) as Promise<T>;
  const marks = await ev(
    sel =>
      [...document.querySelector(sel)!.children]
        .map(c => c.getAttribute('data-draft-slot'))
        .filter(Boolean)
        .sort(),
    first,
  );
  assert.deepEqual(
    marks,
    ['body:api', 'body:nope', 'body:web', 'overlay:api'],
    `${fw}: marked children pass through the wrapper`,
  );
  const assigned = await ev(
    sel =>
      [
        ...document
          .querySelector(sel)!
          .shadowRoot!.querySelectorAll<HTMLElement>('[data-draft-anchor]'),
      ]
        .map(t => `${t.dataset.draftAnchor}=${t.querySelector('slot')?.assignedElements().length}`)
        .sort(),
    first,
  );
  assert.deepEqual(
    assigned,
    ['body:api=1', 'body:web=1', 'overlay:api=1'],
    `${fw}: each target gets its child`,
  );
  assert.ok(
    (await ev(() => (window as unknown as W).__slotLog.diagnostics, 0)).includes(
      'DRAFT_SLOT_UNKNOWN:nope',
    ),
    `${fw}: an unknown slot is a DRAFT_SLOT_UNKNOWN warning`,
  );
  // The first diagram fits small (16rem with its outline shown): frame api at full size, above
  // the zoom where bodies give way to titles.
  await ev(sel => {
    const v = (
      document.querySelector(sel) as HTMLElement & {
        viewer: {
          geometry(): {
            nodes: Record<string, { x: number; y: number; width: number; height: number }>;
          };
          setCamera(c: object): void;
        };
      }
    ).viewer;
    const b = v.geometry().nodes.api;
    v.setCamera({ centerX: b.x + b.width / 2, centerY: b.y + b.height / 2, zoom: 1 });
  }, first);
  await page.evaluate(
    () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const boxes = () =>
    ev(sel => {
      const w = window as unknown as W,
        el = document.querySelector(sel)!;
      return {
        card: w.__rect(el.querySelector('.card[data-card="api"]')),
        api: w.__itemBox(el, 'api'),
        over: w.__rect(el.shadowRoot!.querySelector('[data-draft-anchor="overlay:api"]')),
        badge: w.__rect(el.querySelector('.badge')),
        ghost: w.__rect(el.querySelector('[data-draft-slot="body:nope"]')),
      };
    }, first);
  const g = await boxes();
  assert.ok(near(g.card, g.api), `${fw}: a body fills its node ${JSON.stringify(g)}`);
  assert.ok(near(g.over, g.api), `${fw}: an overlay covers its node`);
  assert.equal(g.ghost?.w, 0, `${fw}: content for an unknown slot draws nothing`);
  const start = await ev(sel => {
    const v = (
      document.querySelector(sel) as HTMLElement & {
        viewer: { getCamera(): object; setCamera(c: object): void };
      }
    ).viewer;
    const c = v.getCamera() as { zoom: number };
    v.setCamera({ ...c, zoom: c.zoom * 2 });
    return c;
  }, first);
  await page.evaluate(
    () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const z = await boxes();
  assert.ok(
    near(z.card, z.api) && Math.abs(z.card!.w - g.card!.w * 2) < 2,
    `${fw}: a body scales with the camera`,
  );
  assert.ok(
    near(z.over, z.api) && Math.abs(z.badge!.h - g.badge!.h) < 0.5,
    `${fw}: an overlay follows at screen scale`,
  );
  const restore = () =>
    ev(
      ([sel, c]) =>
        (
          document.querySelector(sel as string) as HTMLElement & {
            viewer: { setCamera(c: unknown): void };
          }
        ).viewer.setCamera(c),
      [first, start] as const,
    );
  await restore();
  await page.evaluate(
    () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  assert.equal(
    await ev(
      sel => getComputedStyle(document.querySelector(`${sel} .card`)!).backgroundColor,
      first,
    ),
    'rgb(10, 120, 200)',
    `${fw}: host CSS styles slot content`,
  );

  // Pointer: body text passes to the drawing; a marked button takes its click.
  const label = page.locator(`${first} .card[data-card="api"] span`);
  const lb = (await label.boundingBox())!;
  await page.mouse.click(lb.x + 3, lb.y + lb.height / 2);
  await page.waitForTimeout(100);
  const activated = await ev(() => (window as unknown as W).__slotLog.activate.slice(), 0);
  assert.equal(activated.at(-1), 'api', `${fw}: a click on body text activates the node`);
  await page.locator(`${first} .card[data-card="api"] button`).click();
  await page.waitForTimeout(100);
  assert.equal(
    await ev(() => (window as unknown as W).__clicks, 0),
    1,
    `${fw}: a data-draft-input button takes its click`,
  );
  assert.equal(
    await ev(() => (window as unknown as W).__slotLog.activate.length, 0),
    activated.length,
    `${fw}: the marked button's click does not reach the drawing`,
  );

  // A caret survives an update through the framework; content follows the new drawing.
  await ev(sel => {
    (window as unknown as W).__kept = document
      .querySelector(sel)!
      .shadowRoot!.querySelector('[data-draft-anchor="body:api"]');
  }, first);
  await page.locator(`${first} .field`).click();
  await page.keyboard.type('ab');
  await ev(() => (window as unknown as W).__slotUpdate(), 0);
  await page.waitForFunction(
    sel =>
      !!(
        document.querySelector(sel) as HTMLElement & {
          viewer: { geometry(): { nodes: Record<string, unknown> } | null };
        }
      ).viewer.geometry()?.nodes.cache,
    first,
    { timeout: 10000 },
  );
  await page.evaluate(
    () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const caret = await ev(
    () => ({
      cls: document.activeElement?.className,
      pos: (document.activeElement as HTMLInputElement | null)?.selectionStart,
    }),
    0,
  );
  await page.keyboard.type('c');
  assert.deepEqual(caret, { cls: 'field', pos: 2 }, `${fw}: a caret survives a source update`);
  assert.equal(
    await page.locator(`${first} .field`).inputValue(),
    'abc',
    `${fw}: typing continues after the update`,
  );
  const u = await ev(sel => {
    const w = window as unknown as W,
      el = document.querySelector(sel)!;
    return {
      api: [w.__rect(el.querySelector('.card[data-card="api"]')), w.__itemBox(el, 'api')],
      cache: [w.__rect(el.querySelector('.card[data-card="cache"]')), w.__itemBox(el, 'cache')],
      web: !!el.querySelector('.card[data-card="web"]'),
      label: el.querySelector('.card[data-card="api"] span')?.textContent,
      same: el.shadowRoot!.querySelector('[data-draft-anchor="body:api"]') === w.__kept,
    };
  }, first);
  assert.ok(
    near(u.api[0], u.api[1]) && near(u.cache[0], u.cache[1]),
    `${fw}: content follows the update ${JSON.stringify(u)}`,
  );
  assert.ok(
    !u.web && u.label === 'API card 2',
    `${fw}: removed and relabeled content follows the framework`,
  );
  assert.ok(u.same, `${fw}: a target keeps its identity across an update`);

  // overflow: clip: focus on content far off screen never scrolls the element.
  const scrolled = await ev(async sel => {
    const el = document.querySelector(sel) as HTMLElement & {
      viewer: { setCamera(c: unknown): void };
    };
    (document.activeElement as HTMLElement | null)?.blur();
    el.viewer.setCamera({ centerX: 4000, centerY: 4000, zoom: 1 });
    await new Promise(r => requestAnimationFrame(r));
    el.querySelector<HTMLInputElement>('.field')!.focus();
    await new Promise(r => requestAnimationFrame(r));
    const all = [el, ...el.shadowRoot!.querySelectorAll('*')];
    (document.activeElement as HTMLElement | null)?.blur();
    return all.filter(e => e.scrollLeft || e.scrollTop).length;
  }, first);
  assert.equal(scrolled, 0, `${fw}: overflow: clip never scrolls on focus`);
  await restore();
}

/** The editor through the wrapper: its body lands in place, body text selects, a marked input is no shortcut. */
async function editorSlots(page: import('playwright-core').Page, fw: string) {
  const editor = page.locator('draft-editor').nth(0);
  await editor.scrollIntoViewIfNeeded();
  const ev = <T, A>(fn: (arg: A) => T, arg: A) => page.evaluate(fn as never, arg) as Promise<T>;
  const g = await ev(() => {
    const w = window as unknown as W,
      el = document.querySelector('draft-editor')!;
    return {
      assigned: [...el.shadowRoot!.querySelectorAll<HTMLElement>('[data-draft-anchor]')].map(
        t => `${t.dataset.draftAnchor}=${t.querySelector('slot')?.assignedElements().length}`,
      ),
      card: w.__rect(el.querySelector('.card')),
      api: w.__itemBox(el, 'api'),
    };
  }, 0);
  assert.deepEqual(g.assigned, ['body:api=1'], `${fw}: the editor assigns its marked child`);
  assert.ok(near(g.card, g.api), `${fw}: an editor body fills its node ${JSON.stringify(g)}`);
  const label = (await editor.locator('.card span').boundingBox())!;
  await page.mouse.click(label.x + 3, label.y + label.height / 2);
  await page.waitForTimeout(150);
  assert.equal(
    (await ev(() => (window as unknown as W).__slotLog.select, 0)).at(-1),
    'api',
    `${fw}: a click on editor body text selects the node`,
  );
  const changes = await ev(
    () => (window as unknown as { __changes: string[][] }).__changes[0].length,
    0,
  );
  await editor.locator('.field').click();
  await page.keyboard.type('n');
  await page.waitForTimeout(300);
  assert.equal(
    await editor.locator('.field').inputValue(),
    'n',
    `${fw}: the marked input takes the key`,
  );
  assert.equal(
    await ev(() => (window as unknown as { __changes: string[][] }).__changes[0].length, 0),
    changes,
    `${fw}: typing n in a marked input adds no node`,
  );
  // A press on the editor's drawing takes focus from the viewer's slot field: Backspace deletes
  // the node, and the field keeps its text.
  const field = page.locator('draft-diagram').nth(0).locator('.field');
  await field.click();
  await page.keyboard.type('z');
  const typed = await field.inputValue();
  await editor.scrollIntoViewIfNeeded();
  const web = (await ev(
    () => (window as unknown as W).__itemBox(document.querySelector('draft-editor')!, 'web'),
    0,
  ))!;
  await page.mouse.click(web.x + web.w / 2, web.y + web.h / 2);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);
  assert.equal(
    await field.inputValue(),
    typed,
    `${fw}: Backspace after a press on the editor's drawing leaves the viewer's field alone`,
  );
  assert.ok(
    !(await ev(
      () => (document.querySelector('draft-editor') as { source?: string }).source,
      0,
    ))!.includes('node web'),
    `${fw}: Backspace deletes the node pressed in the editor`,
  );
}
