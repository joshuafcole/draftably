import { describe, expect, it } from 'vitest';
import { checkScene } from '../src/dsl/check';
import { checkSource, compile } from '../src/dsl/compile';
import { sourceOperations } from '../src/dsl/operations';
import { projectScene, visibleRects } from '../src/dsl/project';
import { printSource, readSource } from '../src/dsl/syntax';
import { translateEdit } from '../src/dsl/translate';
import { clone } from '../src/model/geometry';
import { placeAlong, placeOf } from '../src/model/route-marks';
import { computeRoutes } from '../src/model/routes';
import type { Diagram, Point } from '../src/model/types';

const GROUPED = [
  'diagram "Routes" version=1',
  'group svc "Services"',
  'node api "API" in=svc',
  'node db "Store" in=svc',
  'node web "Web"',
  'edge read api -> db "reads"',
  'edge call web -> api "calls"',
].join('\n');

async function drawn(source: string) {
  const scene = await compile(source),
    doc = projectScene(scene),
    { vg, rects } = visibleRects(doc),
    { routes } = computeRoutes(doc, vg, rects, { previous: [] });
  return { scene, doc, rects, routes, route: (id: string) => routes.find(r => r.id === id)! };
}

const passes = (points: Point[], p: Point) =>
  points.some(
    (a, i) =>
      i > 0 &&
      Math.min(a.x, points[i - 1].x) <= p.x &&
      p.x <= Math.max(a.x, points[i - 1].x) &&
      Math.min(a.y, points[i - 1].y) <= p.y &&
      p.y <= Math.max(a.y, points[i - 1].y) &&
      (a.x === points[i - 1].x ? a.x === p.x : a.y === p.y),
  );

/** Apply an editor edit to the drawn file, as the session commits one. */
function edit(source: string, label: string, selection: string[], fn: (d: Diagram) => void) {
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
    drag: 'stay',
  });
  return { text: printSource(result.source), operations: result.operations };
}

