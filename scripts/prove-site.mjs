#!/usr/bin/env node
/**
 * The public site as a visitor reaches it (docs/intent/public-site/usability-audit-2026-10-29).
 *
 * Serves dist-site/ the way GitHub Pages does and drives it in Chromium with real clicks and keys:
 * the links between surfaces, narrow panes, docs overlays, New, Space and a Playground module that
 * fails to load. Direct URLs alone would miss most of these failures. Screenshots go to
 * tmp/proof-site/.
 *
 * Run `pnpm site:build` first. Usage: pnpm prove:site
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createProof, sleep, waitFor as wait } from './lib/proof.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist-site');
const proof = createProof(path.join(root, 'tmp/proof-site'));
const { check } = proof;
const BASE = '/draftably/';

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
};

/** A file by path, a folder's index.html, or 404.html with a 404: what GitHub Pages does. */
const server = http.createServer((req, res) => {
  const route = decodeURIComponent(new URL(req.url, 'http://site').pathname);
  const send = (file, status = 200) => {
    res.writeHead(status, { 'content-type': TYPES[path.extname(file)] ?? 'text/plain' });
    fs.createReadStream(file).pipe(res);
  };
  const local = path.join(dist, route.slice(BASE.length - 1));
  const file = [local, path.join(local, 'index.html'), `${local}.html`].find(
    f => route.startsWith(BASE) && fs.existsSync(f) && fs.statSync(f).isFile(),
  );
  send(file ?? path.join(dist, '404.html'), file ? 200 : 404);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const site = `http://127.0.0.1:${server.address().port}${BASE}`;

const browser = await chromium.launch();
const open = async (url, viewport = { width: 1440, height: 900 }, device = {}) => {
  // A new context each time: nothing kept in the browser leaks from one journey to the next.
  const context = await browser.newContext({ viewport, ...device });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  proof.watch(page);
  page.on('dialog', d => d.accept());
  await page.goto(`${site}${url}`);
  return page;
};
const FILE = '.menubar-item:has-text("File")';
const editorReady = page =>
  wait(page, () => !!document.querySelector('.canvas [data-id], .start'), 'the editor', 10000);
const focused = page =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute('aria-label') || el?.textContent?.trim().slice(0, 40) || el?.tagName;
  });
const inside = (page, selector) =>
  page.evaluate(s => !!document.activeElement?.closest(s), selector);
const setSource = async (page, text) => {
  await page.click('.cm-content');
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
};
const sourceText = page => page.evaluate(() => document.querySelector('.cm-content')?.textContent);

