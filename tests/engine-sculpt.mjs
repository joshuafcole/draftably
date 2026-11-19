/* Node 22+, no packages. Exercises actual shipped DOM-free engines. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { LayoutLab } from '../src/engines/layout-engine.ts';
import { SculptLab as Lab } from '../src/engines/sculpt-engine.ts';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..'),
  OUT = path.resolve(ROOT, 'tmp/verification-current');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
function check(name, value, detail) {
  assert.ok(value, name + ' ' + JSON.stringify(detail ?? ''));
  results.push({ name, status: 'passed', ...(detail ? { detail } : {}) });
  console.log('[sculpt geometry] PASS', name);
}
const sample = id =>
    JSON.parse(fs.readFileSync(path.join(__dirname, '../src/samples', id + '.json'))),
  copy = x => JSON.parse(JSON.stringify(x)),
  coords = d => JSON.stringify(d.layout.nodes),
  dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const centered = p => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
(async () => {
  check(
    'Feather is one at the center and exactly zero at and beyond the radius',
    Lab.weight(0, 100, 0.75) === 1 &&
      Lab.weight(100, 100, 0.75) === 0 &&
      Lab.weight(200, 100, 0.75) === 0,
  );
  const weights = Array.from({ length: 101 }, (_, i) => Lab.weight(i, 100, 0.75));
  check(
    'Smooth falloff is bounded and monotonically decreasing',
    weights.every((w, i) => w >= 0 && w <= 1 && (!i || w <= weights[i - 1])),
  );
  check(
    'Soft edge remains continuous at the core and outer rim',
    Math.abs(Lab.weight(25 - 1e-4, 100, 0.75) - Lab.weight(25 + 1e-4, 100, 0.75)) < 1e-6 &&
      Lab.weight(99.9999, 100, 0.75) < 1e-6,
  );
  check(
    'Radius hit testing uses distance to the rectangle, not only its center',
    Lab.rectDistance({ x: 120, y: 45 }, { x: 100, y: 30, w: 164, h: 56 }) === 0,
  );
  const doc = sample('branches');
  const before = JSON.stringify(doc);
  for (const algo of LayoutLab.algorithms) {
    const data = await Lab.journey(doc, { algorithm: algo.id, maxIterations: 160 });
    check(
      algo.id +
        ': checkpoints begin at exact authored geometry and end at the actual solver output',
      JSON.stringify(data.frames[0].nodes) === coords(doc) &&
        JSON.stringify(data.frames.at(-1).nodes) === coords(data.finalDocument),
      { frames: data.frames.length, reason: data.report.termination },
    );
    check(
      algo.id + ': finite checkpoint coordinates with bounded history memory',
      data.frames.length <= 96 &&
        data.frames.every(f =>
          Object.values(f.nodes).every(p => ['x', 'y', 'w', 'h'].every(k => Number.isFinite(p[k]))),
        ),
    );
  }
  check('Journey generation does not mutate source document', JSON.stringify(doc) === before);
  const data = await Lab.journey(doc, { algorithm: 'flow', maxIterations: 160 }),
    again = await Lab.journey(doc, { algorithm: 'flow', maxIterations: 160 });
  check(
    'Same source and settings produce the same recorded geometry',
    JSON.stringify(data.frames.map(f => f.nodes)) ===
      JSON.stringify(again.frames.map(f => f.nodes)),
  );
  check(
    'Lookahead chooses a future checkpoint without moving its input',
    Lab.lookahead(data.frames, 0, 40, 0.8) > 0 && JSON.stringify(doc) === before,
  );
  const nested = sample('nested-services'),
    id = nested.graph.nodes[2].id,
    parent = nested.graph.nodes[2].parentId;
  const protectedData = await Lab.journey(nested, {
    algorithm: 'compound-flow',
    maxIterations: 160,
    fixedIds: [id],
  });
  check(
    'Local holds protect the node through every ancestor move and solver checkpoint',
    protectedData.frames.every(
      f => JSON.stringify(f.nodes[id]) === JSON.stringify(nested.layout.nodes[id]),
    ),
  );
  check(
    'Temporary holds are not converted to exported pin metadata',
    protectedData.finalDocument.layout.nodes[id].pinned === nested.layout.nodes[id].pinned,
  );
  check(
    'Invocation-only constraints stay out of persistent settings',
    !('fixedIds' in protectedData.settings) &&
      !('fixedIds' in protectedData.finalDocument.settings) &&
      protectedData.execution.fixedIds.includes(id),
  );
  const pin = copy(nested);
  pin.layout.nodes[id].pinned = true;
  const pathData = await Lab.journey(pin, { algorithm: 'compound-spring', maxIterations: 160 });
  check(
    'Actual pins survive the complete recorded path',
    pathData.frames.every(
      f => JSON.stringify(f.nodes[id]) === JSON.stringify(pin.layout.nodes[id]),
    ),
  );
  const point = centered(doc.layout.nodes.n04);
  for (const mode of ['tidy', 'flow', 'space', 'restore']) {
    const source = copy(doc),
      ref = copy(doc.layout.nodes);
    for (const p of Object.values(ref)) {
      p.y += 60;
      p.x += 40;
    }
    const result = Lab.dab(source, { mode, point, worldRadius: 230, strength: 65, reference: ref });
    check(
      mode + ': source immutable and graph/settings/frame sizes unchanged',
      JSON.stringify(source) === before &&
        JSON.stringify(result.document.graph) === JSON.stringify(source.graph) &&
        JSON.stringify(result.document.settings) === JSON.stringify(source.settings) &&
        Object.keys(source.layout.nodes).every(
          id =>
            result.document.layout.nodes[id].w === source.layout.nodes[id].w &&
            result.document.layout.nodes[id].h === source.layout.nodes[id].h,
        ),
    );
    check(
      mode + ': outside the brush remains bit-identical; displacement stays under the weighted cap',
      Object.keys(source.layout.nodes).every(id =>
        result.weights[id]
          ? dist(source.layout.nodes[id], result.document.layout.nodes[id]) <=
            18 * 0.65 * result.weights[id] + 0.001
          : JSON.stringify(source.layout.nodes[id]) ===
            JSON.stringify(result.document.layout.nodes[id]),
      ),
    );
    check(
      mode + ': no new or worsened rectangle collision',
      Lab.noWorse(source, source.layout.nodes, result.document.layout.nodes),
    );
  }
  const field = Lab.field(doc, point, 230, 0.75),
    chosen = Object.keys(field.weights)[0];
  const pinned = copy(doc);
  pinned.layout.nodes[chosen].pinned = true;
  const brush = Lab.dab(pinned, { mode: 'tidy', point, worldRadius: 230 });
  check(
    'Brush respects explicit pins',
    JSON.stringify(brush.document.layout.nodes[chosen]) ===
      JSON.stringify(pinned.layout.nodes[chosen]),
  );
  const held = Lab.dab(doc, { mode: 'flow', point, worldRadius: 230, protectedIds: ['n04'] });
  check(
    'Brush respects session local holds',
    JSON.stringify(held.document.layout.nodes.n04) === JSON.stringify(doc.layout.nodes.n04),
  );
  const none = Lab.dab(doc, { point: { x: -10000, y: -10000 }, worldRadius: 50 });
  check(
    'Empty brush is a true no-op',
    JSON.stringify(none.document) === before && none.moved.length === 0,
  );
  const reference = copy(doc.layout.nodes);
  reference.n04.x += 100;
  reference.n04.y += 90;
  const restored = Lab.dab(doc, { mode: 'restore', point, worldRadius: 50, reference });
  check(
    'Local restore approaches the chosen past coordinate',
    dist(restored.document.layout.nodes.n04, reference.n04) <
      dist(doc.layout.nodes.n04, reference.n04),
  );
  const badRef = Lab.dab(doc, { mode: 'restore', point, reference: { other: { x: 0, y: 0 } } });
  check(
    'Missing restore IDs never move or resurrect nodes',
    coords(badRef.document) === coords(doc),
  );
  const np = centered(nested.layout.nodes[id]);
  const local = Lab.dab(nested, { mode: 'flow', point: np, worldRadius: 200, strength: 100 });
  check(
    'Brush edits children without moving or resizing any container',
    nested.graph.groups.every(
      g =>
        JSON.stringify(nested.layout.nodes[g.id]) ===
        JSON.stringify(local.document.layout.nodes[g.id]),
    ),
  );
  if (parent) {
    const p = copy(nested);
    p.layout.nodes[parent].pinned = true;
    const r = Lab.dab(p, { mode: 'flow', point: np, worldRadius: 800 });
    check(
      'A pinned container shields its descendants from brush effects',
      JSON.stringify(r.document.layout.nodes[id]) === JSON.stringify(p.layout.nodes[id]),
    );
  }
  let current = copy(nested);
  for (let i = 0; i < 80; i++) {
    const n = current.graph.nodes[i % current.graph.nodes.length];
    current = Lab.dab(current, {
      mode: i % 2 ? 'tidy' : 'flow',
      point: centered(current.layout.nodes[n.id]),
      worldRadius: 220,
      strength: 70,
    }).document;
  }
  check(
    '80 repeated dabs preserve graph and container identities',
    JSON.stringify(current.graph) === JSON.stringify(nested.graph) &&
      nested.graph.groups.every(
        g =>
          JSON.stringify(nested.layout.nodes[g.id]) === JSON.stringify(current.layout.nodes[g.id]),
      ),
  );
  check(
    '80 repeated dabs do not introduce or worsen collisions',
    Lab.noWorse(nested, nested.layout.nodes, current.layout.nodes),
  );
  // Timings are observations of this machine, not UI frame-rate guarantees.
  const timing = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    Lab.dab(doc, { point, worldRadius: 230 });
    timing.push(performance.now() - t);
  }
  timing.sort((a, b) => a - b);
  results.push({
    name: 'Observed branch-sample brush timing',
    status: 'measured',
    medianMs: +timing[10].toFixed(2),
    p95Ms: +timing[19].toFixed(2),
  });
  fs.writeFileSync(
    path.join(OUT, 'sculpt-geometry-results.json'),
    JSON.stringify({ passed: results.filter(x => x.status === 'passed').length, results }, null, 2),
  );
  console.log('[sculpt geometry] COMPLETE', results.length);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
