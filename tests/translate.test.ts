import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSource } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import { printSource, readSource } from '../src/dsl/syntax';
import {
  movedOutsideEdit,
  reflowGroup,
  translateEdit,
  UnsupportedEdit,
} from '../src/dsl/translate';
import * as edits from '../src/model/edits';
import { clone } from '../src/model/geometry';
import type { Diagram } from '../src/model/types';

const checkout = readFileSync(path.join(__dirname, '../examples/checkout.draft'), 'utf8');

/** The repro from issues #424 and #437. */
const SCORING = `diagram "Score a change so reviewers know their posture" version=1
subtitle "Objective scores on the change replace guessing from diff size"

group bug "Defect: impact" color=red
node disrupt "Disruption: crash, feature\\nunusable, or retry works" in=bug
node scope "Scope: one user\\nor every user" in=bug
group dev "Dev work: impact on developers" color=blue
node touches "Who it touches" in=dev
node odds "Odds it hurts\\nor helps others" in=dev
node process "Process, skills, docs\\nvs architecture, refactor, API" in=dev
node today "Today: description\\nand diff size" color=stone
node scores "Scores in the description or labels" color=amber shade=300
group posture "Reviewer posture" color=slate
node accept "Default accept" in=posture
node caution "Default caution" in=posture
node reject "Default reject" in=posture

edge s1 bug -> scores
edge s2 dev -> scores
edge s3 today -> scores "replaces" kind=async
edge s4 scores -> posture "sets"

layout root engine=layered direction=down
layout bug row
layout dev row
layout posture row

legend red "Defect scoring"
legend blue "Dev-work scoring"
legend amber shade=300 "What we add"
legend line dashed "Today's signal"
`;

/** Apply an editor edit to the projected file and return the new source and its scene. */
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
  });
  const text = printSource(result.source);
  return { text, scene: checkSource(text), result };
}

