import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  defaultAppearance,
  resolveAppearance,
  swatchFor,
  type AppearanceLayer,
} from '../src/model/appearance';

const DARK: AppearanceLayer = {
  dark: true,
  canvas: '#15181E',
  text: '#E6E8EC',
  muted: '#9AA1AD',
  connection: '#B8BEC8',
  node: { fill: '#22262E', stroke: '#3A404B' },
  group: { fill: '#1B1F26', stroke: '#2E343E', ink: '#C9CED6' },
  colors: [{ family: 'blue', shade: 500, fill: '#3D6FD9' }],
};

describe('a host appearance layer', () => {
  it('paints over the file’s look', () => {
    const r = resolveAppearance({ ...defaultAppearance(), host: DARK });
    expect(r.dark).toBe(true);
    expect(r.canvas).toBe('#15181E');
    expect(r.text).toBe('#E6E8EC');
    expect(r.muted).toBe('#9AA1AD');
    expect(r.connection).toBe('#B8BEC8');
    // The host's text inks a plain shape unless the host names the shape's own ink.
    expect(r.node).toEqual({ fill: '#22262E', stroke: '#3A404B', ink: '#E6E8EC' });
    expect(r.group).toEqual({ fill: '#1B1F26', stroke: '#2E343E', ink: '#C9CED6' });
    expect(swatchFor(r, 'blue', 500).fill).toBe('#3D6FD9');
  });

  it('draws colored containers deep on a dark canvas and pale on a light one', () => {
    const light = resolveAppearance(defaultAppearance()),
      dark = resolveAppearance({ ...defaultAppearance(), host: { dark: true, canvas: '#15181E' } });
    expect(swatchFor(dark, 'blue', undefined, 'group')).toEqual(
      dark.families.get('blue')!.get(900),
    );
    expect(swatchFor(light, 'blue', undefined, 'group')).toEqual(
      light.families.get('blue')!.get(100),
    );
  });

  it('changes nothing it does not set', () => {
    const plain = resolveAppearance(defaultAppearance()),
      empty = resolveAppearance({ ...defaultAppearance(), host: {} });
    expect({ ...empty, families: [...empty.families] }).toEqual({
      ...plain,
      families: [...plain.families],
    });
  });
});

describe('a session with a host appearance', () => {
  beforeAll(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
    vi.stubGlobal('window', { setTimeout, clearTimeout });
  });
  afterAll(() => vi.unstubAllGlobals());

  const SOURCE =
    'diagram "Paint" version=1\ngroup g "Group" color=blue\nnode a "A" in=g\nnode b "B"\nedge ab a -> b\n';
  const settle = async (s: { fileCompiling(): boolean }) => {
    for (let i = 0; i < 40 && s.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
  };

  it('draws in the host’s paint, keeps it across a new source, and moves and writes nothing', async () => {
    const { createDiagramSession } = await import('../src/state/session');
    const s = createDiagramSession({ appearance: DARK });
    await s.openSource(SOURCE);
    await settle(s);
    expect(resolveAppearance(s.doc.appearance).canvas).toBe('#15181E');
    const layout = JSON.stringify(s.doc.layout);

    s.setAppearance({ canvas: '#FAFAF7', text: '#111111' });
    expect(resolveAppearance(s.doc.appearance).canvas).toBe('#FAFAF7');
    expect(JSON.stringify(s.doc.layout)).toBe(layout);
    expect(s.currentSource()).toBe(SOURCE);

    await s.receiveSource(SOURCE.replace('"B"', '"Bee"'));
    await settle(s);
    expect(s.doc.graph.nodes.find(n => n.id === 'b')?.title).toBe('Bee');
    expect(resolveAppearance(s.doc.appearance).text).toBe('#111111');

    s.setAppearance(null);
    expect(s.doc.appearance.host).toBeUndefined();
    expect(resolveAppearance(s.doc.appearance).canvas).toBe(
      resolveAppearance(defaultAppearance()).canvas,
    );
    s.dispose();
  });
});