const journeys = {
  async 'diagram comparison page loads every rendered image at desktop and phone widths'() {
    for (const width of [1440, 390]) {
      const page = await open('docs/agent-diagram-evaluation', { width, height: 900 });
      const images = page.locator('.doc img[src*="/evaluations/agent-diagrams/"]');
      check(`Comparison shows images at ${width}px`, (await images.count()) > 0);
      for (const image of await images.all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(img => img.decode());
      }
      const loaded = await images.evaluateAll(list =>
        list.every(img => img.complete && img.naturalWidth > 0),
      );
      check(`Comparison images load at ${width}px`, loaded);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      check(`Comparison has no document overflow at ${width}px`, overflow <= 1, `${overflow}px`);
      await page.screenshot({ path: path.join(proof.out, `comparison-${width}-top.png`) });
      await page.context().close();
    }
  },
  async 'docs source links and source ZIP work under the nested base'() {
    const page = await open('docs/agent-diagram-evaluation', undefined, { acceptDownloads: true });
    await page.waitForSelector('.docs-search-button');
    const source = page.locator(
      '.doc a[href$="/evaluations/agent-diagrams/source/tooled/workflow/mermaid.mmd.txt"]',
    );
    const sourceUrl = await source.getAttribute('href');
    check('the source link keeps the nested site base', sourceUrl?.startsWith(BASE));
    const sourceNav = page.waitForNavigation();
    await source.click();
    const response = await sourceNav;
    const contentType = response?.headers()['content-type'] ?? '';
    const sourceBody = await response?.text();
    check(
      'the source link serves text, not the SPA fallback',
      response?.status() === 200 &&
        /text\/plain/.test(contentType) &&
        !/<!doctype html/i.test(sourceBody ?? ''),
      `${response?.status()} ${contentType}; at ${page.url()}`,
    );
    check(
      'the source document has its expected contents',
      /flowchart|graph/i.test(sourceBody ?? ''),
      (sourceBody ?? '').slice(0, 80),
    );
    await page.goBack();
    await page.waitForSelector('.doc');
    const backPath = new URL(page.url()).pathname.replace(/\/$/, '');
    check(
      'Back returns to the comparison docs under the nested base',
      backPath === `${BASE}docs/agent-diagram-evaluation`,
      backPath,
    );

    const zip = page.locator('.doc a[href$="/evaluations/agent-diagrams/sources.zip"]');
    const zipUrl = await zip.getAttribute('href');
    check('the ZIP link keeps the nested site base', zipUrl?.startsWith(BASE));
    const [download] = await Promise.all([page.waitForEvent('download'), zip.click()]);
    const archivePath = await download.path();
    const archive = archivePath && fs.readFileSync(archivePath);
    check(
      'the source download has the expected name',
      download.suggestedFilename() === 'sources.zip',
      download.suggestedFilename(),
    );
    check(
      'the source download is a nonempty ZIP archive',
      !!archive &&
        archive.length > 4 &&
        archive.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
      archive ? `${archive.length} bytes` : 'download has no local path',
    );
    await page.context().close();
  },

  async 'landing links reach the editor and carry edits'() {
    const page = await open('');
    await page.click('text=Open the editor');
    await editorReady(page);
    check('U01 the landing link shows the editor at once', await page.isVisible('.canvas, .start'));
    await page.goBack();
    await wait(page, () => !!document.querySelector('.live'), 'the landing page');
    check('U01 Back returns to the landing page', true);

    await page.waitForSelector('.live-source textarea');
    await page.fill(
      '.live-source textarea',
      'diagram "Landing edit" version=1\nnode a "My edit"\n',
    );
    await sleep(700);
    await page.click('.live-open');
    await editorReady(page);
    await wait(page, () => document.body.textContent.includes('My edit'), 'the edited node');
    check('U03 the landing demo carries edited source', true);
    await page.context().close();
  },

  async 'Playground return identifies its separate copy'() {
    const page = await open('play');
    await page.waitForSelector('.cm-content');
    await setSource(page, 'diagram "Playground copy" version=1\nnode a "Alpha"\n');
    await page.getByRole('button', { name: /open in the editor/i }).click();
    await editorReady(page);
    await page.fill('.title-input', 'Editor copy');
    await page.keyboard.press('Enter');
    await sleep(800);
    const back = page.getByRole('link', { name: 'Back to Playground (separate copy)' });
    check('Return to Playground identifies the separate copy', await back.isVisible());
    await back.click();
    await page.waitForSelector('.cm-content');
    check('Return retains Playground source', (await sourceText(page)).includes('Playground copy'));
    await page.goForward();
    await editorReady(page);
    check('Editor copy stays separate', (await page.inputValue('.title-input')) === 'Editor copy');
    await page.context().close();
  },

  async 'narrow Playground'() {
    for (const width of [390, 768]) {
      const page = await open('play', { width, height: 844 });
      await page.waitForSelector('.play-body');
      if (await page.isVisible('.play-tabs')) await page.click('.play-tabs >> text=Source');
      await sleep(200);
      const w = await page.evaluate(() => document.querySelector('.play-source').offsetWidth);
      check(`U02 the source pane is usable at ${width}px`, w > 200, `${w}px wide`);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      check(`F08 no sideways scroll at ${width}px`, over <= 0, `${over}px over`);
      const names = await page.evaluate(() => ({
        github: document.querySelector('.site-nav-gh')?.getAttribute('aria-label'),
        theme: document.querySelector('.play-source select')?.getAttribute('aria-label'),
      }));
      check(`U08 names stay at ${width}px`, names.github === 'GitHub' && names.theme === 'Theme');
      await page.context().close();
    }
  },

  async 'Playground keeps work and refuses a mixed export'() {
    const page = await open('play');
    await page.waitForSelector('.cm-content');
    await setSource(page, 'diagram "Audit keep" version=1\nnode keep "Keep this work"\n');
    await wait(page, () => /#s=/.test(location.hash), 'the source hash');
    await page.click('.site-nav >> text=Docs');
    await page.waitForSelector('.docs-search-button');
    await page.click('.site-nav >> text=Playground');
    await page.waitForSelector('.cm-content');
    await sleep(300);
    check('U06 the nav returns to the same work', (await sourceText(page)).includes('Audit keep'));

    await setSource(page, 'diagram "Audit keep" version=1\nnode keep "Keep"\nkeep -> nothing\n');
    await sleep(700);
    await page.click('.play-actions .menu-wrap > .tool');
    const blocked = await page.evaluate(() =>
      [...document.querySelectorAll('#download-menu button')]
        .filter(b => /svg|png/i.test(b.textContent))
        .every(b => b.disabled || b.getAttribute('aria-disabled') === 'true'),
    );
    check('F04 image export is blocked while the source has errors', blocked);
    await page.context().close();
  },

  async 'Playground reload keeps the current history entry'() {
    const page = await open('play?example=checkout');
    await page.waitForSelector('.cm-content');
    const custom = 'diagram "Immediate edit" version=1\nnode a "Alpha"\n';
    await setSource(page, custom);
    await page.reload();
    await page.waitForSelector('.cm-content');
    check(
      'Immediate reload retains edited source',
      (await sourceText(page)).includes('Immediate edit'),
    );
    await setSource(page, 'invalid source');
    await page.reload();
    await page.waitForSelector('.cm-content');
    check('Immediate reload retains invalid source', (await sourceText(page)) === 'invalid source');
    await setSource(page, '');
    await page.reload();
    await page.waitForSelector('.cm-content');
    check('Immediate reload retains empty source', (await sourceText(page)) === '');
    await setSource(page, custom);
    await wait(page, () => /#s=/.test(location.hash), 'the source hash');
    const shared = page.url();
    await page.click('.picker-button');
    await page.fill('.picker-search', 'Sign-in');
    await page.keyboard.press('Enter');
    await wait(page, () => location.search.includes('example='), 'the selected example');
    await wait(
      page,
      () => document.querySelector('.cm-content')?.textContent.includes('Sign-in sequence'),
      'the example source',
    );
    const example = await sourceText(page);
    await page.goBack();
    await wait(
      page,
      () => document.querySelector('.cm-content')?.textContent.includes('Immediate edit'),
      'the previous draft',
    );
    check('Back restores the draft', (await sourceText(page)).includes('Immediate edit'));
    await page.goForward();
    await wait(
      page,
      () => document.querySelector('.cm-content')?.textContent.includes('Sign-in sequence'),
      'the example again',
    );
    check('Forward restores the selected example', (await sourceText(page)) === example);
    await setSource(page, 'diagram "First edit" version=1\nnode a "A"\n');
    await setSource(page, 'diagram "Unrelated draft" version=1\nnode b "Beta"\n');
    await sleep(800);
    await page.reload();
    await page.waitForSelector('.cm-content');
    check(
      'The latest repeated edit survives',
      (await sourceText(page)).includes('Unrelated draft'),
    );
    const other = await page.context().newPage();
    await other.goto(shared);
    await other.waitForSelector('.cm-content');
    check(
      'A new shared link wins over an unrelated draft',
      (await sourceText(other)).includes('Immediate edit'),
    );
    await page.context().close();
  },

  async 'a late Playground hash cannot replace a newer edit'() {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      const Native = window.CompressionStream;
      window.CompressionStream = class {
        constructor(format) {
          const stream = new Native(format);
          this.writable = stream.writable;
          const hold = window.holdNextCompression;
          window.holdNextCompression = false;
          this.readable = stream.readable.pipeThrough(
            new TransformStream({
              async transform(chunk, controller) {
                if (hold) {
                  await new Promise(resolve => {
                    window.releaseCompression = resolve;
                  });
                }
                controller.enqueue(chunk);
              },
            }),
          );
        }
      };
    });
    const page = await context.newPage();
    proof.watch(page);
    await page.goto(`${site}play?example=checkout`);
    await page.waitForSelector('.cm-content');
    await page.evaluate(() => {
      window.holdNextCompression = true;
    });
    await setSource(page, 'diagram "Slow old" version=1\nnode a "A"\n');
    await wait(page, () => typeof window.releaseCompression === 'function', 'the held compression');
    await setSource(page, 'diagram "Fast new" version=1\nnode b "B"\n');
    await wait(page, () => /#s=/.test(location.hash), 'the newer hash');
    await page.evaluate(() => window.releaseCompression());
    await sleep(300);
    const other = await context.newPage();
    await other.goto(page.url());
    await other.waitForSelector('.cm-content');
    check(
      'A late hash does not replace the newer shared source',
      (await sourceText(other)).includes('Fast new'),
    );
    await context.close();
  },

  async 'native keys in the editor'() {
    const page = await open('app/?example=checkout');
    await editorReady(page);
    const held = () => page.evaluate(() => !!document.querySelector('.space-held'));
    const tabToFile = async () => {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        if ((await focused(page)) === 'File') return;
      }
    };
    await tabToFile();
    await page.keyboard.down('Space');
    check('#306 Space on a focused button starts no pan', !(await held()));
    await page.keyboard.up('Space');
    await page.waitForSelector('.popover');
    check('#306 Space opens the File menu', true);
    await page.keyboard.press('Escape');

    await page.click('.canvas', { position: { x: 5, y: 5 } });
    await page.keyboard.down('Space');
    check('#306 Space on the canvas holds the pan', await held());
    await page.keyboard.up('Space');
    check('#306 keyup releases the pan', !(await held()));

    await page.click('[role="toolbar"] button');
    await page.keyboard.down('Space');
    check('#306 Space still pans after a toolbar click', await held());
    await page.keyboard.up('Space');
    await page.context().close();
  },

  async 'New from an example'() {
    const page = await open('app/?example=checkout');
    await editorReady(page);
    const opened = page.url();
    await page.click(FILE);
    await page.click('.popover >> text="New diagram"');
    await page.waitForURL(url => url.href !== opened, { timeout: 5000 });
    await editorReady(page);
    check('#305 File › New leaves the example URL', !page.url().includes('example=checkout'));
    const status = await page.locator('.in-example').textContent();
    check('#305 the blank draft is not called an example', !/example/i.test(status), status);
    const bar = await page.locator('.example-bar').textContent();
    check('#305 the bar says draft', /Draft/.test(bar) && !/example/i.test(bar), bar.slice(0, 80));
    check('#305 the tab title drops the example', !/example|checkout/i.test(await page.title()));
    await page.fill('.title-input', 'Audit new draft');
    await page.keyboard.press('Enter');
    await sleep(800);
    await page.reload();
    await editorReady(page);
    const kept = await page.inputValue('.title-input');
    check('#305 the new draft survives a reload', kept === 'Audit new draft', kept);
    await page.screenshot({ path: path.join(proof.out, 'new-draft.png') });
    await page.context().close();

    const start = await open('app/?example=checkout');
    await editorReady(start);
    await start.click(FILE);
    // Timed in the page: drawing 25 thumbnails at once froze this click for seconds.
    const took = await start.evaluate(
      () =>
        new Promise(done => {
          const item = [...document.querySelectorAll('.popover .menu-item')].find(b =>
            b.textContent.startsWith('Start screen'),
          );
          const from = performance.now();
          item.click();
          requestAnimationFrame(() => setTimeout(() => done(performance.now() - from)));
        }),
    );
    await start.waitForSelector('.start-dialog');
    check('the start dialog paints within a second', took < 1000, `${Math.round(took)} ms`);
    const hint = await start.locator('.start-new').textContent();
    check('#305 the start dialog says what New does', /blank draft/.test(hint), hint.slice(0, 80));
    check(
      'the start dialog links home',
      new URL(await start.locator('.start-dialog .brand').getAttribute('href'), start.url())
        .pathname === new URL('..', start.url()).pathname,
    );
    await start.click('.start-new button');
    await start.waitForURL(url => url.search.includes('new'), { timeout: 5000 });
    await editorReady(start);
    check('#305 the start dialog opens the same draft', !start.url().includes('checkout'));
    await start.context().close();

    // The browser copy stays the promised path outside an example.
    const copy = await open('app/');
    await editorReady(copy);
    await copy.click('.start-new button');
    const ok = copy.locator(
      'dialog button:has-text("New diagram"), .dialog button:has-text("New diagram")',
    );
    if (await ok.count()) await ok.first().click();
    await sleep(300);
    await copy.fill('.title-input', 'Browser copy');
    await copy.keyboard.press('Enter');
    await sleep(800);
    await copy.goto(new URL('..', copy.url()).href);
    await copy.waitForSelector('.hero');
    const resume = await copy.locator('.hero-actions .button.primary').textContent();
    check('the landing page offers the diagram left in the editor', /Browser copy/.test(resume));
    await copy.screenshot({ path: path.join(proof.out, 'landing-resume.png') });
    await copy.goBack();
    await copy.reload();
    await copy.waitForSelector('.title-input');
    await sleep(300);
    check(
      '#305 a browser copy survives a reload',
      (await copy.inputValue('.title-input')) === 'Browser copy',
    );
    await copy.context().close();
  },

  async 'layout actions say what they change'() {
    const page = await open('app/?example=checkout');
    await editorReady(page);
    const button = page.locator('.toolbar button:has-text("Tidy")');
    await page.click('.menubar-item:has-text("Layout")');
    await page.click('.popover .menu-item:has-text("Arrange")');
    const panel = page.locator('.arrange-subject strong');
    check(
      '#307 nothing selected means the whole diagram',
      /Whole diagram/.test(await panel.textContent()),
    );
    // Click only once layout and routing settle; an early click can land on a moving edge, which
    // the status bar counts but the scope ignores.
    await page.evaluate(() => window.diagramStudio.ready());
    // The first fit can still move the canvas after ready(), so a click can select the item that
    // was under the pointer a frame earlier. Click again until `web` alone is selected.
    for (let attempt = 0; attempt < 4; attempt++) {
      await page.locator('.node[data-id="web"]').click({ force: true });
      const only = await page
        .waitForFunction(
          () => {
            const ids = [...document.querySelectorAll('.canvas .selected[data-id]')].map(
              e => e.dataset.id,
            );
            return ids.length === 1 && ids[0] === 'web';
          },
          null,
          { timeout: 1000 },
        )
        .then(() => true)
        .catch(() => false);
      if (only) break;
    }
    // Selection and the two scope labels update through separate reactive components. Wait for
    // both projections before checking them, and keep their final values in failure output.
    await page
      .waitForFunction(
        () => {
          const subject = document.querySelector('.arrange-subject strong')?.textContent ?? '';
          const hint =
            document
              .querySelector('.toolbar button[data-tip="Tidy"]')
              ?.getAttribute('data-tip-hint') ?? '';
          return /1 shape/.test(subject) && /the selection|this group/.test(hint);
        },
        null,
        { timeout: 2000 },
      )
      .catch(() => {});
    const selectedScope = (await panel.textContent())?.trim() ?? '(missing)';
    const selectedHint = (await button.getAttribute('data-tip-hint')) ?? '(missing)';
    const selectionStatus = `${
      (await page.locator('.statusbar > span').first().textContent())?.trim() ?? '(missing)'
    }; selected ${await page.evaluate(() =>
      JSON.stringify(
        [...document.querySelectorAll('.canvas .selected[data-id]')].map(e => e.dataset.id),
      ),
    )}`;
    check(
      '#307 a selection narrows the scope',
      /1 shape/.test(selectedScope),
      `observed ${JSON.stringify(selectedScope)}; status ${JSON.stringify(selectionStatus)}`,
    );
    check(
      '#307 the toolbar tooltip agrees',
      /the selection|this group/.test(selectedHint),
      `observed ${JSON.stringify(selectedHint)}; status ${JSON.stringify(selectionStatus)}`,
    );
    await page.screenshot({ path: path.join(proof.out, 'layout-panel.png') });
    await page.context().close();

    const phone = await open('app/?example=checkout', { width: 390, height: 844 });
    await editorReady(phone);
    await phone.click('.toolbar button:has-text("More")');
    await phone.click('.popover .menu-item:has-text("Layout")');
    const menu = await phone.locator('.popover').textContent();
    check('#307 the phone menu states the scope', /Small moves in the whole diagram/.test(menu));
    check('#307 the phone menu offers a comparison', /Compare alternatives/.test(menu));
    await phone.keyboard.press('Escape');
    check('F08 the phone shows where work is kept', await phone.isVisible('.save-status'));
    await phone.screenshot({ path: path.join(proof.out, 'phone-brand.png') });
    await phone.screenshot({ path: path.join(proof.out, 'phone-status.png') });
    await phone.screenshot({ path: path.join(proof.out, 'layout-menu.png') });
    await phone.click('.toolbar .brand');
    await phone.waitForSelector('.hero');
    check('the editor logo returns to the landing page', true);
    await phone.context().close();
  },

  async 'docs overlays'() {
    const page = await open('docs/cells');
    await page.waitForSelector('.docs-search-button');
    await page.focus('.docs-search-button');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.search input');
    check('F06 search focuses its input', await inside(page, '.search'));
    const modal = await page.evaluate(
      () => !!document.querySelector('dialog.search-backdrop:modal'),
    );
    check('F06 search is a modal dialog', modal);
    for (const [state, text] of [
      ['empty', ''],
      ['results', 'swim'],
      ['no-results', 'zzzqq'],
    ]) {
      await page.fill('.search input', text);
      let held = true;
      for (const keys of ['Shift+Tab', 'Shift+Tab', 'Tab', 'Tab', 'Tab', 'Tab']) {
        await page.keyboard.press(keys);
        // The page behind is inert, so focus can only rest in the dialog or leave the document.
        held &&= await page.evaluate(
          () =>
            !document.activeElement ||
            document.activeElement === document.body ||
            !!document.activeElement.closest('dialog'),
        );
      }
      check(`F06 Tab stays in search (${state})`, held, await focused(page));
      await page.focus('.search input');
    }
    await page.fill('.search input', 'zzzqq');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await sleep(100);
    check(
      'F06 a sample button keeps Enter',
      (await page.inputValue('.search input')) !== 'zzzqq',
      await page.inputValue('.search input'),
    );
    await page.keyboard.press('Tab');
    await page.keyboard.press('Escape');
    await sleep(100);
    check('F06 Escape closes search from any control', !(await page.isVisible('.search')));
    check('F06 focus returns to the search button', (await focused(page)) === 'Search docs');

    await page.click('.doc-example-bar >> text=Expand');
    await page.waitForSelector('.zoom');
    check('U05 focus enters the expanded drawing', await inside(page, '.zoom'));
    let held = true;
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Tab');
      held &&= await inside(page, '.zoom');
    }
    check('U05 Tab stays in the expanded drawing', held);
    const transform = () => page.locator('.zoom-paper').getAttribute('style');
    const fitted = await transform();
    await page.keyboard.press('+');
    await page.keyboard.press('ArrowLeft');
    check('U05 keys zoom and pan the drawing', (await transform()) !== fitted);
    await page.keyboard.press('Escape');
    check('U05 Escape closes the expanded drawing', !(await page.isVisible('.zoom')));
    check('U05 focus returns to the opener', (await focused(page)) === 'Expand');
    await page.context().close();
  },

  async 'the Playground fits examples and names them after Undo'() {
    const page = await open('play');
    await page.waitForSelector('.cm-content');
    const pick = async name => {
      await page.click('.picker-button');
      await page.fill('.picker-search', name);
      await page.keyboard.press('Enter');
      await sleep(900);
    };
    const clipped = () =>
      page.evaluate(() => {
        const frame = document.querySelector('.play-diagram').getBoundingClientRect();
        const box = document.querySelector('.play-diagram svg').getBoundingClientRect();
        return box.left < frame.left - 1 || box.right > frame.right + 1;
      });
    await pick('Sign-in');
    await pick('Kubernetes');
    check('U04 a large example opens inside its frame', !(await clipped()));
    await pick('TCP');
    await pick('Order lifecycle');
    check('U04 a wide example opens inside its frame', !(await clipped()));

    await page.click('.cm-content');
    await page.keyboard.press('ControlOrMeta+z');
    await sleep(500);
    const shown = await page.locator('.picker-button').textContent();
    check('F14 Undo restores the picker name', !/Order lifecycle/.test(shown), shown);
    await page.context().close();
  },

  async 'a docs edit reaches the Playground'() {
    const page = await open('docs/cells');
    const example = page.locator('.doc-example').first();
    const source = await example.locator('textarea').inputValue();
    await example.locator('textarea').fill(`# Docs edit\n${source}`);
    await sleep(500);
    await example.locator('.doc-example-play').click();
    await page.waitForSelector('.cm-content');
    check('the edited docs source arrives', (await sourceText(page)).includes('# Docs edit'));
    await page.context().close();
  },

  async 'an exported image opens again'() {
    const page = await open('play');
    await page.waitForSelector('.cm-content');
    await setSource(page, 'diagram "Round trip" version=1\nnode kept "Kept in the image"\n');
    await sleep(700);
    for (const kind of ['SVG', 'PNG']) {
      await page.click('.play-actions .menu-wrap > .tool');
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click(`#download-menu button:has-text("${kind}")`),
      ]);
      const file = path.join(proof.out, `round-trip.${kind.toLowerCase()}`);
      await download.saveAs(file);
      await setSource(page, 'diagram "Other" version=1\nnode other "Other"\n');
      await sleep(500);
      await page.click('.picker-button');
      await page.setInputFiles('.picker-file input', file);
      await sleep(700);
      const text = await sourceText(page);
      check(`${kind} opens with its source`, text.includes('Kept in the image'), text.slice(0, 50));
    }
    await page.context().close();
  },

  async 'a stale drawing says so when expanded'() {
    const page = await open('docs/cells');
    const example = page.locator('.doc-example').first();
    const source = await example.locator('textarea').inputValue();
    await example.locator('textarea').fill(`${source}\nnope -> nothing\n`);
    await page.waitForSelector('.doc-drawing-error');
    await example.locator('.doc-example-bar >> text=Expand').click();
    await page.waitForSelector('.zoom');
    const said = await page.locator('.zoom').textContent();
    check('#308 the overlay names the last valid drawing', /last valid/i.test(said));
    check('#308 the overlay gives the error line', /line \d+/i.test(said));
    await page.screenshot({ path: path.join(proof.out, 'stale-zoom.png') });
    await page.keyboard.press('Escape');
    await example.locator('textarea').fill(source);
    await page.waitForFunction(() => !document.querySelector('.doc-drawing-error'));
    await example.locator('.doc-example-bar >> text=Expand').click();
    await page.waitForSelector('.zoom');
    const after = await page.locator('.zoom').textContent();
    check('#308 the notice clears after repair', !/last valid/i.test(after));
    await page.context().close();
  },

  async 'a Playground module that fails to load'() {
    const module = /Playground-[^/]*\.js/;
    const failed = async page => {
      await page.waitForSelector('.load-failed');
      await page.unroute(module);
      await page.screenshot({ path: path.join(proof.out, 'load-failed.png') });
      await page.click('.load-failed button');
      await page.waitForSelector('.cm-content');
    };

    const docs = await open('docs/cells');
    const example = docs.locator('.doc-example').first();
    const source = await example.locator('textarea').inputValue();
    await example.locator('textarea').fill(`# Kept through the failure\n${source}`);
    await sleep(500);
    await docs.route(module, r => r.abort());
    await example.locator('.doc-example-play').click();
    await failed(docs);
    check('#304 Reload keeps a docs edit', (await sourceText(docs)).includes('Kept through'));
    await docs.context().close();

    const home = await open('');
    await home.route(module, r => r.abort());
    await home.setInputFiles('.hero-reopen input[type="file"]', {
      name: 'dropped.draft',
      mimeType: 'text/plain',
      buffer: Buffer.from('diagram "Dropped" version=1\nnode a "From a file"\n'),
    });
    await failed(home);
    check('#304 Reload keeps a reopened file', (await sourceText(home)).includes('From a file'));
    await home.context().close();
  },

  async 'text diagram imports'() {
    for (const [name, text, label] of [
      ['graph.dot', 'digraph { a [label="Dot source"]; a -> b }', 'Dot source'],
      ['graph.mmd', 'flowchart LR\n  A[Mermaid source] --> B[Store]', 'Mermaid source'],
      ['graph.d2', 'a: D2 source\na -> b', 'D2 source'],
    ]) {
      const page = await open('');
      page.setDefaultTimeout(30000);
      await page.setInputFiles('.hero-reopen input[type="file"]', {
        name,
        mimeType: 'text/plain',
        buffer: Buffer.from(text),
      });
      await page.waitForSelector('.cm-content', { timeout: 30000 });
      await wait(
        page,
        () => document.querySelector('.cm-content')?.textContent.includes('source'),
        'imported source',
        30000,
      );
      check(`${name} opens as native source`, (await sourceText(page)).includes(label));
      await page.reload();
      await page.waitForSelector('.cm-content');
      check(`${name} survives reload`, (await sourceText(page)).includes(label));
      if (name === 'graph.mmd')
        await page.screenshot({ path: path.join(proof.out, 'import-mermaid.png') });
      await page.context().close();
    }
  },

  async 'editor import warnings and failures'() {
    const page = await open('app/?example=checkout');
    page.setDefaultTimeout(30000);
    await editorReady(page);
    const before = page.url();
    const choose = async (name, text) => {
      await page.click(FILE);
      const pending = page.waitForEvent('filechooser');
      await page.getByRole('menuitem', { name: 'Import text diagram…' }).click();
      const chooser = await pending;
      await chooser.setFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
    };
    await choose('warning.dot', 'digraph { a -> b }');
    await page.getByText('Review import changes').waitFor();
    await page.screenshot({ path: path.join(proof.out, 'import-warning.png') });
    await page.getByRole('button', { name: 'Cancel' }).click();
    check('cancel keeps the current editor document', page.url() === before);
    await choose('sequence.mmd', 'sequenceDiagram\n actor Alice\n Alice->>Bob: Hello');
    await page.getByText('Review import changes').waitFor();
    await page.getByRole('button', { name: 'Cancel' }).click();
    check('a Mermaid sequence reaches import review', page.url() === before);
    await choose('unsupported.mmd', 'classDiagram\n Alice <|-- Bob');
    await page.getByText('Could not open file').waitFor();
    check('unsupported input keeps the current editor document', page.url() === before);
    await page.context().close();
  },

  async 'search answers tasks'() {
    const page = await open('docs');
    await page.waitForSelector('.docs-search-button');
    for (const query of ['reopen', 'export png', 'save diagram']) {
      await page.click('.docs-search-button');
      await page.fill('.search input', query);
      const first = await page.locator('.search-hit-title').first().textContent();
      check(`F11 "${query}" leads to a task`, /sav|export|reopen|open/i.test(first), first);
      await page.click('.search-backdrop', { position: { x: 4, y: 4 } });
    }
    await page.context().close();
  },

  async 'the editor links back to the site'() {
    const page = await open('app/?example=checkout');
    await editorReady(page);
    await page.click(FILE);
    const file = await page.locator('.popover').textContent();
    check('U09 the File menu reaches the Playground', /Playground/.test(file));
    await page.click('.menubar-item:has-text("Help")');
    const help = await page.locator('.popover').textContent();
    check('U09 the Help menu reaches the docs', /Docs/.test(help), help.slice(0, 80));
    await page.context().close();
  },

  async 'LD01 narrow demo edits reach the editor'() {
    for (const width of [390, 768]) {
      const page = await open('', { width, height: 844 });
      await page.waitForSelector('.live-source textarea');
      await page.fill(
        '.live-source textarea',
        'diagram "Narrow edit" version=1\nnode a "Edited on a phone"\n',
      );
      await sleep(700);
      await page.click('.live-open');
      await editorReady(page);
      await wait(page, () => document.body.textContent.includes('Edited on'), 'the edited node');
      check(`LD01 the demo link carries edits at ${width}px`, true);
      await page.context().close();
    }
  },

  async 'LD02 demo Undo keeps typed text'() {
    const page = await open('');
    const box = page.locator('.drag-host [data-id="db"]').first();
    await box.waitFor();
    const at = await box.boundingBox();
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + at.width / 2 + 30, at.y + at.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    await page.waitForSelector('.live-bar-end >> text=Undo');
    await page.click('.live-source textarea');
    await page.keyboard.press('ControlOrMeta+ArrowDown');
    await page.keyboard.type('# typed after the drag');
    await sleep(400);
    const undo = page.locator('.live-bar-end >> text=Undo');
    if (await undo.count()) await undo.click();
    await sleep(400);
    const text = await page.inputValue('.live-source textarea');
    check('LD02 Undo cannot delete typed text', text.includes('# typed after the drag'));
    await page.context().close();
  },

  async 'the landing page fits a phone'() {
    for (const width of [320, 390, 464]) {
      const page = await open('', { width, height: 844 });
      await page.waitForSelector('.install .copy');
      const over = await page.evaluate(w => document.documentElement.scrollWidth - w, width);
      check(`LP01 no sideways scroll at ${width}px`, over <= 0, `${over}px over`);
      const out = await page.evaluate(w => {
        const rights = [...document.querySelectorAll('.install .copy, .install .copy-icon')];
        return Math.max(...rights.map(e => e.getBoundingClientRect().right)) - w;
      }, width);
      check(`LP01 install commands stay on screen at ${width}px`, out <= 0, `${out}px over`);
      await page.context().close();
    }
  },

  async 'LC01 the page says what a drag writes'() {
    const page = await open('');
    const box = page.locator('.drag-host [data-id="db"]').first();
    await box.waitFor();
    const before = await page.inputValue('.live-source textarea');
    const at = await box.boundingBox();
    await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
    await page.mouse.down();
    await page.mouse.move(at.x + at.width / 2 + 30, at.y + at.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    await page.waitForSelector('.live-bar-end >> text=Undo');
    const after = await page.inputValue('.live-source textarea');
    const lines = text => text.split('\n').length;
    const added = lines(after) - lines(before);
    check('LC01 a drag writes more than one line', added > 1, `${added} lines`);
    const hero = await page.locator('.hero-sub').textContent();
    check('LC01 the hero says lines', /readable lines/.test(hero), hero);
    const install = await page.locator('.install').textContent();
    check('LC01 Install says lines', /readable lines/.test(install));
    await page.context().close();
  },

  async 'LC02 the page says what a theme changes'() {
    const page = await open('');
    await page.locator('.points').scrollIntoViewIfNeeded();
    await page.click('.point button:has-text("Restyle with one line")');
    const gate = async theme => {
      await page.click(`.point-tabs button:has-text("${theme}")`);
      await sleep(600);
      return page
        .locator('.point-figure [data-id="gate"]')
        .first()
        .evaluate(el => el.getBBox().y);
    };
    const [drafting, ink] = [await gate('Drafting'), await gate('Ink')];
    check('LC02 a theme moves a box', drafting !== ink, `y ${drafting} to ${ink}`);
    const text = await page.locator('.point.is-active').textContent();
    check('LC02 the claim admits the resize', /boxes resize to fit/.test(text), text.slice(0, 90));
    check('LC02 the false claim is gone', !/never moves/.test(text));
    await page.context().close();
  },

  async 'J1 A1 Copy shows on a touch screen'() {
    const page = await open(
      'docs/cli',
      { width: 390, height: 844 },
      { hasTouch: true, isMobile: true },
    );
    const copy = page.locator('.doc-copy').first();
    await copy.waitFor({ state: 'attached' });
    const opacity = await copy.evaluate(el => getComputedStyle(el).opacity);
    check('A1 Copy shows without a hover', opacity === '1', `opacity ${opacity}`);
    await page.context().close();
  },

  async 'J1 A2 Rules tables wrap at 390px'() {
    const page = await open('docs/rules', { width: 390, height: 844 });
    await page.waitForSelector('.doc table');
    const widest = await page.evaluate(() =>
      Math.max(...[...document.querySelectorAll('.doc table')].map(t => t.offsetWidth)),
    );
    check('A2 prose cells wrap in the box', widest < 900, `${widest}px wide`);
    await page.context().close();
  },

  async 'J1 B1 Copy leaves out shell notes'() {
    const page = await open('docs/get-started');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const block = page.locator('.doc-code', { hasText: /^\s*(draftably|npx|pnpm|npm)\b.* #/m });
    const shown = await block.first().locator('code').textContent();
    await block.first().hover();
    await block.first().locator('.doc-copy').click();
    await page.waitForSelector('.is-copied');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    check('B1 the block shows a # note', shown.includes('#'));
    check('B1 Copy has no # text', copied.length > 0 && !copied.includes('#'), copied.slice(0, 80));
    await page.context().close();
  },

  async 'J1 B3 Escape closes Topics'() {
    const page = await open('docs/rules', { width: 390, height: 844 });
    await page.click('.docs-menu-button');
    await page.waitForSelector('.docs-menu-button[aria-expanded="true"]');
    await page.keyboard.press('Escape');
    await sleep(100);
    const expanded = await page.getAttribute('.docs-menu-button', 'aria-expanded');
    check('B3 Escape closes the menu', expanded === 'false', `aria-expanded ${expanded}`);
    check('B3 focus returns to the button', (await focused(page)) === 'Topics');
    await page.context().close();
  },

  async 'J1 B4 Back keeps the scroll position'() {
    const page = await open('docs/rules');
    await page.waitForSelector('.docs-side a[href$="/docs/cells"]');
    await page.evaluate(() => window.scrollTo(0, 1800));
    await sleep(200);
    await page.click('.docs-side a[href$="/docs/cells"]');
    await wait(page, () => location.pathname.endsWith('/docs/cells'), 'the Cells page');
    await sleep(200);
    await page.goBack();
    await wait(page, () => location.pathname.endsWith('/docs/rules'), 'the Rules page');
    await sleep(300);
    const y = await page.evaluate(() => window.scrollY);
    check('B4 Back returns to the same place', Math.abs(y - 1800) < 4, `scrollY ${y}`);
    await page.context().close();
  },

  async 'J1 C1 colour finds Themes'() {
    const page = await open('docs');
    await page.click('.docs-search-button');
    await page.fill('.search input', 'colour');
    const first = await page
      .locator('.search-hit-title')
      .first()
      .textContent({ timeout: 2000 })
      .catch(() => 'no result');
    check('C1 colour leads to Themes', /Themes/.test(first), first);
    await page.context().close();
  },

  async 'J1 I1 --try direction runs on a plain file'() {
    const file = path.join(proof.out, 'plain.draft');
    fs.writeFileSync(file, 'diagram "Plain" version=1\nnode a "A"\nnode b "B"\nedge e1 a -> b\n');
    const cli = path.join(root, 'scripts/draftably.mjs');
    const run = spawnSync(process.execPath, [cli, 'vary', file, '--try', 'direction'], {
      encoding: 'utf8',
    });
    const said = `${run.stdout}${run.stderr}`;
    check('I1 vary exits clean', run.status === 0 && !/Failed/.test(said), said.slice(0, 160));
  },
};

const only = process.argv[2];
for (const [name, run] of Object.entries(journeys)) {
  if (only && !name.includes(only)) continue;
  try {
    await run();
  } catch (error) {
    check(`${name} finished`, false, error.message.split('\n').slice(0, 3).join(' '));
    await Promise.all(browser.contexts().map(c => c.close()));
  }
}
await proof.capture();
await browser.close();
server.close();
proof.finish(dist);
