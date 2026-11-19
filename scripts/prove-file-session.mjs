#!/usr/bin/env node
/**
 * End-to-end proof for file-backed editing (docs/CHECKS.md, "File-backed editing").
 *
 * Opens a copy of examples/checkout.draft through `pnpm draftably open`, drives the real editor in
 * Chromium (drag, pin, resize, undo/redo, camera), adds content to the file from outside,
 * restarts the server, and checks that the browser's geometry matches `draftably inspect` throughout.
 * Also checks invalid source and a stale save. Screenshots go to tmp/proof/.
 *
 * Run `pnpm build` first. Usage: pnpm prove:file
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createProof, same, sleep, startViewer, stopViewer, waitFor } from './lib/proof.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = process.env.DRAFTABLY_BIN ?? path.join(root, 'scripts/draftably.mjs');
const example = process.env.DRAFTABLY_EXAMPLE ?? path.join(root, 'examples/checkout.draft');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-proof-'));
const file = path.join(dir, 'architecture.draft');
const proof = createProof(path.join(root, 'tmp/proof'));
const { check } = proof;
fs.copyFileSync(example, file);

const cli = (...args) =>
  execFileSync(process.execPath, [entry, ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
const inspect = () => JSON.parse(cli('inspect', file, '--json'));
const read = () => fs.readFileSync(file, 'utf8');

const start = (port = 0) => startViewer({ entry, file, cwd: dir, port });
/** Wait until the viewer reports the file saved and the file holds what the viewer shows. */
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
const browserGeometry = page => page.evaluate(() => window.diagramStudio.fileGeometry());
const rect = (geometry, id) => geometry.nodes.find(n => n.id === id);
const center = box => [box.x + box.width / 2, box.y + box.height / 2];
const box = (page, id) => page.locator(`[data-id="${id}"]`).first().boundingBox();

/** Fit the view (camera only; the file does not change) and save a screenshot. */
const shot = (_page, name) => proof.shot(name);

async function drag(page, from, to) {
  await page.mouse.move(...from);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++)
    await page.mouse.move(
      from[0] + ((to[0] - from[0]) * i) / 12,
      from[1] + ((to[1] - from[1]) * i) / 12,
    );
  await page.mouse.up();
}

