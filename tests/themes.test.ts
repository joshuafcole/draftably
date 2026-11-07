import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { checkSource } from '../src/dsl/compile';
import { canonicalGeometry, projectScene } from '../src/dsl/project';
import { parseModel, printSource, readSource } from '../src/dsl/syntax';
import { translateEdit } from '../src/dsl/translate';
import {
  BUILT_IN_FAMILIES,
  contrast,
  CONTRAST,
  PRESETS,
  resolveAppearance,
  SHADES,
  swatchFor,
  THEME_IDS,
} from '../src/model/appearance';
import { normalize } from '../src/model/document';
import { FACES, measureText, wrapLines } from '../src/model/fonts';
import { clone } from '../src/model/geometry';
import type { Diagram } from '../src/model/types';

const proof = readFileSync(path.join(__dirname, '../examples/theme-proof.draft'), 'utf8');
const withTheme = (source: string, line: string) => source.replace(/^theme .*$/m, line);

function edit(source: string, fn: (d: Diagram) => void, label = 'Edit', selection: string[] = []) {
  const scene = checkSource(source),
    before = projectScene(scene),
    after = clone(before);
  fn(after);
  const result = translateEdit({
    source: readSource(source),
    scene,
    before,
    after,
    label,
    selection,
  });
  return printSource(result.source);
}

describe('type metrics', () => {
  it('measures and wraps from the stored font tables', () => {
    const serif = resolveAppearance({ theme: 'fieldnotes', overrides: {}, colors: [] }).title;
    expect(measureText('Covered', serif)).toBeGreaterThan(40);
    expect(wrapLines('Triage the request and check the service contract', 164, serif)).toEqual([
      'Triage the request and',
      'check the service',
      'contract',
    ]);
    // A word longer than the line breaks by character.
    const parts = wrapLines('Maintenanceverificationreport', 128, serif);
    expect(parts.length).toBe(2);
    expect(parts.every(p => measureText(p, serif) <= 128)).toBe(true);
  });

  it('sizes nodes from the theme padding and title type', () => {
    const height = (theme: string, id = 'quote') =>
      checkSource(withTheme(proof, `theme ${theme}`)).byId.get(id)!.h;
    // Drafting keeps the original 56px single-line node: 16px line + 2 × 20px padding.
    expect(height('drafting')).toBe(56);
    expect(height('fieldnotes')).toBe(19 + 2 * 22);
    expect(height('ink')).toBeGreaterThan(height('fieldnotes'));
    // Wider serif titles wrap sooner: two lines here.
    expect(height('fieldnotes', 'request')).toBe(2 * 19 + 2 * 22);
  });

  it('reserves group header room for the theme title', () => {
    const scene = checkSource(proof),
      field = scene.byId.get('field')!,
      dispatch = scene.byId.get('dispatch')!;
    expect(scene.look.groupHeader).toBe(19 + 32);
    expect(dispatch.y - field.y).toBeGreaterThanOrEqual(scene.look.groupHeader);
  });

  it('keeps an explicit size exact and reports a title that overflows it', () => {
    const scene = checkSource(
      proof.replace('size triage width=200 height=104', 'size triage width=160 height=56'),
    );
    const triage = scene.byId.get('triage')!;
    expect([triage.w, triage.h]).toEqual([160, 56]);
    expect(scene.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'text-overflow', ids: ['triage'], line: 35 }),
    );
    expect(checkSource(proof).diagnostics.some(d => d.code === 'text-overflow')).toBe(false);
  });

  it('raises an auto height to min-height, in cells too, and only with height=auto', () => {
    const h = (source: string) => checkSource(source).byId.get('a')!.h;
    expect(h('node a "Build"\nsize a width=140 height=auto min-height=90')).toBe(90);
    expect(h('node a "Build"\nsize a width=140 height=auto min-height=24')).toBe(
      h('node a "Build"\nsize a width=140 height=auto'),
    );
    expect(
      h(
        'group g "G"\nlayout g cells\nnode a "A" in=g\nnode b "B" in=g\nsize a width=140 height=auto min-height=90',
      ),
    ).toBe(90);
    expect(() => checkSource('node a "Build"\nsize a width=140 height=60 min-height=90')).toThrow(
      /min-height/,
    );
  });

  it('compiles the same geometry every time', () => {
    const a = canonicalGeometry(projectScene(checkSource(proof))),
      b = canonicalGeometry(projectScene(checkSource(proof)));
    expect(a).toEqual(b);
  });
});

