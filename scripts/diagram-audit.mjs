#!/usr/bin/env node
/**
 * Diagram quality audit: objective layout metrics for a corpus of `.draft` files, plus a
 * contact sheet per diagram for the visual review. See docs/intent/diagram-quality/RUBRIC.md.
 *
 *   node scripts/diagram-audit.mjs <corpus-dir> <out-dir> [--only slug,slug] [--no-shots]
 *                                  [--baseline <previous-out-dir>]
 *
 * A corpus dir holds one folder per diagram. Each folder has `v0.draft` (the first render) and
 * optional `e1.draft`, `e2.draft`, … (the same diagram after each follow-up request). Writes
 * `<out>/<slug>/metrics.json`, `<out>/<slug>/sheet.png` and `<out>/summary.md`.
 *
 * A follow-up file states what its request should achieve in `# expect` comments, checked here:
 *
 *   # expect left-of a b       a's right edge is left of b's left edge (also right-of, above, below)
 *   # expect order-x a b c     centers run left to right (order-y: top to bottom)
 *   # expect reads-x a b c     reading order, left to right, wrapping onto lower rows (reads-y: columns)
 *   # expect aligned-x a b     centers share x within 4px (aligned-y: y)
 *   # expect near a b 80       the gap between a and b is at most 80px
 *   # expect still a b         a and b moved at most 24px from the previous version
 *   # expect still *           nothing that existed before moved more than 24px; the summary also
 *                              reports each `still` with the drawing's median shift removed
 *   # expect still-shape *     nothing moved more than 24px once each band's own shift along the
 *                              reading direction is removed (the relabel promise: a widened gap
 *                              slides what follows it, and nothing else changes shape)
 *   # expect keeps-order       no pair of old objects swapped sides (growth may push things aside)
 *   # expect back-edges 0      at most this many edges run against the reading direction
 *
 * With `--baseline`, the summary adds each render's defect-index change and `<slug>/compare-<v>.png`
 * puts the previous round's image beside this one's.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'scripts/draftably.mjs');

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  return i < 0 ? false : (args.splice(i, 1), true);
};
const option = name => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args.splice(i, 2)[1];
};
const noShots = flag('--no-shots');
const only = option('--only')?.split(',');
const baseline = option('--baseline');
const [corpusDir, outDir] = args;
if (!corpusDir || !outDir) {
  console.error(
    'Usage: node scripts/diagram-audit.mjs <corpus-dir> <out-dir> [--only a,b] [--no-shots]',
  );
  process.exit(1);
}

const run = (...a) => {
  try {
    return {
      out: execFileSync(process.execPath, [cli, ...a], { encoding: 'utf8', stdio: 'pipe' }),
      ok: true,
    };
  } catch (e) {
    return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, ok: false };
  }
};

// ---------- geometry helpers ----------
const EPS = 0.5;
// Thresholds for the space metrics, calibrated on the round-4 renders (RUBRIC.md).
/** A forward edge shorter than this is never long. */
const LONG_EDGE_MIN = 400;
/** A forward edge this many times the gap between its two boxes (along both axes) is a detour. */
const LONG_EDGE_DETOUR = 2;
/** A forward edge longer than this share of the drawing's diagonal runs across the drawing. */
const LONG_EDGE_SPAN = 0.6;
/** The largest empty rectangle over this share of the drawing's area is an empty quarter. */
const EMPTY_AREA = 0.15;
/** ...and only when both its sides are at least this long (a thin strip is `empty-band`). */
const EMPTY_SIDE = 160;
/** ...and it would hold at least this many of the drawing's average boxes. */
const EMPTY_BOXES = 11;
/** A drawing wider (or taller) than this ratio reads as a strip. */
const MAX_ASPECT = 5;
const segs = pts => pts.slice(1).map((p, i) => [pts[i], p]);
const len = ([a, b]) => Math.hypot(b.x - a.x, b.y - a.y);
const shrink = (r, d) => ({ x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d });
const center = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const rectsOverlap = (a, b) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS &&
  Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPS;
const inside = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

/** Does an axis-aligned (or any) segment pass through the rectangle's interior? Sampled. */
function segHitsRect([a, b], r) {
  const n = Math.max(2, Math.ceil(len([a, b]) / 3));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (inside({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, r)) return true;
  }
  return false;
}

/** Proper crossing of two segments (not touching at shared endpoints, not collinear). */
function segsCross([a, b], [c, d]) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = o(a, b, c),
    o2 = o(a, b, d),
    o3 = o(c, d, a),
    o4 = o(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Length of collinear overlap between two axis-aligned segments. */
function collinearOverlap([a, b], [c, d]) {
  const h1 = Math.abs(a.y - b.y) < EPS,
    h2 = Math.abs(c.y - d.y) < EPS;
  const v1 = Math.abs(a.x - b.x) < EPS,
    v2 = Math.abs(c.x - d.x) < EPS;
  if (h1 && h2 && Math.abs(a.y - c.y) < 2) {
    return Math.max(
      0,
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)),
    );
  }
  if (v1 && v2 && Math.abs(a.x - c.x) < 2) {
    return Math.max(
      0,
      Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)),
    );
  }
  return 0;
}

const dir = ([a, b]) => {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'R' : 'L') : dy >= 0 ? 'D' : 'U';
};
const opposite = { R: 'L', L: 'R', U: 'D', D: 'U' };

// ---------- source parsing (edge endpoints, declared direction) ----------
function parseSource(text) {
  const edges = new Map();
  const diamonds = new Set();
  let direction,
    edgeGap = 16;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/(^|\s)(#|\/\/).*$/, '').trim();
    const e = line.match(/^edge\s+(\S+)\s+(\S+)\s*->\s*(\S+)/);
    if (e) edges.set(e[1], { source: e[2], target: e[3], label: /"[^"]+"/.test(line) });
    const n = line.match(/^node\s+(\S+)\b.*\bshape=diamond\b/);
    if (n) diamonds.add(n[1]);
    const l = line.match(/^layout\s+root\b.*direction=(right|down)/);
    if (l) direction = l[1];
    const g = line.match(/^routing\b.*\b(?:edge|port)-gap=(\d+)/g);
    if (g) for (const m of g) edgeGap = Math.max(edgeGap, +m.match(/(\d+)$/)[1]);
  }
  return { edges, diamonds, direction, edgeGap };
}

// ---------- SVG parsing (edge label boxes) ----------
/**
 * The room a group's header icon and title text take, as the renderer draws them: the icon from
 * the frame's left, then the 13px semibold title at `x + 33`, plus 8px. Falls back to the whole
 * band when the title isn't found.
 */
function groupTitleInk(svg, g) {
  const re =
    /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*font-size="([\d.]+)" font-weight="600"[^>]*>([^<]*)</g;
  for (const m of svg.matchAll(re)) {
    if (Math.abs(+m[1] - (g.x + 33)) > 1 || Math.abs(+m[2] - (g.y + 17)) > 1) continue;
    const chars = m[4].replace(/&[a-z#0-9]+;/g, '_').length;
    return { x: g.x + 3, y: g.y + 2, w: 30 + chars * +m[3] * 0.62 + 8, h: 28 };
  }
  return { x: g.x + 2, y: g.y + 2, w: g.w - 4, h: 28 };
}

function parseLabels(svg) {
  const canvas = svg.match(
    /<rect x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" fill="(#[0-9A-Fa-f]+)"\/>/,
  )?.[1];
  const labels = [];
  const re =
    /<rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="4" fill="([^"]+)"\/>\s*<text[^>]*font-weight="500"[^>]*>([^<]*)</g;
  let m;
  while ((m = re.exec(svg))) {
    if (canvas && m[5] !== canvas) continue;
    labels.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], text: m[6], at: m.index });
  }
  // The text itself, inside the label's padding: the renderer pads the measured text by 8px
  // each side (to at least 36px wide) and centres one line of the annotation type in the box.
  for (const label of labels) {
    const tag = svg.slice(label.at).match(/<text[^>]*font-size="([\d.]+)"/);
    const size = tag ? +tag[1] : 10.5;
    const chars = label.text.replace(/&[a-z#0-9]+;/g, '_').length;
    const w = Math.min(label.w - 16, chars * size * 0.62);
    const c = center(label);
    label.ink = { x: c.x - w / 2, y: c.y - size / 2, w, h: size };
  }
  // The label's own path is the line in the edge's group, which holds the line and its label
  // (the halo paths before it, where the line breaks a frame, have no line cap). A line with
  // `head=none` has no end marker, so the last marked path before the label would be another
  // edge's.
  for (const label of labels) {
    const before = svg.slice(0, label.at),
      group = before.slice(before.lastIndexOf('<g data-id="'));
    label.edge = group.match(/^<g data-id="([^"]+)"/)?.[1];
    const d =
      group.match(/<path d="(M[^"]+)"[^>]*stroke-linecap/)?.[1] ??
      [...before.matchAll(/<path d="(M[^"]+)"[^>]*marker-end/g)].pop()?.[1];
    label.path = d
      ? [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map(p => ({ x: +p[1], y: +p[2] }))
      : [];
  }
  return labels;
}