describe('translating editor edits', () => {
  it('saves a drag as a relative preference next to the nearest sibling', () => {
    const { text, scene, result } = edit(checkout, 'Move objects', ['db'], d => {
      const api = d.layout.nodes.platform;
      d.layout.nodes.db.x = api.x + api.w + 40;
      d.layout.nodes.db.y = api.y + 200;
    });
    expect(text).toMatch(/^near db platform side=right gap=40 offset=\d+$/m);
    expect(result.notes[0]).toBe('db right of platform');
    const platform = scene.byId.get('platform')!,
      db = scene.byId.get('db')!;
    expect(db.x).toBe(platform.x + platform.w + 40);
  });

  it('places a node dropped under a neighbour below it, not beside the one across the gap', () => {
    // Issue #237: `paid` dropped under `declined` in submitPayment's row was saved right of it.
    const source = [
      'group client "Browser"',
      'node click "Click Pay" in=client',
      'node req "submitPayment" in=client',
      'node ok "paid" in=client shape=pill',
      'node err "declined (try again)" in=client shape=pill',
      'edge s1 click -> req',
      'layout root flow direction=down',
      'stay ok x=0 y=0',
      'stay click x=188 y=0',
      'stay err x=376 y=0',
      'stay req x=188 y=85',
      '',
    ].join('\n');
    const { text, scene, result } = edit(source, 'Move objects', ['ok'], d => {
      const req = d.layout.nodes.req;
      d.layout.nodes.ok.x = req.x + req.w + 24;
      d.layout.nodes.ok.y = req.y;
    });
    expect(text).toMatch(/^near ok err side=below gap=29$/m);
    expect(result.notes[0]).toBe('ok below err');
    const req = scene.byId.get('req')!;
    expect(scene.byId.get('ok')).toMatchObject({ x: req.x + req.w + 24, y: req.y });
    expect(result.drops).toEqual([expect.objectContaining({ id: 'ok', x: req.x + req.w + 24 })]);
  });

  it('moves a soft group by giving each member a stay', () => {
    const source = [
      'node ingress "Ingress"',
      'group mon "Monitoring" frame=soft',
      'node prom "Prometheus" in=mon',
      'node graf "Grafana" in=mon',
      'edge e1 ingress -> prom',
      'edge e2 prom -> graf',
      '',
    ].join('\n');
    const was = checkSource(source);
    const { text, scene } = edit(source, 'Move objects', ['mon'], d => {
      for (const id of ['mon', 'prom', 'graf']) d.layout.nodes[id].y += 200;
    });
    const stays = text.split('\n').filter(l => l.startsWith('stay '));
    expect(stays.filter(l => /^stay (prom|graf) /.test(l))).toHaveLength(2);
    expect(text).not.toMatch(/^(stay|near|nudge) mon /m);
    for (const id of ['prom', 'graf'])
      expect(scene.byId.get(id)!.y - scene.byId.get('ingress')!.y).toBe(
        was.byId.get(id)!.y - was.byId.get('ingress')!.y + 200,
      );
  });

  it('keeps comments and unrelated statements when saving', () => {
    const { text } = edit(checkout, 'Move objects', ['db'], d => {
      d.layout.nodes.db.y += 300;
    });
    expect(text).toContain('# Customer-facing entry points.');
    expect(text).toContain('node payments "Payments" in=services shape=pill # charges cards');
    expect(text).toContain('# Layout refinements');
  });

  it('pins at the parent-local position and releases to a soft anchor', () => {
    const pinned = edit(checkout, 'Pin objects', ['orders'], d => {
      d.layout.nodes.orders.pinned = true;
    });
    const orders = checkSource(checkout).byId.get('orders')!;
    expect(pinned.text).toContain(`pin orders x=${orders.localX} y=${orders.localY}`);
    const released = edit(pinned.text, 'Unpin objects', ['orders'], d => {
      d.layout.nodes.orders.pinned = false;
    });
    expect(released.text).not.toMatch(/^pin orders/m);
    expect(released.text).toContain(`stay orders x=${orders.localX} y=${orders.localY}`);
  });

  it('writes requested sizes for shapes and containers', () => {
    const node = edit(checkout, 'Resize shape', ['api'], d => {
      d.layout.nodes.api.w = 240;
    });
    expect(node.text).toContain('size api width=240 height=56');
    const group = edit(checkout, 'Resize container', ['services'], d => {
      d.layout.nodes.services.x -= 3; // grid snapping
      d.layout.nodes.services.w += 100;
      d.layout.nodes.services.h += 60;
    });
    const before = checkSource(checkout).byId.get('services')!;
    expect(group.text).toContain(
      `layout services row gap=56 min-width=${before.w + 100} min-height=${before.h + 60}`,
    );
    expect(group.scene.byId.get('services')!.w).toBe(before.w + 100);
    expect(group.text).not.toMatch(/^near services/m);
  });

  it('keeps height=auto and min-height through a width-only resize', () => {
    const source =
      'node a "Build"\nnode b "Ship"\nedge a-b a -> b\n\nsize a width=140 height=auto min-height=90\n';
    const wider = edit(source, 'Resize shape', ['a'], d => {
      d.layout.nodes.a.w = 200;
    });
    expect(wider.text).toContain('size a width=200 height=auto min-height=90');
    const taller = edit(source, 'Resize shape', ['a'], d => {
      d.layout.nodes.a.h = 130;
    });
    expect(taller.text).toContain('size a width=140 height=130');
    expect(taller.text).not.toContain('min-height');
  });

  it('leaves no layout notes after a plain resize', () => {
    // Issue #437: a resize anchored its neighbours where they were, and the relayout broke them.
    const source = SCORING;
    const { text, scene } = edit(source, 'Resize shape', ['disrupt'], d => {
      d.layout.nodes.disrupt.w += 120;
    });
    expect(text).toMatch(/^size disrupt /m);
    expect(scene.diagnostics.filter(d => d.level !== 'info')).toEqual([]);
  });

  it('adds, renames, connects, styles and deletes with readable ids', () => {
    const { text, result } = edit(checkout, 'Add shape', [], d => {
      const id = edits.addNode(
        d,
        { title: 'Fraud check', parentId: 'services' },
        { x: 900, y: 600 },
      );
      edits.addEdge(d, { from: 'payments', to: id, label: 'score' });
      edits.setTitle(d, 'api', 'Gateway');
      edits.setStyle(d, 'db', { color: 'rose', shape: 'diamond' });
      edits.deleteObjects(d, ['web']);
    });
    expect(text).toMatch(/^node fraud-check "Fraud check" in=services$/m);
    expect(text).toMatch(/^edge payments-fraud-check payments -> fraud-check "score"$/m);
    expect(text).toContain('node api "Gateway" in=platform');
    expect(text).toContain('node db "Postgres" color=rose shape=diamond');
    expect(text).not.toMatch(/web/);
    expect([...result.ids.values()]).toEqual(['fraud-check', 'payments-fraud-check']);
  });

  it('wraps objects in a new group and ungroups them', () => {
    const wrapped = edit(checkout, 'Create container', [], d => {
      edits.wrapInContainer(d, ['db'], { x: 0, y: 0 });
    });
    expect(wrapped.text).toMatch(/^group container "Container"$/m);
    expect(wrapped.text).toContain('node db "Postgres" color=violet in=container');
    const flat = edit(wrapped.text, 'Ungroup', [], d => edits.ungroup(d, ['container']));
    expect(flat.text).not.toMatch(/container/);
  });

  it('reverses and restyles connections', () => {
    const { text } = edit(checkout, 'Reverse connection', [], d => {
      edits.reverseEdge(d, 'charge');
      d.graph.edges.find(e => e.id === 'persist')!.dashed = false;
    });
    expect(text).toContain('edge charge payments -> orders "authorize"');
    expect(text).toContain('edge persist orders -> db "persist"\n');
  });

  it('rejects edits the file cannot express', () => {
    expect(() =>
      edit(checkout, 'Set start preference', [], d => edits.setIntent(d, 'start', 'web', 'center')),
    ).toThrow(UnsupportedEdit);
  });

  it('does not write geometry for objects that were not edited', () => {
    const { text } = edit(checkout, 'Move objects', ['db'], d => {
      d.layout.nodes.web.x += 50; // a side effect, not the selection
    });
    expect(text).toBe(printSource(readSource(checkout)));
  });
});

