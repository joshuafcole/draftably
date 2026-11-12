/**
 * Installs the packed runtime and React packages into `integration-examples/react-flow`, builds
 * it, and proves it in a browser: React Flow measures the nodes, `layout({ reactFlow })` places
 * them and routes every line with no blocked line, `DraftablyEdge` draws each route, and dragging
 * a node routes the lines again, all without console errors. Screenshots go to tmp/react-flow/.
 * Run `pnpm runtime:build && pnpm editor:build && pnpm frameworks:build` first.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'tmp/react-flow');
const app = path.join(out, 'app');
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, 'packs'), { recursive: true });
const pack = (dir: string) =>
  JSON.parse(
    execFileSync('pnpm', ['pack', '--json', '--pack-destination', path.join(out, 'packs')], {
      cwd: path.join(root, 'packages', dir),
      encoding: 'utf8',
    }),
  ).filename as string;
const packs = { runtime: pack('runtime'), editor: pack('editor'), react: pack('react') };
cpSync(path.join(root, 'integration-examples/react-flow'), app, { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8'));
manifest.dependencies['@draftably/runtime'] = `file:${packs.runtime}`;
manifest.dependencies['@draftably/react'] = `file:${packs.react}`;
manifest.dependencies['@draftably/editor'] = `file:${packs.editor}`;
writeFileSync(path.join(app, 'package.json'), JSON.stringify(manifest, null, 2));
writeFileSync(
  path.join(app, 'pnpm-workspace.yaml'),
  `packages: []\noverrides:\n  '@draftably/runtime': 'file:${packs.runtime}'\n  '@draftably/editor': 'file:${packs.editor}'\nallowBuilds:\n  esbuild: true\n`,
);
const run = (...args: string[]) =>
  execFileSync('pnpm', args, { cwd: app, stdio: 'pipe', encoding: 'utf8' });
run('install');
run('exec', 'tsc', '-p', 'tsconfig.json');
run('exec', 'vite', 'build');

const dist = path.join(app, 'dist'),
  types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  let file = path.join(dist, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname));
  if (!existsSync(file) || file.endsWith('/')) file = path.join(dist, 'index.html');
  res.setHeader('content-type', types[path.extname(file)] ?? 'text/html');
  res.end(readFileSync(file));
});
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address() as { port: number };

const browser = await chromium.launch(),
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } }),
  errors: string[] = [];
page.on('console', m => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.draftably, null, { timeout: 30000 });
  await page.waitForTimeout(400);
  const first = await page.evaluate(() => window.draftably!);
  assert.equal(first.blocked, 0, 'no blocked lines');
  const paths = () =>
    page.$$eval('.draftably-edge path.react-flow__edge-path', ps =>
      ps.map(p => p.getAttribute('d') ?? ''),
    );
  const before = await paths();
  assert.equal(before.length, 8, 'every edge draws');
  assert.ok(before.every(d => d.startsWith('M')));
  assert.equal(await page.locator('.draftably-edge-label').count(), 5, 'every label draws');
  await page.screenshot({ path: path.join(out, 'layout.png') });

  // Drag Postgres down into open space; the lines into it route again while it moves.
  const db = page.locator('.react-flow__node[data-id="db"]'),
    box = (await db.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++)
    await page.mouse.move(box.x + box.width / 2 - i * 4, box.y + box.height / 2 + i * 22);
  await page.mouse.up();
  await page.waitForTimeout(200);
  const after = await paths(),
    moved = await page.evaluate(() => window.draftably!);
  assert.ok(moved.routes >= 5, `routed while dragging (${moved.routes} times)`);
  assert.notDeepEqual(after, before, 'lines follow the node');
  await page.screenshot({ path: path.join(out, 'dragged.png') });
  assert.deepEqual(errors, []);
  console.log(
    `PASS React Flow: laid out in ${first.ms} ms (${first.quality}), 8 lines and 5 labels drawn, ` +
      `${moved.routes} routes while dragging, no console errors. Screenshots in tmp/react-flow/.`,
  );
} finally {
  await browser.close();
  server.close();
}