// ---------- color ----------
const luminance = hex => {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4]
    .map(i => parseInt(v.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** Text-on-fill pairs for shapes and group titles, plus the distinct fills used. */
function parseColors(svg) {
  const canvas = svg.match(
    /<rect x="[-\d.]+" y="[-\d.]+" width="[\d.]+" height="[\d.]+" fill="(#[0-9A-Fa-f]{6})"\/>/,
  )?.[1];
  const pairs = [];
  const re =
    /<(?:rect|path|ellipse|circle)[^>]*fill="(#[0-9A-Fa-f]{6})"[^>]*stroke="#[0-9A-Fa-f]{6}"[^>]*\/>\s*(?:<svg[\s\S]*?<\/svg>\s*)?<text[^>]*fill="(#[0-9A-Fa-f]{6})"[^>]*>(?:<tspan[^>]*>)?([^<]*)/g;
  let m;
  while ((m = re.exec(svg)))
    pairs.push({ fill: m[1], ink: m[2], text: m[3], ratio: +contrast(m[1], m[2]).toFixed(2) });
  const connection = svg.match(/<path d="M[^"]+" fill="none" stroke="(#[0-9A-Fa-f]{6})"/)?.[1];
  return {
    canvas,
    pairs,
    fills: [...new Set(pairs.map(p => p.fill.toUpperCase()))],
    connectionContrast: canvas && connection ? +contrast(canvas, connection).toFixed(2) : undefined,
  };
}

/** Gap between a rectangle and an orthogonal segment: 0 when the segment crosses it. */
const rectSegDist = (r, [a, b]) =>
  Math.hypot(
    Math.max(0, Math.min(a.x, b.x) - (r.x + r.w), r.x - Math.max(a.x, b.x)),
    Math.max(0, Math.min(a.y, b.y) - (r.y + r.h), r.y - Math.max(a.y, b.y)),
  );

// ---------- hooks ----------
/** Spans of two boxes along an axis overlap (with a little slack). */
const spansMeet = (s, t, axis) => {
  const size = axis === 'x' ? 'w' : 'h';
  return Math.min(s[axis] + s[size], t[axis] + t[size]) - Math.max(s[axis], t[axis]) > -STEP;
};

/** Why a route is a hook (a U-turn), or '' when it isn't. */
function hookOf(r, s, t) {
  if (!s || !t || r.segs.length < 2) return '';
  const first = dir(r.segs[0]),
    last = dir(r.segs.at(-1));
  // Overshoot: arriving travelling up (into the bottom) while the source sits wholly above the
  // target, and so on: the line passed the target and turned back into its far side.
  const far = {
    U: s.y + s.h <= t.y,
    D: t.y + t.h <= s.y,
    L: s.x + s.w <= t.x,
    R: t.x + t.w <= s.x,
  }[last];
  if (far) return 'into its far side';
  if (r.segs.length >= 3 && first === opposite[last]) {
    // A C: out one side, along a channel, back into the same-facing side of a box stacked in
    // line with the source. The boxes share the exit axis' span, so the line never doubles back.
    const axis = 'RL'.includes(first) ? 'x' : 'y';
    if (!spansMeet(s, t, axis)) return 'doubles back';
  }
  return '';
}

// ---------- empty area ----------
/**
 * The largest empty rectangle inside a frame, among obstacle rectangles: for each pair of
 * x-coordinates, the longest free run in y between the obstacles that span it.
 */
function largestEmpty(frame, obstacles, minSide = 0) {
  const xs = [
    ...new Set(
      [frame.x, frame.x + frame.w, ...obstacles.flatMap(o => [o.x, o.x + o.w])]
        .map(v => Math.min(frame.x + frame.w, Math.max(frame.x, v)))
        .map(Math.round),
    ),
  ].sort((a, b) => a - b);
  let best = { x: frame.x, y: frame.y, w: 0, h: 0 };
  for (let i = 0; i < xs.length; i++) {
    for (let j = i + 1; j < xs.length; j++) {
      const x0 = xs[i],
        x1 = xs[j];
      const block = obstacles
        .filter(o => Math.min(o.x + o.w, x1) - Math.max(o.x, x0) > EPS)
        .map(o => [o.y, o.y + o.h])
        .sort((a, b) => a[0] - b[0]);
      let reach = frame.y;
      const consider = (from, to) => {
        if (to - from >= minSide && x1 - x0 >= minSide && (to - from) * (x1 - x0) > best.w * best.h)
          best = { x: x0, y: from, w: x1 - x0, h: to - from };
      };
      for (const [y0, y1] of block) {
        if (y0 > reach) consider(reach, y0);
        reach = Math.max(reach, y1);
      }
      consider(reach, frame.y + frame.h);
    }
  }
  return best;
}

// ---------- group packing ----------
/** Below this share of its interior covered by members, a group reads as mostly empty. */
const MIN_GROUP_FILL = 0.35;
/** Sibling groups (or a group and a sibling box) closer than this read as pressed together. */
const MIN_GROUP_GAP = 16;
/** Facing gaps between groups in one drawing that differ by more than this read as uneven. */
const GROUP_GAP_SPREAD = 16;
/** A step this large on both axes is diagonal, not aligned. */
const STEP = 16;

/**
 * Group fill, staircases and the gaps between sibling groups. Returns the issues plus the raw
 * numbers (each group's fill, the facing gaps) for `metrics.json`.
 */
function groupPacking(nodes, routes, byId) {
  const issues = [];
  const kids = new Map();
  for (const n of nodes) (kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)).push(n);
  const isGroup = id => kids.has(id);
  const fills = {};

  // Fill: member area over the area the members span (the group's interior, since groups fit
  // their content). Two boxes at opposite ends of a wide frame score low.
  for (const [id, list] of kids) {
    if (id === 'root' || list.length < 2) continue;
    const x0 = Math.min(...list.map(k => k.x)),
      y0 = Math.min(...list.map(k => k.y)),
      x1 = Math.max(...list.map(k => k.x + k.w)),
      y1 = Math.max(...list.map(k => k.y + k.h));
    const fill = list.reduce((s, k) => s + k.w * k.h, 0) / Math.max(1, (x1 - x0) * (y1 - y0));
    fills[id] = +fill.toFixed(2);
    if (fill < MIN_GROUP_FILL) issues.push(['sparse-group', `${id} fill ${fills[id]}`]);
  }

  // Staircase: inside a group, a chain link (a member with one way on to a sibling that has one
  // way in, through any descendants) whose ends sit diagonally: a chain should read as a straight
  // row or column. A fan out of one member may spread diagonally; that is not counted. In any
  // scope, three or more sibling groups whose centres step monotonically on both axes are a
  // staircase too. (A chain of plain boxes at the root may bend through a layered drawing.)
  const sibling = (id, scope) => {
    let n = byId.get(id);
    while (n && n.parent !== scope) n = byId.get(n.parent);
    return n?.id;
  };
  // Two boxes line up on an axis when their starts, centres or ends agree (a row may align tops).
  const lined = (m, n, axis, size) =>
    [0, 0.5, 1].some(f => Math.abs(m[axis] + f * m[size] - (n[axis] + f * n[size])) <= 4);
  const step = (a, b) => {
    const m = byId.get(a),
      n = byId.get(b);
    const dx = center(n).x - center(m).x,
      dy = center(n).y - center(m).y;
    const diagonal =
      Math.abs(dx) > STEP &&
      Math.abs(dy) > STEP &&
      !lined(m, n, 'x', 'w') &&
      !lined(m, n, 'y', 'h');
    return diagonal ? `${Math.sign(dx)},${Math.sign(dy)}` : '';
  };
  for (const [scope, list] of kids) {
    const next = new Map(),
      prev = new Map();
    for (const r of routes) {
      const a = sibling(r.source, scope),
        b = sibling(r.target, scope);
      if (!a || !b || a === b) continue;
      (next.get(a) ?? next.set(a, new Set()).get(a)).add(b);
      (prev.get(b) ?? prev.set(b, new Set()).get(b)).add(a);
    }
    let links = 0;
    if (scope !== 'root')
      for (const [a, outs] of next)
        for (const b of outs)
          if (outs.size === 1 && prev.get(b).size === 1 && step(a, b)) {
            links++;
            issues.push(['group-staircase', `${scope}: ${a} → ${b} sit diagonally`]);
          }
    const frames = list.filter(n => isGroup(n.id)).sort((p, q) => center(p).x - center(q).x);
    if (frames.length >= 3 && !links) {
      const steps = frames.slice(1).map((g, i) => step(frames[i].id, g.id));
      if (steps.every(s => s && s === steps[0]))
        issues.push([
          'group-staircase',
          `${scope}: groups ${frames.map(g => g.id).join(', ')} step diagonally`,
        ]);
    }
  }

  // Gaps: for each group, the nearest sibling straight across on each side (projections
  // overlapping). Too small is pressed together; group-to-group gaps that vary a lot across one
  // drawing are uneven.
  const gaps = new Map();
  for (const [, list] of kids) {
    for (const g of list.filter(n => isGroup(n.id))) {
      for (const axis of ['x', 'y']) {
        const [size, other, otherSize] = axis === 'x' ? ['w', 'y', 'h'] : ['h', 'x', 'w'];
        for (const side of [-1, 1]) {
          let best;
          for (const n of list) {
            if (n === g) continue;
            const overlap =
              Math.min(g[other] + g[otherSize], n[other] + n[otherSize]) -
              Math.max(g[other], n[other]);
            if (overlap <= EPS) continue;
            const gap = side > 0 ? n[axis] - (g[axis] + g[size]) : g[axis] - (n[axis] + n[size]);
            if (gap < -EPS) continue;
            if (!best || gap < best.gap) best = { n, gap };
          }
          if (!best) continue;
          const key = [g.id, best.n.id].sort().join(' | ');
          gaps.set(key, { gap: Math.round(best.gap), groups: isGroup(best.n.id) });
        }
      }
    }
  }
  for (const [key, { gap }] of gaps)
    if (gap < MIN_GROUP_GAP) issues.push(['tight-group-gap', `${key} ${gap}px apart`]);
  const between = [...gaps.values()].filter(g => g.groups && g.gap <= 160).map(g => g.gap);
  if (between.length > 1 && Math.max(...between) - Math.min(...between) > GROUP_GAP_SPREAD)
    issues.push([
      'uneven-group-gap',
      `gaps between groups run ${Math.min(...between)}–${Math.max(...between)}px`,
    ]);
  return {
    issues,
    fills,
    gaps: Object.fromEntries([...gaps].map(([k, v]) => [k, v.gap])),
  };
}

// ---------- metrics for one file ----------
function measure(file) {
  const source = fs.readFileSync(file, 'utf8');
  const check = run('check', file);
  const warnings = check.out.split('\n').filter(l => /warning/i.test(l));
  if (!check.ok) return { file, error: check.out.trim() };
  const geo = JSON.parse(run('inspect', file).out);
  const svg = run('inspect', file, '--svg').out;
  const { edges, diamonds, direction, edgeGap } = parseSource(source);

  const byId = new Map(geo.nodes.map(n => [n.id, n]));
  const parents = new Set(geo.nodes.map(n => n.parent));
  const leaves = geo.nodes.filter(n => !parents.has(n.id));
  const groups = geo.nodes.filter(n => parents.has(n.id));
  const ancestors = id => {
    const out = [];
    for (let n = byId.get(id); n && n.parent !== 'root'; n = byId.get(n.parent)) out.push(n.parent);
    return out;
  };

  const issues = [];
  const note = (kind, detail) => issues.push({ kind, detail });

  // Node overlaps: leaves, and sibling groups.
  for (let i = 0; i < geo.nodes.length; i++) {
    for (let j = i + 1; j < geo.nodes.length; j++) {
      const a = geo.nodes[i],
        b = geo.nodes[j];
      if (ancestors(a.id).includes(b.id) || ancestors(b.id).includes(a.id)) continue;
      if (rectsOverlap(a, b)) note('node-overlap', `${a.id} × ${b.id}`);
    }
  }

  const routes = geo.routes.map(r => ({ ...r, ...(edges.get(r.id) ?? {}), segs: segs(r.points) }));
  let bends = 0,
    maxBends = 0,
    hooks = 0,
    totalLen = 0;
  for (const r of routes) {
    const b = Math.max(0, r.points.length - 2);
    bends += b;
    maxBends = Math.max(maxBends, b);
    totalLen += r.segs.reduce((s, sg) => s + len(sg), 0);
    if (b >= 4) note('many-bends', `${r.id} (${b})`);
    // Edge through an unrelated leaf.
    for (const n of leaves) {
      if (n.id === r.source || n.id === r.target) continue;
      if (r.segs.some(sg => segHitsRect(sg, shrink(n, 2))))
        note('edge-through-node', `${r.id} through ${n.id}`);
    }
    // Through a group's title band, other than straight into or out of a member's top: the
    // band holds the title, and a line through it reads as crossing the frame. Since round 5
    // (decision 3, `DETOUR_RATIO`) a line to or from a member may also cross the band straight
    // across, beside the title text, where going round the group would be much longer: that
    // crossing reads as entering the frame, so it doesn't count either.
    for (const g of groups) {
      const band = { x: g.x + 2, y: g.y + 2, w: g.w - 4, h: 28 };
      const member = id => id === g.id || ancestors(id).includes(g.id);
      const title = groupTitleInk(svg, g);
      const inner = r.segs.filter((sg, k) => {
        const upright = Math.abs(sg[0].x - sg[1].x) < EPS;
        const terminal = (k === 0 || k === r.segs.length - 1) && upright;
        const across =
          upright &&
          (member(r.source) || member(r.target)) &&
          Math.min(sg[0].y, sg[1].y) <= g.y + EPS &&
          Math.max(sg[0].y, sg[1].y) >= band.y + band.h - EPS &&
          !segHitsRect(sg, title);
        return !terminal && !across && segHitsRect(sg, band);
      });
      if (inner.length) note('edge-through-title-band', `${r.id} through ${g.id}'s title band`);
    }
    // Arrives from below: the last run climbs into the target's bottom although the source does
    // not sit below the target. Reads as backwards (viewer feedback 2026-10-23, R1).
    {
      const [a, b] = r.points.slice(-2),
        src = byId.get(r.source),
        dst = byId.get(r.target);
      if (
        a &&
        b &&
        src &&
        dst &&
        Math.abs(a.x - b.x) < EPS &&
        a.y > b.y + EPS &&
        src.y + src.h / 2 < dst.y + dst.h
      )
        note('arrives-below', `${r.id} into ${r.target}`);
    }
    // Edge through a group that holds neither endpoint.
    for (const g of groups) {
      const holds = id => id === g.id || ancestors(id).includes(g.id);
      if (holds(r.source) || holds(r.target)) continue;
      if (r.segs.some(sg => segHitsRect(sg, shrink(g, 4))))
        note('edge-through-group', `${r.id} through ${g.id}`);
    }
  }

  // Clearance: a line running alongside a box, a group border or another line, close enough that
  // a reader can't tell which is which. Only parallel runs count; crossing a border is fine.
  const sides = r => [
    { axis: 'v', at: r.x, from: r.y, to: r.y + r.h, out: -1 },
    { axis: 'v', at: r.x + r.w, from: r.y, to: r.y + r.h, out: 1 },
    { axis: 'h', at: r.y, from: r.x, to: r.x + r.w, out: -1 },
    { axis: 'h', at: r.y + r.h, from: r.x, to: r.x + r.w, out: 1 },
  ];
  const straight = ([a, b]) =>
    Math.abs(a.x - b.x) < EPS
      ? { axis: 'v', at: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) }
      : Math.abs(a.y - b.y) < EPS
        ? { axis: 'h', at: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) }
        : null;
  const alongside = (s, t) =>
    s.axis === t.axis ? Math.min(s.to, t.to) - Math.max(s.from, t.from) : 0;
  for (const r of routes) {
    const runs = r.segs.map(straight).filter(Boolean);
    for (const n of leaves) {
      const close = runs.some(s =>
        sides(n).some(side => {
          const d = (s.at - side.at) * side.out;
          return d > EPS && d < 15 && alongside(s, side) > 16;
        }),
      );
      if (close) note('edge-hugs-node', `${r.id} along ${n.id}`);
    }
    for (const g of groups) {
      const gap = s =>
        Math.min(
          ...sides(g)
            .filter(side => alongside(s, side) > 20)
            .map(side => Math.abs(s.at - side.at)),
        );
      const nearest = Math.min(...runs.map(gap));
      if (nearest < 8) note('edge-on-group-border', `${r.id} along ${g.id}`);
      // 8–15px inside or outside the border: the line rides it, as close as a hug on a box.
      else if (nearest < 15)
        note('edge-near-group-border', `${r.id} ${Math.round(nearest)}px from ${g.id}`);
    }
    // In a slot: inside a group, between one of its members and its border, close to both (the
    // inset a group leaves round its members is no channel).
    for (const g of groups) {
      const members = leaves.filter(n => ancestors(n.id).includes(g.id));
      const slot = runs.find(s => {
        if (s.to - s.from <= 20) return false;
        const [lo, hi] = s.axis === 'v' ? [g.x, g.x + g.w] : [g.y, g.y + g.h];
        if (s.at <= lo + EPS || s.at >= hi - EPS) return false;
        const [from, to] = s.axis === 'v' ? [g.y, g.y + g.h] : [g.x, g.x + g.w];
        if (s.from < from - EPS || s.to > to + EPS) return false;
        return sides(g).some(border => {
          if (border.axis !== s.axis) return false;
          const toBorder = (border.at - s.at) * border.out;
          if (toBorder <= 0 || toBorder >= 24) return false;
          // A member side facing the border, on the run's other side and close to it.
          return members.some(n =>
            sides(n).some(side => {
              if (side.axis !== s.axis || side.out !== border.out) return false;
              const d = (s.at - side.at) * side.out;
              return d > EPS && d < 24 && alongside(s, side) > 16;
            }),
          );
        });
      });
      if (slot) note('edge-in-slot', `${r.id} between ${g.id}'s members and its border`);
    }
  }
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i].segs.map(straight).filter(Boolean),
        b = routes[j].segs.map(straight).filter(Boolean);
      const close = a.some(s =>
        b.some(t => {
          const d = Math.abs(s.at - t.at);
          return d >= 2 && d < 10 && alongside(s, t) > 20;
        }),
      );
      if (close) note('edges-too-close', `${routes[i].id} & ${routes[j].id}`);
    }
  }

  // Orderliness: does routing look drawn on purpose? Lines sharing a corridor should keep one
  // pitch, edges fanning out of (or into) one side should turn at the same place, ports on a
  // side should be spread evenly, and no edge should carry a tiny zigzag.
  const allRuns = routes.flatMap(r =>
    r.segs
      .map(straight)
      .filter(s => s && s.to - s.from > 12)
      .map(s => ({ ...s, edge: r.id })),
  );
  for (const axis of ['h', 'v']) {
    const runs = allRuns.filter(s => s.axis === axis).sort((a, b) => a.at - b.at);
    const seen = new Set();
    for (const seed of runs) {
      if (seen.has(seed)) continue;
      const corridor = [seed];
      seen.add(seed);
      for (let k = 0; k < corridor.length; k++) {
        for (const s of runs) {
          if (seen.has(s) || s.edge === corridor[k].edge) continue;
          if (Math.abs(s.at - corridor[k].at) <= 40 && alongside(s, corridor[k]) > 0) {
            corridor.push(s);
            seen.add(s);
          }
        }
      }
      const lines = [...new Set(corridor.map(s => Math.round(s.at)))].sort((a, b) => a - b);
      if (lines.length < 3) continue;
      const gaps = lines.slice(1).map((v, i) => v - lines[i]);
      if (
        Math.max(...gaps) > 1.6 * Math.min(...gaps) &&
        Math.max(...gaps) - Math.min(...gaps) > 6
      ) {
        note('uneven-channel', `${axis === 'v' ? 'x' : 'y'}≈${lines[0]}: gaps ${gaps.join('/')}`);
      }
    }
  }
  const fans = new Map();
  for (const r of routes) {
    if (r.segs.length < 3) continue;
    const first = r.segs[0],
      last = r.segs.at(-1);
    const out = `${r.source}|out|${dir(first)}`,
      into = `${r.target}|in|${dir(last)}`;
    const firstTurn = 'RL'.includes(dir(first)) ? first[1].x : first[1].y;
    const lastTurn = 'RL'.includes(dir(last)) ? last[0].x : last[0].y;
    (fans.get(out) ?? fans.set(out, []).get(out)).push(firstTurn);
    (fans.get(into) ?? fans.set(into, []).get(into)).push(lastTurn);
  }
  // A bundle into (or out of) one side, each line turning one edge gap past the last, is the
  // stagger a draftsman uses; only other spreads are ragged.
  const staggered = turns => {
    const at = [...new Set(turns.map(Math.round))].sort((a, b) => a - b);
    return at.slice(1).every((t, i) => Math.abs(t - at[i] - edgeGap) <= 2);
  };
  for (const [key, turns] of fans) {
    const distinct = [...new Set(turns.map(t => Math.round(t / 3)))];
    if (turns.length >= 2 && distinct.length > 1 && !staggered(turns)) {
      note(
        'ragged-bends',
        `${key.replace(/\|/g, ' ')}: turns at ${turns.map(Math.round).join(', ')}`,
      );
    }
  }
  const ports = new Map();
  for (const r of routes) {
    for (const [id, p] of [
      [r.source, r.points[0]],
      [r.target, r.points.at(-1)],
    ]) {
      const n = byId.get(id);
      if (!n || !p) continue;
      const side =
        Math.abs(p.x - n.x) < 2
          ? 'left'
          : Math.abs(p.x - n.x - n.w) < 2
            ? 'right'
            : Math.abs(p.y - n.y) < 2
              ? 'top'
              : Math.abs(p.y - n.y - n.h) < 2
                ? 'bottom'
                : null;
      // A port on a diamond's slanted face is on no side of the box.
      if (!side) continue;
      const along = side === 'left' || side === 'right' ? p.y - n.y : p.x - n.x;
      const key = `${id}|${side}`;
      (ports.get(key) ?? ports.set(key, []).get(key)).push(along);
    }
  }
  for (const [key, list] of ports) {
    const [id, side] = key.split('|');
    const n = byId.get(id);
    const span = side === 'left' || side === 'right' ? n.h : n.w;
    const at = [...new Set(list.map(Math.round))].sort((a, b) => a - b);
    if (at.length < 2) continue;
    // Ports bunched around the middle are a deliberate style; lopsided ones are not.
    const offset = at.reduce((t, p) => t + p, 0) / at.length - span / 2;
    if (Math.abs(offset) > Math.max(8, span * 0.1)) {
      note('uneven-ports', `${id} ${side}: ${at.join(', ')} of ${Math.round(span)}`);
    }
  }
  for (const r of routes) {
    const inner = r.segs.slice(1, -1);
    if (inner.some(sg => len(sg) > 0 && len(sg) < 12))
      note('jog', `${r.id} has a ${Math.round(Math.min(...inner.map(len)))}px step`);
  }

  // Container fit: a group should wrap its contents with the same padding on every side, and
  // every group in a drawing should use the same padding. The top holds the title, so it is
  // compared across groups rather than with the other sides.
  const pads = [];
  for (const g of groups) {
    const kids = geo.nodes.filter(n => n.parent === g.id);
    if (!kids.length) continue;
    const x0 = Math.min(...kids.map(k => k.x)),
      y0 = Math.min(...kids.map(k => k.y)),
      x1 = Math.max(...kids.map(k => k.x + k.w)),
      y1 = Math.max(...kids.map(k => k.y + k.h));
    const pad = {
      id: g.id,
      left: Math.round(x0 - g.x),
      right: Math.round(g.x + g.w - x1),
      top: Math.round(y0 - g.y),
      bottom: Math.round(g.y + g.h - y1),
    };
    // A side whose padding carries a line running along it is a routing channel, not padding.
    const strips = {
      left: { axis: 'v', lo: g.x, hi: x0, from: g.y, to: g.y + g.h },
      right: { axis: 'v', lo: x1, hi: g.x + g.w, from: g.y, to: g.y + g.h },
      top: { axis: 'h', lo: g.y + 32, hi: y0, from: g.x, to: g.x + g.w },
      bottom: { axis: 'h', lo: y1, hi: g.y + g.h, from: g.x, to: g.x + g.w },
    };
    pad.channel = {};
    for (const [side, st] of Object.entries(strips))
      pad.channel[side] = routes.some(r =>
        r.segs
          .map(straight)
          .some(
            sg =>
              sg &&
              sg.axis === st.axis &&
              sg.at > st.lo + EPS &&
              sg.at < st.hi - EPS &&
              Math.min(sg.to, st.to) - Math.max(sg.from, st.from) > 20,
          ),
      );
    pads.push(pad);
    const sides3 = ['left', 'right', 'bottom']
      .filter(side => !pad.channel[side] || pad[side] <= 24)
      .map(side => pad[side]);
    if (sides3.length && Math.max(...sides3) - Math.min(...sides3) > 12) {
      note('uneven-padding', `${g.id} left ${pad.left}, right ${pad.right}, bottom ${pad.bottom}`);
    }
  }
  for (const side of ['left', 'top']) {
    const values = pads.filter(p => !p.channel[side]).map(p => p[side]);
    if (values.length > 1 && Math.max(...values) - Math.min(...values) > 8) {
      note(
        'padding-varies',
        `${side} padding ${Math.min(...values)}–${Math.max(...values)} across groups`,
      );
    }
  }

  // Group packing: how members sit inside a group, and how sibling groups sit beside each other.
  const packing = groupPacking(geo.nodes, routes, byId);
  for (const [kind, detail] of packing.issues) note(kind, detail);

  // Crossings and unrelated shared segments.
  let crossings = 0;
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      const a = routes[i],
        b = routes[j];
      const related =
        a.source === b.source ||
        a.target === b.target ||
        a.source === b.target ||
        a.target === b.source;
      let overlap = 0;
      for (const s of a.segs) {
        for (const t of b.segs) {
          if (segsCross(s, t)) crossings++;
          overlap += collinearOverlap(s, t);
        }
      }
      if (overlap > 12 && !related)
        note('shared-segment', `${a.id} & ${b.id} (${Math.round(overlap)}px)`);
    }
  }

  // Edges against the reading direction.
  const flowDir =
    direction ??
    (() => {
      let h = 0,
        v = 0;
      for (const r of routes) {
        const s = byId.get(r.source),
          t = byId.get(r.target);
        if (!s || !t) continue;
        h += Math.abs(center(t).x - center(s).x);
        v += Math.abs(center(t).y - center(s).y);
      }
      return h >= v ? 'right' : 'down';
    })();
  // A folded flow wraps onto the next row (or column): an edge into a later row runs back along
  // the axis but forward in reading order, as `reads-x` reads it, so it is not a back edge.
  let backEdges = 0;
  const flowArrow = flowDir === 'right' ? 'R' : 'D';
  for (const r of routes) {
    const s = byId.get(r.source),
      t = byId.get(r.target);
    if (!s || !t) continue;
    const d = flowDir === 'right' ? center(t).x - center(s).x : center(t).y - center(s).y;
    const wraps = flowDir === 'right' ? t.y >= s.y + s.h - EPS : t.x >= s.x + s.w - EPS;
    r.wrap = d < -20 && wraps;
    r.back = d < -20 && !wraps;
    if (r.back) backEdges++;
    // Hook: a U-turn. Either the line leaves one way and comes back the opposite way into a box
    // that doesn't share its exit's span (a C down a channel into the facing side of a box in
    // the same column or row reads as drafted), or it overshoots: it arrives in the target's far
    // side, travelling back toward the source. A fold's wrap into the next row's leading side, or a
    // return lane into the leading side of an earlier box, arrives along the reading direction and
    // is the accepted shape.
    const hook = hookOf(r, s, t);
    if (hook && !((r.wrap || r.back) && dir(r.segs.at(-1)) === flowArrow)) {
      hooks++;
      note('hook', `${r.id} ${r.source}→${r.target} ${hook}`);
    }
    // Off-axis port: in a layout with a declared direction, a forward edge should arrive travelling
    // that way (into a child's top in a downward tree) and never leave against it. A side entry
    // reads as a sibling link.
    if (direction && d > 20 && r.segs.length) {
      if (dir(r.segs.at(-1)) !== flowArrow)
        note('off-axis-port', `${r.id} ${r.source}→${r.target} arrives sideways`);
      else if (dir(r.segs[0]) === opposite[flowArrow])
        note('off-axis-port', `${r.id} ${r.source}→${r.target} leaves backwards`);
    }
  }
  // Diamonds: a line meets a decision at one of its four vertices, travelling straight out of
  // (or into) it. A port on a slanted face, or a line that leaves a vertex sideways, reads as
  // missing the shape's point.
  for (const r of routes) {
    if (!r.segs.length) continue;
    for (const [id, p, sg, end] of [
      [r.source, r.points[0], r.segs[0], 'leaves'],
      [r.target, r.points.at(-1), r.segs.at(-1), 'enters'],
    ]) {
      if (!diamonds.has(id)) continue;
      const n = byId.get(id);
      if (!n) continue;
      const c = center(n);
      const vertex = [
        ['top', c.x, n.y, 'U'],
        ['bottom', c.x, n.y + n.h, 'D'],
        ['left', n.x, c.y, 'L'],
        ['right', n.x + n.w, c.y, 'R'],
      ].find(([, x, y]) => Math.hypot(p.x - x, p.y - y) <= 3);
      const travel = end === 'leaves' ? dir(sg) : opposite[dir(sg)];
      if (!vertex) note('off-axis-port', `${r.id} ${end} diamond ${id} off its vertices`);
      else if (travel !== vertex[3])
        note('off-axis-port', `${r.id} ${end} diamond ${id}'s ${vertex[0]} vertex sideways`);
    }
  }

  // Labels.
  const labels = parseLabels(svg);
  for (const [i, l] of labels.entries()) {
    for (const n of leaves)
      if (rectsOverlap(l, n)) note('label-on-node', `"${l.text}" on ${n.id}`);
      // Pressed against a box without touching it: hard to read as the line's (feedback R5).
      else if (rectsOverlap(l, { x: n.x - 6, y: n.y - 6, w: n.w + 12, h: n.h + 12 }))
        note('label-near-node', `"${l.text}" by ${n.id}`);
    for (const g of groups) {
      const header = { x: g.x, y: g.y, w: g.w, h: 32 };
      if (rectsOverlap(l, header)) note('label-on-group-title', `"${l.text}" on ${g.id}`);
      const edgesCut = [
        { x: g.x - 1, y: g.y, w: 2, h: g.h },
        { x: g.x + g.w - 1, y: g.y, w: 2, h: g.h },
        { x: g.x, y: g.y - 1, w: g.w, h: 2 },
        { x: g.x, y: g.y + g.h - 1, w: g.w, h: 2 },
      ];
      if (edgesCut.some(c => rectsOverlap(l, c)))
        note('label-on-group-border', `"${l.text}" on ${g.id}`);
    }
    for (const m of labels.slice(i + 1)) {
      if (rectsOverlap(l, m)) {
        note('label-overlap', `"${l.text}" × "${m.text}"`);
        continue;
      }
      // Two labels on different edges closer than a label's height read as one phrase, or as
      // two labels on one edge.
      const gap = Math.max(
        m.x - (l.x + l.w),
        l.x - (m.x + m.w),
        m.y - (l.y + l.h),
        l.y - (m.y + m.h),
      );
      if (gap < Math.min(l.h, m.h))
        note('labels-too-close', `"${l.text}" & "${m.text}" ${Math.round(gap)}px apart`);
    }
    // Detached: the label's box stands more than half its height clear of its own line. (Measured
    // from the box, not its centre, so a wide label crossed off-centre by an upright line counts
    // as on it; for a label beside a level line the two measures agree.)
    const dist = Math.min(...segs(l.path).map(sg => rectSegDist(l, sg)));
    if (dist > l.h / 2) note('label-detached', `"${l.text}" ${Math.round(dist)}px from its edge`);
    // Beside its line: clear of it, though near. Labels read as one set when every line runs
    // through its own (FEEL.md), so one that steps aside is a mild defect.
    else if (dist > 0.5)
      note('label-beside-line', `"${l.text}" ${Math.round(dist)}px off its edge`);
    // Another edge running under the label.
    for (const r of routes) {
      if (r.id === l.edge) continue;
      if (
        r.points[0] &&
        l.path[0] &&
        Math.abs(r.points[0].x - l.path[0].x) < 1 &&
        Math.abs(r.points[0].y - l.path[0].y) < 1
      )
        continue;
      // Through the text itself is misleading (S1); under the padding only, a reader still
      // reads the label but the line seems to stop at it.
      if (r.segs.some(sg => segHitsRect(sg, shrink(l.ink, 1))))
        note('label-through-text', `${r.id} through the "${l.text}" text`);
      else if (r.segs.some(sg => segHitsRect(sg, shrink(l, 1))))
        note('label-on-edge', `"${l.text}" over ${r.id}`);
    }
  }

  // Titles that wrap inside a word: a break with no space in the source label, and not where an
  // identifier's pieces meet (after / . _ - : or at a camelCase capital), as `annotationCommand /
  // s`, or that leave one or two characters after a break inside a word, as `installed / ?`.
  const titles = [...source.matchAll(/^\s*(?:node|group)\s+\S+\s+"([^"]*)"/gm)].map(m => m[1]);
  const decode = t =>
    t
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  for (const m of svg.matchAll(/<text[^>]*>((?:<tspan[^>]*>[^<]*<\/tspan>){2,})<\/text>/g)) {
    const parts = [...m[1].matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map(t => decode(t[1]));
    const squash = t => t.replace(/\s+/g, '');
    const title = titles.find(t => squash(t) === squash(parts.join('')));
    if (!title) continue;
    let at = 0;
    for (const [i, part] of parts.slice(0, -1).entries()) {
      // Walk the title past this line's characters, skipping spaces, to the break.
      for (const ch of squash(part)) {
        while (/\s/.test(title[at] ?? '')) at++;
        if (title[at] === ch) at++;
      }
      const before = title[at - 1] ?? '',
        after = title[at] ?? '';
      const boundary =
        /\s/.test(after) ||
        /[/._:-]/.test(before) ||
        (/[a-z0-9]/.test(before) && /[A-Z]/.test(after));
      // A short word wrapped at a space ("Analyzer counts / it") is a widow, not a broken word.
      if (!boundary || (!/\s/.test(after) && parts[i + 1].trim().length <= 2))
        note('mid-word-wrap', `"${parts[i]} / ${parts[i + 1]}"`);
    }
  }

  // Dead space: wide empty bands across the drawing, and edges far longer than the rest.
  for (const axis of ['x', 'y']) {
    const size = axis === 'x' ? 'w' : 'h';
    const spans = geo.nodes.map(n => [n[axis], n[axis] + n[size]]).sort((a, b) => a[0] - b[0]);
    let reach = spans[0]?.[1] ?? 0;
    for (const [start, end] of spans.slice(1)) {
      if (start - reach > 120)
        note(
          'empty-band',
          `${axis === 'x' ? 'column' : 'row'} ${Math.round(start - reach)}px at ${axis}=${Math.round(reach)}`,
        );
      reach = Math.max(reach, end);
    }
  }
  // Long edges: a forward line far longer than the straight way between its ends (a detour), or
  // one that spans most of the drawing (its ends were placed far apart).
  const lengths = routes.map(r => r.segs.reduce((sum, sg) => sum + len(sg), 0));
  const xs0 = geo.nodes.flatMap(n => [n.x, n.x + n.w]),
    ys0 = geo.nodes.flatMap(n => [n.y, n.y + n.h]);
  const diagonal = Math.hypot(
    Math.max(...xs0) - Math.min(...xs0),
    Math.max(...ys0) - Math.min(...ys0),
  );
  const stretch = [];
  for (const [i, r] of routes.entries()) {
    if (lengths[i] <= LONG_EDGE_MIN) continue;
    const s = byId.get(r.source),
      t = byId.get(r.target);
    if (!s || !t) continue;
    // The straight way: the gap between the two boxes along each axis.
    const direct =
      Math.max(0, Math.abs(center(t).x - center(s).x) - (s.w + t.w) / 2) +
      Math.max(0, Math.abs(center(t).y - center(s).y) - (s.h + t.h) / 2);
    const detour = lengths[i] / Math.max(1, direct),
      span = lengths[i] / Math.max(1, diagonal);
    stretch.push({
      id: r.id,
      kind: r.back ? 'back' : r.wrap ? 'wrap' : 'forward',
      length: Math.round(lengths[i]),
      detour: +detour.toFixed(2),
      span: +span.toFixed(2),
    });
    // A return in a cycle, or a fold's wrap onto the next row, is long by nature: it counts
    // only when it runs longer than the drawing's diagonal.
    if (r.back || r.wrap) {
      if (span > 1)
        note(
          'long-edge',
          `${r.id} ${Math.round(lengths[i])}px ${r.back ? 'return' : 'wrap'}, longer than the diagonal`,
        );
      continue;
    }
    if (detour > LONG_EDGE_DETOUR)
      note(
        'long-edge',
        `${r.id} ${Math.round(lengths[i])}px, ${detour.toFixed(1)}× the direct way`,
      );
    else if (span > LONG_EDGE_SPAN)
      note('long-edge', `${r.id} ${Math.round(lengths[i])}px, ${span.toFixed(2)} of the diagonal`);
  }

  // Empty area: the largest empty rectangle inside the drawing (between the boxes and the edge
  // labels; a group frame with nothing in it is still empty), as a share of the drawing's area.
  // A quarter left empty reads as a layout that lost its shape. Natural corners of a small flow
  // are not counted: the hole must also have room for EMPTY_BOXES of the drawing's boxes. A
  // thin band across the drawing is `empty-band`.
  const rootFrame = {
    x: Math.min(...xs0),
    y: Math.min(...ys0),
    w: Math.max(...xs0) - Math.min(...xs0),
    h: Math.max(...ys0) - Math.min(...ys0),
  };
  const leafArea0 = leaves.reduce((s, n) => s + n.w * n.h, 0);
  const hole = largestEmpty(rootFrame, [...leaves, ...labels], EMPTY_SIDE);
  const emptyShare = (hole.w * hole.h) / Math.max(1, rootFrame.w * rootFrame.h);
  const emptyBoxes = (hole.w * hole.h) / Math.max(1, leafArea0 / Math.max(1, leaves.length));
  if (emptyShare > EMPTY_AREA && emptyBoxes >= EMPTY_BOXES)
    note(
      'empty-area',
      `${Math.round(hole.w)}×${Math.round(hole.h)}px at ${Math.round(hole.x)},${Math.round(hole.y)} (${Math.round(emptyShare * 100)}% of the drawing, room for ${Math.round(emptyBoxes)} boxes)`,
    );

  // Anything drawn outside the SVG's viewBox is cut off in every export.
  const vb = svg
    .match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/)
    ?.slice(1)
    .map(Number);
  if (vb) {
    const frame = { x: vb[0], y: vb[1], w: vb[2], h: vb[3] };
    const out = p =>
      p.x < frame.x || p.y < frame.y || p.x > frame.x + frame.w || p.y > frame.y + frame.h;
    for (const r of routes) if (r.points.some(out)) note('clipped', `edge ${r.id}`);
    for (const l of labels) {
      if (out({ x: l.x, y: l.y }) || out({ x: l.x + l.w, y: l.y + l.h }))
        note('clipped', `label "${l.text}"`);
    }
  }

  // Color: text must read on its fill (4.5:1), connections on the canvas (3:1).
  const colors = parseColors(svg);
  for (const p of colors.pairs)
    if (p.ratio < 4.5) note('low-contrast', `"${p.text}" ${p.ink} on ${p.fill} (${p.ratio})`);
  if (colors.connectionContrast !== undefined && colors.connectionContrast < 3) {
    note('low-contrast', `connections on canvas (${colors.connectionContrast})`);
  }

  // Shape of the whole drawing.
  const xs = geo.nodes.flatMap(n => [n.x, n.x + n.w]),
    ys = geo.nodes.flatMap(n => [n.y, n.y + n.h]);
  const width = Math.max(...xs) - Math.min(...xs),
    height = Math.max(...ys) - Math.min(...ys);
  const leafArea = leaves.reduce((s, n) => s + n.w * n.h, 0);
  const aspect = width / Math.max(1, height);
  if (aspect > MAX_ASPECT || aspect < 1 / MAX_ASPECT)
    note(
      'wide-aspect',
      `${width}×${height}px (${aspect >= 1 ? aspect.toFixed(1) : (1 / aspect).toFixed(1)}:1)`,
    );
  const aligned = leaves.filter(a =>
    leaves.some(
      b =>
        b !== a &&
        (Math.abs(center(a).x - center(b).x) < 2 || Math.abs(center(a).y - center(b).y) < 2),
    ),
  ).length;

  const count = kind => issues.filter(i => i.kind === kind).length;
  const counts = Object.fromEntries(
    [
      'node-overlap',
      'edge-through-node',
      'label-on-node',
      'label-near-node',
      'label-overlap',
      'label-on-edge',
      'label-on-group-title',
      'label-on-group-border',
      'label-detached',
      'hook',
      'arrives-below',
      'shared-segment',
      'edge-through-group',
      'edge-through-title-band',
      'many-bends',
      'low-contrast',
      'clipped',
      'empty-band',
      'long-edge',
      'expectation-failed',
      'edge-hugs-node',
      'edge-on-group-border',
      'edge-near-group-border',
      'edge-in-slot',
      'edges-too-close',
      'uneven-channel',
      'ragged-bends',
      'uneven-ports',
      'off-axis-port',
      'jog',
      'uneven-padding',
      'padding-varies',
      'mid-word-wrap',
      'sparse-group',
      'group-staircase',
      'tight-group-gap',
      'uneven-group-gap',
      'label-through-text',
      'labels-too-close',
      'label-beside-line',
      'empty-area',
      'wide-aspect',
    ].map(k => [k, count(k)]),
  );
  // Weighted defect index; hard defects dominate. Normalized per 10 edges so sizes compare.
  const weights = {
    'node-overlap': 10,
    'edge-through-node': 8,
    'label-on-node': 6,
    'label-near-node': 1,
    'label-overlap': 6,
    'label-on-edge': 3,
    'label-on-group-title': 3,
    'label-on-group-border': 1,
    'label-detached': 3,
    hook: 3,
    'arrives-below': 2,
    'shared-segment': 3,
    'edge-through-group': 2,
    'edge-through-title-band': 2,
    'many-bends': 1,
    'low-contrast': 2,
    clipped: 8,
    'empty-band': 2,
    'long-edge': 1,
    'expectation-failed': 4,
    'edge-hugs-node': 1,
    'edge-on-group-border': 1,
    'edge-near-group-border': 1,
    'edge-in-slot': 1,
    'edges-too-close': 2,
    'uneven-channel': 1,
    'ragged-bends': 1,
    'uneven-ports': 1,
    'off-axis-port': 1,
    jog: 1,
    'uneven-padding': 2,
    'padding-varies': 2,
    'mid-word-wrap': 1,
    'sparse-group': 1,
    'group-staircase': 1,
    'tight-group-gap': 2,
    'uneven-group-gap': 1,
    'label-through-text': 6,
    'labels-too-close': 2,
    'label-beside-line': 1,
    'empty-area': 3,
    'wide-aspect': 2,
  };
  const raw =
    Object.entries(counts).reduce((s, [k, v]) => s + v * weights[k], 0) +
    crossings * 1 +
    backEdges * 0.5;
  const defectIndex = +(raw / Math.max(1, routes.length / 10)).toFixed(1);

  const expectations = [...source.matchAll(/^\s*#\s*expect\s+(.+)$/gm)].map(m => m[1].trim());

  return {
    file: path.basename(file),
    expectations,
    nodes: leaves.length,
    groups: groups.length,
    edges: routes.length,
    warnings,
    flowDir,
    width,
    height,
    aspect: +(width / Math.max(1, height)).toFixed(2),
    density: +(leafArea / Math.max(1, width * height)).toFixed(3),
    aligned: +(aligned / Math.max(1, leaves.length)).toFixed(2),
    crossings,
    bends,
    bendsPerEdge: +(bends / Math.max(1, routes.length)).toFixed(2),
    maxBends,
    hooks,
    backEdges,
    edgeLengthPerEdge: Math.round(totalLen / Math.max(1, routes.length)),
    theme: source.match(/^theme\s+(\S+)/m)?.[1] ?? 'drafting',
    fills: colors.fills.length,
    minTextContrast: Math.min(...colors.pairs.map(p => p.ratio)),
    groupFill: packing.fills,
    groupGaps: packing.gaps,
    emptyArea: {
      share: +emptyShare.toFixed(2),
      boxes: +emptyBoxes.toFixed(1),
      w: Math.round(hole.w),
      h: Math.round(hole.h),
      x: Math.round(hole.x),
      y: Math.round(hole.y),
    },
    edgeStretch: stretch,
    counts,
    defectIndex,
    issues,
    geo,
  };
}

/** How much did the drawing move between two versions? Only objects present in both count. */
function stability(a, b) {
  const pos = m => new Map(m.geo.nodes.map(n => [n.id, center(n)]));
  const pa = pos(a),
    pb = pos(b);
  const shared = [...pa.keys()].filter(id => pb.has(id));
  const moves = shared.map(id =>
    Math.hypot(pb.get(id).x - pa.get(id).x, pb.get(id).y - pa.get(id).y),
  );
  // Movement after removing the median shift: a drawing that slid as a whole kept its shape.
  const median = values => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0;
  const sx = median(shared.map(id => pb.get(id).x - pa.get(id).x)),
    sy = median(shared.map(id => pb.get(id).y - pa.get(id).y));
  const aligned = shared.map(id =>
    Math.hypot(pb.get(id).x - pa.get(id).x - sx, pb.get(id).y - pa.get(id).y - sy),
  );
  let flips = 0;
  for (let i = 0; i < shared.length; i++) {
    for (let j = i + 1; j < shared.length; j++) {
      const p = pa.get(shared[i]),
        q = pa.get(shared[j]),
        r = pb.get(shared[i]),
        s = pb.get(shared[j]);
      const fx =
        Math.abs(q.x - p.x) > 20 &&
        Math.abs(s.x - r.x) > 20 &&
        Math.sign(q.x - p.x) !== Math.sign(s.x - r.x);
      const fy =
        Math.abs(q.y - p.y) > 20 &&
        Math.abs(s.y - r.y) > 20 &&
        Math.sign(q.y - p.y) !== Math.sign(s.y - r.y);
      if (fx || fy) flips++;
    }
  }
  return {
    shared: shared.length,
    meanMove: Math.round(moves.reduce((s, m) => s + m, 0) / Math.max(1, moves.length)),
    maxMove: Math.round(Math.max(0, ...moves)),
    moved: moves.filter(m => m > 24).length,
    alignedMean: Math.round(aligned.reduce((t, m) => t + m, 0) / Math.max(1, aligned.length)),
    alignedMoved: aligned.filter(m => m > 24).length,
    orderFlips: flips,
    shift: { x: Math.round(sx), y: Math.round(sy) },
  };
}

/**
 * `still-shape`: the objects in `list` that moved more than 24px once each band's own shift
 * along the reading direction is removed. Bands are the runs of the previous version's boxes
 * whose spans along the reading axis overlap (a rank, or a column in a rightward flow); a group
 * follows the band of its first member at its start and of its last member at its end.
 */
function stillShape(prev, r, list) {
  if (!prev) return [];
  const axis = r.flowDir === 'down' ? 'y' : 'x',
    across = axis === 'x' ? 'y' : 'x',
    size = axis === 'x' ? 'w' : 'h';
  const before = new Map(prev.geo.nodes.map(n => [n.id, n])),
    after = new Map(r.geo.nodes.map(n => [n.id, n]));
  const parents = new Set(prev.geo.nodes.map(n => n.parent));
  const leaves = prev.geo.nodes.filter(n => !parents.has(n.id) && after.has(n.id));
  // Rows: a folded flow wraps onto rows separated by a clear gap across the reading axis; each
  // row widens on its own. Bands: within a row, merge the leaves' spans along the reading axis.
  const acrossSize = axis === 'x' ? 'h' : 'w';
  const runs = (list, a, s) => {
    const out = new Map();
    let k = -1,
      reach = -Infinity;
    for (const n of [...list].sort((p, q) => p[a] - q[a])) {
      if (n[a] >= reach - EPS) k++;
      reach = Math.max(reach, n[a] + n[s]);
      out.set(n.id, k);
    }
    return out;
  };
  const rowOf = runs(leaves, across, acrossSize);
  const bandOf = new Map();
  let band = -1;
  for (const row of new Set(rowOf.values())) {
    const inRow = runs(
      leaves.filter(n => rowOf.get(n.id) === row),
      axis,
      size,
    );
    const base = band + 1;
    for (const [id, k] of inRow) {
      bandOf.set(id, base + k);
      band = Math.max(band, base + k);
    }
  }
  const median = values => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] ?? 0;
  const shifts = new Map();
  for (let b = 0; b <= band; b++)
    shifts.set(
      b,
      median(leaves.filter(n => bandOf.get(n.id) === b).map(n => after.get(n.id)[axis] - n[axis])),
    );
  const crossShift = median(leaves.map(n => after.get(n.id)[across] - n[across]));
  const within = id => {
    const out = [];
    for (const n of leaves) {
      for (let p = n; p && p.parent !== 'root'; p = before.get(p.parent))
        if (p.parent === id) {
          out.push(n);
          break;
        }
    }
    return out;
  };
  return list.filter(id => {
    const a = before.get(id),
      b = after.get(id);
    if (!a || !b) return false;
    let startShift, endShift;
    if (bandOf.has(id)) startShift = endShift = shifts.get(bandOf.get(id));
    else {
      const kids = within(id);
      if (!kids.length) return false;
      const first = kids.reduce((p, q) => (q[axis] < p[axis] ? q : p)),
        last = kids.reduce((p, q) => (q[axis] + q[size] > p[axis] + p[size] ? q : p));
      startShift = shifts.get(bandOf.get(first.id));
      endShift = shifts.get(bandOf.get(last.id));
    }
    const dStart = b[axis] - a[axis] - startShift,
      dEnd = b[axis] + b[size] - (a[axis] + a[size]) - endShift,
      dAcross =
        b[across] +
        (axis === 'x' ? b.h : b.w) / 2 -
        (a[across] + (axis === 'x' ? a.h : a.w) / 2) -
        crossShift;
    return Math.max(Math.abs(dStart), Math.abs(dEnd), Math.abs(dAcross)) > 24;
  });
}

