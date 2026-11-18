import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSource, contentOrigin, rankLayers } from '../src/dsl/compile';
import { canonicalGeometry, projectScene } from '../src/dsl/project';
import { DslError, formatSource, parseModel } from '../src/dsl/syntax';
import { normalize } from '../src/model/document';
import { edgeLabelSize } from '../src/model/labels';

const checkout = readFileSync(path.join(__dirname, '../examples/checkout.draft'), 'utf8');

const errorLine = (source: string) => {
  try {
    parseModel(source);
  } catch (error) {
    expect(error).toBeInstanceOf(DslError);
    return (error as DslError).line;
  }
  throw Error('expected a DslError');
};

describe('syntax', () => {
  it('reports the line of each kind of error', () => {
    expect(errorLine('node a "A"\nnode a "B"')).toBe(2);
    expect(errorLine('node a "A" in=nowhere')).toBe(1);
    expect(errorLine('node a "A"\n\nedge e a -> b')).toBe(3);
    expect(errorLine('node a "A" colour=blue')).toBe(1);
    expect(errorLine('node a "A\n')).toBe(1);
    expect(errorLine('group g "G"\nnode a "A" in=g\nnode b "B"\nnear a b')).toBe(4);
    expect(errorLine('layout root grid')).toBe(1);
  });

  it('refuses attributes that have no effect', () => {
    for (const attr of ['kind=database', 'detail="x"', 'priority=3'])
      expect(errorLine(`node a "A" ${attr}`)).toBe(1);
    for (const attr of ['kind=data', 'importance=2'])
      expect(errorLine(`node a "A"\nnode b "B"\nedge e a -> b ${attr}`)).toBe(3);
  });

  it('formats consistently and keeps comments and unrelated statements', () => {
    const messy =
      '\n\n# heading\n  node   a  "A"   color=blue   # inline note\n\n\n\nnode b "B" // other style\n\n';
    expect(formatSource(messy)).toBe(
      '# heading\nnode a "A" color=blue # inline note\n\nnode b "B" // other style\n',
    );
    expect(formatSource(formatSource(checkout))).toBe(formatSource(checkout));
    expect(formatSource(checkout)).toContain('# Customer-facing entry points.');
  });
});

