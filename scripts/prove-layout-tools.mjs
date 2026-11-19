#!/usr/bin/env node
/**
 * End-to-end proof for the layout tools in file mode (docs/CHECKS.md, "Layout tools in file mode").
 *
 * Opens a copy of examples/order-pipeline.draft through `pnpm draftably open` and drives the real
 * editor in Chromium: apply a Compare candidate (a layout recipe), run Improve, keep a timeline
 * step, paint with the brush (positions), add content from outside, and restart. After each step
 * the browser's geometry must match `draftably inspect` of the saved file. Screenshots go to
 * tmp/proof-layout/.
 *
 * Run `pnpm build` first. Usage: pnpm prove:layout
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import {
  createProof,
  same,
  sleep,
  startViewer,
  stopViewer,
  waitFor as wait,
} from './lib/proof.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-layout-proof-'));
const file = path.join(dir, 'pipeline.draft');
const proof = createProof(path.join(root, 'tmp/proof-layout'));
const { check } = proof;
fs.copyFileSync(path.join(root, 'examples/order-pipeline.draft'), file);

const cli = (...args) =>
  execFileSync(process.execPath, [path.join(root, 'scripts/draftably.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
const inspect = () => JSON.parse(cli('inspect', file, '--json'));
const read = () => fs.readFileSync(file, 'utf8');
const stays = text => (text.match(/^stay /gm) ?? []).length;

const start = (port = 0) =>
  startViewer({ entry: path.join(root, 'scripts/draftably.mjs'), file, cwd: root, port });

// Engine layouts can take several seconds, so waits default to 30 seconds here.
const waitFor = (page, test, label, timeout = 30000) => wait(page, test, label, timeout);
/** Wait until a new revision is laid out, saved, and on disk. */
async function settled(page, previous) {
  const until = Date.now() + 15000;
  while (read() === previous && Date.now() < until) await sleep(50);
  await waitFor(
    page,
    () => {
      const state = window.diagramStudio.fileState();
      return state.status === 'saved' && !state.compiling;
    },
    'saved',
  );
  const shown = await page.evaluate(() => window.diagramStudio.fileState().source);
  return read() !== previous && read() === shown;
}
const browserGeometry = page => page.evaluate(() => window.diagramStudio.fileGeometry());
const matches = async (page, name) =>
  check(`${name}: viewer matches draftably inspect`, same(await browserGeometry(page), inspect()));

const shot = (_page, name) => proof.shot(name);

let server = await start();
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
proof.watch(page);
try {
  await page.goto(server.url);
  await waitFor(page, () => !!window.diagramStudio?.fileState, 'viewer');
  await waitFor(page, () => !window.diagramStudio.fileState().compiling, 'laid out');
  await matches(page, 'opened file');

  // 1. Compare: apply the first alternative. The file gets a layout recipe.
  let before = read();
  await page.keyboard.press('Alt+e');
  await waitFor(
    page,
    () =>
      !document.querySelector('.comparison-progress')?.textContent?.includes('Computing') &&
      !!document.querySelector('.candidate-card.current canvas, .candidate-card.current svg'),
    'candidates',
  );
  await page.screenshot({ path: path.join(proof.out, 'layout-1-compare.png') });
  check(
    'compare leads with the current drawing',
    (await page.locator('.candidate-card').first().textContent()).includes('Current drawing'),
  );
  await page.getByRole('button', { name: 'Apply' }).first().click();
  check('compare apply saved', await settled(page, before));
  check('compare wrote a recipe', /^layout root engine=[a-z-]+$/m.test(read()));
  await matches(page, 'recipe');
  await shot(page, 'layout-2-recipe.png');

  // 2. Improve: a bounded pass, saved as positions.
  before = read();
  await page.keyboard.press('l');
  check('improve saved', await settled(page, before));
  check('improve wrote positions', stays(read()) > 0, `${stays(read())} stays`);
  await matches(page, 'improve');

  // 3. Timeline: record, scrub to the middle, keep that step.
  before = read();
  await page.keyboard.press('Alt+t');
  await waitFor(page, () => !!document.querySelector('.timeline-deck input[type=range]'), 'deck');
  await waitFor(
    page,
    () => Number(document.querySelector('.timeline-deck input[type=range]').max) > 2,
    'recorded steps',
  );
  await page.evaluate(() => {
    const slider = document.querySelector('.timeline-deck input[type=range]');
    slider.value = String(Math.round(Number(slider.max) / 2));
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  await page.screenshot({ path: path.join(proof.out, 'layout-3-timeline.png') });
  await page.getByRole('button', { name: /Keep & edit/ }).click();
  check('timeline step saved', await settled(page, before));
  check('timeline step wrote positions', read() !== before && stays(read()) > 0);
  await matches(page, 'timeline step');

  // 4. Brush: one stroke across the middle of the drawing.
  before = read();
  await page.keyboard.press('1');
  await page.keyboard.press('w');
  const canvas = await page.locator('.canvas').boundingBox();
  const y = canvas.y + canvas.height / 2;
  await page.mouse.move(canvas.x + canvas.width * 0.3, y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i++)
    await page.mouse.move(canvas.x + canvas.width * (0.3 + i * 0.02), y);
  await page.mouse.up();
  check('brush stroke saved', await settled(page, before));
  await page.keyboard.press('w');
  await matches(page, 'brush');

  // 5. An agent adds a step; the saved arrangement holds and the new node fits in.
  const arranged = inspect();
  fs.appendFileSync(file, 'node audit "Audit trail" color=violet\nedge e13 ledger -> audit\n');
  await waitFor(
    page,
    () => window.diagramStudio.fileGeometry().nodes.some(n => n.id === 'audit'),
    'audit',
  );
  await waitFor(page, () => !window.diagramStudio.fileState().compiling, 'laid out');
  await matches(page, 'external addition');
  const added = inspect();
  const held = ['intake', 'web', 'partner', 'gateway'].filter(
    id =>
      !same(
        arranged.nodes.find(n => n.id === id),
        added.nodes.find(n => n.id === id),
      ),
  );
  check('distant arranged region stays put', held.length === 0, held.join(', '));
  await shot(page, 'layout-4-external-add.png');

  // 6. Restart: a fresh process and page draw the same thing.
  await stopViewer(server);
  server = await start(server.port);
  await page.reload();
  await waitFor(page, () => window.diagramStudio?.fileState().status === 'saved', 'reload');
  await waitFor(page, () => !window.diagramStudio.fileState().compiling, 'laid out');
  check('restart reproduces geometry', same(await browserGeometry(page), added));
} catch (error) {
  check('proof ran to completion', false, error.message);
} finally {
  await proof.capture();
  await browser.close();
  await stopViewer(server);
}

proof.finish(file);