/** Check a version's `# expect` lines. `prev` is the version before it, for `still`. */
function checkExpectations(r, prev) {
  const rect = new Map(r.geo.nodes.map(n => [n.id, n]));
  const was = new Map((prev?.geo.nodes ?? []).map(n => [n.id, center(n)]));
  return r.expectations.map(line => {
    const [kind, ...ids] = line.split(/\s+/);
    const need = ids.filter(id => !/^\d+$/.test(id) && id !== '*');
    const missing = need.filter(id => !rect.has(id));
    if (missing.length) return { line, pass: false, why: `unknown ${missing.join(', ')}` };
    const [a, b] = need.map(id => rect.get(id));
    const gap = () =>
      Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
    const moved = id =>
      was.has(id)
        ? Math.hypot(center(rect.get(id)).x - was.get(id).x, center(rect.get(id)).y - was.get(id).y)
        : 0;
    const run = (axis, list) =>
      list.every(
        (id, i) => i === 0 || center(rect.get(list[i - 1]))[axis] < center(rect.get(id))[axis],
      );
    switch (kind) {
      case 'left-of':
        return { line, pass: a.x + a.w <= b.x };
      case 'right-of':
        return { line, pass: b.x + b.w <= a.x };
      case 'above':
        return { line, pass: a.y + a.h <= b.y };
      case 'below':
        return { line, pass: b.y + b.h <= a.y };
      case 'order-x':
        return { line, pass: run('x', need) };
      case 'order-y':
        return { line, pass: run('y', need) };
      case 'aligned-x':
        return {
          line,
          pass: need.every(id => Math.abs(center(rect.get(id)).x - center(a).x) <= 4),
        };
      case 'aligned-y':
        return {
          line,
          pass: need.every(id => Math.abs(center(rect.get(id)).y - center(a).y) <= 4),
        };
      case 'near': {
        const limit = Number(ids.find(id => /^\d+$/.test(id)) ?? 80);
        return { line, pass: gap() <= limit, why: `gap ${Math.round(gap())}px` };
      }
      case 'still': {
        const list = ids.includes('*') ? [...was.keys()].filter(id => rect.has(id)) : need;
        const off = list.filter(id => moved(id) > 24);
        // Alongside the raw check: the same objects after removing the drawing's median shift, so
        // a drawing that slid as a whole (`shape` passes) is told apart from one that changed shape.
        const shift = r.stabilityFromPrev?.shift ?? { x: 0, y: 0 },
          reshaped = list.filter(
            id =>
              was.has(id) &&
              Math.hypot(
                center(rect.get(id)).x - was.get(id).x - shift.x,
                center(rect.get(id)).y - was.get(id).y - shift.y,
              ) > 24,
          );
        const slid = shift.x || shift.y ? `; shift ${shift.x},${shift.y}` : '';
        return {
          line,
          pass: off.length === 0,
          shape: reshaped.length === 0,
          why: off.length
            ? `moved: ${off.join(', ')}${slid}; ${reshaped.length ? `after shift: ${reshaped.join(', ')}` : 'holds its shape after shift'}`
            : undefined,
        };
      }
      case 'still-shape': {
        // A relabel may widen the gap between two bands (ranks across the reading direction):
        // everything past it slides along the reading direction by that band's own shift.
        // Remove each band's shift along the reading axis (and the drawing's median shift
        // across it) and check that nothing else moved: nothing outside the widened gap changed
        // shape.
        const list = ids.includes('*') ? [...was.keys()].filter(id => rect.has(id)) : need;
        const off = stillShape(prev, r, list);
        return {
          line,
          pass: off.length === 0,
          why: off.length ? `reshaped: ${off.join(', ')}` : undefined,
        };
      }
      case 'reads-x':
      case 'reads-y': {
        // Reading order with wraps: each next object is further along the axis in the same band,
        // or starts a new band further across, like lines of text.
        // Text-like: a step forward along the axis is reading on; a step back along it must go
        // down (or right, for columns) to the next band.
        const [along, across] = kind === 'reads-x' ? ['x', 'y'] : ['y', 'x'];
        let along_ = 0,
          wraps = 0;
        const ok = need.every((id, i) => {
          if (i === 0) return true;
          const p = center(rect.get(need[i - 1])),
            q = center(rect.get(id));
          if (q[along] > p[along] + 4) return ++along_ > 0;
          wraps++;
          return q[across] > p[across];
        });
        // A single line across the axis (a column for reads-x) is not reading along it.
        return { line, pass: ok && along_ >= wraps, why: `${along_} along, ${wraps} wraps` };
      }
      case 'keeps-order': {
        const flips = r.stabilityFromPrev?.orderFlips ?? 0;
        return { line, pass: flips === 0, why: `${flips} order flips` };
      }
      case 'back-edges':
        return { line, pass: r.backEdges <= Number(ids[0] ?? 0), why: `${r.backEdges} back edges` };
      default:
        return { line, pass: false, why: 'unknown expectation' };
    }
  });
}

