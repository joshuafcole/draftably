#!/usr/bin/env node
/**
 * Slots on the built packages, in plain DOM, in Chromium, Firefox and WebKit. One page holds a
 * `<draft-diagram>` and a `<draft-editor>` of one file, each with host children marked
 * `data-draft-slot`. For each element it checks the host contract's slot rules: content waits
 * for the element (host.css), manual assignment puts each child in its target, a body fills its
 * node and scales with the camera, an overlay covers its item at screen size, host CSS styles the
 * content, content follows a source update and a target keeps its identity, a click on body text
 * reaches the drawing, a `data-draft-input` button takes its click, a caret survives an update,
 * `overflow: clip` keeps the element from scrolling, an unknown slot or prefix is a
 * `DRAFT_SLOT_UNKNOWN` warning, content larger than its node is a `DRAFT_SLOT_OVERFLOW` warning, and low detail hides
 * bodies, also after a commit made zoomed out. For the editor also: its styles in the shadow root, page
 * tokens on `:host`, ports and handles above a body, no shortcut from a marked input, and a press
 * on its drawing takes the keys from a focused field in the viewer's slot. The editor's events:
 * `update` for each source (an `error` for one that does not parse) and a cancelable `link`.
 * Screenshots go to tmp/proof-slots/.
 *
 * Usage: pnpm runtime:build && pnpm editor:build && node scripts/prove-slots.mjs [chromium,firefox,webkit]
 */
/* global H, card, title, rect, itemBox, target, fill, log, viewer, editor -- page globals in evaluate() */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright-core';
import { sleep } from './lib/proof.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'tmp/proof-slots');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const pkg of ['runtime/dist/element.js', 'editor/dist/element.js', 'runtime/dist/host.css'])
  if (!fs.existsSync(path.join(root, 'packages', pkg)))
    throw Error(`packages/${pkg} is missing: run pnpm runtime:build && pnpm editor:build`);