let server = await start();
// Playwright disables this by default, hiding retained live streams during ordinary navigation.
// Full Chromium, not the headless shell that `pnpm shoot` and the layout proof use.
const browser = await chromium
  .launch({ channel: 'chromium', ignoreDefaultArgs: ['--disable-back-forward-cache'] })
  .catch(async e => {
    await stopViewer(server);
    if (!/Executable doesn't exist/.test(e.message)) throw e;
    console.error(
      'The file proof needs full Chromium. Install it once with:\n\n  pnpm exec playwright-core install chromium\n',
    );
    process.exit(1);
  });
const page = await browser.newPage({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
});
proof.watch(page);
try {
  await page.goto(server.url);
  await waitFor(page, () => !!window.diagramStudio?.fileState, 'viewer');
  check('opened file matches draftably inspect', same(await browserGeometry(page), inspect()));

  // 1. Resize a group from its corner, making room below its row.
  const services = await box(page, 'services');
  await page.mouse.click(services.x + 90, services.y + 10);
  const corner = await page.locator('[data-resize="se"]').first().boundingBox();
  await drag(page, center(corner), [center(corner)[0] + 40, center(corner)[1] + 110]);
  check('resize saved', await settled(page));
  check(
    'resize wrote a requested group size',
    /^layout services row gap=56 min-width=\d+ min-height=\d+$/m.test(read()),
  );

  // 2. Drag a sibling inside the group: a relative preference, not coordinates.
  const orders = await box(page, 'orders'),
    payments = await box(page, 'payments');
  await drag(page, center(payments), [
    orders.x + orders.width / 2,
    orders.y + orders.height + 30 + payments.height / 2,
  ]);
  check('drag saved', await settled(page));
  check(
    'drag wrote a relative preference',
    /^near payments orders side=below gap=\d+/m.test(read()),
  );

  // 3. Pin another object.
  await page.mouse.click(...center(await box(page, 'api')));
  await page.keyboard.press('p');
  check('pin saved', await settled(page));
  check('pin wrote parent-local coordinates', /^pin api x=\d+ y=\d+$/m.test(read()));

  // 4. The camera is not part of the file.
  const bytes = read();
  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -400);
  await page.mouse.wheel(300, 0);
  await sleep(500);
  check('camera movement leaves the file unchanged', read() === bytes);

  // 5. Undo and redo write source.
  await page.keyboard.press('Meta+z');
  await settled(page);
  const undone = !/^pin api/m.test(read());
  await page.keyboard.press('Meta+Shift+z');
  await settled(page);
  check('undo and redo rewrite the file', undone && read() === bytes);

  const refined = inspect();
  check('refined file matches draftably inspect', same(await browserGeometry(page), refined));
  await shot(page, 'proof-1-refined.png');

  // 6. An agent adds a connected node to the same group.
  fs.appendFileSync(
    file,
    'node fraud "Fraud check" in=services\nedge score payments -> fraud "score"\n',
  );
  await waitFor(
    page,
    () => window.diagramStudio.fileGeometry().nodes.some(n => n.id === 'fraud'),
    'fraud',
  );
  const added = inspect(),
    text = read();
  check('external addition is visible', same(await browserGeometry(page), added));
  check(
    'comments and content survive',
    text.includes('# Customer-facing entry points.') && text.includes('# charges cards'),
  );
  const o = rect(added, 'orders'),
    p = rect(added, 'payments');
  const near = /^near payments orders side=below gap=(\d+)(?: offset=(-?\d+))?$/m.exec(text);
  check(
    'relative preference still holds',
    !!near &&
      p.y === o.y + o.h + Number(near[1]) &&
      p.x + p.w / 2 === o.x + o.w / 2 + Number(near[2] ?? 0),
  );
  const pin = /^pin api x=(\d+) y=(\d+)$/m.exec(text),
    platform = rect(added, 'platform'),
    api = rect(added, 'api');
  check(
    'pin holds in its group',
    !!pin &&
      api.x === platform.x + 24 + Number(pin[1]) &&
      api.y === platform.y + 48 + Number(pin[2]),
  );
  const steady = ['clients', 'web', 'mobile'].filter(
    id => !same(rect(refined, id), rect(added, id)),
  );
  check('distant region stays put', steady.length === 0, steady.join(', '));
  const notes = await page.evaluate(() => window.diagramStudio.fileState().diagnostics);
  // The wider platform lands on db: their stays went stale and were dropped (`stale-stay`), or
  // an anchor gave way (`relaxed`). Either way the movement is reported.
  const moved = ['platform', 'db'].filter(id => !same(rect(refined, id), rect(added, id)));
  check(
    'unavoidable movement is diagnosed',
    moved.every(id =>
      notes.some(n => (n.code === 'stale-stay' || n.code === 'relaxed') && n.ids.includes(id)),
    ),
    moved.length ? `moved: ${moved.join(', ')}` : 'nothing else moved',
  );
  await shot(page, 'proof-2-external-add.png');
  await page.locator('.file-notes button').click();
  await page.screenshot({ path: path.join(proof.out, 'proof-2-notes.png') });
  await page.locator('.file-notes button').click();

  // 7. Restart: a fresh process and a fresh page draw the same thing.
  await stopViewer(server);
  server = await start(server.port);
  await page.reload();
  await waitFor(page, () => window.diagramStudio?.fileState().status === 'saved', 'reload');
  check(
    'restart reproduces geometry',
    same(await browserGeometry(page), added) && same(inspect(), added),
  );
  await shot(page, 'proof-3-restart.png');

  // 8. Invalid source keeps the last drawing and pauses writes.
  const valid = read();
  fs.appendFileSync(file, 'edge broken api -> nowhere\n');
  await waitFor(page, () => !!document.querySelector('.file-banner'), 'error banner');
  await page.mouse.click(...center(await box(page, 'db')));
  await page.keyboard.press('p');
  await sleep(300);
  // Routes refined in a worker land a moment later on a slow machine.
  await waitFor(page, () => !window.diagramStudio.diagnostics().layoutBusy, 'routes');
  check(
    'invalid source keeps the last drawing and is not overwritten',
    same(await browserGeometry(page), added) && read().endsWith('edge broken api -> nowhere\n'),
  );
  await shot(page, 'proof-4-invalid.png');
  fs.writeFileSync(file + '.tmp', valid);
  fs.renameSync(file + '.tmp', file);
  await waitFor(page, () => !document.querySelector('.file-banner'), 'banner cleared');

  // 9. A stale save is refused; the agent's change wins until the user decides.
  await page.mouse.click(...center(await box(page, 'db')));
  fs.appendFileSync(file, 'node audit "Audit log"\n');
  await page.keyboard.press('p');
  await waitFor(
    page,
    () => /changed on disk before/.test(document.querySelector('.file-banner')?.textContent ?? ''),
    'conflict',
    3000,
  ).catch(() => false);
  const conflict = await page.locator('.file-banner').isVisible();
  check(
    'stale save is refused and the newer file is kept',
    conflict && read().includes('node audit') && !/^pin db/m.test(read()),
  );
  await shot(page, 'proof-5-conflict.png');
  if (conflict) await page.getByRole('button', { name: 'Keep file' }).click();

  // 10. Cached file pages must release their streams so navigation can exceed HTTP/1's six slots.
  const switchFiles = Array.from({ length: 9 }, (_, i) => `switch-${i}.draft`);
  for (const [i, name] of switchFiles.entries())
    fs.writeFileSync(path.join(dir, name), `diagram "Switch ${i}" version=1\nnode a "A"\n`);
  for (let i = 0; i < 12; i++) {
    const name = switchFiles[i % switchFiles.length];
    await page.goto(`${new URL(server.url).origin}/?file=${name}`, {
      waitUntil: 'commit',
      timeout: 5000,
    });
    await waitFor(page, () => window.diagramStudio?.fileState().status === 'saved', `switch ${i}`);
    await page.evaluate(() => {
      window.addEventListener('pageshow', event => {
        document.documentElement.dataset.proofCachedRestore = String(event.persisted);
      });
    });
  }
  check('file switching exceeds the browser connection limit without stalling', true);

  // A cached page misses disk changes while away; restoring it must reconnect and catch up.
  fs.writeFileSync(path.join(dir, switchFiles[1]), 'node restored "Changed while away"\n');
  await page.goBack({ waitUntil: 'commit' });
  check(
    'back navigation actually restores a cached page',
    await page.evaluate(() => document.documentElement.dataset.proofCachedRestore === 'true'),
  );
  await waitFor(
    page,
    () => window.diagramStudio?.fileState().source.includes('Changed while away'),
    'restored file catches up',
  );
  check('back navigation reconnects the cached file and catches up', true);
  await page.goForward({ waitUntil: 'commit' });
  await waitFor(
    page,
    () => window.diagramStudio?.fileState().source.includes('Switch 2'),
    'forward navigation',
  );
  check('forward navigation restores the next file', true);
} catch (error) {
  check('proof ran to completion', false, error.message);
} finally {
  await proof.capture();
  await browser.close();
  await stopViewer(server);
}

proof.finish(file);