// ---------- run ----------
fs.mkdirSync(outDir, { recursive: true });
const slugs = fs
  .readdirSync(corpusDir)
  .filter(s => fs.statSync(path.join(corpusDir, s)).isDirectory())
  .filter(s => !only || only.includes(s))
  .sort();

const rows = [];
/**
 * Sheets are 1000 CSS px wide, so the 2x PNG is 2000px: what a reviewer sees without
 * downscaling. The column count is the one that leaves each card largest once the whole sheet
 * fits a 2000x2000 view.
 */
const SHEET_WIDTH = 1000;
function sheetCols(renders, cards) {
  const aspects = renders.filter(r => !r.error).map(r => r.aspect);
  const aspect = aspects.reduce((a, b) => a + b, 0) / Math.max(1, aspects.length) || 1;
  let best = 1;
  let bestWidth = 0;
  for (let cols = 1; cols <= cards; cols++) {
    const card = (SHEET_WIDTH - 32 - 16 * (cols - 1)) / cols;
    const height = 32 + Math.ceil(cards / cols) * (card / aspect + 30) + 16;
    const shown = card / Math.max(1, height / SHEET_WIDTH);
    if (shown > bestWidth) [best, bestWidth] = [cols, shown];
  }
  return best;
}

for (const slug of slugs) {
  const dir = path.join(corpusDir, slug);
  const variants = fs
    .readdirSync(dir)
    .filter(f => /^(v0|e\d+)\.draft$/.test(f))
    .sort((a, b) =>
      a === 'v0.draft'
        ? -1
        : b === 'v0.draft'
          ? 1
          : a.localeCompare(b, undefined, { numeric: true }),
    );
  const results = variants.map(v => measure(path.join(dir, v)));
  for (const [i, r] of results.entries()) {
    if (r.error || i === 0 || results[i - 1].error) continue;
    r.stabilityFromPrev = stability(results[i - 1], r);
    r.stabilityFromV0 = stability(results[0], r);
  }
  for (const [i, r] of results.entries()) {
    if (r.error) continue;
    r.checks = checkExpectations(r, i > 0 && !results[i - 1].error ? results[i - 1] : undefined);
    for (const c of r.checks)
      if (!c.pass)
        r.issues.push({
          kind: 'expectation-failed',
          detail: `${c.line}${c.why ? ` (${c.why})` : ''}`,
        });
    // A missed request counts like the other defects (weight 4 per 10 edges).
    const failed = r.checks.filter(c => !c.pass).length;
    r.counts['expectation-failed'] = failed;
    r.defectIndex = +(r.defectIndex + (failed * 4) / Math.max(1, r.edges / 10)).toFixed(1);
  }
  const before =
    baseline && fs.existsSync(path.join(baseline, slug, 'metrics.json'))
      ? JSON.parse(fs.readFileSync(path.join(baseline, slug, 'metrics.json'), 'utf8'))
      : [];
  for (const r of results) {
    const old = before.find(b => b.file === r.file && !b.error);
    if (old && !r.error) r.baselineDI = old.defectIndex;
  }
  const outSlug = path.join(outDir, slug);
  fs.mkdirSync(outSlug, { recursive: true });
  fs.writeFileSync(
    path.join(outSlug, 'metrics.json'),
    JSON.stringify(
      results.map(({ geo: _geo, ...r }) => r),
      null,
      2,
    ),
  );
  if (!noShots) {
    for (const v of variants) {
      execFileSync(
        process.execPath,
        [
          path.join(root, 'scripts/shoot.mjs'),
          path.join(dir, v),
          path.join(outSlug, v.replace('.draft', '.png')),
        ],
        { stdio: 'ignore' },
      );
    }
    if (variants.length > 1) {
      const cards = variants.map(v => `${slug} ${v.replace('.draft', '')}::${path.join(dir, v)}`);
      execFileSync(
        process.execPath,
        [
          path.join(root, 'scripts/shoot.mjs'),
          '--sheet',
          path.join(outSlug, 'sheet.png'),
          '--size',
          `${SHEET_WIDTH}x800`,
          '--cols',
          String(sheetCols(results, variants.length)),
          ...cards,
        ],
        { stdio: 'ignore' },
      );
    }
  }
  if (!noShots && baseline) {
    for (const v of variants) {
      const png = v.replace('.draft', '.png');
      const old = path.join(baseline, slug, png);
      if (!fs.existsSync(old)) continue;
      execFileSync(
        process.execPath,
        [
          path.join(root, 'scripts/shoot.mjs'),
          '--sheet',
          path.join(outSlug, `compare-${png}`),
          '--size',
          `${SHEET_WIDTH}x800`,
          '--cols',
          String(
            sheetCols(
              results.filter(r => r.file === v),
              2,
            ),
          ),
          `before ${slug} ${v}::${old}`,
          `after ${slug} ${v}::${path.join(outSlug, png)}`,
        ],
        { stdio: 'ignore' },
      );
    }
  }
  for (const r of results) rows.push({ slug, ...r });
  console.log(
    `${slug}: ${results.map(r => (r.error ? `${r.file} ERROR` : `${r.file} DI=${r.defectIndex}`)).join(', ')}`,
  );
}