describe('route statements', () => {
  it('are read, kept by printSource, and refused when they name no edge or a bad point', async () => {
    const text = `${GROUPED}\nroute read via=40,10;80,10 strength=required\n`;
    expect(printSource(readSource(text))).toBe(text);
    const scene = checkSource(text);
    expect(scene.model.routes).toEqual([
      {
        id: 'read',
        via: [
          { x: 40, y: 10 },
          { x: 80, y: 10 },
        ],
        strength: 'required',
        line: 8,
      },
    ]);
    expect(() => checkSource(`${GROUPED}\nroute nowhere via=1,2`)).toThrow('Unknown edge nowhere');
    expect(() => checkSource(`${GROUPED}\nroute read via=1`)).toThrow('via=x1,y1;x2,y2');
    expect(() => checkSource(`${GROUPED}\nroute read`)).toThrow('A route needs via=');
    expect(() => checkSource(`${GROUPED}\nroute read via=1,2\nroute read via=3,4`)).toThrow(
      'Duplicate',
    );
    expect(() => checkSource(`${GROUPED}\nroute read via=1,2 strength=hard`)).toThrow(
      'soft|required',
    );
  });

  it('are relative to the content area of the group holding both ends, so moving the group moves them', async () => {
    const at = await drawn(`${GROUPED}\nroute read via=-20,30\n`),
      svc = at.scene.byId.get('svc')!,
      origin = {
        x: at.scene.byId.get('api')!.x - at.scene.byId.get('api')!.localX,
        y: at.scene.byId.get('api')!.y - at.scene.byId.get('api')!.localY,
      };
    expect(origin.x).toBeGreaterThan(svc.x);
    const bend = { x: origin.x - 20, y: origin.y + 30 };
    expect(at.doc.layout.edges.read.waypoints).toEqual([bend]);
    expect(passes(at.route('read').points, bend)).toBe(true);
    // The group pinned 100 to the right and down: the bend comes with it.
    const moved = await drawn(
      `${GROUPED}\nroute read via=-20,30\npin svc x=${svc.x + 100} y=${svc.y + 100}\n`,
    );
    expect(moved.doc.layout.edges.read.waypoints).toEqual([{ x: bend.x + 100, y: bend.y + 100 }]);
  });

  it('give way when soft and a point lands in a box, and hold when required', async () => {
    const plain = await drawn(GROUPED),
      web = plain.scene.byId.get('web')!,
      api = plain.scene.byId.get('api')!,
      // The route of `read` is relative to Services' content area, where API sits at its origin.
      inWeb = `${web.x + 10 - (api.x - api.localX)},${web.y + 10 - (api.y - api.localY)}`;
    const soft = await drawn(`${GROUPED}\nroute read via=${inWeb}\n`);
    const gave = soft.scene.diagnostics.find(d => d.code === 'route-gave-way')!;
    expect(gave.line).toBe(8);
    expect(gave.message).toContain('inside web');
    expect(soft.doc.layout.edges.read.waypoints).toBeUndefined();
    expect(soft.route('read').points).toEqual(plain.route('read').points);
    expect(checkScene(soft.scene).diagnostics.map(d => d.code)).toContain('route-gave-way');
    const held = await drawn(`${GROUPED}\nroute read via=${inWeb} strength=required\n`);
    expect(held.scene.diagnostics.map(d => d.code)).not.toContain('route-gave-way');
    expect(held.doc.layout.edges.read.waypoints).toHaveLength(1);
  });

  it('a dragged bend is written relative to its group, and a fresh compile draws it exactly', async () => {
    const first = await drawn(GROUPED),
      api = first.scene.byId.get('api')!,
      db = first.scene.byId.get('db')!,
      // Between the two boxes, off the straight line down.
      bend = { x: api.x + api.w / 2 + 30, y: Math.round((api.y + api.h + db.y) / 2) };
    const { text, operations } = edit(GROUPED, 'Move bend', ['read'], d => {
      d.layout.edges.read = { ...d.layout.edges.read, waypoints: [bend] };
    });
    expect(operations.map(o => `${o.kind} ${o.statement} ${o.id}`)).toEqual(['add route read']);
    expect(text).toMatch(
      new RegExp(
        `^route read via=${bend.x - (api.x - api.localX)},${bend.y - (api.y - api.localY)}$`,
        'm',
      ),
    );
    const again = await drawn(text);
    expect(again.doc.layout.edges.read.waypoints).toEqual([bend]);
    expect(passes(again.route('read').points, bend)).toBe(true);
    // Removing every bend removes the statement.
    const bare = edit(text, 'Reset connection bends', ['read'], d => {
      d.layout.edges.read.waypoints = undefined;
    });
    expect(bare.text).not.toMatch(/^route /m);
    expect(bare.operations.map(o => `${o.kind} ${o.statement}`)).toEqual(['remove route']);
  });

  it('go when their edge goes', () => {
    const text = `${GROUPED}\nroute read via=1,2\nlabel read at=0.5\n`;
    const { text: out } = edit(text, 'Delete', [], d => {
      d.graph.edges = d.graph.edges.filter(e => e.id !== 'read');
    });
    expect(out).not.toMatch(/^(route|label) read/m);
  });
});

