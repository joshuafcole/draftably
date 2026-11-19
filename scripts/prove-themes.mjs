#!/usr/bin/env node
/**
 * End-to-end proof for diagram themes (docs/CHECKS.md, "Themes in file mode").
 *
 * Opens a temporary copy of examples/theme-proof.draft through `pnpm draftably open` on its own
 * port and checks, in Chromium with the bundled fonts:
 *   1. Fieldnotes: serif titles that fit their shapes, group titles clear of their content,
 *      browser geometry equal to `draftably inspect`, and SVG/PNG exports that carry the fonts.
 *   2. A shade change saves to the file without moving anything; a restart reopens the same file.
 *   3. Invalid theme source keeps the last drawing; padding changes keep pins and explicit sizes.
 *   4. All five themes from source, each matching `draftably inspect`, with titles that fit.
 *   5. The appearance menu: choosing a theme and padding saves to the file; undo and redo.
 * Screenshots and exports go to tmp/proof-themes/.
 *
 * Run `pnpm build` first. Usage: pnpm prove:themes
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = path.join(root, 'scripts/draftably.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-themes-'));
const file = path.join(dir, 'theme-proof.draft');
const out = path.join(root, 'tmp/proof-themes');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'examples/theme-proof.draft'), file);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const cli = (...args) =>
  execFileSync(process.execPath, [entry, ...args], { cwd: dir, encoding: 'utf8' });
const inspect = () => JSON.parse(cli('inspect', file, '--json'));
const read = () => fs.readFileSync(file, 'utf8');
const write = text => fs.writeFileSync(file, text);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A free local port, so the proof never reuses someone else's server. */
const freePort = () =>
  new Promise(resolve => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
const port = await freePort();

function start() {
  const child = spawn(
    process.execPath,
    [entry, 'open', file, '--port', String(port), '--no-open'],
    {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  return new Promise((resolve, reject) => {
    child.stdout.on('data', chunk => String(chunk).includes('Viewer:') && resolve(child));
    child.once('exit', code => reject(Error(`draftably open exited with ${code}`)));
  });
}
const stop = child =>
  new Promise(resolve => {
    child.once('exit', resolve);
    child.kill('SIGTERM');
  });

async function waitFor(page, test, label, timeout = 5000, arg) {
  const until = Date.now() + timeout;
  for (;;) {
    if (await page.evaluate(test, arg).catch(() => false)) return true;
    if (Date.now() > until) throw Error(`Timed out waiting for ${label}`);
    await sleep(50);
  }
}
async function settled(page) {
  await waitFor(
    page,
    () => {
      const state = window.diagramStudio.fileState();
      return state.status === 'saved' && !state.compiling;
    },
    'saved',
  );
  const shown = await page.evaluate(() => window.diagramStudio.fileState().source);
  const until = Date.now() + 2000;
  while (read() !== shown && Date.now() < until) await sleep(50);
  return read() === shown;
}
/** Wait until the viewer shows the file's current source. */
const caughtUp = page =>
  waitFor(
    page,
    // The source arrives before its layout, which compiles in the engine worker.
    text => {
      const state = window.diagramStudio.fileState();
      return state.source === text && !state.compiling;
    },
    'file update',
    5000,
    read(),
  );
const browserGeometry = page => page.evaluate(() => window.diagramStudio.fileGeometry());

async function shot(page, name) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('1');
  await sleep(300);
  await page.screenshot({ path: path.join(out, name) });
}

/**
 * Real text bounds against each shape's usable interior, measured with the loaded fonts.
 * Returns the worst overflow in pixels and its node.
 */
const textFit = page =>
  page.evaluate(() => {
    let worst = { by: 0, id: '', count: 0 };
    for (const node of document.querySelectorAll('.scene .node')) {
      const title = node.querySelector('.node-title'),
        shape = node.querySelector('.node-shape');
      if (!title || !shape) continue;
      worst.count++;
      const t = title.getBBox(),
        s = shape.getBBox(),
        tag = shape.tagName;
      // Diamonds: the text block's corners must sit inside the outline.
      let by = 0;
      if (tag === 'path') {
        const cx = s.x + s.width / 2,
          cy = s.y + s.height / 2;
        for (const [x, y] of [
          [t.x, t.y],
          [t.x + t.width, t.y],
          [t.x, t.y + t.height],
          [t.x + t.width, t.y + t.height],
        ])
          by = Math.max(
            by,
            (Math.abs(x - cx) / (s.width / 2) + Math.abs(y - cy) / (s.height / 2) - 1) * 40,
          );
      } else
        by = Math.max(
          s.x - t.x,
          t.x + t.width - (s.x + s.width),
          s.y - t.y,
          t.y + t.height - (s.y + s.height),
        );
      if (by > worst.by) worst = { ...worst, by: Math.round(by * 10) / 10, id: node.dataset.id };
    }
    return worst;
  });

/** Group titles must end above their content area and inside the frame. */
const groupClearance = page =>
  page.evaluate(() => {
    const geometry = window.diagramStudio.fileGeometry().nodes;
    let worst = { by: -Infinity, id: '' };
    for (const group of document.querySelectorAll('.scene .group')) {
      const id = group.dataset.id,
        title = group.querySelector('.group-title').getBBox(),
        frame = geometry.find(n => n.id === id),
        kids = geometry.filter(n => n.parent === id);
      const top = Math.min(...kids.map(k => k.y - frame.y));
      const by = Math.max(title.y + title.height - top, title.x + title.width - frame.w);
      if (by > worst.by) worst = { by: Math.round(by * 10) / 10, id };
    }
    return worst;
  });

const titleFont = page =>
  page.evaluate(() => {
    const title = document.querySelector('.scene .node-title'),
      group = document.querySelector('.scene .group-title');
    const font = getComputedStyle(title).fontFamily;
    return {
      node: font,
      group: getComputedStyle(group).fontFamily,
      loaded: document.fonts.check(`600 15px ${font}`),
    };
  });

/** Render a standalone SVG in a fresh page with no app CSS, as a separate viewer would. */
async function renderStandalone(browser, svg, name) {
  const page = await browser.newPage({ deviceScaleFactor: 1.5 });
  await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
  await page.evaluate(() => document.fonts.ready);
  await sleep(200);
  const faces = await page.evaluate(() =>
    [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/"/g, '')),
  );
  await page
    .locator('svg')
    .first()
    .screenshot({ path: path.join(out, name) });
  await page.close();
  return faces;
}

let server = await start();
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  // 1. Fieldnotes from source.
  await page.goto(`http://127.0.0.1:${port}/?file=${path.basename(file)}`);
  await waitFor(page, () => !!window.diagramStudio?.fileState, 'viewer');
  await page.evaluate(() => document.fonts.ready);
  check(
    'Fieldnotes geometry matches draftably inspect',
    same(await browserGeometry(page), inspect()),
  );
  const fonts = await titleFont(page);
  check(
    'node and group titles use the loaded serif',
    fonts.node.includes('Draft Source Serif') &&
      fonts.group.includes('Draft Source Serif') &&
      fonts.loaded,
    fonts.node,
  );
  const fit = await textFit(page);
  check(
    'every title fits inside its shape',
    fit.by <= 0.5 && fit.count === 9,
    `${fit.count} titles, worst ${fit.by}px ${fit.id}`,
  );
  const clear = await groupClearance(page);
  check('group titles clear their content', clear.by < 0, `closest ${clear.by}px ${clear.id}`);
  await shot(page, 'm1-fieldnotes-canvas.png');

  const browserSvg = await page.evaluate(() => window.diagramStudio.exportSvg());
  fs.writeFileSync(path.join(out, 'm1-fieldnotes-browser.svg'), browserSvg);
  const browserFaces = await renderStandalone(browser, browserSvg, 'm1-fieldnotes-browser-svg.png');
  check(
    'browser SVG embeds and renders the serif',
    browserSvg.includes("font-family:'Draft Source Serif'") &&
      browserFaces.includes('Draft Source Serif') &&
      browserSvg.includes('"appearance":{"theme":"fieldnotes"'),
    browserFaces.join(', '),
  );
  const cliSvg = cli('inspect', file, '--svg');
  fs.writeFileSync(path.join(out, 'm1-fieldnotes-cli.svg'), cliSvg);
  const cliFaces = await renderStandalone(browser, cliSvg, 'm1-fieldnotes-cli-svg.png');
  check(
    'CLI SVG embeds and renders the serif',
    cliFaces.includes('Draft Source Serif'),
    cliFaces.join(', '),
  );
  const png = await page.evaluate(() => window.diagramStudio.exportPng());
  fs.writeFileSync(
    path.join(out, 'm1-fieldnotes-export.png'),
    Buffer.from(png.split(',')[1], 'base64'),
  );
  check(
    'PNG export renders',
    png.startsWith('data:image/png') && png.length > 20000,
    `${png.length} chars`,
  );

  // 2. A shade is a repaint: saved to the file, nothing moves; restart and reopen.
  const before = inspect();
  await page.evaluate(() => {
    window.diagramStudio.select('dispatch');
    window.diagramStudio.setShade(800);
  });
  check('shade edit saved', await settled(page));
  check(
    'file holds the shade',
    /^node dispatch "Dispatch technician" in=field shade=800$/m.test(read()),
  );
  check('shade change moves nothing', same(inspect(), before));
  await stop(server);
  server = await start();
  await page.reload();
  await waitFor(page, () => !!window.diagramStudio?.fileState, 'viewer after restart');
  check('reopened file matches draftably inspect', same(await browserGeometry(page), inspect()));
  check(
    'reopened shade is shown',
    await page.evaluate(() => window.diagramStudio.get().styles.dispatch.shade === 800),
  );

  // 3. Failure cases from outside the viewer.
  const good = read();
  write(good.replace('theme fieldnotes', 'theme parchment'));
  await waitFor(page, () => window.diagramStudio.fileState().status === 'invalid', 'invalid theme');
  const invalid = await page.evaluate(() => document.body.innerText);
  check(
    'invalid theme keeps the drawing and names the line',
    /Line 2: Unknown theme parchment/.test(invalid) && same(await browserGeometry(page), before),
  );
  write(good);
  await caughtUp(page);
  const pinned = inspect().nodes.find(n => n.id === 'close');
  write(good.replace('theme fieldnotes', 'theme fieldnotes padding-x=28 padding-y=30'));
  await caughtUp(page);
  const padded = inspect();
  const close = padded.nodes.find(n => n.id === 'close'),
    triage = padded.nodes.find(n => n.id === 'triage');
  check(
    'padding keeps pins and explicit sizes',
    close.x === pinned.x && close.y === pinned.y && triage.w === 200 && triage.h === 104,
  );
  check('padded file matches draftably inspect', same(await browserGeometry(page), padded));
  const diag = await page.evaluate(() => window.diagramStudio.fileState().diagnostics);
  check(
    'a title that no longer fits its size is reported',
    diag.some(d => d.code === 'text-overflow' && d.ids.includes('triage')),
  );
  write(good);
  await caughtUp(page);

  // 4. Every theme from source.
  for (const theme of ['drafting', 'fieldnotes', 'signal', 'ink', 'blueprint']) {
    write(good.replace('theme fieldnotes', `theme ${theme}`));
    await caughtUp(page);
    await page.evaluate(() => document.fonts.ready);
    const g = await browserGeometry(page),
      themeFit = await textFit(page),
      themeClear = await groupClearance(page);
    check(
      `${theme}: geometry matches inspect, titles fit, groups clear`,
      same(g, inspect()) && themeFit.by <= 0.5 && themeClear.by < 0,
      `fit ${themeFit.by}px ${themeFit.id}; clearance ${themeClear.by}px`,
    );
    if (theme === 'blueprint') {
      const f = await titleFont(page);
      check(
        'blueprint titles use the monospace face',
        f.node.includes('Draft JetBrains Mono'),
        f.node,
      );
    }
    await shot(page, `m2-${theme}.png`);
  }
  write(good);
  await caughtUp(page);

  // 5. The appearance menu writes the file.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await sleep(150);
  await page.screenshot({ path: path.join(out, 'm3-appearance-menu.png') });
  await page.getByRole('menuitemradio', { name: /Signal/ }).click();
  check('choosing a theme saved', await settled(page));
  check('file names the theme', /^theme signal$/m.test(read()));
  const padX = page.getByLabel('Horizontal padding');
  check('the menu stays open after choosing a theme', await padX.isVisible());
  if (!(await padX.isVisible())) await page.getByRole('button', { name: 'Appearance' }).click();
  await padX.fill('20');
  await padX.press('Enter');
  check('padding saved', await settled(page));
  check('file holds the padding', /^theme signal padding-x=20$/m.test(read()));
  check('menu edit matches draftably inspect', same(await browserGeometry(page), inspect()));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+z');
  await settled(page);
  const undone = /^theme signal$/m.test(read());
  await page.keyboard.press('Meta+z');
  await settled(page);
  const undoneTwice = /^theme fieldnotes$/m.test(read());
  await page.keyboard.press('Meta+Shift+z');
  await settled(page);
  check('undo and redo walk theme edits', undone && undoneTwice && /^theme signal$/m.test(read()));
  await shot(page, 'm3-signal-after-menu.png');
  check('no page errors', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  await stop(server);
  fs.rmSync(dir, { recursive: true, force: true });
}

const failed = results.filter(r => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed. Output: ${path.relative(root, out)}/`,
);
process.exit(failed.length ? 1 : 0);
