/**
 * Draws the site's social preview card (site/public/og.png, 1200×630) from a real diagram: the
 * highlighted source on the left, the drawing the CLI makes from it on the right. Rerun it when
 * the example, the renderer or the site's look changes:
 *
 *   node scripts/og-image.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { highlightHtml } from '../site/highlight.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const example = path.join(root, 'examples/checkout.draft');
const run = (args: string[]) =>
  execFileSync('node', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 });

const svg = run(['scripts/draftably.mjs', 'inspect', example, '--svg', '--no-source']);
const source = fs
  .readFileSync(example, 'utf8')
  .split('\n')
  .filter(line => line.trim() && !line.startsWith('#') && !line.startsWith('layout'))
  .slice(0, 14)
  .join('\n');

const fonts = path.join(root, 'src/assets/fonts');
const html = `<!doctype html>
<meta charset="utf-8" />
<style>
  @font-face { font-family: Inter; font-weight: 500; src: url('${fonts}/inter-latin-500-normal.woff2'); }
  @font-face { font-family: Inter; font-weight: 600 800; src: url('${fonts}/inter-latin-600-normal.woff2'); }
  @font-face { font-family: Mono; src: url('${fonts}/jetbrains-mono-latin-500-normal.woff2'); }
  * { box-sizing: border-box; }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; background: #f5f6f9;
    font-family: Inter, sans-serif; color: #15171f; -webkit-font-smoothing: antialiased; }
  .card { display: grid; grid-template-rows: auto 1fr; height: 100%; padding: 52px 56px 48px; gap: 30px; }
  .head { display: flex; align-items: baseline; justify-content: space-between; }
  h1 { margin: 0; font-size: 56px; font-weight: 800; letter-spacing: -0.035em; line-height: 1.05; }
  .mark { display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 800;
    letter-spacing: -0.02em; color: #15171f; } .mark svg { width: 44px; height: 44px; }
  .frame { display: grid; grid-template-columns: 330px 1fr; min-height: 0; border: 1px solid #c9cfda;
    border-radius: 12px; background: #fff; overflow: hidden; box-shadow: 0 12px 40px #25213b14; }
  pre { margin: 0; padding: 22px 0 0 22px; font: 14.5px/24px Mono, monospace; white-space: pre;
    overflow: hidden; border-right: 1px solid #e3e6ec; font-variant-ligatures: none;
    mask-image: linear-gradient(to right, #000 82%, transparent); }
  .art { display: flex; align-items: center; justify-content: center; padding: 18px; background: #f7f7f4; min-width: 0; }
  .art svg { width: 100%; height: 100%; }
  .tok-command { color: #6650d9; } .tok-string { color: #2d7a5c; } .tok-attr { color: #8a6420; }
  .tok-value, .tok-number { color: #2b5fa8; } .tok-arrow, .tok-comment { color: #8c92a4; }
</style>
<div class="card">
  <div class="head">
    <h1>Diagrams used to<br />be a drag.</h1>
    <span class="mark">${fs.readFileSync(path.join(root, 'src/assets/logo.svg'), 'utf8')}draftably</span>
  </div>
  <div class="frame">
    <pre>${highlightHtml(source)}</pre>
    <div class="art">${svg}</div>
  </div>
</div>`;

const page = path.join(root, 'tmp/og/card.html');
fs.mkdirSync(path.dirname(page), { recursive: true });
fs.writeFileSync(page, html);
const out = path.join(root, 'site/public/og.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
run(['scripts/shoot.mjs', page, out, '--size', '1200x630', '--wait', '600']);
// The screenshot is 2x; social cards expect 1200×630.
execFileSync('sips', ['-z', '630', '1200', out], { stdio: 'ignore' });
console.log(`Wrote ${path.relative(root, out)}`);