describe('stability after a refinement', () => {
  const drag = () =>
    edit(checkout, 'Move objects', ['payments'], d => {
      const orders = d.layout.nodes.orders;
      d.layout.nodes.payments.x = orders.x;
      d.layout.nodes.payments.y = orders.y + orders.h + 40;
    });

  it('anchors top-level objects and siblings around the edit', () => {
    const { text, result } = drag();
    expect(text).toMatch(/^near payments orders side=below gap=40$/m);
    for (const id of ['clients', 'platform', 'db', 'api', 'orders'])
      expect(text).toMatch(new RegExp(`^stay ${id} x=\\d+ y=\\d+$`, 'm'));
    expect(text).not.toMatch(/^stay (web|mobile)/m);
    expect(result.notes.at(-1)).toBe('anchored 6 nearby');
  });

  it('keeps distant regions steady and reports movement the growth forces', () => {
    const { text } = drag();
    const before = checkSource(text);
    const added =
      text +
      'node fraud "Fraud check" in=services\nedge score payments -> fraud "score"\nnode cache "Cache"\nedge lookup api -> cache\n';
    const after = checkSource(added);
    for (const id of ['clients', 'web', 'mobile'])
      expect([after.byId.get(id)!.x, after.byId.get(id)!.y]).toEqual([
        before.byId.get(id)!.x,
        before.byId.get(id)!.y,
      ]);
    // The refinement still holds inside the edited group.
    const orders = after.byId.get('orders')!,
      payments = after.byId.get('payments')!;
    expect(payments.y).toBe(orders.y + orders.h + 40);
    // The wider platform now lands on db: their stays went stale, so both are dropped and the
    // packing places them, and that is reported. The packing keeps platform where it was and
    // moves db out of its way.
    const stale = after.diagnostics.filter(d => d.code === 'stale-stay').flatMap(d => d.ids);
    expect(stale.sort()).toEqual(['db', 'platform']);
    expect(movedOutsideEdit(before, after, readSource(text), readSource(added)).sort()).toEqual([
      'db',
    ]);
  });

  it('reports objects that moved although the edit did not mention them', () => {
    const before = checkSource(checkout),
      added = checkout + 'node cdn "CDN"\nedge serve cdn -> web\n',
      after = checkSource(added);
    const moved = movedOutsideEdit(before, after, readSource(checkout), readSource(added));
    expect(moved).toContain('clients');
    expect(moved).not.toContain('web');
    expect(moved).not.toContain('cdn');
  });

  it('reflows a group without disturbing what is around it', () => {
    const { text } = drag();
    const doc = readSource(text);
    expect(reflowGroup(doc, checkSource(text), 'services')).toBe(2);
    const reflowed = printSource(doc);
    expect(reflowed).not.toMatch(/^near payments/m);
    expect(reflowed).not.toMatch(/^stay orders/m);
    expect(reflowed).toMatch(/^stay platform/m);
  });
});