describe('compile', () => {
  it('places nested children inside their group content area', () => {
    const scene = checkSource(checkout);
    for (const o of scene.objects) {
      if (o.parent === 'root') continue;
      const g = scene.byId.get(o.parent)!,
        origin = contentOrigin(g);
      expect(o.x).toBe(origin.x + o.localX);
      expect(o.x + o.w).toBeLessThanOrEqual(g.x + g.w);
      expect(o.y + o.h).toBeLessThanOrEqual(g.y + g.h);
    }
    expect(scene.diagnostics.filter(d => d.level === 'error')).toEqual([]);
  });

  it('keeps pins at their parent-local coordinates when content is added', () => {
    const pinned = checkout + 'pin db x=900 y=40\n';
    const before = checkSource(pinned).byId.get('db')!;
    const after = checkSource(pinned + 'node cache "Cache"\nedge read api -> cache\n').byId.get(
      'db',
    )!;
    expect([before.localX, before.localY]).toEqual([900, 40]);
    expect([after.localX, after.localY]).toEqual([900, 40]);
  });

  it('places an object relative to a sibling', () => {
    const scene = checkSource(checkout + 'near payments orders side=below gap=40\n');
    const orders = scene.byId.get('orders')!,
      payments = scene.byId.get('payments')!;
    expect(payments.y).toBe(orders.y + orders.h + 40);
  });

  it('reports a relaxed preference instead of overlapping', () => {
    const scene = checkSource(checkout + 'nudge payments dx=-120\n');
    expect(scene.diagnostics.some(d => d.code === 'relaxed' && d.ids[0] === 'payments')).toBe(true);
  });

  it('gives a relaxed diagnostic its intended position and distance as numbers', () => {
    const scene = checkSource(checkout + 'nudge payments dx=-120\n'),
      d = scene.diagnostics.find(x => x.code === 'relaxed' && x.ids[0] === 'payments')!,
      got = scene.byId.get('payments')!;
    expect(typeof d.intended?.x).toBe('number');
    expect(typeof d.intended?.y).toBe('number');
    expect(d.distance).toBeGreaterThanOrEqual(2);
    expect(d.message).toContain(`gave way by ${d.distance} px`);
    expect(Math.round(Math.hypot(got.x - d.intended!.x, got.y - d.intended!.y))).toBe(d.distance);
  });

  it('honors a requested group size and reports a size the contents override', () => {
    const big = checkSource(
      checkout.replace('layout services row gap=56', 'layout services row gap=56 min-width=800'),
    );
    expect(big.byId.get('services')!.w).toBe(800);
    const small = checkSource(
      checkout.replace('layout services row gap=56', 'layout services row gap=56 min-width=100'),
    );
    expect(small.diagnostics.some(d => d.code === 'group-grew')).toBe(true);
  });

  it('points a bare inner quote at its column and suggests the escape', () => {
    expect(() => parseModel('node a "Says "hi" now"')).toThrow(/Line 1, column 14: .*\\"/);
    expect(parseModel('node a "Says \\"hi\\""').objects[0].label).toBe('Says "hi"');
  });

  it('takes a count as a number or a short symbol', () => {
    const counts = parseModel('node a "A" count=12\nnode b "B" count=N').objects.map(o => o.count);
    expect(counts).toEqual([12, 'N']);
    expect(() => parseModel('node a "A" count=1')).toThrow(/count/);
  });

  it('rejects relative placement cycles with a line', () => {
    expect(() => checkSource('node a "A"\nnode b "B"\nnear a b\nnear b a\n')).toThrow(/Line [34]/);
  });
});

/** A chain of `n` nodes, `n0 -> n1 -> …`, with optional extra lines. */
const chain = (n: number, extra = '') =>
  Array.from({ length: n }, (_, i) => `node n${i} "Step ${i}"`).join('\n') +
  '\n' +
  Array.from({ length: n - 1 }, (_, i) => `edge e${i} n${i} -> n${i + 1}`).join('\n') +
  '\n' +
  extra;
const aspect = (scene: ReturnType<typeof checkSource>) => {
  const xs = scene.objects.flatMap(o => [o.x, o.x + o.w]),
    ys = scene.objects.flatMap(o => [o.y, o.y + o.h]);
  return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
};
const centre = (scene: ReturnType<typeof checkSource>, id: string) => {
  const o = scene.byId.get(id)!;
  return { x: o.x + o.w / 2, y: o.y + o.h / 2 };
};

describe('flow ranks', () => {
  it('breaks a loop at its return edge instead of putting the loop in one layer', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const pairs: Array<[string, string]> = [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'b'],
      ['d', 'e'],
    ];
    expect(rankLayers(ids, pairs)).toEqual([['a'], ['b'], ['c'], ['d'], ['e']]);
  });

  it('starts from the first declared node when every node is on a cycle', () => {
    expect(
      rankLayers(
        ['x', 'y', 'z'],
        [
          ['y', 'z'],
          ['z', 'x'],
          ['x', 'y'],
        ],
      ),
    ).toEqual([['x'], ['y'], ['z']]);
  });

  it('keeps a looping pipeline along the requested direction', () => {
    const scene = checkSource(
      chain(4, 'edge back n3 -> n1 "retry"\nlayout root flow direction=right'),
    );
    const xs = ['n0', 'n1', 'n2', 'n3'].map(id => centre(scene, id).x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(['n0', 'n1', 'n2', 'n3'].map(id => centre(scene, id).y)).size).toBe(1);
  });
});