describe('appearance in the file', () => {
  it('reads the theme line and its overrides', () => {
    const m = parseModel(
      'theme signal padding-x=20 padding-y=10 radius=2 title-font=serif annotation-font=mono canvas="#fafafa"',
    );
    expect(m.appearance).toEqual({
      theme: 'signal',
      overrides: {
        paddingX: 20,
        paddingY: 10,
        radius: 2,
        titleFont: 'serif',
        annotationFont: 'mono',
        canvas: '#FAFAFA',
      },
      colors: [],
    });
    expect(parseModel('node a "A"').appearance.theme).toBe('drafting');
  });

  it('reports invalid appearance with its line', () => {
    expect(() => parseModel('node a "A"\ntheme parchment')).toThrow(
      /Line 2: Unknown theme parchment/,
    );
    expect(() => parseModel('theme signal padding-x=200')).toThrow(/padding-x from 4 to 48/);
    expect(() => parseModel('theme signal\ntheme blueprint')).toThrow(
      /Line 2: Duplicate declaration/,
    );
    expect(() => parseModel('theme-color brand fill=#123456')).toThrow(/double quotes/);
    expect(() => parseModel('node a "A" color=blue shade=550')).toThrow(/Expected shade=50\|100/);
    expect(() =>
      parseModel(
        'theme-color blue shade=100 fill="#eeeeee"\ntheme-color blue shade=100 ink="#000000"',
      ),
    ).toThrow(/Line 2: Duplicate declaration: theme-color:blue:100/);
  });

  it('defines custom families by shade and checks references', () => {
    const brand =
      'theme-color brand shade=100 fill="#EAF1ED" stroke="#9AB4A4" ink="#244431"\n' +
      'theme-color brand shade=800 fill="#244431" stroke="#244431" ink="#FFFFFF"\n';
    const m = parseModel(
      brand +
        'node context "Context" color=brand shade=100\nnode focus "Main step" color=brand shade=800',
    );
    expect(m.objects.map(o => [o.color, o.shade])).toEqual([
      ['brand', 100],
      ['brand', 800],
    ]);
    // An omitted shade means 500, which brand does not define.
    expect(() => parseModel(brand + 'node x "X" color=brand')).toThrow(
      /Line 3: brand has no shade 500 \(the default\); it defines 100, 800/,
    );
    expect(() => parseModel('node x "X" color=ocean')).toThrow(/Unknown color ocean/);
    expect(() => parseModel('theme-color ocean shade=100 fill="#ffffff"')).toThrow(
      /needs fill, stroke and ink/,
    );
    // Built-in shades accept partial overrides.
    const look = resolveAppearance(
      parseModel('theme-color blue fill="#405D48"\nnode a "A" color=blue').appearance,
    );
    expect(swatchFor(look, 'blue', undefined).fill).toBe('#405D48');
    expect(swatchFor(look, 'blue', 500).ink).toBe(swatchFor(resolveAppearance(), 'blue', 500).ink);
  });

  it('accepts the former Meld aliases as real families', () => {
    expect(
      parseModel('node a "A" color=teal\nnode b "B" color=orange').objects.map(o => o.color),
    ).toEqual(['teal', 'orange']);
  });

  it('projects appearance and shades, and survives JSON normalization', () => {
    const doc = projectScene(
      checkSource(
        'theme blueprint radius=2\ntheme-color brand shade=300 fill="#111111" stroke="#222222" ink="#FFFFFF"\nnode a "A" color=brand shade=300\nnode b "B" color=blue',
      ),
    );
    expect(doc.appearance.theme).toBe('blueprint');
    expect(doc.styles.a).toMatchObject({ color: 'brand', shade: 300 });
    expect(doc.styles.b.shade).toBeUndefined();
    const again = normalize(JSON.parse(JSON.stringify(doc)));
    expect(again.appearance).toEqual(doc.appearance);
    expect(again.styles.a.shade).toBe(300);
    expect(normalize({ graph: { nodes: [], edges: [] } }).appearance.theme).toBe('drafting');
    const bad = JSON.parse(JSON.stringify(doc));
    bad.styles.a.color = 'ocean';
    expect(() => normalize(bad)).toThrow(/unknown color/);
    bad.styles.a.color = 'blue';
    bad.styles.a.shade = 450;
    expect(() => normalize(bad)).toThrow(/unknown shade/);
  });
});

