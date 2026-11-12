#!/usr/bin/env node
/**
 * Graph API speed on fresh graphs: each timed call lays out a NEW random graph, so the router's
 * cache never helps, as with a host that lays out a graph once. The graphs come from a fixed seed,
 * so two runs (before and after a change) time the same graphs and their drawings can be compared.
 *
 * Usage: pnpm bench:fresh [--runs 5] [--quality auto|quick|full] [--only <name>]
 *          [--out tmp/bench/fresh.json] [--compare tmp/bench/fresh-before.json] [--dist <dir>]
 *
 * Reports the median time and the median drawing measures over the runs: crossings between
 * lines, bends, line length, lines through other boxes, blocked lines, and area, plus a digest
 * of every drawing: a speedup that keeps the digest changed no drawing.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const runs = Number(opt('runs', 5)),
  quality = opt('quality', 'auto'),
  only = opt('only', ''),
  out = opt('out', 'tmp/bench/fresh.json'),
  compare = opt('compare', ''),
  dist = path.resolve(root, opt('dist', 'packages/runtime/dist'));
const { layout } = await import(path.join(dist, 'graph.js'));

// The same generator as the docs' elkjs/dagre comparison, so the numbers line up.
let s = 11;
const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
const tree = n => Array.from({ length: n - 1 }, (_, k) => [Math.floor(rand() * (k + 1)), k + 1]);
function dag(n, m) {
  const seen = new Set(),
    edges = [];
  for (let i = 1; i < n; i++) {
    const j = Math.floor(rand() * i);
    seen.add(`${j}-${i}`);
    edges.push([j, i]);
  }
  while (edges.length < m) {
    const a = Math.floor(rand() * n),
      b = Math.floor(rand() * n);
    if (a < b && !seen.has(`${a}-${b}`)) {
      seen.add(`${a}-${b}`);
      edges.push([a, b]);
    }
  }
  return edges;
}
const graph = (n, edges) => ({
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Service ${i}` })),
  edges: edges.map(([a, b]) => ({ source: `n${a}`, target: `n${b}` })),
  direction: 'down',
  routing: { quality },
});
// Each case starts its own sequence, so `--only` times the same graphs as a full run.
const cases = [
  ['tree 100', 11, () => graph(100, tree(100))],
  ['dag 50/65', 12, () => graph(50, dag(50, 65))],
  ['dag 100/127', 13, () => graph(100, dag(100, 127))],
  ['dag 200/260', 14, () => graph(200, dag(200, 260))],
];

/** Proper crossings between two segments, ignoring touches at ends. */
function cross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
/** Does segment a→b pass through the inside of box r (shrunk by 2px)? */
function through(a, b, r) {
  const x0 = r.x + 2,
    y0 = r.y + 2,
    x1 = r.x + r.width - 2,
    y1 = r.y + r.height - 2;
  if (x1 <= x0 || y1 <= y0) return false;
  // Liang–Barsky clip of the segment against the box.
  let t0 = 0,
    t1 = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t1 - t0 > 1e-6;
}

function measure(r) {
  const edges = Object.values(r.edges),
    segs = edges.map(e => e.points.slice(1).map((p, i) => [e.points[i], p]));
  let crossings = 0,
    bends = 0,
    length = 0,
    thru = 0;
  for (let i = 0; i < segs.length; i++) {
    bends += Math.max(0, edges[i].points.length - 2);
    for (const [a, b] of segs[i]) length += Math.hypot(b.x - a.x, b.y - a.y);
    for (let j = i + 1; j < segs.length; j++)
      for (const [a, b] of segs[i])
        for (const [c, d] of segs[j]) if (cross(a, b, c, d)) crossings++;
    for (const [id, box] of Object.entries(r.nodes)) {
      if (id === edges[i].source || id === edges[i].target) continue;
      if (segs[i].some(([a, b]) => through(a, b, box))) thru++;
    }
  }
  return {
    crossings,
    bends,
    length: Math.round(length),
    through: thru,
    blocked: edges.filter(e => e.blocked).length,
    area: Math.round((r.bounds.width * r.bounds.height) / 1000),
  };
}

const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const keys = ['crossings', 'bends', 'length', 'through', 'blocked', 'area'];
const results = {};
// One untimed layout loads the modules and fonts.
await layout(graph(20, dag(20, 26)));
for (const [name, seed, make] of cases) {
  if (only && !name.includes(only)) continue;
  s = seed;
  const times = [],
    ms = [],
    digest = createHash('sha256');
  let used;
  for (let i = 0; i < runs; i++) {
    const g = make(),
      t = performance.now(),
      r = await layout(g);
    times.push(performance.now() - t);
    ms.push(measure(r));
    digest.update(JSON.stringify(r));
    used = r.quality;
  }
  results[name] = {
    ms: Math.round(med(times)),
    quality: used,
    // Equal digests: every drawing came out the same, to the last coordinate.
    digest: digest.digest('hex').slice(0, 8),
    ...Object.fromEntries(keys.map(k => [k, med(ms.map(m => m[k]))])),
  };
}

const before = compare ? JSON.parse(fs.readFileSync(path.resolve(root, compare), 'utf8')) : {};
const cell = (name, k) => {
  const now = results[name][k],
    was = before[name]?.[k];
  return was === undefined || was === now ? `${now}` : `${was} → ${now}`;
};
const lines = [
  `Fresh graphs, quality=${quality}, median of ${runs}.`,
  '',
  `| Graph | ms | Routed | ${keys.join(' | ')} | Digest |`,
  `| --- | ---: | --- | ${keys.map(() => '---:').join(' | ')} | --- |`,
  ...Object.keys(results).map(
    n =>
      `| ${n} | ${cell(n, 'ms')} | ${results[n].quality} | ${keys.map(k => cell(n, k)).join(' | ')} | ${cell(n, 'digest')} |`,
  ),
];
console.log(lines.join('\n'));
fs.mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
fs.writeFileSync(path.resolve(root, out), JSON.stringify(results, null, 2));
process.exit(0);
