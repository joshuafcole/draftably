/**
 * The host proof: one list of checks for a server-rendered page that shows the proof page in
 * `integration-examples/frameworks/proof.js`. The Vite apps (`prove-frameworks.ts`) and the
 * meta-framework apps (`prove-meta-frameworks.ts`) both run it, so every host proves the same
 * contract with real mouse and keyboard input in Chromium:
 *
 * server HTML, hydration that keeps the server's nodes with no errors, a body that reads host
 * context and host CSS, a marked button, a caret across a source update, two editors with
 * separate shortcuts, a failed update that shows its diagnostics, a strict CSP with no
 * violations, and 50 mount cycles back at baseline.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';

export interface HostProof {
  name: string;
  passed: string[];
  failed: string[];
  /** Measured values worth printing: the CSP header, the cycle numbers. */
  notes: string[];
}

type Box = { x: number; y: number; w: number; h: number } | null;
const near = (a: Box, b: Box, t = 1.5) =>
  !!a &&
  !!b &&
  Math.abs(a.x - b.x) <= t &&
  Math.abs(a.y - b.y) <= t &&
  Math.abs(a.w - b.w) <= t &&
  Math.abs(a.h - b.h) <= t;

/** Before any page script: CSP violations, draft events, and the server's own nodes. */
const init = () => {
  const w = window as unknown as Record<string, unknown>;
  const log = {
    violations: [] as string[],
    diagnostics: [] as { stale: boolean; codes: string[] }[],
    activate: [] as string[],
  };
  w.__hostLog = log;
  document.addEventListener('securitypolicyviolation', e =>
    log.violations.push(`${e.effectiveDirective} ${e.blockedURI || 'inline'} ${e.sourceFile}`),
  );
  document.addEventListener('draft-diagnostics', e => {
    const d = (e as CustomEvent).detail;
    if ((e.target as Element).closest('#p-viewer'))
      log.diagnostics.push({
        stale: d.stale,
        codes: d.diagnostics.map((x: { severity: string; code: string }) => x.severity),
      });
  });
  document.addEventListener('draft-itemactivate', e =>
    log.activate.push((e as CustomEvent).detail.id),
  );
  // Keep the nodes the parser builds from the server HTML, to compare after hydration.
  new MutationObserver((_, obs) => {
    const viewer = document.querySelector('#p-viewer draft-diagram');
    const card = document.querySelector('.proof-card');
    if (viewer && !w.__ssrViewer) w.__ssrViewer = viewer;
    if (card && !w.__ssrCard) w.__ssrCard = card;
    if (w.__ssrViewer && w.__ssrCard) obs.disconnect();
  }).observe(document, { childList: true, subtree: true });
  /** A node's box on screen, from the handle's camera and geometry only. */
  w.__itemBox = (el: HTMLElement & { viewer?: never }, id: string) => {
    const h = el.viewer as unknown as {
      geometry(): {
        nodes: Record<string, { x: number; y: number; width: number; height: number }>;
      };
      getCamera(): { centerX: number; centerY: number; zoom: number };
    };
    const b = h.geometry()?.nodes[id];
    if (!b) return null;
    const c = h.getCamera();
    const p = el.shadowRoot!.querySelector('.draft-viewer__viewport')!.getBoundingClientRect();
    return {
      x: p.x + p.width / 2 + (b.x - c.centerX) * c.zoom,
      y: p.y + p.height / 2 + (b.y - c.centerY) * c.zoom,
      w: b.width * c.zoom,
      h: b.height * c.zoom,
    };
  };
};

type Log = {
  violations: string[];
  diagnostics: { stale: boolean; codes: string[] }[];
  activate: string[];
};
type Hooks = {
  changes: string[][];
  clicks: number;
  menus: (string | null)[];
  links: string[];
};

