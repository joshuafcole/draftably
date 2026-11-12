#!/usr/bin/env node
/**
 * Host contract budgets (docs/intent/host-contract/plan.md, "Performance"): the built
 * `@draftably/runtime` element on plain pages in Chromium, with no bundler.
 *
 *   pnpm bench:host [--runs 5] [--out tmp/bench/host.json] [--strict]
 *   node scripts/bench/host.mjs --serve   (prints the page URL; add ?n=2&dark for the dark tokens)
 *
 * Each row prints median and p95 over the runs, the budget, and ✓ or ✗. Cold loads run with a 4×
 * CPU throttle. The exit code is 0 whatever the times, unless `--strict` is passed.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(root, 'packages/runtime/dist');
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const runs = Number(opt('runs', 5));
const out = path.resolve(root, opt('out', 'tmp/bench/host.json'));
const strict = process.argv.includes('--strict');
if (!fs.existsSync(path.join(dist, 'element.js'))) throw Error('Run pnpm runtime:build first.');

const source = fs.readFileSync(path.join(root, 'scripts/bench/diagrams/xl-triggers.draft'), 'utf8');
const nodes = source.match(/^node /gm).length;
/** 200 nodes in ten rows of twenty, each joined to the next: the geometry() row. */
const big = [
  'diagram "Big" version=1',
  ...Array.from({ length: 200 }, (_, i) => `node n${i} "Node ${i}"`),
  ...Array.from({ length: 199 }, (_, i) => `edge e${i} n${i} -> n${i + 1}`),
].join('\n');

/** 250 nodes for the slot rows: a body and an overlay on each gives 500 targets. */
const slotted = [
  'diagram "Slots" version=1',
  ...Array.from({ length: 250 }, (_, i) => `node n${i} "Node ${i}"`),
].join('\n');

/** A plain page: `n` elements of the 28-box file, each a label of its own. */
const page = query => `<!doctype html><meta charset="utf-8"><title>host bench</title>
<link rel="stylesheet" href="/dist/host.css">
<style>body{margin:0}draft-diagram{height:240px}.b{font:11px system-ui;background:#dbeafe;height:100%}</style>
<style media="${new URLSearchParams(query).has('dark') ? 'all' : 'not all'}">
body{background:#020617}draft-diagram{--draft-bg:#0f172a;--draft-ink:#e2e8f0;--draft-border:#334155;--draft-focus:#38bdf8}
</style>
<script type="module">
const q = new URLSearchParams(${JSON.stringify(query)});
const n = Number(q.get('n') ?? 1);
const source = q.has('big') ? ${JSON.stringify(big)} : q.has('slots') ? ${JSON.stringify(slotted)} : ${JSON.stringify(source)};
/** \`slots=N\`: N targets, a body and an overlay on each of the first N / 2 nodes. */
const slots = Number(q.get('slots') ?? 0);
window.__long = 0;
new PerformanceObserver(list => {
  for (const e of list.getEntries()) window.__long = Math.max(window.__long, e.duration);
}).observe({ type: 'longtask', buffered: true });
window.committed = el =>
  new Promise(resolve => {
    const on = e => {
      if (e.detail.status !== 'committed') return;
      el.removeEventListener('draft-update', on);
      resolve(performance.now());
    };
    el.addEventListener('draft-update', on);
  });
window.add = () => {
  const el = document.createElement('draft-diagram');
  if (q.has('big') || slots) el.options = { execution: { mode: 'worker', timeoutMs: 120000 } };
  for (let i = 0; i < slots / 2; i++) {
    const body = document.createElement('div'), badge = document.createElement('span');
    body.className = 'b';
    body.dataset.draftSlot = 'body:n' + i;
    body.textContent = 'Card ' + i;
    badge.dataset.draftSlot = 'overlay:n' + i;
    badge.textContent = '•';
    el.append(body, badge);
  }
  el.source = source;
  document.body.append(el);
  return el;
};
/** The first update of an element, whatever its status. */
window.settled = el =>
  new Promise(resolve =>
    el.addEventListener(
      'draft-update',
      e => resolve({ status: e.detail.status, t: performance.now() }),
      { once: true },
    ),
  );
window.loaded = import('/dist/element.js');
const first = q.has('empty') ? [] : Array.from({ length: n }, window.add).map(window.settled);
window.firstUpdates = Promise.all(first);
window.firstCommit = q.has('empty')
  ? undefined
  : window.firstUpdates.then(all => Math.max(...all.map(u => u.t)));
</script>`;

