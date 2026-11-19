#!/usr/bin/env node
/**
 * End-to-end proof for editing a sequence diagram's messages with the keyboard.
 *
 * Opens a copy of examples/checkout-sequence.draft through `pnpm draftably open` and drives the
 * real editor in Chromium. One click selects a message; every step after it is a key press. It
 * checks that Tab adds a message and puts the caret in its label, and that a moved message keeps
 * the selection and the keys, so a second move needs no click. Screenshots go to
 * tmp/proof-sequence/.
 *
 * Run `pnpm build` first. Usage: pnpm prove:sequence
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createProof, sleep, startViewer, stopViewer, waitFor } from './lib/proof.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entry = process.env.DRAFTABLY_BIN ?? path.join(root, 'scripts/draftably.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-proof-sequence-'));
const file = path.join(dir, 'checkout.draft');
const proof = createProof(path.join(root, 'tmp/proof-sequence'));
const { check } = proof;
fs.copyFileSync(path.join(root, 'examples/checkout-sequence.draft'), file);

const read = () => fs.readFileSync(file, 'utf8');
/** The ids of the file's events, in file order. */
const events = () => [...read().matchAll(/^(?:edge|action) (\S+)/gm)].map(m => m[1]).join(' ');

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
const selected = page =>
  page.evaluate(() =>
    [...document.querySelectorAll('.edge.selected')].map(e => e.getAttribute('data-id')).join(' '),
  );
/** What holds the keyboard: the canvas, a message, or a field and its selected text. */
const focus = page =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      return `${el.closest('[aria-label="Inspector"]') ? 'inspector' : 'field'}:${el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0)}`;
    return el?.closest?.('.canvas') || el?.matches?.('.canvas') ? 'canvas' : (el?.tagName ?? '');
  });

const server = await startViewer({ entry, file, cwd: dir });
const browser = await chromium.launch({ channel: 'chromium' }).catch(async e => {
  await stopViewer(server);
  if (!/Executable doesn't exist/.test(e.message)) throw e;
  console.error(
    'The sequence proof needs full Chromium. Install it once with:\n\n  pnpm exec playwright-core install chromium\n',
  );
  process.exit(1);
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
proof.watch(page);
try {
  await page.goto(server.url);
  await waitFor(page, () => !!window.diagramStudio?.fileState, 'viewer');
  await page.evaluate(() => window.diagramStudio.ready());
  const start = 'm1 m2 m3 m4 m5 m6 m7 m8 m9 m10';
  check('the file opens with its ten events', events() === start, events());

  // Open the Inspector, where a new message gets its label.
  if (!(await page.locator('[role="complementary"][aria-label="Inspector"]').count()))
    await page.locator('button[aria-label="Inspector"]').first().click();
  // The last click of the proof: select the call "charge card". Keys do the rest.
  const line = await page.locator('[data-id="m5"] .edge-hit').first().boundingBox();
  await page.mouse.click(line.x + line.width / 3, line.y + line.height / 2);
  check('a click selects the message', (await selected(page)) === 'm5', await selected(page));

  // 1. Tab adds a message after it, selects it, and puts the caret in its label.
  await page.keyboard.press('Tab');
  check('insert saved', await settled(page));
  check(
    'Tab adds a message after the selected one, numbered after the file',
    events() === 'm1 m2 m3 m4 m5 m11 m6 m7 m8 m9 m10',
    events(),
  );
  check('the new message joins the phase', /^phase charge .* m5 m11 m6 m7$/m.test(read()));
  await sleep(500);
  check('the new message is selected', (await selected(page)) === 'm11', await selected(page));
  check(
    "the caret is in the Inspector's Label field, with the label selected",
    (await focus(page)) === 'inspector:message',
    await focus(page),
  );
  await page.keyboard.type('check the fraud score');
  await page.keyboard.press('Enter');
  check('label saved', await settled(page));
  check(
    'typing names the new message at once',
    read().includes('edge m11 orders -> pay "check the fraud score"'),
  );
  await proof.shot('1-inserted.png');

  // 2. Enter gave the keys back to the canvas, so Shift Tab adds one before it.
  check(
    'Enter hands the keys back to the canvas',
    (await focus(page)) === 'canvas',
    await focus(page),
  );
  await page.keyboard.press('Shift+Tab');
  check('second insert saved', await settled(page));
  check(
    'Shift Tab adds a message before the selected one',
    events() === 'm1 m2 m3 m4 m5 m12 m11 m6 m7 m8 m9 m10',
    events(),
  );
  await sleep(500);
  check('that message is selected too', (await selected(page)) === 'm12', await selected(page));

  // 3. Alt and an arrow move it, twice, with no click between. Enter keeps its label.
  await page.keyboard.press('Enter');
  await sleep(200);
  await page.keyboard.press('Alt+ArrowDown');
  check('move saved', await settled(page));
  check(
    'Alt ↓ moves the message one place down',
    events() === 'm1 m2 m3 m4 m5 m11 m12 m6 m7 m8 m9 m10',
    events(),
  );
  check(
    'the moved message keeps the selection',
    (await selected(page)) === 'm12',
    await selected(page),
  );
  check('the canvas keeps the keys', (await focus(page)) === 'canvas', await focus(page));
  await page.keyboard.press('Alt+ArrowDown');
  check('second move saved', await settled(page));
  check(
    'a second Alt ↓ moves it again, with no click',
    events() === 'm1 m2 m3 m4 m5 m11 m6 m12 m7 m8 m9 m10',
    events(),
  );
  await page.keyboard.press('Alt+ArrowUp');
  check('third move saved', await settled(page));
  check('Alt ↑ moves it back up', events() === 'm1 m2 m3 m4 m5 m11 m12 m6 m7 m8 m9 m10', events());
  check('the selection is still on it', (await selected(page)) === 'm12', await selected(page));
  await proof.shot('2-moved.png');

  // 4. A move the file cannot keep changes nothing and leaves the keys where they were.
  const bytes = read();
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowDown');
  check('moves inside the phase saved', await settled(page));
  const last = read();
  await page.keyboard.press('Alt+ArrowDown');
  await sleep(400);
  check('a move that would split a phase is refused', read() === last && last !== bytes, events());
  check(
    'the refused move keeps the selection',
    (await selected(page)) === 'm12',
    await selected(page),
  );
} catch (error) {
  check('proof ran to completion', false, error.message);
} finally {
  await proof.capture();
  await browser.close();
  await stopViewer(server);
}

proof.finish(file);
