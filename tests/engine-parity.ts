import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { LayoutLab } from '../src/engines/layout-engine.ts';
import { RouteLab } from '../src/engines/routing-engine.ts';
import { ExplorerLab } from '../src/engines/explorer-engine.ts';
import { SculptLab } from '../src/engines/sculpt-engine.ts';
import type { NodeGeometry } from '../src/model/types';

// `--shard i/n` runs one share of the comparisons and writes its own report, so
// `scripts/test-engines.ts` can run the shares side by side and merge them. Without it, all run.
const shardAt = process.argv.indexOf('--shard');
const [shard, shards] = shardAt > 0 ? process.argv[shardAt + 1].split('/').map(Number) : [0, 1];
// Each group of comparisons takes the next number; a share runs the groups that fall to it.
// Every share walks the same loops, so the numbers agree between them.
let group = 0;
const mine = () => group++ % shards === shard;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const outDir = path.join(root, 'tmp/verification-current');
fs.mkdirSync(outDir, { recursive: true });
const baseline = vm.createContext({ console, setTimeout, clearTimeout, performance });
for (const name of ['layout', 'routing', 'explorer', 'sculpt']) {
  const file = path.join(root, 'reference/v7/source', `${name}-engine.js`);
  vm.runInContext(fs.readFileSync(file, 'utf8'), baseline, { filename: file });
}
const current = {
  layout: LayoutLab,
  routing: RouteLab,
  explorer: ExplorerLab,
  sculpt: SculptLab,
};
const engines = {
  layout: baseline.LayoutLab,
  routing: baseline.RouteLab,
  explorer: baseline.ExplorerLab,
  sculpt: baseline.SculptLab,
};
const fixtureNames = fs
  .readdirSync(path.join(here, '../src/samples'))
  .filter(x => x.endsWith('.json'))
  .sort()
  .map(x => x.slice(0, -5));
const fixtures = new Map(
  fixtureNames.map(name => [
    name,
    JSON.parse(fs.readFileSync(path.join(here, '../src/samples', `${name}.json`), 'utf8')),
  ]),
);
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const clean = (value: unknown) => {
  const plain = JSON.parse(JSON.stringify(value));
  const visit = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(visit);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(
      Object.entries(item)
        .filter(([key]) => key !== 'milliseconds' && key !== 'createdAt')
        .map(([key, child]) => [key, visit(child)]),
    );
  };
  return visit(plain);
};
// The soft standoff band, the tidy pass, facing-side fans, gated title bands and the search window
// postdate v7, so routing parity runs with them off. Their own behaviour is covered in
// tests/routing-clearance.test.ts, tests/routing-order.test.ts and tests/routing-fans.test.ts.
const LEGACY_ROUTING = {
  standoff: 0,
  tidy: false,
  facing: false,
  titleBands: false,
  window: false,
};
let checks = 0;
const results: Array<{ name: string; status: string; group: number; message?: string }> = [];
function parity(name: string, before: unknown, after: unknown) {
  try {
    assert.deepStrictEqual(clean(after), clean(before));
    checks++;
    results.push({ name, status: 'passed', group: group - 1 });
  } catch (error) {
    results.push({
      name,
      status: 'failed',
      group: group - 1,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

assert.equal(fixtureNames.length, 13, 'copy all 13 baseline examples into src/samples');
for (const name of fixtureNames) {
  const fixture = fixtures.get(name);
  for (const algorithm of current.layout.algorithms) {
    if (!mine()) continue;
    const options = {
      algorithm: algorithm.id,
      mode: 'rebuild' as const,
      settle: true,
      maxIterations: 160,
      // The layered order prior (authored in-rank order unless sweeps clearly cut crossings)
      // postdates v7; tests/growth-order.test.ts covers it.
      orderPrior: false,
    };
    const oldLayout = await engines.layout.compute(copy(fixture), options);
    const newLayout = await current.layout.compute(copy(fixture), options);
    parity(`${name}/${algorithm.id}: layout result`, oldLayout, newLayout);
    const oldRoutes = engines.routing.compute(
      engines.explorer.sceneInput(oldLayout.document),
      oldLayout.document.settings.routing,
    );
    const newRoutes = current.routing.compute(current.explorer.sceneInput(newLayout.document), {
      ...newLayout.document.settings.routing,
      ...LEGACY_ROUTING,
    });
    parity(`${name}/${algorithm.id}: routed layout result`, oldRoutes, newRoutes);
  }
  if (mine())
    parity(
      `${name}: route authored fixture`,
      engines.routing.compute(engines.explorer.sceneInput(fixture), fixture.settings.routing),
      current.routing.compute(current.explorer.sceneInput(fixture), {
        ...fixture.settings.routing,
        ...LEGACY_ROUTING,
      }),
    );
}

const journeySource = fixtures.get('branches');
for (const algorithm of current.layout.algorithms) {
  if (!mine()) continue;
  const options = { algorithm: algorithm.id, maxIterations: 160 };
  const oldJourney = await engines.sculpt.journey(copy(journeySource), options);
  const newJourney = await current.sculpt.journey(copy(journeySource), options);
  parity(`${algorithm.id}: recorded journey`, oldJourney, newJourney);
}
for (const name of ['branches', 'nested-services']) {
  const doc = fixtures.get(name);
  const point = (() => {
    const p = doc.layout.nodes[doc.graph.nodes[0].id];
    return { x: p.x + p.w / 2, y: p.y + p.h / 2 };
  })();
  for (const mode of ['tidy', 'flow', 'space', 'restore', 'protect'] as const) {
    if (!mine()) continue;
    const reference: NodeGeometry = copy(doc.layout.nodes);
    for (const p of Object.values(reference)) {
      p.x += 40;
      p.y += 60;
    }
    const options = { mode, point, worldRadius: 230, strength: 65, reference };
    parity(
      `${name}/${mode}: brush dab`,
      engines.sculpt.dab(copy(doc), options),
      current.sculpt.dab(copy(doc), options),
    );
  }
}

const report = {
  fixtureCount: fixtureNames.length,
  layoutAlgorithms: current.layout.algorithms.length,
  checks,
  results,
};
if (shards > 1) {
  // A share's report also says how many groups there are, so the merge can tell that none is lost.
  fs.writeFileSync(
    path.join(outDir, `engine-parity-results-${shard}.json`),
    JSON.stringify({ ...report, shard, shards, groups: group }),
  );
  console.log(`[engine parity] share ${shard + 1} of ${shards}: ${checks} parity comparisons`);
} else {
  fs.writeFileSync(
    path.join(outDir, 'engine-parity-results.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(
    `[engine parity] PASS ${checks} parity comparisons across ${fixtureNames.length} fixtures and ${current.layout.algorithms.length} algorithms`,
  );
}