const source = `diagram "Slots" version=1
node web "Web"
node api "API"
node db "Database"
edge e1 web -> api
edge e2 api -> db
size api width=220 height=auto min-height=110
`;
// The update moves and relabels api's content, adds cache and removes web.
const updated = `diagram "Slots" version=1
node cache "Cache"
node api "API v2"
node db "Database"
edge e1 cache -> api
edge e2 api -> db
size api width=260 height=auto min-height=120
`;

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Slots</title>
<link rel="stylesheet" href="/packages/runtime/dist/host.css">
<style>
  body { margin: 0; padding: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  draft-diagram, draft-editor { height: 520px; border: 1px solid #ccc; }
  draft-editor { --accent: rgb(220, 20, 60); }
  .card { box-sizing: border-box; width: 100%; height: 100%; padding: 6px; display: flex;
    flex-direction: column; gap: 4px; background: rgb(10, 120, 200); color: white;
    font: 13px/1.3 system-ui, sans-serif; }
  .badge { position: absolute; right: -8px; top: -8px; background: rgb(200, 40, 40); color: white;
    border-radius: 9px; padding: 1px 6px; font: 11px/16px system-ui, sans-serif; }
  .field { width: 120px; font-size: 12px; }
</style></head>
<body>
<draft-diagram id="viewer"></draft-diagram>
<draft-editor id="editor"></draft-editor>
<script type="module">
  const source = ${JSON.stringify(source)};
  window.log = { viewer: { activate: [], diagnostics: [], anchors: 0, updates: [] }, editor: { select: [], diagnostics: [], anchors: 0, updates: [], links: [] }, clicks: 0 };
  /** Plain-DOM content for one element: a body per listed node, an overlay, an unknown slot. */
  window.fill = (el, ids, suffix = '') => {
    for (const c of [...el.querySelectorAll(':scope > .card')])
      if (!ids.includes(c.dataset.id)) c.remove();
    for (const id of ids) {
      let c = el.querySelector(':scope > .card[data-id="' + id + '"]');
      if (!c) {
        c = document.createElement('div');
        c.className = 'card';
        c.dataset.id = id;
        c.dataset.draftSlot = 'body:' + id;
        c.innerHTML = '<span class="label"></span><button data-draft-input class="act">go</button>' +
          (id === 'api' ? '<input data-draft-input class="field">' : '');
        c.querySelector('.act').onclick = () => window.log.clicks++;
        el.append(c);
      }
      c.querySelector('.label').textContent = 'Card ' + id + suffix;
    }
  };
  for (const el of [viewer, editor]) {
    // An unknown ID, and a typo in the prefix: both warn and show nothing.
    el.innerHTML = '<div class="badge" data-draft-slot="overlay:db">3</div><div class="ghost" data-draft-slot="body:nope">ghost</div><div class="typo" data-draft-slot="bdy:web">typo</div>';
    // Host order differs from drawing order (web, api, db): targets follow the drawing.
    fill(el, ['api', 'web']);
  }
  // WebKit can run this module before the stylesheet in <head> has loaded.
  const link = document.querySelector('link[rel=stylesheet]');
  if (!link.sheet) await new Promise(r => link.addEventListener('load', r, { once: true }));
  window.beforeDefine = [...viewer.children, ...editor.children].map(c => getComputedStyle(c).display);
  viewer.options = { toolbar: false };
  viewer.source = source;
  editor.source = source;
  viewer.addEventListener('draft-itemactivate', e => log.viewer.activate.push(e.detail.id));
  editor.addEventListener('draft-select', e => log.editor.select.push(e.detail.ids.join()));
  for (const [side, el] of [['viewer', viewer], ['editor', editor]]) {
    el.addEventListener('draft-diagnostics', e => log[side].diagnostics.push(e.detail.diagnostics.map(d => d.code + ':' + d.itemIds.join())));
    el.addEventListener('draft-anchors', e => { log[side].anchors++; log[side].lastAnchors = e.detail.anchors.length; });
    el.addEventListener('draft-update', e => log[side].updates.push(e.detail.status + (e.detail.error ? ':' + e.detail.error.diagnostics[0].code : '')));
  }
  editor.addEventListener('draft-link', e => {
    log.editor.links.push(e.detail.itemId + '|' + e.detail.href);
    e.preventDefault();
  });
  const ports = { viewer: '.draft-viewer__viewport', editor: '.stage' };
  window.H = s => { const el = s === 'viewer' ? viewer : editor; return { el, handle: () => el.viewer ?? el.editor, port: () => el.shadowRoot.querySelector(ports[s]) }; };
  window.rect = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
  /** An item's box on screen, from the public camera and geometry only. */
  window.itemBox = (s, id) => {
    const h = H(s).handle(), b = h.geometry().nodes[id], c = h.getCamera(), p = rect(H(s).port());
    return { x: p.x + p.w / 2 + (b.x - c.centerX) * c.zoom, y: p.y + p.h / 2 + (b.y - c.centerY) * c.zoom, w: b.width * c.zoom, h: b.height * c.zoom };
  };
  window.target = (s, slot) => H(s).el.shadowRoot.querySelector('[data-draft-anchor="' + slot + '"]');
  window.card = (s, id) => H(s).el.querySelector(':scope > .card[data-id="' + id + '"]');
  window.title = (s, id) => H(s).el.shadowRoot.querySelector(s === 'viewer' ? '.draft-viewer__viewport > svg [data-id="' + id + '"] text' : '.canvas .node[data-id="' + id + '"] text');
  await import('/packages/runtime/dist/element.js');
  await import('/packages/editor/dist/element.js');
  await Promise.all([viewer.updateComplete, editor.updateComplete]);
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

const engines = { chromium, firefox, webkit };
const only = process.argv[2]?.split(',') ?? Object.keys(engines);
const near = (a, b, t = 1.5) => Math.abs(a - b) <= t;
const failures = [];

for (const name of only) {
  const browser = await engines[name].launch(
    name === 'chromium' ? { args: ['--use-mock-keychain', '--password-store=basic'] } : {},
  );
  const tab = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  const logs = [];
  tab.on('console', m => m.type() === 'error' && logs.push(m.text()));
  tab.on('pageerror', e => logs.push(`pageerror: ${e.message}`));
  const results = [];
  const check = (label, ok, info) => {
    results.push({ label, ok: !!ok });
    if (!ok) failures.push(`${name}: ${label}`);
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${name} ${label}${info === undefined ? '' : ` — ${JSON.stringify(info)}`}`,
    );
  };
  const frames = () =>
    tab.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const ev = (fn, arg) => tab.evaluate(fn, arg);
  const at = async r => tab.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
  const same = (a, b, t) =>
    a && b && near(a.x, b.x, t) && near(a.y, b.y, t) && near(a.w, b.w, t) && near(a.h, b.h, t);
  try {
    await tab.goto(base);
    await tab.waitForFunction(() => window.ready, null, { timeout: 20000 });
    const hidden = await ev(() => window.beforeDefine);
    check(
      'host.css hides slot content before the elements define',
      hidden.every(d => d === 'none'),
      hidden,
    );
    await sleep(400);
    for (const side of ['viewer', 'editor']) {
      const label = text => `${side}: ${text}`;
      // Manual assignment: each marked child lands in its own target; an unknown slot gets none.
      const assigned = await ev(
        s =>
          [...H(s).el.shadowRoot.querySelectorAll('[data-draft-anchor]')]
            .map(
              t => `${t.dataset.draftAnchor}=${t.querySelector('slot')?.assignedElements().length}`,
            )
            .sort(),
        side,
      );
      check(
        label('each marked child is assigned to its target'),
        assigned.join() === 'body:api=1,body:web=1,overlay:db=1',
        assigned,
      );
      const order = () =>
        ev(
          s =>
            [...H(s).el.shadowRoot.querySelectorAll('.draft-anchors__bodies > [data-draft-anchor]')]
              .map(t => t.dataset.draftAnchor)
              .join(),
          side,
        );
      const first = await order();
      check(
        label('bodies follow drawing order, not host order'),
        first === 'body:web,body:api',
        first,
      );
      check(
        label('an unknown slot is a DRAFT_SLOT_UNKNOWN warning'),
        await ev(s => log[s].diagnostics.flat().includes('DRAFT_SLOT_UNKNOWN:nope'), side),
      );
      const typo = await ev(
        s => ({
          warned: log[s].diagnostics.flat().includes('DRAFT_SLOT_UNKNOWN:web'),
          shown: rect(H(s).el.querySelector('.typo'))?.w ?? 0,
        }),
        side,
      );
      check(
        label('a slot with an unknown prefix (bdy:) warns and shows nothing'),
        typo.warned && typo.shown === 0,
        typo,
      );

      // Geometry: a body fills its node; an overlay covers its item at screen size.
      let g = await ev(
        s => ({
          card: rect(card(s, 'api')),
          api: itemBox(s, 'api'),
          badge: rect(H(s).el.querySelector('.badge')),
          over: rect(target(s, 'overlay:db')),
          db: itemBox(s, 'db'),
        }),
        side,
      );
      check(label('a body fills its node on screen'), same(g.card, g.api), g);
      check(label("an overlay sits at its item's screen box"), same(g.over, g.db), {
        over: g.over,
        db: g.db,
      });
      const start = await ev(s => H(s).handle().getCamera(), side);
      await ev(
        ([s, c]) =>
          H(s)
            .handle()
            .setCamera({ ...c, zoom: c.zoom * 2 }),
        [side, start],
      );
      await frames();
      const z = await ev(
        s => ({
          card: rect(card(s, 'api')),
          api: itemBox(s, 'api'),
          badge: rect(H(s).el.querySelector('.badge')),
          over: rect(target(s, 'overlay:db')),
          db: itemBox(s, 'db'),
        }),
        side,
      );
      check(
        label('a body scales with the camera'),
        same(z.card, z.api) && near(z.card.w, g.card.w * 2, 2),
        { before: g.card, after: z.card },
      );
      check(
        label('an overlay follows the camera at screen scale'),
        same(z.over, z.db) && near(z.badge.h, g.badge.h, 0.5),
        { over: z.over, db: z.db, badge: z.badge.h },
      );
      await ev(([s, c]) => H(s).handle().setCamera(c), [side, start]);
      await frames();
      check(
        label('host CSS styles slot content'),
        (await ev(s => getComputedStyle(card(s, 'api')).backgroundColor, side)) ===
          'rgb(10, 120, 200)',
      );

      // Pointer: body text lets the pointer through to the drawing; a marked button takes it.
      const text = await ev(s => rect(card(s, 'api').querySelector('.label')), side);
      // The card has its own data-id, so the hit must also be outside the card.
      const under = await ev(
        ([s, x, y]) => {
          const hit = H(s).el.shadowRoot.elementFromPoint(x, y);
          return {
            id: hit?.closest('[data-id]')?.getAttribute('data-id'),
            inCard: !!hit && card(s, 'api').contains(hit),
            drawn: !!hit && H(s).el.shadowRoot.contains(hit),
          };
        },
        [side, text.x + 3, text.y + text.h / 2],
      );
      check(
        label('body text passes the pointer to the drawing'),
        under.id === 'api' && !under.inCard && under.drawn,
        under,
      );
      const heard = () =>
        ev(s => (s === 'viewer' ? log.viewer.activate : log.editor.select).join('|'), side);
      const before = await heard();
      await tab.mouse.click(text.x + 3, text.y + text.h / 2);
      await sleep(150);
      const after = await heard();
      check(
        label(
          side === 'viewer'
            ? 'a click on body text activates the item'
            : 'a click on body text selects the node',
        ),
        after.split('|').at(-1) === 'api' && after !== before,
        after,
      );
      const clicks = await ev(() => log.clicks);
      await at(await ev(s => rect(card(s, 'api').querySelector('.act')), side));
      await sleep(150);
      check(
        label('a data-draft-input button takes its click, and only it'),
        (await ev(() => log.clicks)) === clicks + 1 && (await heard()) === after,
        { clicks: await ev(() => log.clicks), heard: await heard() },
      );

      // Input: a caret survives a source update; a key in a marked input is no shortcut.
      const nodes = () => ev(s => Object.keys(H(s).handle().geometry()?.nodes ?? {}).length, side);
      const count = await nodes();
      const keep = await ev(s => (window.kept = target(s, 'body:api')) && true, side);
      await at(await ev(s => rect(card(s, 'api').querySelector('.field')), side));
      await tab.keyboard.type('abn');
      await sleep(200);
      if (side === 'editor')
        check(label('typing n in a marked input adds no node'), (await nodes()) === count, {
          before: count,
          after: await nodes(),
        });
      await ev(
        async ([s, src]) => {
          const el = H(s).el;
          el.source = src;
          fill(el, ['cache', 'api'], ' 2');
          await el.updateComplete;
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        [side, updated],
      );
      await tab.waitForFunction(s => !!H(s).handle().geometry()?.nodes.cache, side, {
        timeout: 10000,
      });
      await sleep(200);
      const caret = await ev(() => ({
        cls: document.activeElement?.className,
        pos: document.activeElement?.selectionStart,
      }));
      await tab.keyboard.type('c');
      const value = await ev(s => card(s, 'api').querySelector('.field').value, side);
      check(
        label('a caret survives a source update'),
        keep && caret.cls === 'field' && caret.pos === 3 && value === 'abnc',
        { caret, value },
      );
      const u = await ev(
        s => ({
          api: [rect(card(s, 'api')), itemBox(s, 'api')],
          cache: [rect(card(s, 'cache')), itemBox(s, 'cache')],
          label: card(s, 'api').querySelector('.label').textContent,
          same: target(s, 'body:api') === window.kept,
          web: !!target(s, 'body:web'),
          targets: [...H(s).el.shadowRoot.querySelectorAll('[data-draft-anchor]')]
            .map(t => t.dataset.draftAnchor)
            .sort()
            .join(),
        }),
        side,
      );
      check(
        label('content follows the update: moved, relabeled, added, removed'),
        same(...u.api) &&
          same(...u.cache) &&
          u.label === 'Card api 2' &&
          !u.web &&
          u.targets === 'body:api,body:cache,overlay:db',
        u,
      );
      check(label('a target keeps its identity across an update'), u.same);
      const later = await order();
      check(label('a new body goes in drawing order'), later === 'body:cache,body:api', later);

      // overflow: clip: focus on content far off screen never scrolls the element; reveal moves the camera.
      const scrolled = await ev(async s => {
        const h = H(s).handle();
        document.activeElement?.blur();
        h.setCamera({ centerX: 4000, centerY: 4000, zoom: 1 });
        await new Promise(r => requestAnimationFrame(r));
        card(s, 'api').querySelector('.field').focus();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const all = [
          H(s).el,
          ...H(s).el.shadowRoot.querySelectorAll('*'),
          document.scrollingElement,
        ];
        const port = rect(H(s).port()),
          box = itemBox(s, 'api');
        return {
          scrolled: all.filter(e => e.scrollLeft || e.scrollTop).map(e => e.className || e.tagName),
          shown:
            box.x >= port.x - 1 &&
            box.y >= port.y - 1 &&
            box.x + box.w <= port.x + port.w + 1 &&
            box.y + box.h <= port.y + port.h + 1,
        };
      }, side);
      check(
        label('overflow: clip keeps the element from scrolling on focus'),
        scrolled.scrolled.length === 0,
        scrolled.scrolled,
      );
      check(label('focus in a body reveals its node'), scrolled.shown);
      await ev(() => document.activeElement?.blur());
      await ev(([s, c]) => H(s).handle().setCamera(c), [side, start]);
      await frames();
      await tab.screenshot({ path: path.join(out, `${name}-${side}-updated.png`) });

      // Level of detail: below a zoom of 0.4 bodies hide, are inert, and titles show again.
      const detail = async zoom => {
        await ev(
          ([s, c, zoom]) =>
            H(s)
              .handle()
              .setCamera({ ...c, zoom }),
          [side, start, zoom],
        );
        await frames();
        return ev(s => {
          const layer = H(s).el.shadowRoot.querySelector('.draft-anchors');
          return {
            detail: layer.dataset.draftDetail,
            visibility: getComputedStyle(card(s, 'api')).visibility,
            inert: layer.querySelector('.draft-anchors__bodies').inert,
            title: getComputedStyle(title(s, 'api')).opacity,
          };
        }, side);
      };
      const low = await detail(0.3),
        full = await detail(1);
      check(
        label('low detail hides bodies and shows titles'),
        low.detail === 'low' &&
          low.visibility === 'hidden' &&
          low.inert &&
          low.title === '1' &&
          full.detail === 'full' &&
          full.visibility === 'visible' &&
          !full.inert &&
          full.title === '0',
        { low, full },
      );

      // A drawing committed while zoomed out still knows its bodies: zoom in, and each title
      // under a body is hidden.
      await detail(0.3);
      await ev(
        async ([s, src]) => {
          H(s).el.source = src;
          await H(s).el.updateComplete;
          await H(s).handle().ready;
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        },
        [side, updated.replace('"Database"', '"DB"')],
      );
      const zoomedIn = await detail(1);
      check(
        label('a commit made below zoom 0.4 still hides titles under bodies at zoom 1'),
        zoomedIn.detail === 'full' && zoomedIn.title === '0',
        zoomedIn,
      );

      // Content larger than its node, assigned after its target exists, is an overflow.
      await ev(s => {
        const big = document.createElement('div');
        big.className = 'big';
        big.dataset.draftSlot = 'body:db';
        big.style.height = '900px';
        big.textContent = 'tall';
        H(s).el.append(big);
      }, side);
      await tab
        .waitForFunction(s => log[s].diagnostics.at(-1)?.includes('DRAFT_SLOT_OVERFLOW:db'), side, {
          timeout: 3000,
        })
        .catch(() => {});
      check(
        label('content larger than its node is a DRAFT_SLOT_OVERFLOW warning'),
        await ev(s => log[s].diagnostics.at(-1)?.includes('DRAFT_SLOT_OVERFLOW:db'), side),
        await ev(s => log[s].diagnostics.at(-1), side),
      );
      await ev(s => H(s).el.querySelector(':scope > .big').remove(), side);
      await ev(([s, c]) => H(s).handle().setCamera(c), [side, start]);
      await frames();
    }

    // The editor sends update for its first source and each one after, as the viewer does.
    const updates = await ev(() => [...log.editor.updates]);
    check(
      'editor: sends update for its first source and for each source update',
      updates.length >= 3 && updates.every(u => u === 'committed'),
      updates,
    );
    // A source that does not parse is an update error and a DRAFT_PARSE diagnostic.
    const good = await ev(() => editor.source);
    const parse = await ev(async src => {
      const n = log.editor.updates.length;
      editor.source = src + '\nnode "broken';
      await new Promise(r => setTimeout(r, 400));
      const failed = {
        update: log.editor.updates.slice(n).join(),
        diagnostics: log.editor.diagnostics.at(-1).join(),
        status: editor.getAttribute('status'),
      };
      editor.source = src;
      await new Promise(r => setTimeout(r, 400));
      return {
        ...failed,
        after: log.editor.updates.at(-1),
        clear: log.editor.diagnostics.at(-1).join(),
      };
    }, good);
    check(
      'editor: a source that does not parse is an update error and a DRAFT_PARSE diagnostic',
      parse.update === 'error:DRAFT_PARSE' &&
        parse.diagnostics.startsWith('DRAFT_PARSE') &&
        parse.after === 'committed' &&
        !parse.clear.includes('DRAFT_PARSE'),
      parse,
    );
    // A press on a link mark sends a cancelable link; preventDefault keeps it from opening.
    let popups = 0;
    tab.on('popup', () => popups++);
    await ev(async src => {
      editor.source = src.replace(
        'node cache "Cache"',
        'node cache "Cache" href="https://example.com/cache"',
      );
      await editor.editor.ready;
      await new Promise(r => setTimeout(r, 300));
      editor.editor.reveal('cache');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }, good);
    const mark = await ev(() =>
      rect(editor.shadowRoot.querySelector('[data-open-link] .link-hit')),
    );
    if (mark) await at(mark);
    await sleep(300);
    const links = await ev(() => [...log.editor.links]);
    check(
      'editor: a link press sends a cancelable link with the item and href',
      links.join() === 'cache|https://example.com/cache' && popups === 0,
      { links, popups },
    );
    await ev(async src => {
      editor.source = src;
      await new Promise(r => setTimeout(r, 300));
    }, good);

    // A press on the editor's drawing takes focus from a field in the viewer's slot: Backspace
    // then deletes the selected node, and the field keeps its text.
    await at(await ev(() => rect(card('viewer', 'api').querySelector('.field'))));
    await tab.keyboard.type('xy');
    const typed = await ev(() => card('viewer', 'api').querySelector('.field').value);
    await ev(() => editor.editor.reveal('db'));
    await frames();
    const db = await ev(() => itemBox('editor', 'db'));
    await tab.mouse.click(db.x + db.w / 2, db.y + db.h / 2);
    await tab.keyboard.press('Backspace');
    await sleep(300);
    const keys = await ev(() => ({
      field: card('viewer', 'api').querySelector('.field').value,
      focus: document.activeElement?.localName,
      db: editor.editor.source().includes('node db'),
    }));
    check(
      "editor: a press on its drawing takes the keys from a viewer slot's field",
      keys.field === typed && keys.focus === 'draft-editor' && !keys.db,
      { typed, ...keys },
    );

    // The editor: styles in its shadow root, page tokens on :host, chrome above bodies.
    const styled = await ev(async () => {
      const inner = editor.shadowRoot.querySelector('.draft-editor');
      const read = () => ({
        accent: getComputedStyle(inner).getPropertyValue('--accent').trim(),
        bg: getComputedStyle(inner).getPropertyValue('--bg').trim(),
        zoom: getComputedStyle(editor.shadowRoot.querySelector('.zoom-level')).color,
      });
      const light = read();
      editor.dataset.theme = 'dark';
      // Buttons fade their color over 0.12s.
      await new Promise(r => setTimeout(r, 300));
      const dark = read();
      delete editor.dataset.theme;
      return {
        sheets: editor.shadowRoot.adoptedStyleSheets.length,
        head: document.querySelectorAll('style').length,
        light,
        dark,
      };
    });
    check(
      'editor: its styles are adopted in its shadow root, not the page',
      styled.sheets > 0 && styled.head === 1 && styled.light.bg === '#f4f4f1',
      styled,
    );
    check(
      'editor: a page value for a token on <draft-editor> wins',
      styled.light.accent === 'rgb(220, 20, 60)',
      styled.light.accent,
    );
    check(
      'editor: data-theme="dark" on the element switches the tokens',
      styled.dark.bg === '#16171a' && styled.dark.zoom !== styled.light.zoom,
      styled.dark,
    );

    await ev(() => {
      const h = editor.editor,
        b = h.geometry().nodes.api;
      h.select(['api']);
      h.setCamera({ centerX: b.x + b.width / 2, centerY: b.y + b.height / 2, zoom: 1 });
    });
    await frames();
    await tab.screenshot({ path: path.join(out, `${name}-editor-chrome.png`) });
    const hits = await ev(() => {
      const root = editor.shadowRoot;
      const hit = sel => {
        const r = rect(root.querySelector(`.canvas-chrome ${sel}`));
        const e = root.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2);
        return e?.closest('.canvas-chrome') ? e.getAttribute('class') : e?.tagName;
      };
      return {
        handle: hit('.resize-handle[data-resize="se"]'),
        port: hit('.port[data-port="right"]'),
      };
    });
    check(
      'editor: ports and resize handles of a body node sit above the body',
      hits.handle === 'resize-handle' && hits.port?.includes('port'),
      hits,
    );
    const se = await ev(() =>
      rect(editor.shadowRoot.querySelector('.canvas-chrome .resize-handle[data-resize="se"]')),
    );
    const width = await ev(() => editor.editor.geometry().nodes.api.width);
    await tab.mouse.move(se.x + se.w / 2, se.y + se.h / 2);
    await tab.mouse.down();
    await tab.mouse.move(se.x + 60, se.y + 20, { steps: 6 });
    await tab.mouse.up();
    await sleep(300);
    const resized = await ev(() => editor.editor.geometry().nodes.api.width);
    check('editor: a resize handle above a body resizes the node', resized > width + 20, {
      width,
      resized,
    });

    // Destroy: the anchors event says [] before the targets go.
    await ev(() => {
      viewer.remove();
      editor.remove();
    });
    check(
      'both: anchors fire with [] on removal',
      (await ev(() => [log.viewer.lastAnchors, log.editor.lastAnchors].join())) === '0,0',
      await ev(() => [log.viewer.lastAnchors, log.editor.lastAnchors]),
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
