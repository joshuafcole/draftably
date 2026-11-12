import { describe, expect, it } from 'vitest';
import { checkSource } from '../src/dsl/compile';
import { resolveAppearance, type ThemeId } from '../src/model/appearance';
import { measureText, wordPieces, wrapLines } from '../src/model/fonts';
import { textHeight, titleArea, wrapTitle } from '../src/model/labels';

const look = (theme: ThemeId = 'drafting') =>
  resolveAppearance({ theme, overrides: {}, colors: [] });

describe('word pieces', () => {
  it('splits identifiers where a reader would', () => {
    expect(wordPieces('annotationCommands')).toEqual(['annotation', 'Commands']);
    expect(wordPieces('src/viz/Treemap.tsx')).toEqual(['src/', 'viz/', 'Treemap.tsx']);
    expect(wordPieces('MEASURED_*_METRICS')).toEqual(['MEASURED_', '*_METRICS']);
    expect(wordPieces('code-annotations.md')).toEqual(['code-', 'annotations.md']);
    expect(wordPieces('Maintenanceverificationreport')).toEqual(['Maintenanceverificationreport']);
  });
});

describe('title wrapping', () => {
  it('breaks a long identifier between its pieces, not inside a word', () => {
    const title = look().title;
    // annotationCommands is wider than a 120px title line.
    expect(measureText('annotationCommands', title)).toBeGreaterThan(120);
    expect(wrapLines('annotationCommands', 120, title)).toEqual(['annotation', 'Commands']);
    expect(wrapLines('examples/*.draft', 100, title)).toEqual(['examples/', '*.draft']);
  });

  it('still breaks by character when one piece is too long for the line', () => {
    const title = look('fieldnotes').title;
    const parts = wrapLines('Maintenanceverificationreport', 128, title);
    expect(parts.length).toBe(2);
    expect(parts.every(p => measureText(p, title) <= 128)).toBe(true);
  });

  it('balances a wrapped title and leaves no short token alone', () => {
    const title = look().title;
    expect(wrapLines('Open a project in < 5 s', 132, title)).toEqual([
      'Open a project in < 5',
      's',
    ]);
    expect(wrapLines('Open a project in < 5 s', 132, title, true)).toEqual([
      'Open a project',
      'in < 5 s',
    ]);
    expect(wrapLines('Broken: regression to fix', 132, title, true)).toEqual([
      'Broken:',
      'regression to fix',
    ]);
  });
});

describe('default node width', () => {
  const scene = checkSource(
    [
      'diagram "Wrap" version=1',
      'node ask "restic installed?" shape=diamond',
      'node long "Maintenanceverificationreport"',
      'node fixed "Maintenanceverificationreport"',
      'node plain "Load env file"',
      'node split "Disruption: crash, feature\\nunusable, or retry works"',
      'size fixed width=164 height=56',
      'edge e1 ask -> long',
      'layout root flow direction=right',
    ].join('\n'),
  );
  const fits = (id: string, word: string) => {
    const o = scene.byId.get(id)!;
    return measureText(word, scene.look.title) <= titleArea(o.shape, o.w, o.h, scene.look).width;
  };

  it('grows a default-sized shape until its longest word fits whole', () => {
    expect(fits('ask', 'installed?')).toBe(true);
    expect(fits('long', 'Maintenanceverificationreport')).toBe(true);
    expect(scene.byId.get('long')!.w).toBeGreaterThan(164);
  });

  it('widens a title with explicit breaks so each line fits on one row', () => {
    const o = scene.byId.get('split')!;
    expect(o.w).toBeGreaterThan(164);
    const lines = wrapTitle(
      'Disruption: crash, feature\nunusable, or retry works',
      titleArea(o.shape, o.w, o.h, scene.look).width,
      scene.look,
    );
    // The text after the first break is a detail line, set a step smaller.
    expect(lines).toEqual([
      { text: 'Disruption: crash, feature', detail: false },
      { text: 'unusable, or retry works', detail: true },
    ]);
    expect(textHeight(lines, scene.look)).toBe(
      scene.look.title.lineHeight + scene.look.detail.lineHeight,
    );
    expect(o.h).toBe(textHeight(lines, scene.look) + 2 * scene.look.paddingY);
  });

  it('keeps the default width when every word fits, and a requested size exactly', () => {
    expect(scene.byId.get('plain')!.w).toBe(164);
    expect(scene.byId.get('fixed')!.w).toBe(164);
  });
});

describe('diamond size', () => {
  const scene = checkSource(
    [
      'diagram "Square" version=1',
      'node long "First time this worker has seen this file, with rows missing?" shape=diamond',
      'node short "New file?" shape=diamond',
      'node sized "Sized" shape=diamond',
      'size sized width=120 height=160',
      'edge e1 long -> short',
    ].join('\n'),
  );

  it('keeps every diamond square, a long question growing the square', () => {
    for (const id of ['long', 'short', 'sized']) {
      const o = scene.byId.get(id)!;
      expect(o.w).toBe(o.h);
    }
    expect(scene.byId.get('long')!.w).toBeGreaterThan(scene.byId.get('short')!.w);
    expect(scene.byId.get('sized')!.w).toBe(160);
    expect(scene.diagnostics.map(d => d.code)).toContain('big-diamond');
  });
});

describe('column width', () => {
  it('gives a column’s boxes the widest one’s width, keeping sized nodes and other shapes', () => {
    const scene = checkSource(
      [
        'diagram "Column" version=1',
        'group g "G"',
        'node a "A" in=g',
        'node b "Billing reconciliation\\nand weekly payout reports" in=g',
        'node c "C" in=g',
        'node d "Ok?" in=g shape=diamond',
        'size c width=120 height=40',
        'layout g column gap=12',
      ].join('\n'),
    );
    const box = (id: string) => scene.byId.get(id)!;
    expect(box('b').w).toBeGreaterThan(164);
    expect(box('a').w).toBe(box('b').w);
    expect(box('a').x + box('a').w).toBe(box('b').x + box('b').w);
    expect([box('c').w, box('c').h]).toEqual([120, 40]);
    expect(box('d').w).toBe(box('d').h);
  });
});
