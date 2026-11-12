#!/usr/bin/env node
/**
 * Two editors on one page keep separate sessions (issue #475). Serves
 * tests/browser/two-editors.html through Vite, then drags, selects, adds and undoes in one editor
 * with real mouse and keys and checks the other editor's document, selection and source are
 * untouched. Screenshots go to tmp/proof-editors/.
 *
 * Usage: pnpm prove:editors
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createProof, same, sleep, waitFor } from './lib/proof.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const proof = createProof(path.join(root, 'tmp/proof-editors'));
const { check } = proof;

const server = await createServer({ root, server: { port: 0 }, logLevel: 'error' });
await server.listen();
const url = `${server.resolvedUrls.local[0]}tests/browser/two-editors.html`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
proof.watch(page);

/** What one editor holds: source, node positions, selection, undo depth and onChange count. */
const state = i =>
  page.evaluate(i => {
    const { session, source } = window.editors[i];
    return {
      source: source(),
      nodes: session.doc.layout.nodes,
      ids: session.doc.graph.nodes.map(n => n.id),
      selected: session.selectedIds(),
      canUndo: session.canUndo(),
      changes: window.changes[i].length,
    };
  }, i);
const node = (side, id) =>
  page.locator(`#${side} [data-kind="node"][data-id="${id}"]`).first().boundingBox();
const center = box => [box.x + box.width / 2, box.y + box.height / 2];
const idle = i =>
  waitFor(
    page,
    `!window.editors[${i}].session.fileCompiling() && !window.editors[${i}].session.layoutBusy()`,
    `editor ${i} idle`,
  );

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
  check(
    'each editor shows its own source',
    left0.source.includes('Left start') && right0.source.includes('Right start'),
  );

  // Drag Left's node a down by 120 px.
  const from = center(await node('left', 'a'));
  await page.mouse.move(...from);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(from[0] + i * 4, from[1] + i * 10);
  await page.mouse.up();
  await idle(0);
  await waitFor(page, () => window.changes[0].length > 0, 'left change');
  const left1 = await state(0),
    right1 = await state(1);
  check('drag in Left writes Left source', left1.source !== left0.source && left1.changes > 0);
  check(
    'drag in Left leaves Right untouched',
    same(right1.nodes, right0.nodes) && right1.source === right0.source && right1.changes === 0,
  );
  check(
    'Left selects what it dragged; Right selects nothing',
    same(left1.selected, ['a']) && !right1.selected.length,
  );

  // Select b in Right; Left keeps its own selection.
  await page.mouse.click(...center(await node('right', 'b')));
  const left2 = await state(0),
    right2 = await state(1);
  check(
    'selection is per editor',
    same(right2.selected, ['b']) && same(left2.selected, ['a']),
    `left ${left2.selected} right ${right2.selected}`,
  );

  // Add a node in Right with N, then end the label with Escape.
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  // Type once the new node's label editor has focus.
  await waitFor(
    page,
    () => {
      const el = document.activeElement;
      return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
    },
    'label editor focus',
  );
  await page.keyboard.type('Right extra');
  await page.keyboard.press('Enter');
  await idle(1);
  await waitFor(page, () => window.editors[1].session.doc.graph.nodes.length === 3, 'right node');
  // The source catches up with the document after the edit settles.
  await waitFor(page, () => /Right extra/.test(window.editors[1].source()), 'right source');
  const left3 = await state(0),
    right3 = await state(1);
  check('N in Right adds to Right only', right3.ids.length === 3 && same(left3.ids, left1.ids));
  check('Right source has the new node', /Right extra/.test(right3.source));
  await page.screenshot({ path: path.join(proof.out, 'after-edits.png') });

  // Undo in Left: the drag goes back, Right keeps its node.
  await page.mouse.click(...center(await node('left', 'b')));
  await page.keyboard.press('ControlOrMeta+z');
  await idle(0);
  const left4 = await state(0),
    right4 = await state(1);
  check(
    'undo in Left restores Left only',
    left4.source === left0.source && right4.ids.length === 3 && right4.source === right3.source,
    left4.source === left0.source ? '' : left4.source,
  );
  await page.screenshot({ path: path.join(proof.out, 'after-undo.png') });

  // The canvas shortcuts a bare editor keeps, in Right. Left stays as it was.
  const right = () => page.evaluate(() => window.editors[1].session.doc);
  await page.mouse.click(...center(await node('right', 'b')));
  const bx = (await right()).layout.nodes.b.x;
  // Arrows act on the canvas or a shape with focus; a click leaves focus on the page.
  await page.locator('#right [data-kind="node"][data-id="b"]').first().focus();
  await page.keyboard.press('ArrowRight');
  await idle(1);
  const moved = (await right()).layout.nodes.b.x;
  check('arrow nudges the selection', moved === bx + 1, `${bx} -> ${moved}`);

  const edges = (await right()).graph.edges.length;
  await page.keyboard.press('c');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  // Both editors have shapes a and b; Tab must focus the shape in this editor, not the page's first.
  check(
    'Tab focuses a shape in the same editor',
    await page.evaluate(() => !!document.activeElement?.closest('#right')),
  );
  await page.keyboard.press('Enter');
  await idle(1);
  check(
    'C, Enter, Tab, Enter connects two shapes',
    (await right()).graph.edges.length === edges + 1,
  );
  await page.keyboard.press('Escape');

  // Clipboard shortcuts need the OS clipboard; send the events they fire instead.
  await page.mouse.click(...center(await node('right', 'b')));
  const count = (await right()).graph.nodes.length;
  await page.evaluate(() => {
    const target = document.querySelector('#right [data-kind="node"][data-id="b"]');
    const data = new DataTransfer();
    target.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true }));
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
  });
  await idle(1);
  check('copy and paste duplicate the shape', (await right()).graph.nodes.length === count + 1);
  await page.keyboard.press('Delete');
  await idle(1);
  check('Delete removes the pasted shape', (await right()).graph.nodes.length === count);
  check('shortcuts in Right leave Left untouched', (await state(0)).source === left4.source);

  // A press on the page outside every editor ends shortcuts that reach the page body.
  await page.mouse.click(...center(await node('right', 'b')));
  const kept = (await right()).graph.nodes.length;
  await page.mouse.click(6, 6);
  await page.keyboard.press('Delete');
  await sleep(200);
  check(
    'a key after a click on page whitespace reaches no editor',
    (await right()).graph.nodes.length === kept,
  );
  await page.screenshot({ path: path.join(proof.out, 'after-whitespace.png') });

  // A destroyed editor stops being the target of shortcuts.
  await page.mouse.click(...center(await node('right', 'b')));
  await page.evaluate(() => window.editors[1].destroy());
  await page.keyboard.press('Delete');
  await page.keyboard.press('ControlOrMeta+z');
  await sleep(200);
  check('a destroyed editor takes no shortcuts', (await state(0)).source === left4.source);
} catch (error) {
  check('proof ran to completion', false, error.message);
} finally {
  await proof.capture();
  await browser.close();
  await server.close();
  proof.finish(url);
}