/**
 * One `<draft-editor>` of the 200-node file. `?slots`: a body and an overlay on every node. It
 * counts what a drag must not do with slots: anchors events, size-observer calls and slot
 * assignments.
 */
const editorPage = `<!doctype html><meta charset="utf-8"><title>editor bench</title>
<link rel="stylesheet" href="/dist/host.css">
<style>body{margin:0}draft-editor{display:block;width:1200px;height:700px}.b{font:11px system-ui;background:#dbeafe;height:100%}</style>
<script type="module">
const el = document.createElement('draft-editor');
if (location.search.includes('slots'))
  for (let i = 0; i < 200; i++) {
    const body = document.createElement('div'), badge = document.createElement('span');
    body.className = 'b';
    body.dataset.draftSlot = 'body:n' + i;
    body.textContent = 'Card ' + i;
    badge.dataset.draftSlot = 'overlay:n' + i;
    badge.textContent = '•';
    el.append(body, badge);
  }
el.source = ${JSON.stringify(big)};
window.counts = { anchors: 0, observe: 0, assign: 0 };
el.addEventListener('draft-anchors', () => counts.anchors++);
const observe = ResizeObserver.prototype.observe,
  assign = HTMLSlotElement.prototype.assign;
ResizeObserver.prototype.observe = function (...a) { counts.observe++; return observe.apply(this, a); };
HTMLSlotElement.prototype.assign = function (...a) { counts.assign++; return assign.apply(this, a); };
document.body.append(el);
await import('/editor/element.js');
await el.updateComplete;
await el.editor.ready;
window.ready = true;
</script>`;

