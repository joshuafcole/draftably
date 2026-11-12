#!/usr/bin/env node
/**
 * Graph API harness: lays out every graph in `graph-corpus.mjs` through the built runtime
 * package and checks what a host relies on. Prints a Markdown table; writes tmp/bench/graph.json.
 *
 * Usage: pnpm bench:graph [--only <name substring>] [--quality auto|full|quick]
 *
 * Fails (exit 1) on a throw, a missing ID, overlapping boxes, a child outside its group, a line
 * that does not start and end on its boxes, or different output for the same input. Blocked
 * lines and times over the 1 s budget are reported, not failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpus } from './graph-corpus.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { layout } = await import(path.join(root, 'packages/runtime/dist/graph.js'));
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const only = opt('only', ''),
  quality = opt('quality', 'auto'),
  BUDGET = 1000;

const inside = (a, b, pad = 0.5) =>
  a.x >= b.x - pad &&
  a.y >= b.y - pad &&
  a.x + a.width <= b.x + b.width + pad &&
  a.y + a.height <= b.y + b.height + pad;
const overlap = (a, b) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5;
/** Distance from point `p` to the outline of box `b`, 0 when on it. */
function offOutline(p, b) {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width)),
    dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height));
  if (dx || dy) return Math.hypot(dx, dy);
  return Math.min(p.x - b.x, b.x + b.width - p.x, p.y - b.y, b.y + b.height - p.y);
}

function check(input, out) {
  const problems = [],
    g = input.reactFlow || input.elk ? null : input;
  if (!g) return problems;
  const shapes = new Map(g.nodes.map(n => [n.id, n.shape])),
    boxes = { ...out.nodes, ...out.groups },
    ancestors = id => {
      const list = [];
      for (let p = boxes[id]?.parent; p; p = boxes[p]?.parent) list.push(p);
      return list;
    };
  for (const n of g.nodes) if (!out.nodes[n.id]) problems.push(`missing node ${n.id}`);
  for (const x of g.groups ?? []) if (!out.groups[x.id]) problems.push(`missing group ${x.id}`);
  (g.edges ?? []).forEach((e, i) => {
    const id = e.id ?? `e${i + 1}`;
    if (!out.edges[id]) problems.push(`missing edge ${id}`);
  });
  const ids = Object.keys(boxes);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i],
        b = ids[j];
      if (ancestors(a).includes(b) || ancestors(b).includes(a)) continue;
      if (overlap(boxes[a], boxes[b])) problems.push(`${a} overlaps ${b}`);
    }
  for (const id of ids) {
    const p = boxes[id].parent;
    if (p && !inside(boxes[id], boxes[p])) problems.push(`${id} outside ${p}`);
  }
  for (const [id, e] of Object.entries(out.edges)) {
    if (e.points.length < 2) {
      problems.push(`${id} has ${e.points.length} points`);
      continue;
    }
    // A self loop or a message may start inside its box; the rest start on the outline.
    if (e.source === e.target) continue;
    if (!boxes[e.source] || !boxes[e.target]) {
      problems.push(`${id} ends ${e.source} → ${e.target} have no box`);
      continue;
    }
    // A round or diamond shape's outline lies inside its box: allow up to half the box.
    const slack = id =>
        ['circle', 'diamond', 'pill'].includes(shapes.get(id))
          ? Math.min(boxes[id].width, boxes[id].height) / 2
          : 2,
      a = offOutline(e.points[0], boxes[e.source]),
      b = offOutline(e.points.at(-1), boxes[e.target]);
    if (a > slack(e.source) || b > slack(e.target))
      problems.push(`${id} ends ${a.toFixed(1)}/${b.toFixed(1)}px off its boxes`);
  }
  return problems;
}

const rows = [],
  report = [];
let failed = 0;
for (const { name, input } of corpus) {
  if (only && !name.includes(only)) continue;
  const arg = { ...input, routing: { ...input.routing, quality } };
  let out, ms, again, error;
  try {
    // The first run is timed: a second run of the same input reuses the router's cache.
    const t = performance.now();
    out = await layout(arg);
    ms = performance.now() - t;
    again = await layout(arg);
  } catch (e) {
    error = e.message;
  }
  const problems = error ? [`throws: ${error}`] : check(input, out);
  if (!error && JSON.stringify(out) !== JSON.stringify(again))
    problems.push('different output for the same input');
  const blocked = out ? Object.values(out.edges).filter(e => e.blocked).length : 0,
    warnings = out?.warnings ?? [];
  if (problems.length) failed++;
  report.push({ name, ms, blocked, problems, warnings, quality: out?.quality });
  rows.push(
    `| ${name} | ${out ? Object.keys(out.nodes).length : '–'} | ${out ? Object.keys(out.edges).length : '–'} | ${ms === undefined ? '–' : `${Math.round(ms)}${ms > BUDGET ? ' ✗' : ''}`} | ${out?.quality ?? '–'} | ${blocked || ''} | ${[...problems, ...warnings.map(w => `⚠ ${w}`)].join('; ').slice(0, 160)} |`,
  );
}
const table = [
  `Graph API harness, quality=${quality}. Budget ${BUDGET} ms.`,
  '',
  '| Graph | Nodes | Edges | ms | Routed | Blocked | Problems |',
  '| --- | ---: | ---: | ---: | --- | ---: | --- |',
  ...rows,
].join('\n');
console.log(table);
fs.mkdirSync(path.join(root, 'tmp/bench'), { recursive: true });
fs.writeFileSync(path.join(root, 'tmp/bench/graph.json'), JSON.stringify(report, null, 2));
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
process.exit(failed ? 1 : 0);
