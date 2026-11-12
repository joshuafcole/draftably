#!/usr/bin/env node
/**
 * Performance benchmark: CLI commands and viewer interactions on five generic diagrams, against
 * two budgets: interactive actions under 200 ms and document load under 1 s.
 *
 * Usage: pnpm bench [--runs 3] [--only cli|ui|host] [--files xl,l] [--out tmp/bench/latest.json]
 *                   [--compare tmp/bench/before.json]
 *
 * Viewer times run from input until the drawing is settled: not compiling, layout idle, saved,
 * and geometry unchanged for 250 ms, timed to the last change. Prints a Markdown table (and
 * appends it to $GITHUB_STEP_SUMMARY in CI). The exit code is 0 whatever the times: it reports.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startViewer, stopViewer } from '../lib/proof.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pristine = path.join(root, 'scripts/bench/diagrams');
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const runs = Number(opt('runs', 3));
const only = opt('only', '');
const out = path.resolve(root, opt('out', 'tmp/bench/latest.json'));
const compare = opt('compare', '');
const pick = opt('files', '')
  .split(',')
  .filter(Boolean)
  .map(p => p + '-');
const files = fs
  .readdirSync(pristine)
  .filter(f => f.endsWith('.draft') && (!pick.length || pick.some(p => f.startsWith(p))))
  .sort((a, b) => order(a) - order(b));
function order(f) {
  return ['s-', 'm-', 'l-', 'xl-', 'seq-'].findIndex(p => f.startsWith(p));
}
const short = f => f.split('-')[0];

const LOAD = 1000,
  INTERACTIVE = 200;
const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
function record(group, action, budget, file, xs) {
  const ok = xs.filter(Number.isFinite);
  const ms = ok.length ? Math.round(median(ok)) : null;
  results.push({ group, action, budget, file: short(file), ms });
  console.error(`${action.padEnd(32)} ${short(file).padEnd(4)} ${ms ?? '-'} ms`);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftably-bench-'));
const restore = f => fs.copyFileSync(path.join(pristine, f), path.join(dir, f));
// Edits start from a source never seen before, so no run reuses a layout an earlier run cached.
let fresh = 0;
const restoreFresh = f =>
  fs.writeFileSync(
    path.join(dir, f),
    `${fs.readFileSync(path.join(pristine, f), 'utf8')}\n# bench ${process.pid} ${fresh++}\n`,
  );
files.forEach(restore);

// Build once so no timed command pays for a rebuild.
execFileSync(process.execPath, [path.join(root, 'scripts/draftably.mjs'), '--version'], {
  stdio: 'ignore',
});
const cli = path.join(root, 'dist-cli/main.js');

if (only === 'host') {
  // The host contract budgets have their own script; `pnpm bench:host` runs it alone.
  execFileSync('pnpm', ['bench:host', '--runs', String(runs)], { cwd: root, stdio: 'inherit' });
  process.exit(0);
}

if (only !== 'ui') {
  const time = args => {
    const t = performance.now();
    spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    return performance.now() - t;
  };
  const firstNode = f => fs.readFileSync(path.join(pristine, f), 'utf8').match(/^node (\S+)/m)[1];
  const commands = {
    check: f => ['check', f],
    'check --metrics': f => ['check', f, '--metrics'],
    'inspect --png': f => ['inspect', f, '--png', path.join(dir, 'out.png'), '--scale', '1'],
    'set (edit a label)': f => ['set', f, firstNode(path.basename(f)), 'label=Renamed box'],
  };
  for (const [name, args] of Object.entries(commands))
    for (const f of files) {
      const xs = [];
      for (let i = 0; i < runs; i++) {
        restore(f);
        xs.push(time(args(path.join(dir, f))));
      }
      record('CLI', name, null, f, xs);
    }
  files.forEach(restore);
}

if (only !== 'cli') await viewer();

function table(rows, before) {
  const cols = [...new Set(rows.map(r => r.file))];
  const key = r => `${r.group}|${r.action}|${r.file}`;
  const old = new Map((before ?? []).map(r => [key(r), r.ms]));
  const fmt = n => (n == null ? '–' : n.toLocaleString('en-US'));
  const lines = [
    `| Action | Budget | ${cols.join(' | ')} |`,
    `| --- | ---: | ${cols.map(() => '---:').join(' | ')} |`,
  ];
  for (const action of [...new Set(rows.map(r => `${r.group}|${r.action}`))]) {
    const of = rows.filter(r => `${r.group}|${r.action}` === action);
    const budget = of[0].budget;
    const cells = cols.map(c => {
      const r = of.find(x => x.file === c);
      if (!r) return '';
      const was = old.get(key(r));
      const over = budget && r.ms != null && r.ms > budget ? ' ✗' : '';
      return (was != null && before ? `${fmt(was)} → ` : '') + fmt(r.ms) + over;
    });
    lines.push(
      `| ${of[0].group}: ${of[0].action} | ${budget ? fmt(budget) : ''} | ${cells.join(' | ')} |`,
    );
  }
  return lines.join('\n');
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(results, null, 1));
const md = table(results, compare ? JSON.parse(fs.readFileSync(compare, 'utf8')) : null);
console.log(md);
console.log(`\nms, median of ${runs}; ✗ over budget. Results: ${path.relative(root, out)}`);
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Benchmark\n\n${md}\n`);
fs.rmSync(dir, { recursive: true, force: true });

async function viewer() {
  const { chromium } = await import('playwright-core');
  const server = await startViewer({
    entry: path.join(root, 'scripts/draftably.mjs'),
    file: dir,
    cwd: root,
  });
  const base = server.url.replace(/[?#].*$/, '').replace(/\/$/, '');
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(helpers);
  const page = await ctx.newPage();
  const now = () => page.evaluate(() => performance.now());
  const settleFrom = start => page.evaluate(s => window.__settle(s), start);
  const open = async (f, p = page) => {
    await p.goto(`${base}/?file=${f}`);
    return p.evaluate(() => window.__settle(0));
  };
  const ids = f =>
    [...fs.readFileSync(path.join(pristine, f), 'utf8').matchAll(/^node (\S+)/gm)].map(m => m[1]);
  const boxOf = id => page.locator(`[data-kind="node"][data-id="${id}"]`).first().boundingBox();
  const ui = (action, budget, f, xs) => record('Viewer', action, budget, f, xs);

  try {
    for (const f of files) {
      const cold = [],
        warm = [];
      for (let i = 0; i < runs; i++) {
        restore(f);
        const tab = await ctx.newPage();
        cold.push(await open(f, tab));
        await tab.reload();
        warm.push(await tab.evaluate(() => window.__settle(0)));
        await tab.close();
      }
      ui('open in a new tab', LOAD, f, cold);
      ui('reload', LOAD, f, warm);
      // A source the viewer has never compiled, as after an agent writes a new file.
      const fresh = [];
      for (let i = 0; i < runs; i++) {
        fs.appendFileSync(path.join(dir, f), `\n# bench ${Date.now()} ${i}\n`);
        const tab = await ctx.newPage();
        fresh.push(await open(f, tab));
        await tab.close();
        restore(f);
      }
      ui('open a never-seen source', LOAD, f, fresh);
    }

    for (const f of files) {
      const xs = [];
      for (let i = 0; i < runs; i++) {
        await open(f === files[0] ? files[1] : files[0]);
        const start = await now();
        await page.locator(`a[href$="file=${f}"]`).first().click();
        await page.waitForFunction(name => location.search.includes(name), f);
        xs.push(await settleFrom(start));
      }
      ui('switch in the sidebar', LOAD, f, xs);
    }

    for (const f of files.filter(f => !f.startsWith('seq-'))) {
      const nodes = ids(f),
        target = nodes[Math.floor(nodes.length / 2)];
      restore(f);
      await open(f);
      let xs = [];
      for (let i = 0; i < runs; i++) {
        await page.keyboard.press('Escape');
        const b = await boxOf(target);
        const start = await now();
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        xs.push(await settleFrom(start));
      }
      ui('select a box', INTERACTIVE, f, xs);

      const gaps = [],
        drops = [];
      for (let i = 0; i < runs; i++) {
        restoreFresh(f);
        await open(f);
        const b = await boxOf(target),
          from = [b.x + b.width / 2, b.y + b.height / 2];
        await page.evaluate(() => window.__frames());
        await page.mouse.move(...from);
        await page.mouse.down();
        for (let s = 1; s <= 20; s++) await page.mouse.move(from[0] + 6 * s, from[1] + 3 * s);
        gaps.push(await page.evaluate(() => window.__framesStop()));
        const up = await now();
        await page.mouse.up();
        drops.push(await settleFrom(up));
      }
      ui('drag: worst frame', INTERACTIVE, f, gaps);
      ui('drag: drop to saved', INTERACTIVE, f, drops);

      const undo = [],
        redo = [];
      for (let i = 0; i < runs; i++) {
        let start = await now();
        await page.keyboard.press('Meta+z');
        undo.push(await settleFrom(start));
        start = await now();
        await page.keyboard.press('Meta+Shift+z');
        redo.push(await settleFrom(start));
      }
      ui('undo', INTERACTIVE, f, undo);
      ui('redo', INTERACTIVE, f, redo);

      const src = () => fs.readFileSync(path.join(dir, f), 'utf8'),
        shown = [];
      xs = [];
      for (let i = 0; i < runs; i++) {
        restoreFresh(f);
        await open(f);
        const count = await page.evaluate(() => window.diagramStudio.fileGeometry().nodes.length);
        const start = await now();
        fs.writeFileSync(
          path.join(dir, f),
          `${src()}\nnode bench_new "Added by bench"\nedge bench_e ${nodes[0]} -> bench_new\n`,
        );
        await page.waitForFunction(
          n => window.diagramStudio.fileGeometry().nodes.length > n,
          count,
          { timeout: 90000 },
        );
        shown.push((await now()) - start);
        xs.push(await settleFrom(start));
      }
      ui('file edit: new box drawn', INTERACTIVE, f, shown);
      ui('file edit: add node + edge', INTERACTIVE, f, xs);

      xs = [];
      for (let i = 0; i < runs; i++) {
        restoreFresh(f);
        await open(f);
        const start = await now();
        fs.writeFileSync(
          path.join(dir, f),
          src().replace(/^(node \S+ ")[^"]*"/m, `$1Relabeled ${i}"`),
        );
        await page.waitForFunction(
          t => window.diagramStudio.fileState().source.includes(t),
          `Relabeled ${i}`,
          { timeout: 90000 },
        );
        xs.push(await settleFrom(start));
      }
      ui('file edit: change a label', INTERACTIVE, f, xs);

      xs = [];
      for (let i = 0; i < runs; i++) {
        restoreFresh(f);
        await open(f);
        const start = await now();
        await page.evaluate(() => window.diagramStudio.addNode());
        await page.keyboard.press('Escape');
        xs.push(await settleFrom(start));
      }
      ui('add a box', INTERACTIVE, f, xs);

      xs = [];
      for (let i = 0; i < runs; i++) {
        restoreFresh(f);
        await open(f);
        const start = await now();
        await page.evaluate(() => window.diagramStudio.layout());
        xs.push(await settleFrom(start));
      }
      ui('automatic layout', INTERACTIVE, f, xs);

      xs = [];
      for (let i = 0; i < runs; i++) {
        await page.mouse.move(720, 450);
        await page.evaluate(() => window.__frames());
        for (let s = 0; s < 10; s++) await page.mouse.wheel(0, i % 2 ? 120 : -120);
        await page.evaluate(
          () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
        xs.push(await page.evaluate(() => window.__framesStop()));
      }
      ui('zoom: worst frame', INTERACTIVE, f, xs);

      xs = [];
      for (let i = 0; i < runs; i++) {
        const start = await now();
        await page.evaluate(() => window.diagramStudio.exportPng());
        xs.push((await now()) - start);
      }
      ui('export PNG', INTERACTIVE, f, xs);

      if ((await page.locator('.state-chip').count()) > 1) {
        xs = [];
        for (let i = 0; i < runs; i++) {
          const start = await now();
          await page.keyboard.press(']');
          xs.push(await settleFrom(start));
        }
        ui('next emphasis state', INTERACTIVE, f, xs);
        xs = [];
        for (let i = 0; i < runs; i++) {
          await open(f);
          const start = await now();
          await page.locator('.state-chip', { hasText: 'Grid' }).click();
          xs.push(await page.evaluate(s => window.__quietAfter(s), start));
        }
        ui('open Grid view', INTERACTIVE, f, xs);
      }
      restore(f);
    }
  } finally {
    await browser.close();
    await stopViewer(server);
    await sleep(50);
  }
}

// Runs in the page before any script.
function helpers() {
  window.__lt = [];
  new PerformanceObserver(l =>
    l.getEntries().forEach(e => window.__lt.push([e.startTime, e.duration])),
  ).observe({ type: 'longtask', buffered: true });
  window.__sig = () => {
    const d = window.diagramStudio;
    if (!d) return null;
    const f = d.fileState(),
      g = d.diagnostics();
    if (f.compiling || g.layoutBusy || f.status !== 'saved' || g.visibleNodes === 0) return null;
    return `${JSON.stringify(d.fileGeometry())}|${g.selected.join(',')}|${d.state?.() ?? ''}`;
  };
  window.__settle = async (t0, quiet = 250, max = 90000) => {
    let last = null,
      at = performance.now();
    while (performance.now() - t0 < max) {
      const s = window.__sig(),
        now = performance.now();
      if (s !== last) {
        last = s;
        at = now;
      } else if (s && now - at >= quiet) return at - t0;
      await new Promise(r => setTimeout(r, 10));
    }
    return NaN;
  };
  // The end of the last long task after `t0`, once the main thread has been quiet for 300 ms.
  window.__quietAfter = t0 =>
    new Promise(resolve => {
      const tick = () => {
        const last = window.__lt.at(-1),
          end = last ? last[0] + last[1] : 0;
        if (performance.now() - Math.max(end, t0) > 300) resolve(Math.max(0, end - t0));
        else setTimeout(tick, 20);
      };
      tick();
    });
  window.__frames = () => {
    window.__ft = [];
    window.__ftOn = true;
    const loop = t => {
      window.__ft.push(t);
      if (window.__ftOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  window.__framesStop = () => {
    window.__ftOn = false;
    const gaps = window.__ft.slice(1).map((t, i) => t - window.__ft[i]);
    return Math.max(0, ...gaps);
  };
}

// The host contract budgets run after the CLI and viewer rows.
if (!only)
  execFileSync('pnpm', ['bench:host', '--runs', String(runs)], { cwd: root, stdio: 'inherit' });