const editorDist = path.join(root, 'packages/editor/dist');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/page.html') {
    res.setHeader('content-type', 'text/html');
    return res.end(page(url.search));
  }
  if (url.pathname === '/editor.html') {
    res.setHeader('content-type', 'text/html');
    return res.end(editorPage);
  }
  const [from, rel] = url.pathname.startsWith('/editor/')
    ? [editorDist, url.pathname.slice('/editor/'.length)]
    : [dist, url.pathname.replace(/^\/dist\//, '')];
  const file = path.join(from, decodeURIComponent(rel));
  if (!file.startsWith(from) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
  res.setHeader('cache-control', 'max-age=3600');
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
if (process.argv.includes('--serve')) {
  console.log(base);
  await new Promise(() => {});
}

const browser = await chromium.launch();
const sorted = xs => [...xs].sort((a, b) => a - b);
const median = xs => sorted(xs)[Math.floor(xs.length / 2)];
const p95 = xs => sorted(xs)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)];
const rows = [];
let dragBase = 0;
const row = (area, budget, measured, ok) => {
  rows.push({ area, budget, measured, ok });
  console.error(`${ok ? '✓' : '✗'} ${area}: ${measured} (budget ${budget})`);
};
const ms = xs => `${Math.round(median(xs))} ms median, ${Math.round(p95(xs))} ms p95`;

async function open(query, { throttle = 1, context } = {}) {
  const ctx = context ?? (await browser.newContext());
  const tab = await ctx.newPage();
  const cdp = await ctx.newCDPSession(tab);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const scripts = [],
    workers = [];
  tab.on('request', r => {
    if (r.url().endsWith('.js')) scripts.push(r.url());
  });
  tab.on('worker', w => workers.push(w.url()));
  await tab.goto(`${base}/page.html?${query}`);
  return { ctx, tab, cdp, scripts, workers };
}

// Main-thread JS on a viewer-only page, gzip -9, before and through the first commit.
{
  const { ctx, tab, scripts, workers } = await open('n=1');
  await tab.evaluate(() => window.firstCommit);
  const worker = new Set(workers);
  const main = [...new Set(scripts)].filter(u => !worker.has(u));
  const kb =
    main.reduce((sum, u) => {
      const file = path.join(dist, new URL(u).pathname.replace(/^\/dist\//, ''));
      return sum + zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
    }, 0) / 1024;
  const editor = scripts.some(u => /editor/.test(u));
  row(
    'Main-thread JS, viewer-only page',
    '≤ 40 KB gz; no editor request',
    `${kb.toFixed(1)} KB gz in ${main.length} files; editor request: ${editor ? 'yes' : 'no'}`,
    kb <= 40 && !editor,
  );
  await ctx.close();
}

// First diagram: navigation to the committed update, cold (4× CPU) and warm (cached, no throttle).
{
  const cold = [],
    warm = [];
  for (let i = 0; i < runs; i++) {
    const first = await open('n=1', { throttle: 4 });
    cold.push(await first.tab.evaluate(() => window.firstCommit));
    await first.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await first.tab.reload();
    warm.push(await first.tab.evaluate(() => window.firstCommit));
    await first.ctx.close();
  }
  row(`First diagram, ${nodes}-box file, cold (4× CPU)`, '≤ 1 s', ms(cold), median(cold) <= 1000);
  row(`First diagram, ${nodes}-box file, warm`, '≤ 300 ms', ms(warm), median(warm) <= 300);
}

// Source update to commit, on a page that already drew the file.
{
  const { ctx, tab } = await open('n=1');
  await tab.evaluate(() => window.firstCommit);
  const times = [];
  for (let i = 0; i < Math.max(runs, 10); i++)
    times.push(
      await tab.evaluate(async i => {
        const el = document.querySelector('draft-diagram');
        const done = window.committed(el);
        const t = performance.now();
        el.source = el.source.replace(/"[^"]*"/, `"Update ${i}"`);
        return (await done) - t;
      }, i),
    );
  row(`Source update to commit, ${nodes} boxes`, '≤ 200 ms', ms(times), median(times) <= 200);
  await ctx.close();
}

// 20 instances, then 20 updates each: workers, stylesheets, fonts and long tasks.
const pool = Math.max(1, Math.min(4, os.cpus().length - 1));
{
  const { ctx, tab, workers } = await open('n=20');
  const first = await tab.evaluate(() => window.firstUpdates);
  const committed = first.filter(u => u.status === 'committed').length;
  row(
    `20 instances of the ${nodes}-box file`,
    'every diagram commits; no timeouts',
    `${committed}/20 committed; last at ${Math.round(Math.max(...first.map(u => u.t)))} ms`,
    committed === 20,
  );
  await tab.evaluate(async () => {
    const els = [...document.querySelectorAll('draft-diagram')];
    for (let round = 0; round < 20; round++)
      await Promise.all(
        els.map((el, i) => {
          const done = window.committed(el);
          el.source = el.source.replace(/"[^"]*"/, `"R${round} ${i}"`);
          return done;
        }),
      );
  });
  const page = await tab.evaluate(() => {
    const els = [...document.querySelectorAll('draft-diagram')];
    const sheets = new Set();
    let styles = 0;
    for (const el of els) {
      for (const s of el.shadowRoot.adoptedStyleSheets) sheets.add(s);
      styles += el.shadowRoot.querySelectorAll(':scope > style').length;
    }
    return { sheets: sheets.size + styles, fonts: document.fonts.size, long: window.__long };
  });
  row(
    'Workers, 20 instances × 20 updates',
    `≤ min(4, cores − 1) = ${pool} render workers per page`,
    `${workers.length} created`,
    workers.length <= pool,
  );
  row(
    '20 instances: stylesheets, fonts, long tasks',
    '1 sheet; 1 font set; no long task over 200 ms',
    `${page.sheets} sheets; ${page.fonts} font faces; longest task ${Math.round(page.long)} ms`,
    page.sheets === 1 && page.long <= 200,
  );
  await ctx.close();
}

// geometry() at 200 nodes: one object per revision, read in well under 1 ms.
{
  const { ctx, tab } = await open('n=1&big');
  await tab.evaluate(() => window.firstUpdates);
  const g = await tab.evaluate(() => {
    const viewer = document.querySelector('draft-diagram').viewer;
    const first = viewer.geometry();
    const t = performance.now();
    let same = true;
    for (let i = 0; i < 1000; i++) same &&= viewer.geometry() === first;
    return {
      ms: (performance.now() - t) / 1000,
      same,
      nodes: Object.keys(first?.nodes ?? {}).length,
    };
  });
  row(
    'geometry() at 200 nodes',
    '≤ 1 ms; the same object for one revision',
    `${g.ms.toFixed(4)} ms per call; ${g.nodes} nodes; same object: ${g.same ? 'yes' : 'no'}`,
    g.ms <= 1 && g.same && g.nodes === 200,
  );
  await ctx.close();
}

// Camera frames with 10, 100 and 500 slot targets: one transform on the body layer and one
// position per overlay, with no layout reads. The time includes the style and layout the move
// causes (read once, in the measurement only). Forced layouts: the layout reads that 100 moves
// make, counted by wrapping every DOM API that reads layout (a forced layout needs one).
for (const count of [10, 100, 500]) {
  const { ctx, tab } = await open(`n=1&slots=${count}`);
  await tab.evaluate(() => window.firstUpdates);
  const times = await tab.evaluate(async () => {
    const el = document.querySelector('draft-diagram'),
      v = el.viewer,
      layer = el.shadowRoot.querySelector('.draft-anchors'),
      c = v.getCamera(),
      out = [];
    for (let i = 0; i < 120; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const t = performance.now();
      v.setCamera({
        centerX: c.centerX + i * 3,
        centerY: c.centerY + i * 2,
        zoom: c.zoom * (i % 2 ? 1 : 1 + (i % 30) / 100),
      });
      layer.getBoundingClientRect();
      out.push(performance.now() - t);
    }
    return out;
  });
  // A forced layout needs a layout read after a write: count every read the moves make.
  const forced = await tab.evaluate(() => {
    let reads = 0;
    const undo = [];
    const watch = (proto, name) => {
      const d = Object.getOwnPropertyDescriptor(proto, name);
      const wrapped = d.get
        ? {
            get() {
              reads++;
              return d.get.call(this);
            },
          }
        : {
            value(...a) {
              reads++;
              return d.value.apply(this, a);
            },
          };
      Object.defineProperty(proto, name, { ...d, ...wrapped });
      undo.push(() => Object.defineProperty(proto, name, d));
    };
    for (const name of [
      'getBoundingClientRect',
      'getClientRects',
      'clientWidth',
      'clientHeight',
      'clientTop',
      'clientLeft',
      'scrollWidth',
      'scrollHeight',
      'scrollTop',
      'scrollLeft',
    ])
      watch(Element.prototype, name);
    for (const name of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft', 'offsetParent'])
      watch(HTMLElement.prototype, name);
    watch(window, 'getComputedStyle');
    const v = document.querySelector('draft-diagram').viewer,
      c = v.getCamera();
    for (let i = 0; i < 100; i++)
      v.setCamera({ ...c, centerX: c.centerX + i, zoom: c.zoom * (1 + (i % 7) / 50) });
    for (const f of undo) f();
    return reads;
  });
  const targets = await tab.evaluate(
    () =>
      document.querySelector('draft-diagram').shadowRoot.querySelectorAll('[data-draft-anchor]')
        .length,
  );
  row(
    `Camera frame, ${count} targets`,
    count === 500 ? '≤ 8 ms p95; 0 forced layouts' : '0 forced layouts',
    `${targets} targets; ${median(times).toFixed(2)} ms median, ${p95(times).toFixed(2)} ms p95; ${forced} layout reads in 100 moves`,
    targets === count && forced === 0 && (count < 500 || p95(times) <= 8),
  );
  await ctx.close();
}

// Target reconcile at 500 targets: the pass each commit runs over every target, timed through
// anchor() with the same slots (with the style and layout it causes); and a real source update
// that moves every node, which must re-create no target.
{
  const { ctx, tab } = await open('n=1&slots=500');
  await tab.evaluate(() => window.firstUpdates);
  const r = await tab.evaluate(async () => {
    const el = document.querySelector('draft-diagram'),
      v = el.viewer,
      layer = el.shadowRoot.querySelector('.draft-anchors'),
      names = [...el.children].map(c => c.dataset.draftSlot),
      times = [];
    for (let i = 0; i < 30; i++) {
      await new Promise(r => requestAnimationFrame(r));
      const t = performance.now();
      v.anchor(names);
      layer.getBoundingClientRect();
      times.push(performance.now() - t);
    }
    let created = 0,
      removed = 0;
    const watch = new MutationObserver(records => {
      for (const m of records) {
        for (const n of m.addedNodes) if (n.dataset?.draftAnchor) created++;
        for (const n of m.removedNodes) if (n.dataset?.draftAnchor) removed++;
      }
    });
    watch.observe(el.shadowRoot, { childList: true, subtree: true });
    const before = v.geometry().nodes.n0;
    const done = window.committed(el);
    // A wider first node moves the nodes after it.
    el.source = `${el.source}\nsize n0 width=320`;
    await done;
    await new Promise(r => requestAnimationFrame(r));
    watch.disconnect();
    return { times, created, removed, moved: v.geometry().nodes.n0.width !== before.width };
  });
  row(
    'Target reconcile per update, 500 targets',
    '≤ 10 ms; no target re-created for an unchanged ID',
    `${median(r.times).toFixed(2)} ms median, ${p95(r.times).toFixed(2)} ms p95; update re-created ${r.created}, removed ${r.removed}${r.moved ? '' : ' (layout did not change)'}`,
    median(r.times) <= 10 && r.created === 0 && r.removed === 0 && r.moved,
  );
  await ctx.close();
}

// Editor drag at 200 nodes, with no slots and with a body and an overlay on each node. A drag
// frame runs in pointermove; the time is from a window capture listener to a window bubble
// listener, plus the style and layout it causes. With slots, a frame moves targets only: it
// fires no anchors event, observes no content again and assigns no slot, and adds at most 5 % to
// the frame. The frame itself is slow at 200 nodes with or without slots: each edge view scans
// every edge (isDiff, findEdge) on each move.
if (fs.existsSync(path.join(editorDist, 'element.js')))
  for (const slots of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 700 } });
    const tab = await ctx.newPage();
    await tab.goto(`${base}/editor.html${slots ? '?slots' : ''}`);
    await tab.waitForFunction(() => window.ready, null, { timeout: 60000 });
    // Zoom 1 on n5, so bodies are at full detail, then find n5 on screen.
    const at = await tab.evaluate(async () => {
      const el = document.querySelector('draft-editor'),
        h = el.editor,
        b = h.geometry().nodes.n5;
      h.setCamera({ centerX: b.x + b.width / 2, centerY: b.y + b.height / 2, zoom: 1 });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const stage = el.shadowRoot.querySelector('.stage').getBoundingClientRect();
      window.times = [];
      let t = 0;
      addEventListener('pointermove', () => (t = performance.now()), true);
      addEventListener('pointermove', () => {
        el.shadowRoot.querySelector('.stage').getBoundingClientRect();
        if (t) window.times.push(performance.now() - t);
      });
      window.before = { ...window.counts };
      return { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
    });
    await tab.mouse.move(at.x, at.y);
    await tab.mouse.down();
    await tab.mouse.move(at.x + 240, at.y + 160, { steps: 60 });
    await tab.mouse.up();
    const r = await tab.evaluate(() => {
      const el = document.querySelector('draft-editor');
      return {
        times: window.times.slice(2),
        anchors: window.counts.anchors - window.before.anchors,
        observe: window.counts.observe - window.before.observe,
        assign: window.counts.assign - window.before.assign,
        targets: el.shadowRoot.querySelectorAll('[data-draft-anchor]').length,
      };
    });
    const frame = `${median(r.times).toFixed(2)} ms median, ${p95(r.times).toFixed(2)} ms p95`;
    if (!slots) {
      dragBase = median(r.times);
      row('Editor drag frame, 200 nodes, no slots', 'reference', frame, r.times.length > 50);
    } else
      row(
        'Editor drag frame, 200 nodes, 400 targets',
        'median ≤ no slots + 5 %; no anchors event, re-observe or assign',
        `${r.targets} targets; ${frame} (${(median(r.times) - dragBase).toFixed(2)} ms median over no slots); ${r.anchors} anchors events, ${r.observe} observe calls, ${r.assign} assigns in ${r.times.length + 2} moves`,
        r.targets === 400 &&
          r.times.length > 50 &&
          median(r.times) <= dragBase * 1.05 &&
          r.anchors === 0 &&
          r.observe === 0 &&
          r.assign === 0,
      );
    await ctx.close();
  }

// Mount and destroy 50 times: heap, workers, fonts and listeners back at baseline.
{
  const { ctx, tab, cdp } = await open('empty');
  await tab.waitForFunction(() => customElements.get('draft-diagram'));
  const measure = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'document' });
    const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
      objectId: result.objectId,
    });
    const fonts = await tab.evaluate(() => document.fonts.size);
    return { heap, listeners: listeners.length, fonts, workers: tab.workers().length };
  };
  const cycle = () =>
    tab.evaluate(async () => {
      const el = window.add();
      await window.committed(el);
      el.remove();
    });
  // Warm the JIT and caches first: the heap grows about 10 % over the first 25 cycles, then holds.
  for (let i = 0; i < 25; i++) await cycle();
  await tab.waitForTimeout(500);
  const before = await measure();
  for (let i = 0; i < 50; i++) await cycle();
  await tab.waitForTimeout(500);
  const after = await measure();
  const growth = (after.heap - before.heap) / before.heap;
  row(
    'Mount and destroy, 50 cycles',
    'heap within 5 %; listeners, workers, fonts at baseline',
    `heap ${Math.round(before.heap / 1024)}→${Math.round(after.heap / 1024)} KB (${(growth * 100).toFixed(1)} %); listeners ${before.listeners}→${after.listeners}; workers ${before.workers}→${after.workers}; fonts ${before.fonts}→${after.fonts}`,
    growth <= 0.05 &&
      after.listeners <= before.listeners &&
      after.workers <= before.workers &&
      after.fonts <= before.fonts,
  );
  await ctx.close();
}

await browser.close();
server.close();
const machine = `${os.cpus()[0].model}, ${os.cpus().length} cores, ${os.platform()} ${os.release()}`;
const table = [
  `Host contract budgets, ${runs} runs, ${machine}:`,
  '',
  '| Area | Budget | Measured | |',
  '| --- | --- | --- | --- |',
  ...rows.map(r => `| ${r.area} | ${r.budget} | ${r.measured} | ${r.ok ? '✓' : '✗'} |`),
].join('\n');
console.log(table);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ machine, runs, rows }, null, 2));
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
if (strict && rows.some(r => !r.ok)) process.exit(1);
