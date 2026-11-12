import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'tmp/runtime-proof');
mkdirSync(out, { recursive: true });
const packed = JSON.parse(
  execFileSync(
    'pnpm',
    ['--dir', path.join(root, 'packages/runtime'), 'pack', '--json', '--pack-destination', out],
    { encoding: 'utf8' },
  ),
);
const dir = mkdtempSync(path.join(os.tmpdir(), 'draftably-runtime-'));
writeFileSync(
  path.join(dir, 'package.json'),
  JSON.stringify({ name: 'runtime-proof', private: true, type: 'module' }),
);
execFileSync('pnpm', ['add', '--ignore-scripts', packed.filename], { cwd: dir, stdio: 'inherit' });
const pkg = path.join(dir, 'node_modules/@draftably/runtime');
const manifest = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8'));
assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
const probe = `import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { renderSvg, validate } from '@draftably/runtime';
import { renderSvg as renderBrowserSvg } from '@draftably/runtime/browser';
import { layout, route } from '@draftably/runtime/graph';
assert.equal(typeof document, 'undefined');
const placed = await layout({ nodes: [{ id: '1' }, { id: '2' }], edges: [{ source: '1', target: '2' }] });
assert.deepEqual(Object.keys(placed.nodes), ['1', '2']);
assert.ok(placed.edges.e1.points.length >= 2);
assert.match(placed.draft, /edge e1 _0 -> _1/);
const lines = route({ nodes: [{ id: 'a', x: 0, y: 0, width: 80, height: 40 }, { id: 'b', x: 200, y: 0, width: 80, height: 40 }], edges: [{ source: 'a', target: 'b' }] });
assert.equal(lines.edges.e1.blocked, false);
assert.equal((await renderBrowserSvg('node a "Browser entry"')).ok, true);
const sources = JSON.parse(readFileSync('sources.json', 'utf8'));
const times = [];
for (const [name, source] of Object.entries(sources)) {
  const start = performance.now();
  const a = await renderSvg(source);
  const cold = performance.now() - start;
  assert.equal(a.ok, true, name + JSON.stringify(a.diagnostics));
  const warmStart = performance.now();
  const b = await renderSvg(source);
  const repeat = performance.now() - warmStart;
  assert.equal(b.ok, true);
  assert.equal(b.value.svg, a.value.svg, name);
  assert.equal((await validate(source)).ok, true, name);
  assert.match(a.value.svg, /data:font\\/woff2/);
  assert.doesNotMatch(a.value.svg, /draftably-source/);
  times.push({ name, firstMs: +cold.toFixed(2), repeatMs: +repeat.toFixed(2), svgBytes: Buffer.byteLength(a.value.svg) });
  writeFileSync(name + '.svg', a.value.svg);
}
console.log(JSON.stringify(times, null, 2));
console.log('PASS packed runtime: Node ESM, no DOM, portable fonts, native layouts, deterministic output.');`;
const sources = Object.fromEntries(
  [
    'checkout.draft',
    'tcp-header.draft',
    'login-sequence.draft',
    'checkout-change.draft',
    'emphasis.draft',
  ].map(name => [name, readFileSync(path.join(root, 'examples', name), 'utf8')]),
);
sources['engine'] =
  'node a "API"\nnode b "Store"\nedge request a -> b\nlayout root engine=layered\n';
writeFileSync(path.join(dir, 'sources.json'), JSON.stringify(sources));
writeFileSync(path.join(dir, 'probe.mjs'), probe);
const proof = execFileSync(process.execPath, ['probe.mjs'], { cwd: dir, encoding: 'utf8' });
console.log(proof);
writeFileSync(path.join(out, 'node.txt'), proof);
writeFileSync(
  path.join(dir, 'consumer.ts'),
  `import {renderSvg, validate, type RenderOptions, type RenderResult} from '@draftably/runtime';
import {renderSvg as renderBrowserSvg, type RenderResult as BrowserResult} from '@draftably/runtime/browser';
import {layout, type GraphIn, type LayoutResult} from '@draftably/runtime/graph';
const graph: GraphIn = { nodes: [{ id: 'a' }], routing: { quality: 'quick' } };
const placed: LayoutResult = await layout(graph);
console.log(placed.nodes.a.x);
const options: RenderOptions = { target: 'inline', idPrefix: 'example', fonts: 'host' };
const result: RenderResult = await renderSvg('node a "A"', options);
const browserResult: BrowserResult = await renderBrowserSvg('node a "A"', options);
await validate('node a "A"');
if (result.ok) console.log(result.value.svg);
if (browserResult.ok) console.log(browserResult.value.svg);
`,
);
execFileSync(
  path.join(root, 'node_modules/.bin/tsc'),
  [
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    'false',
    '--target',
    'es2022',
    '--module',
    'nodenext',
    '--moduleResolution',
    'nodenext',
    'consumer.ts',
  ],
  { cwd: dir, stdio: 'inherit' },
);
const browser = path.join(out, 'nested/demo');
mkdirSync(browser, { recursive: true });
cpSync(
  path.join(root, 'integration-examples/browser-static/index.html'),
  path.join(browser, 'index.html'),
);
cpSync(path.join(pkg, 'dist'), path.join(browser, 'runtime'), { recursive: true });
const bytes = (file: string): number =>
  statSync(file).isDirectory()
    ? readdirSync(file).reduce((n, name) => n + bytes(path.join(file, name)), 0)
    : statSync(file).size;
const seen = new Set<string>();
function staticBytes(file: string): number {
  if (seen.has(file)) return 0;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  for (const forbidden of [
    'mermaid',
    '@d2lang',
    'solid-js',
    'codemirror',
    'jsdom',
    'node:fs',
    'node:http',
  ])
    assert.ok(
      !source.includes(`from "${forbidden}`) && !source.includes(`from '${forbidden}`),
      forbidden,
    );
  return (
    statSync(file).size +
    [...source.matchAll(/(?:from\s*|import\s*)['"](\.[^'"]+)['"]/g)].reduce(
      (n, match) => n + staticBytes(path.resolve(path.dirname(file), match[1])),
      0,
    )
  );
}
console.log(
  `Archive: ${statSync(packed.filename).size} bytes; static ESM graph: ${staticBytes(path.join(pkg, 'dist/index.js'))} bytes; fonts: ${bytes(path.join(pkg, 'dist/fonts'))} bytes.`,
);
console.log(`PASS public TypeScript imports. Browser fixture: ${browser}`);
writeFileSync(
  path.join(out, 'consumer.json'),
  JSON.stringify({ directory: dir, archive: packed.filename, browser }),
);
