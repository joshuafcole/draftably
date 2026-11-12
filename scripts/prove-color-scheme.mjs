#!/usr/bin/env node
/**
 * The drawing follows the page's color scheme, on the built packages, in Chromium, Firefox and
 * WebKit. One plain page holds a `<draft-diagram>` and a `<draft-editor>` of a file with no theme
 * line, a `<draft-diagram>` forced light with `color-scheme: light`, and one of a file with its own
 * `theme drafting` line. It checks: a light page draws light; setting `color-scheme: dark` on the
 * page draws the viewer and the editor dark, with no new render and no moved box; the forced and
 * the themed diagrams stay light; the editor's controls follow the page unless it sets its own
 * `data-theme`; a page with no `color-scheme` stays light on a dark system, and
 * `color-scheme: light dark` on the page follows the system setting.
 * Screenshots go to tmp/proof-color-scheme/.
 *
 * Usage: pnpm runtime:build && pnpm editor:build && node scripts/prove-color-scheme.mjs [chromium,firefox,webkit]
 */
/* global viewer, editor, forced, themed, drafting -- page globals in evaluate() */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { sleep } from './lib/proof.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tmp/proof-color-scheme');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const pkg of ['runtime/dist/element.js', 'editor/dist/element.js', 'runtime/dist/host.css'])
  if (!fs.existsSync(path.join(root, 'packages', pkg)))
    throw Error(`packages/${pkg} is missing: run pnpm runtime:build && pnpm editor:build`);

