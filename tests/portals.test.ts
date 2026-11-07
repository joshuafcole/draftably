import { describe, expect, it } from 'vitest';
import { compile } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import { visibleRects } from '../src/dsl/project';
import { computeRoutes } from '../src/model/routes';
import { checkScene } from '../src/dsl/check';

const base = [
  'diagram "Search" version=1',
  'node gateway "Gateway"',
  'node planner "Query planner"',
  'node merger "Result merger"',
  'edge a gateway -> planner',
  'edge b planner -> merger',
];

const boxes = async (source: string) =>
  (await compile(source)).objects
    .filter(o => o.shape !== 'portal')
    .map(({ id, x, y, w, h }) => ({ id, x, y, w, h }));

const extent = (objects: { x: number; y: number; w: number; h: number; shape?: string }[]) => {
  const drawn = objects.filter(o => o.shape !== 'portal');
  return {
    x: Math.min(...drawn.map(o => o.x)),
    y: Math.min(...drawn.map(o => o.y)),
    r: Math.max(...drawn.map(o => o.x + o.w)),
    b: Math.max(...drawn.map(o => o.y + o.h)),
  };
};

describe('portals', () => {
  it('are laid out after the drawing, so they move nothing', async () => {
    const plain = [...base].join('\n');
    const withPortal = [
      ...base,
      'node offsite "Offsite" shape=portal',
      'edge c merger -> offsite "warm fetch"',
      'edge d offsite -> gateway "callback"',
    ].join('\n');
    expect(await boxes(withPortal)).toEqual(await boxes(plain));
  });

  it('sit outside the frame, on the side facing what they connect to', async () => {
    const scene = await compile(
      [...base, 'node offsite "Offsite" shape=portal', 'edge c merger -> offsite'].join('\n'),
    );
    const frame = extent(scene.objects),
      portal = scene.byId.get('offsite')!,
      merger = scene.byId.get('merger')!;
    // The merger ends the run to the right, so its portal is beyond the frame's right edge.
    expect(portal.x).toBeGreaterThan(frame.r);
    expect(portal.y + portal.h / 2).toBeCloseTo(merger.y + merger.h / 2, 0);
    expect(portal.parent).toBe('root');
  });

  it('spread along their side instead of overlapping', async () => {
    const scene = await compile(
      [
        ...base,
        'node p1 "Offsite" shape=portal',
        'node p2 "Billing" shape=portal',
        'edge c merger -> p1',
        'edge d merger -> p2',
      ].join('\n'),
    );
    const [p1, p2] = [scene.byId.get('p1')!, scene.byId.get('p2')!];
    expect(p1.x).toBe(p2.x);
    expect(Math.abs(p1.y - p2.y)).toBeGreaterThanOrEqual(p1.h);
  });

  it('are routed with the rest, without crossing a box', async () => {
    const scene = await compile(
      [
        ...base,
        'node offsite "Offsite" shape=portal',
        'edge c gateway -> offsite',
        'edge d merger -> offsite',
      ].join('\n'),
    );
    const doc = projectScene(scene),
      { vg, rects } = visibleRects(doc),
      { routes } = computeRoutes(doc, vg, rects);
    expect(routes.find(r => r.id === 'c')?.blocked).toBe(false);
    expect(checkScene(scene).diagnostics.filter(d => d.code === 'edge-through-node')).toEqual([]);
  });

  it('ignore refinements that would move them, and say so', async () => {
    const scene = await compile(
      [
        ...base,
        'node offsite "Offsite" shape=portal',
        'edge c merger -> offsite',
        'stay offsite x=0 y=0',
      ].join('\n'),
    );
    expect(scene.byId.get('offsite')!.x).toBeGreaterThan(extent(scene.objects).r);
    expect(scene.diagnostics.some(d => d.code === 'portal-placed')).toBe(true);
  });

  it('take a host size', async () => {
    const scene = await compile(
      [
        ...base,
        'node offsite "Offsite" shape=portal',
        'edge c merger -> offsite',
        'size offsite width=120 height=auto min-height=40',
      ].join('\n'),
    );
    expect(scene.byId.get('offsite')!.w).toBe(120);
    expect(scene.byId.get('offsite')!.h).toBeGreaterThanOrEqual(40);
  });

  it('sit at the top level of a flow', async () => {
    await expect(
      compile(
        [
          ...base,
          'group g "G"',
          'node offsite "Offsite" shape=portal in=g',
          'node x "X" in=g',
        ].join('\n'),
      ),
    ).rejects.toThrow('portal');
  });
});
