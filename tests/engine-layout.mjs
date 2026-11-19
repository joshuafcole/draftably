/* Deterministic, DOM-free checks of the shipped engines. */
'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LayoutLab as L } from '../src/engines/layout-engine.ts';
import { RouteLab as R } from '../src/engines/routing-engine.ts';
import { ExplorerLab as E } from '../src/engines/explorer-engine.ts';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(ROOT, 'tmp/verification-current');
fs.mkdirSync(OUT, { recursive: true });
const copy = x => JSON.parse(JSON.stringify(x)),
  load = n => JSON.parse(fs.readFileSync(path.join(__dirname, '../src/samples', n + '.json')));
let assertions = 0;
const results = [],
  quality = [];
function check(name, fn) {
  fn();
  assertions++;
}
function geometrySafe(d) {
  for (const p of Object.values(d.layout.nodes)) {
    assert.ok(['x', 'y', 'w', 'h'].every(k => Number.isFinite(p[k])));
    assert.ok(p.w >= 24 && p.h >= 20);
  }
}
(async () => {
  check('invalid role rejected', () =>
    assert.throws(() =>
      L.normalizeIntent({ start: { id: 'no', placement: 'top-left' } }, new Set(['ok'])),
    ),
  );
  check('same start/end rejected', () =>
    assert.throws(() =>
      L.normalizeIntent(
        { start: { id: 'n', placement: 'center' }, end: { id: 'n', placement: 'bottom-right' } },
        new Set(['n']),
      ),
    ),
  );
  check('unsafe placement rejected', () =>
    assert.throws(() =>
      L.normalizeIntent({ start: { id: 'n', placement: '__proto__' } }, new Set(['n'])),
    ),
  );
  const cyclic = load('cycle');
  cyclic.layout.intent = {
    start: { id: 'n02', placement: 'top-left' },
    end: { id: 'n05', placement: 'bottom-right' },
  };
  const t = L.topology(cyclic.graph.nodes, cyclic.graph.edges, cyclic.layout.intent);
  check('specified start receives rank zero despite cycle', () =>
    assert.equal(t.rank.get('n02'), 0),
  );
  check('incoming start edges are feedback without data removal', () =>
    assert.ok(t.feedback.has('n01\0n02')),
  );
  check('specified end is final ranked node', () =>
    assert.equal(t.rank.get('n05'), Math.max(...t.rank.values())),
  );
  const directed = copy(cyclic);
  directed.graph.edges.forEach(e => (e.directed = false));
  check('undirected edges do not impose forward order', () =>
    assert.equal(
      L.topology(directed.graph.nodes, directed.graph.edges, directed.layout.intent).forward.length,
      0,
    ),
  );
  for (const algorithm of L.algorithms) {
    const id = algorithm.id;
    const doc = load('guided-process'),
      input = JSON.stringify(doc);
    const result = await L.compute(doc, {
      algorithm: id,
      mode: 'rebuild',
      settle: true,
      maxIterations: 320,
    });
    check(id + ' cloned input', () => assert.equal(JSON.stringify(doc), input));
    check(id + ' graph and hints unchanged', () => {
      assert.deepEqual(result.document.graph, doc.graph);
      assert.deepEqual(result.document.layout.intent, doc.layout.intent);
    });
    check(id + ' geometry finite', () => geometrySafe(result.document));
    check(id + ' no overlap in guided feedback fixture', () =>
      assert.equal(result.report.after.overlaps, 0),
    );
    check(id + ' implicit start does not overwrite legacy root preference', () =>
      assert.equal(result.document.settings.rootId, doc.settings.rootId),
    );
    if (id !== 'separate') {
      check(id + ' directed forward order in guided fixture', () =>
        assert.equal(result.report.backwardEdges, 0),
      );
      const changed = copy(doc);
      for (const [i, p] of Object.values(changed.layout.nodes).entries()) {
        p.x += 800 - i * 55;
        p.y += i * 91 - 250;
      }
      const repeat = await L.compute(changed, {
        algorithm: id,
        mode: 'rebuild',
        settle: true,
        maxIterations: 320,
      });
      check(id + ' canonical result independent of unpinned starting coordinates', () =>
        assert.deepEqual(repeat.document.layout.nodes, result.document.layout.nodes),
      );
    }
    const pinned = load('nested-services');
    pinned.layout.nodes.session.pinned = true;
    pinned.layout.intent = {
      start: { id: 'user', placement: 'top-left' },
      end: { id: 'archive', placement: 'bottom-right' },
    };
    const pass = await L.compute(pinned, {
      algorithm: id,
      mode: 'pass',
      maxMove: 24,
      iterations: 24,
    });
    check(id + ' nested pin respected', () =>
      assert.deepEqual(pass.document.layout.nodes.session, pinned.layout.nodes.session),
    );
    check(id + ' total parent/child movement remains within one budget', () => {
      for (const [key, p] of Object.entries(pass.document.layout.nodes)) {
        const old = pinned.layout.nodes[key];
        assert.ok(Math.hypot(p.x - old.x, p.y - old.y) <= 24.003, key);
      }
    });
    check(id + ' immutable fixed-size frames', () => {
      for (const g of pinned.graph.groups) {
        assert.equal(pass.document.layout.nodes[g.id].w, pinned.layout.nodes[g.id].w);
        assert.equal(pass.document.layout.nodes[g.id].h, pinned.layout.nodes[g.id].h);
      }
    });
    const center = load('centered-branches');
    const radial = await L.compute(center, {
      algorithm: id,
      mode: 'rebuild',
      settle: true,
      maxIterations: 320,
    });
    check(id + ' centered branches finite and collision-free', () => {
      geometrySafe(radial.document);
      assert.equal(radial.report.after.overlaps, 0);
    });
    if (id !== 'separate')
      check(id + ' centered guide has branches on both sides', () => {
        const p = radial.document.layout.nodes,
          hub = p.hub.x + p.hub.w / 2;
        assert.ok(
          Object.entries(p).some(([key, n]) => key.startsWith('branch') && n.x + n.w / 2 < hub),
        );
        assert.ok(
          Object.entries(p).some(([key, n]) => key.startsWith('branch') && n.x + n.w / 2 > hub),
        );
      });
    results.push({
      algorithm: id,
      status: 'passed',
      guided: result.report,
      center: radial.report,
      nestedPass: pass.report,
    });
    console.log('[geometry]', id, 'passed');
  }
  // Broad current-version sweep: report remaining aesthetic conflicts honestly.
  for (const name of [
    'branches',
    'cycle',
    'automatic-ports',
    'nested-services',
    'boundary-terminals',
  ])
    for (const algorithm of L.algorithms) {
      const d = load(name),
        r = await L.compute(d, {
          algorithm: algorithm.id,
          mode: 'rebuild',
          settle: true,
          maxIterations: 320,
        }),
        routes = R.compute(E.sceneInput(r.document), r.document.settings.routing);
      check(name + '/' + algorithm.id + ' finite routes and geometry', () => {
        geometrySafe(r.document);
        for (const e of routes.routes)
          for (const p of e.points) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      });
      quality.push({
        sample: name,
        algorithm: algorithm.id,
        overlaps: r.report.after.overlaps,
        backward: r.report.backwardEdges,
        blocked: routes.report.blocked,
        crossings: routes.report.crossings,
        lanePairs: routes.report.lanePairs,
      });
    }
  const base = load('branches'),
    snap = JSON.stringify(base),
    intent = { start: { id: 'n00', placement: 'top-left' } };
  const candidate = await E.candidate(
    base,
    { key: 'tree', title: 'Tree', patch: { algorithm: 'tree' } },
    { mode: 'layout', run: 'rebuild', intent, maxIterations: 320 },
  );
  check('experiment intent override does not mutate frozen baseline', () =>
    assert.equal(JSON.stringify(base), snap),
  );
  check('candidate includes requested intent', () =>
    assert.deepEqual(candidate.document.layout.intent, intent),
  );
  const route = await E.candidate(
    base,
    { key: 'routes', title: 'Routes', patch: { edgeGap: 24 } },
    { mode: 'routing', intent },
  );
  check('route-only comparison ignores pending layout hints', () =>
    assert.deepEqual(route.document.layout.nodes, base.layout.nodes),
  );
  check('route-only comparison preserves baseline intent', () =>
    assert.deepEqual(route.document.layout.intent, base.layout.intent),
  );
  fs.writeFileSync(
    path.join(OUT, 'geometry-results.json'),
    JSON.stringify({ assertions, status: 'passed', results, quality }, null, 2),
  );
  console.log(
    '[geometry] PASS',
    assertions,
    'named assertions;',
    quality.length,
    'broad layout/routing cases',
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