export async function proveHost(
  browser: Browser,
  url: string,
  name: string,
  out: string,
): Promise<HostProof> {
  const result: HostProof = { name, passed: [], failed: [], notes: [] };
  const check = (ok: boolean, label: string, detail?: unknown) => {
    if (ok) result.passed.push(label);
    else result.failed.push(detail === undefined ? label : `${label}: ${JSON.stringify(detail)}`);
  };
  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      result.failed.push(
        `${label}: ${error instanceof Error ? error.message.split('\n')[0] : error}`,
      );
    }
  };

  // Server HTML: the diagram, its static SVG and the slot content are there before any script.
  const response = await fetch(url);
  const html = await response.text();
  const csp = response.headers.get('content-security-policy') ?? '';
  writeFileSync(path.join(out, `${name}.html`), html);
  check(
    /<draft-diagram[\s\S]*?<svg[\s\S]*?<\/draft-diagram>/.test(html),
    'server HTML holds the diagram as SVG',
  );
  check(html.includes('Proof host'), 'server HTML holds slot content that reads host context');
  check((html.match(/<draft-editor/g) ?? []).length === 2, 'server HTML holds both editors');
  const directive = (n: string) => csp.match(new RegExp(`(?:^|;)\\s*${n}\\s+([^;]*)`))?.[1] ?? '';
  const scripts = directive('script-src') || directive('default-src');
  const styles = directive('style-src') || directive('default-src');
  check(
    !!scripts &&
      !scripts.includes('unsafe-inline') &&
      !!styles &&
      !styles.includes('unsafe-inline'),
    'the page is served with a strict CSP (no unsafe-inline scripts or styles)',
    csp,
  );
  result.notes.push(`CSP: ${csp}`);

  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors: string[] = [];
  page.on('console', m => {
    if (m.type() === 'error' || (m.type() === 'warning' && /hydrat|mismatch/i.test(m.text())))
      errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  await page.addInitScript(init);
  const ev = <T>(fn: () => T) => page.evaluate(fn);
  const log = () => ev(() => (window as unknown as { __hostLog: Log }).__hostLog);
  const hooks = () => ev(() => (window as unknown as { __proof: Hooks }).__proof);
  const frames = () =>
    page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

  try {
    await page.goto(url);
    await page.waitForFunction(
      () => (window as { __proofHydrated?: boolean }).__proofHydrated,
      undefined,
      {
        timeout: 30000,
      },
    );
    await page.waitForFunction(
      () =>
        document.querySelector('#p-viewer draft-diagram')?.getAttribute('status') === 'ready' &&
        [...document.querySelectorAll('#p-editors draft-editor')].filter(
          e => e.getAttribute('status') === 'ready',
        ).length === 2,
      undefined,
      { timeout: 30000 },
    );
    await frames();

    await step('hydration', async () => {
      const kept = await ev(() => {
        const w = window as unknown as Record<string, unknown>;
        return {
          viewer: w.__ssrViewer === document.querySelector('#p-viewer draft-diagram'),
          card: w.__ssrCard === document.querySelector('.proof-card'),
        };
      });
      check(kept.viewer && kept.card, 'hydration keeps the server nodes', kept);
    });

    await step('body', async () => {
      const body = await ev(() => {
        const el = document.querySelector('#p-viewer draft-diagram') as HTMLElement & {
          viewer: { geometry(): { nodes: Record<string, { x: number; y: number }> } };
        };
        const card = el.querySelector('.proof-card')!;
        const target = el.shadowRoot!.querySelector(
          '[data-draft-anchor="body:api"] slot',
        ) as HTMLSlotElement | null;
        const r = card.getBoundingClientRect();
        return {
          owner: el.querySelector('.proof-owner')?.textContent,
          background: getComputedStyle(card).backgroundColor,
          assigned: !!target?.assignedElements().includes(card),
          card: { x: r.x, y: r.y, w: r.width, h: r.height },
          api: (window as unknown as { __itemBox(e: Element, id: string): Box }).__itemBox(
            el,
            'api',
          ),
        };
      });
      check(body.owner === 'Proof host', 'a body reads host context', body.owner);
      check(body.background === 'rgb(10, 120, 200)', 'host CSS styles the body', body.background);
      check(body.assigned && near(body.card, body.api), 'the body fills its node', body);
    });

    await step('marked button', async () => {
      const before = (await log()).activate.length;
      await page.locator('.proof-go').click();
      await page.waitForFunction(
        () => document.querySelector('.proof-go')?.textContent === 'Go 1',
        undefined,
        {
          timeout: 5000,
        },
      );
      check((await hooks()).clicks === 1, 'a marked button takes its click');
      check(
        (await log()).activate.length === before,
        "the marked button's click does not reach the drawing",
      );
    });

    await step('caret', async () => {
      await page.locator('.proof-field').click();
      await page.keyboard.type('ab');
      await ev(() => (window as unknown as { __proofUpdate(): void }).__proofUpdate());
      await page.waitForFunction(
        () =>
          !!(
            document.querySelector('#p-viewer draft-diagram') as HTMLElement & {
              viewer: { geometry(): { nodes: Record<string, unknown> } | null };
            }
          ).viewer.geometry()?.nodes.cache,
        undefined,
        { timeout: 15000 },
      );
      await frames();
      const caret = await ev(() => ({
        cls: document.activeElement?.className,
        pos: (document.activeElement as HTMLInputElement | null)?.selectionStart,
      }));
      await page.keyboard.type('c');
      check(
        caret.cls === 'proof-field' && caret.pos === 2,
        'a caret survives a source update',
        caret,
      );
      check(
        (await page.locator('.proof-field').inputValue()) === 'abc',
        'typing continues after the update',
      );
      await page.locator('.proof-field').blur();
    });

    await step('editors', async () => {
      const editors = page.locator('#p-editors draft-editor');
      const select = async (index: number, id: string) => {
        const node = editors.nth(index).locator(`[data-kind="node"][data-id="${id}"]`);
        await node.scrollIntoViewIfNeeded();
        await node.click();
      };
      // Each editor holds a selection when Delete is pressed, so a key handler that reached the
      // other editor would delete its node too.
      const press = async (other: [number, string], index: number, id: string) => {
        await select(...other);
        await select(index, id);
        await page.keyboard.press('Delete');
        await page.waitForTimeout(400);
        return page.evaluate(
          ([i, kept]) => {
            const el = document.querySelectorAll('#p-editors draft-editor')[i] as HTMLElement & {
              editor: { source(): string; selection(): string[] };
            };
            return {
              changes: (window as unknown as { __proof: { changes: string[][] } }).__proof.changes,
              kept: el.editor.source().includes(`node ${kept} `),
              selected: el.editor.selection(),
            };
          },
          [other[0], other[1]] as [number, string],
        );
      };
      const first = await press([1, 'd'], 0, 'a');
      check(
        first.changes[0].length > 0 &&
          !/node a /.test(first.changes[0].at(-1)!) &&
          first.changes[1].length === 0 &&
          first.kept,
        'Delete in the first editor changes only the first editor',
        { changes: first.changes.map(c => c.length), kept: first.kept, other: first.selected },
      );
      const second = await press([0, 'b'], 1, 'c');
      check(
        second.changes[1].length > 0 &&
          !/node c /.test(second.changes[1].at(-1)!) &&
          second.changes[0].length === first.changes[0].length &&
          second.kept,
        'Delete in the second editor changes only the second editor',
        { changes: second.changes.map(c => c.length), kept: second.kept, other: second.selected },
      );
    });

    await step('attributes and cancel', async () => {
      const attrs = await ev(() => ({
        viewer: document.querySelector('#p-viewer draft-diagram')?.getAttribute('data-proof'),
        editors: [...document.querySelectorAll('#p-editors draft-editor')].map(el =>
          el.getAttribute('data-proof'),
        ),
      }));
      check(
        attrs.viewer === 'viewer' && attrs.editors.every(a => a === 'editor'),
        'other attributes reach both elements',
        attrs,
      );
      // Event props and options are not attributes: none may land on an element as text.
      const stray = await ev(() =>
        [...document.querySelectorAll('draft-diagram, draft-editor')].flatMap(el =>
          [...el.attributes]
            .map(a => a.name)
            .filter(name => name.startsWith('on') || name === 'options')
            .map(name => `${el.localName}[${name}]`),
        ),
      );
      check(
        stray.length === 0,
        'no event prop or options lands on an element as an attribute',
        stray,
      );
      await page.locator('#p-viewer').scrollIntoViewIfNeeded();
      // A listener on the window runs after the element's own, so it sees whether the menu was
      // cancelled.
      await ev(() =>
        window.addEventListener('contextmenu', e => {
          (window as unknown as { __nativeMenu: boolean }).__nativeMenu = e.defaultPrevented;
        }),
      );
      // A real right-click at the node's center, as a user makes it.
      const box = await ev(() => {
        const root = document.querySelector('#p-viewer draft-diagram')!.shadowRoot!;
        return [...root.querySelectorAll('[data-id="web"]')]
          .map(el => el.getBoundingClientRect())
          .map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }))
          .find(r => r.width > 0 && r.height > 0);
      });
      if (!box) throw Error('the viewer shows no node web');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
      const menu = await ev(() => ({
        menus: (window as unknown as { __proof: Hooks }).__proof.menus,
        prevented: (window as unknown as { __nativeMenu?: boolean }).__nativeMenu,
      }));
      check(
        menu.menus.at(-1) === 'web' && menu.prevented === true,
        "an event prop's preventDefault() cancels the browser's menu",
        menu,
      );

      // A real click on the link mark: the event prop cancels it, so nothing opens.
      const pagesBefore = page.context().pages().length;
      const urlBefore = page.url();
      const link = await ev(() => {
        const root = document.querySelector('#p-viewer draft-diagram')!.shadowRoot!;
        const r = [...root.querySelectorAll('a[href]')]
          .map(el => el.getBoundingClientRect())
          .find(b => b.width > 0 && b.height > 0);
        return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (!link) throw Error('the viewer shows no link');
      await page.mouse.click(link.x, link.y);
      await page.waitForTimeout(400);
      const opened = {
        links: (await hooks()).links,
        pages: page.context().pages().length - pagesBefore,
        moved: page.url() !== urlBefore,
      };
      check(
        opened.links.at(-1) === 'https://example.com/web' && opened.pages === 0 && !opened.moved,
        "an onLink prop's preventDefault() keeps the link from opening",
        opened,
      );
    });

    await step('failed update', async () => {
      await page.locator('#p-viewer').scrollIntoViewIfNeeded();
      await ev(() => (window as unknown as { __proofFail(): void }).__proofFail());
      await page.waitForFunction(
        () =>
          (window as unknown as { __hostLog: Log }).__hostLog.diagnostics.some(
            d => d.stale && d.codes.includes('error'),
          ),
        undefined,
        { timeout: 15000 },
      );
      const shown = await ev(() => {
        const el = document.querySelector('#p-viewer draft-diagram')!;
        const root = el.shadowRoot!.querySelector('.draft-viewer')!;
        const status = root.querySelector('.draft-viewer__status') as HTMLElement;
        return {
          stale: root.classList.contains('draft-viewer--stale'),
          message: status.textContent,
          visible: status.getBoundingClientRect().height > 0,
          drawing: !!root.querySelector('svg [data-id="api"]'),
          status: el.getAttribute('status'),
        };
      });
      check(
        shown.stale &&
          !!shown.message &&
          shown.visible &&
          shown.drawing &&
          shown.status === 'ready',
        'a failed update keeps the drawing and shows its diagnostics',
        shown,
      );
      await page.screenshot({ path: path.join(out, `${name}-failed.png`) });
    });

    await step('cycles', async () => {
      const cdp = await page.context().newCDPSession(page);
      const measure = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize;
        let listeners = 0;
        for (const expression of ['document', 'window']) {
          const { result: obj } = await cdp.send('Runtime.evaluate', { expression });
          listeners += (
            await cdp.send('DOMDebugger.getEventListeners', { objectId: obj.objectId! })
          ).listeners.length;
        }
        const fonts = await ev(() => document.fonts.size);
        return { heap, listeners, fonts, workers: page.workers().length };
      };
      const cycle = async () => {
        await ev(() => (window as unknown as { __proofToggle(): void }).__proofToggle());
        await page.waitForFunction(
          () =>
            document.querySelector('#p-cycle draft-diagram')?.getAttribute('status') === 'ready' &&
            document.querySelector('#p-cycle draft-editor')?.getAttribute('status') === 'ready',
          undefined,
          { timeout: 15000 },
        );
        await ev(() => (window as unknown as { __proofToggle(): void }).__proofToggle());
        await page.waitForFunction(
          () => !document.querySelector('#p-cycle draft-diagram, #p-cycle draft-editor'),
        );
      };
      // Warm the JIT and caches first, as `pnpm bench:host` does.
      for (let i = 0; i < 25; i++) await cycle();
      await page.waitForTimeout(500);
      const before = await measure();
      for (let i = 0; i < 50; i++) await cycle();
      await page.waitForTimeout(500);
      const after = await measure();
      const growth = (after.heap - before.heap) / before.heap;
      const numbers = `heap ${Math.round(before.heap / 1024)}→${Math.round(after.heap / 1024)} KB (${(growth * 100).toFixed(1)} %), listeners ${before.listeners}→${after.listeners}, workers ${before.workers}→${after.workers}, fonts ${before.fonts}→${after.fonts}`;
      result.notes.push(`50 cycles: ${numbers}`);
      check(
        growth <= 0.05 &&
          after.listeners <= before.listeners &&
          after.workers <= before.workers &&
          after.fonts <= before.fonts,
        '50 mount cycles of a viewer and an editor end at baseline',
        numbers,
      );
    });

    const violations = (await log()).violations;
    check(violations.length === 0, 'no CSP violations', violations);
    await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  } catch (error) {
    result.failed.push(`page: ${error instanceof Error ? error.message.split('\n')[0] : error}`);
    await page
      .screenshot({ path: path.join(out, `${name}-failure.png`), fullPage: true })
      .catch(() => {});
  }
  check(errors.length === 0, 'no console errors or hydration warnings', errors);
  await page.close();
  return result;
}

/** Prints one line per proof and returns whether all passed. */
export function report(results: HostProof[]): boolean {
  for (const r of results) {
    console.log(
      `${r.failed.length ? 'FAIL' : 'PASS'} ${r.name}: ${r.passed.length}/${r.passed.length + r.failed.length} host checks`,
    );
    for (const f of r.failed) console.log(`  ✗ ${f}`);
    for (const n of r.notes) console.log(`  · ${n}`);
  }
  return results.every(r => r.failed.length === 0);
}

export type { Page };