describe('editing a sequence', () => {
  const source = [
    'diagram "S" version=1',
    'node a "A"',
    'node b "B"',
    'node c "C"',
    'edge m1 a -> b "1"',
    'edge m2 b -> c "2"',
    'edge m3 c -> a "3"',
    'edge m4 a -> c "4"',
    'phase p "P" m1 m2 m3 # the middle',
    'phase q "Q" m4',
    'state s "S" m2 m4',
    'layout root sequence',
  ].join('\n');
  const without = (ids: string[]) => (d: Diagram) => {
    d.graph.edges = d.graph.edges.filter(e => !ids.includes(e.id));
  };

  it('takes a deleted message out of its phase', () => {
    const { text } = edit(source, 'Delete', [], without(['m2']));
    expect(text).toContain('phase p "P" m1 m3');
    expect(text).toContain('state s "S" m4');
  });

  it('removes a phase with its last message and keeps its comment', () => {
    const { text } = edit(source, 'Delete', [], without(['m1', 'm2', 'm3']));
    expect(text).not.toContain('phase p');
    expect(text).toContain('# the middle');
    expect(text).toContain('phase q "Q" m4');
  });

  it("clears a deleted participant's messages from phases and states", () => {
    const { text } = edit(source, 'Delete', [], d => {
      d.graph.nodes = d.graph.nodes.filter(n => n.id !== 'b');
      without(['m1', 'm2'])(d);
    });
    expect(text).toContain('phase p "P" m3');
    expect(text).toContain('state s "S" m4');
  });

  it('saves a drag as a lane order and never as a position', () => {
    const { text, scene } = edit(source, 'Move', ['a'], d => {
      d.layout.nodes.a.x += 200;
    });
    expect(text).toContain('order root b a c');
    expect(text).not.toMatch(/^(near|nudge|stay|pin) /m);
    expect(scene.byId.get('b')!.x).toBeLessThan(scene.byId.get('a')!.x);
  });

  it('saves nothing for a drag that keeps the lane order', () => {
    expect(() =>
      edit(source, 'Move', ['a'], d => {
        d.layout.nodes.a.y += 40;
      }),
    ).toThrow(UnsupportedEdit);
  });

  it('saves a resize and a new participant without position hints', () => {
    const { text } = edit(source, 'Resize', ['b'], d => {
      d.layout.nodes.b.w += 40;
    });
    expect(text).toMatch(/^size b /m);
    expect(text).not.toMatch(/^(near|nudge|stay|pin) /m);
    const added = edit(source, 'Add', [], d => {
      edits.addNode(d, { title: 'New' }, { x: 900, y: 0 });
    });
    expect(added.text).toContain('node new "New"');
    expect(added.text).not.toMatch(/^(near|nudge|stay|pin) /m);
  });
});