const fmtStab = s =>
  s
    ? `${s.meanMove}/${s.maxMove}px, ${s.moved} moved (${s.alignedMoved} after shift), ${s.orderFlips} flips`
    : '';
const lines = [
  '| Diagram | Ver | Theme | Fills | N/G/E | Aspect | Cross | Bends/e | Hooks | Back | Hard | Label | Route | Clear | Order | Fit | Pack | Space | Expect | DI | Base DI | Δ prev (mean/max) |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(r => {
    if (r.error) return `| ${r.slug} | ${r.file} | ERROR | | | | | | | | | | | | | | | | | | | |`;
    const c = r.counts;
    const hard = c['node-overlap'] + c['edge-through-node'] + c.clipped;
    const label =
      c['label-on-node'] +
      c['label-overlap'] +
      c['label-on-edge'] +
      c['label-on-group-title'] +
      c['label-detached'] +
      c['label-on-group-border'] +
      c['label-through-text'] +
      c['labels-too-close'] +
      c['label-beside-line'];
    const route =
      c['shared-segment'] +
      c['edge-through-group'] +
      c['edge-through-title-band'] +
      c['many-bends'];
    const clear =
      c['edge-hugs-node'] +
      c['edge-on-group-border'] +
      c['edge-near-group-border'] +
      c['edge-in-slot'] +
      c['edges-too-close'];
    const order =
      c['uneven-channel'] + c['ragged-bends'] + c['uneven-ports'] + c['off-axis-port'] + c.jog;
    const fit = c['uneven-padding'] + c['padding-varies'];
    const pack =
      c['sparse-group'] + c['group-staircase'] + c['tight-group-gap'] + c['uneven-group-gap'];
    return `| ${r.slug} | ${r.file.replace('.draft', '')} | ${r.theme} | ${r.fills} | ${r.nodes}/${r.groups}/${r.edges} | ${r.aspect} | ${r.crossings} | ${r.bendsPerEdge} | ${r.hooks} | ${r.backEdges} | ${hard} | ${label} | ${route} | ${clear} | ${order} | ${fit} | ${pack} | ${c['empty-band'] + c['empty-area'] + c['wide-aspect'] + c['long-edge']} | ${r.checks.length ? `${r.checks.filter(x => x.pass).length}/${r.checks.length}` : ''} | ${r.defectIndex} | ${r.baselineDI ?? ''} | ${fmtStab(r.stabilityFromPrev)} |`;
  }),
];
const ok = rows.filter(r => !r.error);
const totals = {};
for (const r of ok) for (const i of r.issues) totals[i.kind] = (totals[i.kind] ?? 0) + 1;
lines.push(
  '',
  `Mean defect index: ${(ok.reduce((s, r) => s + r.defectIndex, 0) / Math.max(1, ok.length)).toFixed(1)} over ${ok.length} renders.`,
  '',
  '| Issue | Count |',
  '| --- | --- |',
  ...Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`),
);
// Follow-up stability: the `still` and `keeps-order` promises, and how far follow-ups move.
const checksOf = kind => ok.flatMap(r => r.checks.filter(c => c.line.split(/\s+/)[0] === kind));
const stills = checksOf('still'),
  shapes = checksOf('still-shape'),
  keeps = checksOf('keeps-order'),
  follow = ok.filter(r => r.stabilityFromPrev);
const count = (list, pass) => `${list.filter(pass).length}/${list.length}`;
lines.push(
  '',
  '| Follow-ups | Value |',
  '| --- | --- |',
  `| still (raw) | ${count(stills, c => c.pass)} |`,
  `| still (median shift removed) | ${count(stills, c => c.shape)} |`,
  `| still-shape (each band's shift removed) | ${count(shapes, c => c.pass)} |`,
  `| keeps-order | ${count(keeps, c => c.pass)} |`,
  `| mean move (px, over ${follow.length} follow-ups) | ${(follow.reduce((t, r) => t + r.stabilityFromPrev.meanMove, 0) / Math.max(1, follow.length)).toFixed(1)} |`,
  `| order flips (total) | ${follow.reduce((t, r) => t + r.stabilityFromPrev.orderFlips, 0)} |`,
);
fs.writeFileSync(path.join(outDir, 'summary.md'), lines.join('\n') + '\n');
console.log(`\nWrote ${path.join(outDir, 'summary.md')}`);