describe('label statements', () => {
  it('put the label a fraction along its line and off it, to the left of its way', async () => {
    const at = await drawn(`${GROUPED}\nlabel call at=0.25 offset=-14\n`),
      r = at.route('call');
    expect(r.label).toMatchObject(placeAlong(r.points, 0.25, -14));
    // Read back, the place draws the label where it is (to the place's rounding).
    const back = placeOf(r.points, r.label!),
      redrawn = placeAlong(r.points, back.at, back.offset);
    expect(Math.hypot(redrawn.x - r.label!.x, redrawn.y - r.label!.y)).toBeLessThan(1.5);
    expect(() => checkSource(`${GROUPED}\nlabel call at=2`)).toThrow('at from 0 to 1');
    expect(() => checkSource(`${GROUPED}\nlabel call offset=3`)).toThrow('A label needs at=');
  });

  it('a slid label is written as the place nearest where it was let go, and drawn there again', async () => {
    const first = await drawn(GROUPED),
      was = first.route('call').label!;
    const { text, operations } = edit(GROUPED, 'Move connection label', ['call'], d => {
      d.layout.edges.call = { ...d.layout.edges.call, labelDx: 0, labelDy: -30 };
    });
    expect(operations.map(o => `${o.kind} ${o.statement} ${o.id}`)).toEqual(['add label call']);
    const again = await drawn(text),
      now = again.route('call').label!;
    const place = placeOf(first.route('call').points, { x: was.x, y: was.y - 30 });
    expect(now).toMatchObject(placeAlong(again.route('call').points, place.at, place.offset));
    // Close to where it was let go; the place keeps a fraction to three places and whole pixels.
    expect(Math.abs(now.y - (was.y - 30))).toBeLessThan(2);
    // A second slide rewrites the one statement.
    const second = edit(text, 'Move connection label', ['call'], d => {
      d.layout.edges.call = { ...d.layout.edges.call, labelDy: 10 };
    });
    expect(second.operations.map(o => `${o.kind} ${o.statement}`)).toEqual(['set label']);
  });

  it('a label set clear of its line takes a leader back to it, and check says so', async () => {
    const near = await drawn(`${GROUPED}\nlabel call at=0.5 offset=0\n`);
    expect(near.route('call').leader).toBeUndefined();
    const far = await drawn(`${GROUPED}\nlabel call at=0.5 offset=90\n`),
      r = far.route('call'),
      l = r.leader!;
    expect(l).toBeDefined();
    // From the label's edge to its line.
    expect(passes(r.points, { x: l.x2, y: l.y2 })).toBe(true);
    const { diagnostics } = checkScene(far.scene, { metrics: true });
    const found = diagnostics.find(d => d.code === 'label-detached')!;
    expect(found.message).toContain('leader');
  });
});

describe('hops', () => {
  const CROSS = [
    'diagram "Hops" version=1',
    'node a "A"',
    'node b "B"',
    'node c "C"',
    'node d "D"',
    'edge across a -> b',
    'edge down c -> d',
    'pin a x=0 y=100',
    'pin b x=400 y=100',
    'pin c x=200 y=0',
    'pin d x=200 y=260',
  ].join('\n');

  it('draw an arc where a level run crosses a line it shares no end with, only when asked', async () => {
    const off = await drawn(CROSS),
      on = await drawn(`${CROSS}\nrouting hops=on\n`);
    expect(off.routes.every(r => !r.path.includes('A'))).toBe(true);
    expect(on.route('across').path).toMatch(/A5,5 0 0 [01] /);
    expect(on.route('down').path).not.toContain('A');
    // The route itself is unchanged.
    expect(on.route('across').points).toEqual(off.route('across').points);
  });

  it('leave lines that share an end alone', async () => {
    const shared = CROSS.replace('edge down c -> d', 'edge down c -> b');
    const on = await drawn(`${shared}\nrouting hops=on\n`);
    expect(on.routes.every(r => !r.path.includes('A'))).toBe(true);
  });

  it('a routing line keeps hops=on through a settings change', () => {
    const scene = checkSource(`${CROSS}\nrouting hops=on\n`);
    expect(scene.model.routing.hops).toBe('on');
    expect(projectScene(scene).settings.routing.hops).toBe('on');
  });
});

describe('the operations a host reads', () => {
  it('name a route or label by its edge', () => {
    const ops = sourceOperations(
      readSource(GROUPED),
      readSource(`${GROUPED}\nroute read via=1,2;3,2\nlabel read at=0.4 offset=12\n`),
    );
    expect(ops).toEqual([
      { kind: 'add', statement: 'route', id: 'read', fields: { via: '1,2;3,2' } },
      { kind: 'add', statement: 'label', id: 'read', fields: { at: '0.4', offset: '12' } },
    ]);
  });
});
