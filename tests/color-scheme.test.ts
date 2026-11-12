// A dark page draws a file without a theme line dark. The viewer gets one SVG for both schemes,
// which only works while the light and dark drawings differ in color alone.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast } from '../src/model/appearance';
import { renderSvg } from '../src/runtime/render';

const examples = readdirSync('examples')
  .filter(f => f.endsWith('.draft'))
  .map(f => [f, readFileSync(`examples/${f}`, 'utf8')] as const);

describe('color schemes', () => {
  it('draws every unthemed example for both schemes in one SVG', async () => {
    const fell: string[] = [];
    for (const [file, source] of examples.filter(([, s]) => !/^\s*theme\s/m.test(s))) {
      const r = await renderSvg(source, { colorScheme: 'auto' });
      if (!r.ok || !r.value.svg.includes('light-dark(')) fell.push(file);
    }
    expect(fell).toEqual([]);
  }, 60_000);

  it('keeps every title readable on its fill in dark', async () => {
    const files = [
      ...examples,
      [
        'sequence-cruft',
        readFileSync('docs/intent/viewer-feedback-2026-11-02/repro/sequence-cruft.draft', 'utf8'),
      ] as const,
    ];
    const low: string[] = [];
    for (const [file, source] of files.filter(([, s]) => !/^\s*theme\s/m.test(s))) {
      const r = await renderSvg(source, { colorScheme: 'dark' });
      if (!r.ok) continue;
      // Each object's markup: its first shape's fill, then the first text drawn on it.
      for (const chunk of r.value.svg.split('<g data-id="').slice(1)) {
        const fill =
          /<(?:rect|path|ellipse|polygon)\b[^>]*class="shape"[^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(
            chunk,
          )?.[1] ??
          /<(?:rect|path|ellipse|polygon)\b[^>]*fill="(#[0-9A-Fa-f]{6})"[^>]*class="shape"/.exec(
            chunk,
          )?.[1];
        const ink = /<text\b[^>]*fill="(#[0-9A-Fa-f]{6})"/.exec(chunk)?.[1];
        if (fill && ink && contrast(ink, fill) < 4.5)
          low.push(`${file} ${chunk.slice(0, chunk.indexOf('"'))}: ${ink} on ${fill}`);
      }
    }
    expect(low).toEqual([]);
  }, 60_000);

  it('keeps the light drawing by default and a file theme in every scheme', async () => {
    const plain = 'node a "A"\nnode b "B" color=blue\nedge e a -> b';
    const light = await renderSvg(plain),
      dark = await renderSvg(plain, { colorScheme: 'dark' }),
      themed = `theme fieldnotes\n${plain}`;
    expect(light.ok && dark.ok).toBe(true);
    if (!light.ok || !dark.ok) return;
    expect(light.value.svg).not.toContain('light-dark(');
    expect(dark.value.svg).not.toEqual(light.value.svg);
    expect(dark.value.viewBox).toEqual(light.value.viewBox);
    const forced = await renderSvg(themed, { colorScheme: 'dark' }),
      lit = await renderSvg(themed);
    expect(forced.ok && lit.ok && forced.value.svg === lit.value.svg).toBe(true);
    // The default theme follows the page even when the file names it, overrides and all.
    const named = await renderSvg(`theme drafting padding-x=20\n${plain}`, { colorScheme: 'dark' });
    expect(named.ok && named.value.svg.includes('#16191E')).toBe(true);
  });
});