describe('flow folding', () => {
  it('leaves a short chain on one line', () => {
    const scene = checkSource(chain(4, 'layout root flow direction=right'));
    expect(new Set(scene.objects.map(o => o.y)).size).toBe(1);
  });

  it('folds a long chain into rows that each read left to right', () => {
    const scene = checkSource(chain(12, 'layout root flow direction=right'));
    expect(aspect(scene)).toBeLessThanOrEqual(3);
    const rows = [...new Set(scene.objects.map(o => o.y))].sort((a, b) => a - b);
    expect(rows.length).toBeGreaterThan(1);
    // Reading row by row, left to right, visits the chain in order.
    const read = [...scene.objects].sort((a, b) => a.y - b.y || a.x - b.x).map(o => o.id);
    expect(read).toEqual(Array.from({ length: 12 }, (_, i) => `n${i}`));
    // Every row starts again at the left edge.
    for (const y of rows)
      expect(Math.min(...scene.objects.filter(o => o.y === y).map(o => o.x))).toBe(0);
  });

  it('folds a long downward chain into columns', () => {
    const scene = checkSource(chain(12, 'layout root flow direction=down'));
    expect(1 / aspect(scene)).toBeLessThanOrEqual(3);
    expect(new Set(scene.objects.map(o => o.x)).size).toBeGreaterThan(1);
  });

  // A CI run: two decisions on the main line, a proofs job beside it, and a shared failure.
  const checks = `
node pr "Pull request" shape=pill
node install "pnpm install"
node changeset "Changeset present?" shape=diamond
node skill "Skill updated?" shape=diamond
node release "release:check"
node fast "check:fast"
node engines "test:engines"
node cli "cli:build + pack-check"
node build "pnpm build"
node file "prove:file"
node proof "prove:layout"
node upload "Upload screenshots"
node fail "Check fails"
edge c1 pr -> install
edge c2 install -> changeset
edge c3 changeset -> skill "yes"
edge c4 skill -> release "yes"
edge c5 release -> fast
edge c6 fast -> engines
edge c7 engines -> cli
edge c8 install -> build "proofs job"
edge c9 build -> file
edge c10 file -> proof
edge c11 proof -> upload "on failure"
edge c12 changeset -> fail "no"
edge c13 skill -> fail "no"
layout root flow direction=right`;
  // Bands are separated by a gap wider than any gap inside one.
  const bandOf = (scene: ReturnType<typeof checkSource>) => {
    const band = new Map<string, number>();
    let k = 0,
      bottom = -Infinity;
    for (const o of [...scene.objects].sort((a, b) => a.y - b.y)) {
      if (bottom > -Infinity && o.y > bottom + 60) k++;
      band.set(o.id, k);
      bottom = Math.max(bottom, o.y + o.h);
    }
    return band;
  };

  it('keeps each decision in the same band as its branches', () => {
    const scene = checkSource(checks),
      band = bandOf(scene);
    expect(new Set(band.values()).size).toBe(2);
    for (const e of scene.edges)
      if (['changeset', 'skill'].includes(e.source))
        expect(band.get(e.target), e.id).toBe(band.get(e.source));
  });

  it('pulls a side branch back to the end of its source band', () => {
    const scene = checkSource(checks),
      band = bandOf(scene),
      at = (id: string) => scene.byId.get(id)!;
    // Upload screenshots would start the second band; it stays beside prove:layout instead.
    expect(band.get('upload')).toBe(band.get('proof'));
    expect(at('upload').x).toBeGreaterThan(at('proof').x + at('proof').w);
    expect(at('upload').y + at('upload').h / 2).toBeCloseTo(at('proof').y + at('proof').h / 2, 0);
    // The main line still wraps.
    expect(band.get('fast')).toBe(1);
  });

  it('returns wrap edges along lanes that share the gap between bands', () => {
    // A retry from Check fails gives the gap a second wrap edge.
    const scene = checkSource(checks + '\nedge c14 fail -> fast "retry"'),
      band = bandOf(scene);
    const wraps = scene.edges.filter(e => band.get(e.target)! > band.get(e.source)!);
    expect(wraps.length).toBeGreaterThan(1);
    const top = Math.max(...scene.objects.filter(o => !band.get(o.id)).map(o => o.y + o.h)),
      bottom = Math.min(...scene.objects.filter(o => band.get(o.id)).map(o => o.y));
    const lanes = wraps.map(e => (e.lane && 'y' in e.lane ? e.lane.y : NaN)).sort((a, b) => a - b);
    // Evenly spaced across the gap, one lane per edge, at least a pitch apart.
    const pitch = (bottom - top) / (lanes.length + 1);
    expect(pitch).toBeGreaterThanOrEqual(20);
    lanes.forEach((y, i) => expect(Math.abs(y - (top + pitch * (i + 1)))).toBeLessThanOrEqual(1));
    // The router draws each wrap along its own lane.
    const doc = projectScene(scene);
    expect(normalize(doc)).toEqual(doc);
    const routes = new Map(canonicalGeometry(doc).routes.map(r => [r.id, r.points]));
    for (const e of wraps) {
      const y = (e.lane as { y: number }).y,
        points = routes.get(e.id)!;
      expect(
        points.some((p, i) => i && p.y === y && points[i - 1].y === y),
        e.id,
      ).toBe(true);
    }
  });

  it('widens the band gap to fit the labels on its lanes', () => {
    // Three side-by-side chains, so three wraps share each gap.
    const chains = (label: string) =>
      ['a', 'b', 'c']
        .flatMap(c =>
          Array.from({ length: 12 }, (_, i) => [
            `node ${c}${i} "Step ${i}"`,
            ...(i ? [`edge ${c}e${i} ${c}${i - 1} -> ${c}${i}${label}`] : []),
          ]),
        )
        .flat()
        .join('\n') + '\nlayout root flow direction=right';
    const gap = (scene: ReturnType<typeof checkSource>) => {
      const band = bandOf(scene),
        top = Math.max(...scene.objects.filter(o => !band.get(o.id)).map(o => o.y + o.h));
      return Math.min(...scene.objects.filter(o => band.get(o.id) === 1).map(o => o.y)) - top;
    };
    const plain = checkSource(chains('')),
      labelled = checkSource(chains(' "a long wrap label"'));
    expect(gap(labelled)).toBeGreaterThan(gap(plain));
    const lanes = labelled.edges
      .flatMap(e => (e.lane && 'y' in e.lane ? [e.lane.y] : []))
      .sort((a, b) => a - b)
      .slice(0, 3);
    expect(lanes).toHaveLength(3);
    // A label on one lane leaves a lane pitch clear of its neighbours.
    const { h } = edgeLabelSize('a long wrap label', labelled.look);
    for (let i = 1; i < lanes.length; i++)
      expect(lanes[i] - lanes[i - 1]).toBeGreaterThanOrEqual(20 + h / 2);
  });

  it('keeps a long chain on one line with fold=never', () => {
    const scene = checkSource(chain(12, 'layout root flow direction=right fold=never'));
    expect(new Set(scene.objects.map(o => o.y)).size).toBe(1);
    expect(parseModel(chain(3, 'layout root row fold=never')).warnings.map(w => w.code)).toEqual([
      'layout-attribute',
    ]);
  });
});

describe('projection', () => {
  it('produces a valid editor document and reproducible geometry', () => {
    const doc = projectScene(checkSource(checkout));
    expect(normalize(doc)).toEqual(doc);
    expect(doc.layout.containers.platform.manualSize).toBe(true);
    expect(doc.styles.payments.shape).toBe('pill');
    expect(doc.styles.orders.color).toBe('mint');
    expect(doc.graph.edges.find(e => e.id === 'persist')!.dashed).toBe(true);
    const a = JSON.stringify(canonicalGeometry(doc)),
      b = JSON.stringify(canonicalGeometry(projectScene(checkSource(checkout))));
    expect(a).toBe(b);
    expect(canonicalGeometry(doc).routes).toHaveLength(5);
  });
});