const source = fs.readFileSync(path.join(root, 'examples/checkout.draft'), 'utf8');
if (/^\s*theme\s/m.test(source)) throw Error('examples/checkout.draft must have no theme line.');
const themedSource = `theme fieldnotes\n${source}`,
  draftingSource = `theme drafting\n${source}`;

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Color scheme</title>
<link rel="stylesheet" href="/packages/runtime/dist/host.css">
<style>
  body { margin: 0; padding: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  html.dark { color-scheme: dark; background: #0b0d10; }
  draft-diagram, draft-editor { height: 250px; }
  #forced { color-scheme: light; }
</style></head>
<body>
<draft-diagram id="viewer"></draft-diagram>
<draft-editor id="editor"></draft-editor>
<draft-diagram id="forced"></draft-diagram>
<draft-diagram id="themed"></draft-diagram>
<draft-diagram id="drafting"></draft-diagram>
<script type="module">
  const link = document.querySelector('link[rel=stylesheet]');
  if (!link.sheet) await new Promise(r => link.addEventListener('load', r, { once: true }));
  window.renders = 0;
  viewer.addEventListener('draft-render', () => window.renders++);
  for (const el of [viewer, forced, themed, drafting]) el.options = { toolbar: false };
  viewer.source = ${JSON.stringify(source)};
  forced.source = ${JSON.stringify(source)};
  themed.source = ${JSON.stringify(themedSource)};
  drafting.source = ${JSON.stringify(draftingSource)};
  editor.source = ${JSON.stringify(source)};
  await import('/packages/runtime/dist/element.js');
  await import('/packages/editor/dist/element.js');
  const all = [viewer, editor, forced, themed, drafting];
  await Promise.all(all.map(el => el.updateComplete));
  await Promise.all(all.map(el => (el.viewer ?? el.editor).ready));
  window.ready = true;
</script>
</body></html>`;

const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/') return (res.setHeader('content-type', 'text/html'), res.end(page));
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(path.join(root, 'packages')) || !fs.existsSync(file))
    return ((res.statusCode = 404), res.end());
  res.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
  res.end(fs.readFileSync(file));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

/** Canvas colors: the default theme's, and its dark variant's. */
const LIGHT = 'rgb(247, 247, 244)',
  DARK = 'rgb(22, 25, 30)';
/** The editor's own `--bg`, light and dark. */
const UI_LIGHT = '#f4f4f1',
  UI_DARK = '#16171a';
const engines = { chromium, firefox, webkit };
const only = process.argv[2]?.split(',') ?? Object.keys(engines);
const failures = [];

for (const name of only) {
  const browser = await engines[name].launch(
    name === 'chromium' ? { args: ['--use-mock-keychain', '--password-store=basic'] } : {},
  );
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    colorScheme: 'light',
  });
  const tab = await context.newPage();
  const logs = [];
  tab.on('console', m => m.type() === 'error' && logs.push(m.text()));
  tab.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
  const check = (label, ok, info) => {
    if (!ok) failures.push(`${name}: ${label}`);
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${name} ${label}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`,
    );
  };
  const frames = () =>
    tab.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  /** Each element's canvas color, the viewer's render count, and the boxes it drew. */
  const read = () =>
    tab.evaluate(() => {
      const canvas = el => {
        const svg = el.shadowRoot.querySelector('.draft-viewer__viewport > svg');
        return getComputedStyle(svg.querySelector(':scope > rect')).fill;
      };
      const stage = editor.shadowRoot.querySelector('.stage');
      const ui = editor.shadowRoot.querySelector('.draft-editor');
      return {
        viewer: canvas(viewer),
        editor: getComputedStyle(stage).backgroundColor,
        controls: getComputedStyle(ui).getPropertyValue('--bg').trim(),
        forced: canvas(forced),
        themed: canvas(themed),
        drafting: canvas(drafting),
        renders: window.renders,
        svg: viewer.shadowRoot.querySelector('.draft-viewer__viewport > svg'),
        boxes: JSON.stringify([viewer.viewer.geometry().nodes, editor.editor.geometry().nodes]),
      };
    });
  try {
    await tab.goto(base);
    await tab.waitForFunction(() => window.ready, null, { timeout: 30000 });
    await sleep(300);
    const light = await read();
    check(
      'a light page draws the viewer and the editor light',
      light.viewer === LIGHT &&
        light.editor === LIGHT &&
        light.forced === LIGHT &&
        light.drafting === LIGHT &&
        light.controls === UI_LIGHT,
      { ...light, boxes: undefined },
    );
    await tab.screenshot({ path: path.join(out, `${name}-light.png`) });
    const svgBefore = await tab.evaluateHandle(() =>
      viewer.shadowRoot.querySelector('.draft-viewer__viewport > svg'),
    );

    // The page turns dark: a class flip that sets color-scheme.
    await tab.evaluate(() => document.documentElement.classList.add('dark'));
    await frames();
    await sleep(200);
    const dark = await read();
    const sameSvg = await tab.evaluate(
      before => before === viewer.shadowRoot.querySelector('.draft-viewer__viewport > svg'),
      svgBefore,
    );
    check(
      'color-scheme: dark on the page draws the viewer and the editor dark',
      dark.viewer === DARK && dark.editor === DARK,
      { viewer: dark.viewer, editor: dark.editor },
    );
    check(
      'the switch draws nothing again and moves no box',
      dark.renders === light.renders && sameSvg && dark.boxes === light.boxes,
      { renders: [light.renders, dark.renders], sameSvg },
    );
    check(
      "the editor's controls follow the page, with no data-theme",
      dark.controls === UI_DARK,
      dark.controls,
    );
    // An explicit data-theme wins over the page, and removing it follows the page again.
    const own = await tab.evaluate(async () => {
      const bg = () =>
        getComputedStyle(editor.shadowRoot.querySelector('.draft-editor'))
          .getPropertyValue('--bg')
          .trim();
      editor.dataset.theme = 'light';
      const light = bg();
      delete editor.dataset.theme;
      return { light, back: bg() };
    });
    check(
      'data-theme="light" on the editor keeps its controls light on a dark page',
      own.light === UI_LIGHT && own.back === UI_DARK,
      own,
    );
    await tab.screenshot({
      path: path.join(out, `${name}-editor-dark.png`),
      clip: await tab.evaluate(() => {
        const r = editor.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    });
    check(
      'color-scheme: light on the element stays light on a dark page',
      dark.forced === LIGHT,
      dark.forced,
    );
    check(
      'a file with another theme line (fieldnotes) keeps its colors on a dark page',
      dark.themed === light.themed,
      dark.themed,
    );
    check(
      'a file with a theme drafting line follows the page',
      dark.drafting === DARK,
      dark.drafting,
    );
    await tab.screenshot({ path: path.join(out, `${name}-dark.png`) });

    // Back to light, live.
    await tab.evaluate(() => document.documentElement.classList.remove('dark'));
    await frames();
    await sleep(200);
    const back = await read();
    check(
      'removing the class draws light again',
      back.viewer === LIGHT && back.editor === LIGHT,
      back.viewer,
    );

    // No color-scheme on the page: a dark system setting changes nothing.
    await tab.emulateMedia({ colorScheme: 'dark' });
    await frames();
    await sleep(200);
    const unset = await read();
    await tab.screenshot({ path: path.join(out, `${name}-system-unset.png`) });
    check(
      'with no color-scheme on the page, a dark system setting stays light',
      unset.viewer === LIGHT &&
        unset.editor === LIGHT &&
        unset.controls === UI_LIGHT &&
        unset.forced === LIGHT,
      { viewer: unset.viewer, editor: unset.editor, controls: unset.controls },
    );

    // The page opts in with one line, and then the system setting decides.
    await tab.addStyleTag({ content: ':root { color-scheme: light dark }' });
    await frames();
    await sleep(200);
    const both = await read();
    await tab.screenshot({ path: path.join(out, `${name}-system-opted.png`) });
    check(
      'color-scheme: light dark on the page draws dark on a dark system',
      both.viewer === DARK && both.editor === DARK && both.controls === UI_DARK,
      { viewer: both.viewer, editor: both.editor, controls: both.controls },
    );
    check(
      'color-scheme: light on the element stays light on an opted-in page and a dark system',
      both.forced === LIGHT,
      both.forced,
    );
    check(
      'a fieldnotes file keeps its colors under light dark on a dark system',
      both.themed === light.themed,
      both.themed,
    );
    await tab.evaluate(() => document.documentElement.classList.add('dark'));
    await frames();
    await sleep(200);
    const darkOnDark = await read();
    check(
      'color-scheme: dark on a dark system draws dark',
      darkOnDark.viewer === DARK && darkOnDark.editor === DARK,
      { viewer: darkOnDark.viewer, editor: darkOnDark.editor },
    );
    await tab.evaluate(() => document.documentElement.classList.remove('dark'));
    await tab.emulateMedia({ colorScheme: 'light' });
    await frames();
    await sleep(200);
    const lightSystem = await read();
    check(
      'color-scheme: light dark draws light again when the system turns light',
      lightSystem.viewer === LIGHT && lightSystem.editor === LIGHT,
      { viewer: lightSystem.viewer, editor: lightSystem.editor },
    );

    // A hidden host has no box, so its probe cannot transition: the page turns dark while it is
    // hidden, and it reads the scheme again when it is shown.
    await tab.evaluate(() => {
      for (const el of [viewer, editor]) el.style.display = 'none';
      document.documentElement.classList.add('dark');
    });
    await frames();
    await sleep(200);
    await tab.evaluate(() => {
      for (const el of [viewer, editor]) el.style.display = '';
    });
    await frames();
    await sleep(200);
    const shown = await read();
    check(
      'a host hidden while the page turns dark draws dark when shown',
      shown.viewer === DARK && shown.editor === DARK,
      { viewer: shown.viewer, editor: shown.editor },
    );

    // Hosts mounted detached, with no shadow root, then attached to the dark page.
    const mounted = await tab.evaluate(async () => {
      const { mountViewer } = await import('/packages/runtime/dist/viewer.js');
      const { mountEditor } = await import('/packages/editor/dist/index.js');
      const vh = document.createElement('div'),
        eh = document.createElement('div');
      for (const h of [vh, eh]) h.style.height = '200px';
      const v = mountViewer(vh, { toolbar: false });
      const done = v.update(viewer.source);
      const ed = mountEditor(eh, { source: viewer.source });
      document.body.append(vh, eh);
      await Promise.all([done, ed.ready]);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 200));
      const inner = () => [...eh.children].find(c => !c.hasAttribute('data-draft-probe'));
      const scheme = () => getComputedStyle(inner()).colorScheme;
      const out = {
        viewer: getComputedStyle(vh.querySelector('.draft-viewer__viewport > svg > rect')).fill,
        editor: getComputedStyle(eh.querySelector('.stage')).backgroundColor,
        controls: scheme(),
      };
      eh.dataset.theme = 'light';
      out.ownLight = scheme();
      out.drawingUnderOwnLight = getComputedStyle(eh.querySelector('.stage')).backgroundColor;
      delete eh.dataset.theme;
      // A page that turns transitions off still switches a light-DOM host.
      const off = document.createElement('style');
      off.textContent = '* { transition: none !important }';
      document.head.append(off);
      document.documentElement.classList.remove('dark');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise(r => setTimeout(r, 200));
      out.offEditor = getComputedStyle(eh.querySelector('.stage')).backgroundColor;
      out.offViewer = getComputedStyle(
        vh.querySelector('.draft-viewer__viewport > svg > rect'),
      ).fill;
      off.remove();
      v.destroy();
      ed.destroy();
      vh.remove();
      eh.remove();
      return out;
    });
    check(
      'a detached mount attached to a dark page draws dark',
      mounted.viewer === DARK && mounted.editor === DARK,
      { viewer: mounted.viewer, editor: mounted.editor },
    );
    check(
      "a light-DOM editor's controls take the page's scheme, and data-theme overrides it",
      mounted.controls === 'dark' &&
        mounted.ownLight === 'light' &&
        mounted.drawingUnderOwnLight === DARK,
      { controls: mounted.controls, ownLight: mounted.ownLight },
    );
    check(
      'transition: none !important on the page still switches light-DOM hosts',
      mounted.offEditor === LIGHT && mounted.offViewer === LIGHT,
      { editor: mounted.offEditor, viewer: mounted.offViewer },
    );
  } catch (e) {
    check('ran to completion', false, String(e.message).split('\n')[0]);
    await tab.screenshot({ path: path.join(out, `${name}-failure.png`) }).catch(() => {});
  }
  if (logs.length) console.log(`${name} console: ${logs.slice(0, 5).join(' | ')}`);
  await browser.close();
}
server.close();
if (failures.length) {
  console.log(`\nFAILED:\n  ${failures.join('\n  ')}`);
  process.exitCode = 1;
}
