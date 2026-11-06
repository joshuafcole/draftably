#!/usr/bin/env node
/**
 * A host drives two read-only editors on one page. Serves tests/browser/view-state.html through
 * Vite, sets the selection and hover from outside, then clicks, drags, double-clicks and presses
 * keys in one editor and checks what each session reports and that no drawing moves.
 * Screenshots go to tmp/proof-view-state/.
 *
 * Usage: pnpm prove:view-state
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createProof, same, sleep, waitFor } from './lib/proof.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proof = createProof(path.join(root, 'tmp/proof-view-state'));
const { check } = proof;

const server = await createServer({ root, server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}tests/browser/view-state.html`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
proof.watch(page);

/** What one editor holds and has reported. */
const state = i =>
  page.evaluate(i => {
    const { session, source } = window.editors[i];
    return {
      source: source(),
      layout: JSON.stringify(session.doc.layout),
      camera: { ...session.doc.camera },
      selected: session.selectedIds(),
      hovered: session.hoveredId(),
      reports: JSON.parse(JSON.stringify(window.reports[i])),
    };
  }, i);
const box = (side, kind, id) =>
  page.locator(`#${side} [data-kind="${kind}"][data-id="${id}"]`).first().boundingBox();
const center = b => [b.x + b.width / 2, b.y + b.height / 2];

try {
  await page.goto(url);
  await waitFor(
    page,
    () => window.editors?.every(e => e.session.doc.graph.nodes.length),
    'editors',
  );
  await sleep(300);
  const left0 = await state(0),
    right0 = await state(1);

  // The host selects and hovers in Left only.
  await page.evaluate(() => {
    window.editors[0].session.showSelection(['b', 'ab']);
    window.editors[0].session.showHover('lane');
  });
  await sleep(50);
  const left1 = await state(0),
    right1 = await state(1);
  check('host selection reaches Left', same(left1.selected, ['b', 'ab']));
  check('host selection leaves Right alone', same(right1.selected, []));
  check('a host selection is not reported back', left1.reports.selected.length === 0);
  check(
    'Left draws the host selection and hover',
    (await page.locator('#left [data-id="b"].selected').count()) === 1 &&
      (await page.locator('#left [data-id="ab"].selected').count()) === 1 &&
      (await page.locator('#left [data-id="lane"].hovered').count()) === 1,
  );
  check(
    'Right draws neither',
    (await page.locator('#right .selected, #right .hovered').count()) === 0,
  );
  check(
    'selection moves nothing',
    left1.layout === left0.layout && same(left1.camera, left0.camera),
  );
  await page.screenshot({ path: path.join(proof.out, 'host-selection.png') });

  // The host selects in Right; Left keeps its own.
  await page.evaluate(() => window.editors[1].session.showSelection(['lane']));
  check(
    'each session keeps its own host selection',
    same((await state(0)).selected, ['b', 'ab']) && same((await state(1)).selected, ['lane']),
  );

  // The user clicks a node in Right: reported with its kind, Left hears nothing.
  await page.mouse.click(...center(await box('right', 'node', 'b')));
  const right2 = await state(1);
  check(
    'a click in Right reports the node',
    same(right2.reports.selected.at(-1), [{ id: 'b', kind: 'node' }]),
    JSON.stringify(right2.reports.selected),
  );
  check('Left hears nothing of it', (await state(0)).reports.selected.length === 0);
  check(
    'pointing at a shape reports its hover',
    right2.reports.hovered.some(h => h?.id === 'b' && h.kind === 'node'),
  );

  // A drag on a shape pans instead of moving it.
  const from = center(await box('right', 'node', 'a'));
  await page.mouse.move(...from);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from[0] + i * 8, from[1] + i * 4);
  await page.mouse.up();
  await sleep(100);
  const right3 = await state(1);
  check('a drag in read-only moves no shape', right3.layout === right0.layout);
  check('a drag in read-only pans', right3.camera.x !== right2.camera.x);
  check('and writes no source', right3.source === right0.source);

  // Double-click and Enter activate.
  await page.mouse.dblclick(...center(await box('right', 'node', 'b')));
  await sleep(50);
  const right4 = await state(1);
  check(
    'a double click activates the node',
    same(right4.reports.activated.at(-1), { id: 'b', kind: 'node' }),
    JSON.stringify(right4.reports.activated),
  );
  check(
    'and opens no inline editor',
    (await page.locator('#right .inline-editor, #right [contenteditable=true]').count()) === 0,
  );
  await page.evaluate(() => window.editors[1].session.showSelection(['ab']));
  await page.locator('#right [data-kind="edge"][data-id="ab"]').first().focus();
  await page.keyboard.press('Enter');
  check(
    'Enter activates the focused connection',
    same((await state(1)).reports.activated.at(-1), { id: 'ab', kind: 'edge' }),
  );
  // Edit shortcuts do nothing: N would add a shape, Delete would remove the selection.
  await page.keyboard.press('n');
  await page.keyboard.press('Delete');
  await sleep(100);
  const right5 = await state(1);
  check(
    'edit keys change nothing',
    right5.layout === right0.layout && right5.source === right0.source,
  );
  check('Left is as the host left it', same((await state(0)).selected, ['b', 'ab']));
  await page.screenshot({ path: path.join(proof.out, 'after-interaction.png') });
} catch (error) {
  check('proof ran to completion', false, error.message);
} finally {
  await proof.capture();
  await browser.close();
  await server.close();
  proof.finish(url);
}