describe('palettes', () => {
  it('orders every built-in ramp from light to dark in every theme', () => {
    const lum = (hex: string) => contrast(hex, '#000000');
    for (const theme of THEME_IDS) {
      const look = resolveAppearance({ theme, overrides: {}, colors: [] });
      for (const family of BUILT_IN_FAMILIES) {
        const fills = SHADES.map(s => lum(swatchFor(look, family, s).fill));
        for (let i = 1; i < fills.length; i++)
          expect(fills[i], `${theme} ${family}`).toBeLessThan(fills[i - 1]);
      }
    }
  });

  it('meets the contrast targets on every shade, surface and connection', () => {
    for (const theme of THEME_IDS) {
      const look = resolveAppearance({ theme, overrides: {}, colors: [] });
      expect(contrast(look.node.fill, look.node.ink)).toBeGreaterThanOrEqual(7);
      expect(contrast(look.group.fill, look.group.ink)).toBeGreaterThanOrEqual(7);
      expect(contrast(look.canvas, look.text)).toBeGreaterThanOrEqual(7);
      expect(contrast(look.canvas, look.connection)).toBeGreaterThanOrEqual(CONTRAST.connection);
      expect(contrast(look.canvas, look.node.stroke)).toBeGreaterThanOrEqual(CONTRAST.outline);
      expect(contrast(look.canvas, look.group.stroke)).toBeGreaterThanOrEqual(CONTRAST.frame);
      for (const family of BUILT_IN_FAMILIES)
        for (const s of SHADES) {
          const c = swatchFor(look, family, s),
            label = `${theme} ${family} ${s}`;
          // Pale shades carry dark text; the rest carry white text, except bright warm 400–500.
          expect(contrast(c.fill, c.ink), label).toBeGreaterThanOrEqual(
            s <= 300 ? CONTRAST.paleInk : CONTRAST.darkInk,
          );
          if (s >= 600 || (s >= 400 && ['blue', 'green', 'red'].includes(family)))
            expect(c.ink, label).toBe('#FFFFFF');
          if (s === 500 && family === 'amber') expect(c.ink, label).not.toBe('#FFFFFF');
          // Every shape is visible on the canvas, by its fill or by its outline.
          expect(
            Math.max(contrast(c.fill, look.canvas), contrast(c.stroke, look.canvas)),
            label,
          ).toBeGreaterThanOrEqual(CONTRAST.outline);
        }
    }
    // The targets hold on a canvas the file overrides.
    const custom = resolveAppearance({
      theme: 'drafting',
      overrides: { canvas: '#DDDDDD' },
      colors: [],
    });
    expect(contrast(custom.canvas, custom.node.stroke)).toBeGreaterThanOrEqual(CONTRAST.outline);
  });

  it('gives each preset its own identity', () => {
    const signatures = THEME_IDS.map(t => {
      const p = PRESETS[t];
      return [p.canvas, p.primary[0], p.titleFont, p.paddingX].join();
    });
    expect(new Set(signatures).size).toBe(5);
    expect(PRESETS.fieldnotes.titleFont).toBe('serif');
    expect(PRESETS.blueprint.titleFont).toBe('mono');
  });
});

describe('appearance edits', () => {
  it('saves a shade as a repaint that moves nothing', () => {
    const text = edit(proof, d => (d.styles.dispatch.shade = 800));
    expect(text).toContain('node dispatch "Dispatch technician" in=field shade=800');
    const geometry = (s: string) => canonicalGeometry(projectScene(checkSource(s)));
    expect(geometry(text)).toEqual(geometry(proof));
    // Back to the default writes no attribute.
    expect(edit(text, d => delete d.styles.dispatch.shade)).toContain(
      'node dispatch "Dispatch technician" in=field\n',
    );
  });

  it('switches themes, keeping custom families and clearing built-in overrides', () => {
    const source =
      'diagram "D" version=1\ntheme fieldnotes padding-x=24\n# palette\ntheme-color blue shade=100 fill="#EEEEEE"\ntheme-color brand fill="#123456" stroke="#000000" ink="#FFFFFF"\nnode a "A" color=brand\n';
    const text = edit(source, d => {
      d.appearance = {
        theme: 'blueprint',
        overrides: {},
        colors: d.appearance.colors.filter(c => c.family === 'brand'),
      };
    });
    expect(text).toBe(
      'diagram "D" version=1\ntheme blueprint\n# palette\ntheme-color brand fill="#123456" stroke="#000000" ink="#FFFFFF"\nnode a "A" color=brand\n',
    );
  });

  it('adds a theme line and padding to a file without one', () => {
    const text = edit('diagram "D" version=1\nnode a "A"\n', d => {
      d.appearance.overrides.paddingY = 14;
    });
    expect(text).toBe('diagram "D" version=1\ntheme drafting padding-y=14\nnode a "A"\n');
    expect(checkSource(text).byId.get('a')!.h).toBe(16 + 28);
  });
});

describe('CLI SVG', () => {
  it('draws with the theme and embeds the fonts it uses', () => {
    const svg = renderSvg(projectScene(checkSource(proof)));
    expect(svg).toContain(`fill="${PRESETS.fieldnotes.canvas}"`);
    expect(svg).toContain(`@font-face{font-family:'${FACES['serif-600'].family}'`);
    expect(svg).toContain('<path d="M'); // the diamond
    expect(svg).toContain('<tspan');
    expect(svg).toContain('>portal</text>');
    expect(svg).not.toContain(`font-family:'${FACES['mono-500'].family}'`);
  });
});
