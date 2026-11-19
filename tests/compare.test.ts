import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { compareDetailed, compareSources } from '../src/dsl/compare';
import { checkSource } from '../src/dsl/compile';
import { GROUP_INSET } from '../src/dsl/frame';
import { projectScene } from '../src/dsl/project';
import { formatSource } from '../src/dsl/syntax';
import { resolveAppearance } from '../src/model/appearance';
import { panelDoc } from '../src/model/panels';

const BEFORE = `diagram "Checkout" version=1
node api "API"
node orders "Orders"
node hook "Webhook"
edge dispatch api -> orders "create"
edge notify api -> hook
layout root flow gap=48
`;

const AFTER = `diagram "Checkout" version=1
node api "API"
node orders "Orders service"
node refunds "Refunds"
edge dispatch api -> orders "create"
edge refund orders -> refunds
layout root flow gap=48
`;

describe('compare', () => {
  it('marks added, removed and changed lines and keeps removed ones where they stood', () => {
    expect(compareSources(BEFORE, AFTER)).toBe(`diagram "Checkout" version=1
node api "API"
~node orders "Orders service" was="Orders"
-node hook "Webhook"
+node refunds "Refunds"
edge dispatch api -> orders "create"
-edge notify api -> hook
+edge refund orders -> refunds
layout root flow gap=48
`);
  });

  it('leaves an unchanged file unmarked', () => {
    expect(compareSources(AFTER, AFTER)).toBe(AFTER);
  });

  it('draws each line both panels keep along the same path', () => {
    const source = fs.readFileSync('examples/checkout-change.draft', 'utf8') + 'compare\n';
    const panels = renderSvg(projectScene(checkSource(source)))
      .split('<g transform=')
      .slice(1)
      .map(p => new Set([...p.matchAll(/<path d="(M-?[\d.]+,[^"]+)"/g)].map(m => m[1])));
    // dispatch, charge, persist and trail are in both panels and must not move between them.
    expect([...panels[0]].filter(d => panels[1].has(d))).toHaveLength(4);
  });

  it('splits an edge that joins other objects into a removed and an added line', () => {
    const before = 'node a "A"\nnode b "B"\nnode c "C"\nedge e a -> b\n';
    const after = 'group g "G"\nnode a "A"\nnode b "B" in=g\nnode c "C"\nedge e a -> c\n';
    const { merged, moved } = compareDetailed(before, after);
    expect(merged).toContain('-edge e-was a -> b-was\n+edge e a -> c\n');
    expect(moved).toEqual([]);
  });

  it('keeps a node that moved container in its old container in the older version', () => {
    const before = 'group g "G"\nnode a "A" in=g\nnode b "B"\nedge e a -> b\n';
    const after = 'group g "G"\nnode a "A"\nnode b "B"\nedge e a -> b\n';
    expect(compareSources(before, after)).toBe(
      'group g "G"\n-node a-was "A" in=g\n+node a "A"\nnode b "B"\n-edge e-was a-was -> b\n+edge e a -> b\n',
    );
  });

  it('trims a container to the members a panel keeps, on every side', () => {
    const doc = projectScene(
      checkSource(
        'group g "G"\n-node a "A" in=g\nnode b "B" in=g\nedge e a -> b\nlayout g engine=layered direction=down\n',
      ),
    );
    const after = panelDoc(doc, 'after').layout.nodes,
      header = resolveAppearance(doc.appearance).groupHeader;
    expect(after.g.y).toBe(after.b.y - header);
    expect(after.g.y + after.g.h).toBe(after.b.y + after.b.h + GROUP_INSET);
    expect(after.b).toEqual(doc.layout.nodes.b);
  });

  it('marks any changed attribute and names what has no old version to draw', () => {
    const { merged, unshown } = compareDetailed(
      'node a "A" color=red\nnode b "B"\nedge e a -> b\n',
      'node a "A" color=blue\nnode b "B"\nedge e a -> b kind=async\n',
    );
    expect(merged).toBe('~node a "A" color=blue\nnode b "B"\n~edge e a -> b kind=async\n');
    expect(unshown).toEqual(['a (color)', 'e (kind)']);
  });

  it('draws the old shape and count in Before and the new ones in After, in one box', () => {
    const { merged, unshown } = compareDetailed(
      'node a "A" shape=circle count=2\nnode b "B" count=N\nnode c "C" shape=box\n',
      'node a "A" shape=diamond count=3\nnode b "B"\nnode c "C" count=4\n',
    );
    expect(merged).toBe(
      '~node a "A" shape=diamond count=3 was-shape=circle was-count=2\n' +
        '~node b "B" was-count=N\n~node c "C" count=4 was-count=1\n',
    );
    expect(unshown).toEqual([]);
    const doc = projectScene(checkSource(merged)),
      [before, after] = [panelDoc(doc, 'before'), panelDoc(doc, 'after')],
      counts = (d: typeof doc) => d.graph.nodes.map(n => n.count);
    expect(before.styles.a.shape).toBe('circle');
    expect(after.styles.a.shape).toBe('diamond');
    expect(doc.styles.a.shape).toBe('diamond');
    expect(counts(before)).toEqual([2, 'N', undefined]);
    expect(counts(after)).toEqual([3, undefined, 4]);
    expect(before.layout.nodes).toEqual(after.layout.nodes);
  });

  it('keeps reporting a changed line end, which has no old version', () => {
    const { merged, unshown } = compareDetailed(
      'node a "A"\nnode b "B"\nedge e a -> b\n',
      'node a "A"\nnode b "B"\nedge e a -> b head=triangle tail=diamond\n',
    );
    expect(merged).toContain('~edge e a -> b head=triangle tail=diamond\n');
    expect(unshown).toEqual(['e (head, tail)']);
  });

  it('keeps reporting a change to a marker, whose box can hold no other shape', () => {
    const lines = (shape: string) =>
      `group g "G"\nnode a "A" in=g\nnode c "C" in=g${shape}\nlayout g cells\n`;
    const { merged, unshown } = compareDetailed(lines(''), lines(' shape=marker'));
    expect(merged).not.toContain('was-shape');
    expect(unshown).toEqual(['c (shape)']);
  });

  it('refuses the old-value words where they mean nothing', () => {
    expect(() => checkSource('node a "A" was-shape=circle\n')).toThrow(
      /was-shape= belongs on a changed \(~\) line/,
    );
    expect(() => checkSource('+node a "A" was-count=2\n')).toThrow(
      /was-count= belongs on a changed \(~\) line/,
    );
    expect(() => checkSource('~group g "G" was-shape=box\n')).toThrow(/Unknown group attribute/);
    expect(() => checkSource('~node a "A" was-shape=marker\n')).toThrow(/Expected was-shape=/);
  });

  it('keeps the old-value words through format', () => {
    const line = '~node a "A" shape=diamond was-shape=circle was-count=2\n';
    expect(formatSource(line)).toBe(line);
  });

  it('leaves a label change, which the older panel can draw, out of the list', () => {
    expect(compareDetailed('node a "A"\n', 'node a "B"\n').unshown).toEqual([]);
  });

  it('reports changes outside declarations', () => {
    const before = 'layout root sequence\nnode a "A"\nnode b "B"\nedge m1 a -> b\nphase p "P" m1\n';
    const after = 'layout root flow\nnode a "A"\nnode b "B"\nedge m1 a -> b\nnote "N" near=a\n';
    expect(compareDetailed(before, after).unshown).toEqual(['layout root', 'phase p', 'note']);
  });

  const SWAP = (order: string, phase = 'm2 m3') =>
    `layout root sequence\nnode a "A"\nnode b "B"\n${order}\nphase p "P" ${phase}\n`;
  const [M1, M2, M3] = ['edge m1 a -> a "self"', 'edge m2 a -> b', 'edge m3 b -> a'];

  it('draws the old message order in Before and the new one in After, with lanes kept', () => {
    const { merged, unshown, reordered } = compareDetailed(
      SWAP([M1, M2, M3].join('\n')),
      SWAP([M2, M3, M1].join('\n')),
    );
    expect(merged).toContain(`${M1}\nwas-order m1 m2 m3\n`);
    expect(unshown).toEqual([]);
    expect(reordered).toBe(true);
    const doc = projectScene(checkSource(merged)),
      [before, after] = [panelDoc(doc, 'before'), panelDoc(doc, 'after')],
      rows = (d: typeof doc) => ['m1', 'm2', 'm3'].map(id => d.layout.edges[id].row!);
    const [was, is] = [rows(before), rows(after)];
    expect(was[0] < was[1] && was[1] < was[2]).toBe(true);
    expect(is[1] < is[2] && is[2] < is[0]).toBe(true);
    expect(is).toEqual(rows(doc));
    expect(before.layout.nodes).toEqual(after.layout.nodes);
    // The older order ends on the phase band, so its panel runs a little further down.
    const [old, now] = [before, after].map(d => d.layout.sequence!.panel);
    expect({ ...old, h: 0 }).toEqual({ ...now, h: 0 });
    expect(old.h).toBeGreaterThanOrEqual(now.h);
    // The band holds m2 and m3 wherever they stand.
    const bands = [before, after].map(d => d.layout.sequence!.phases[0]);
    [was, is].forEach(([, m2, m3], i) => {
      expect(m2).toBeGreaterThan(bands[i].y);
      expect(m3).toBeLessThan(bands[i].y + bands[i].h);
    });
    expect(bands[0].y).not.toBe(bands[1].y);
  });

  it('lists split messages by their spare IDs and leaves added ones out of Before', () => {
    const m4 = 'edge m4 a -> b';
    const before = SWAP([M2, M3, m4].join('\n'), 'm2');
    const after = SWAP([m4, 'edge m3 a -> b', 'edge m9 b -> a', M2].join('\n'), 'm2');
    const { merged } = compareDetailed(before, after);
    expect(merged).toContain('was-order m2 m3-was m4\n');
    const doc = projectScene(checkSource(merged));
    expect(panelDoc(doc, 'before').graph.edges.map(e => e.id)).not.toContain('m9');
  });

  it('writes no order line when only additions and removals change the rows', () => {
    const { merged, reordered } = compareDetailed(
      SWAP([M1, M2, M3].join('\n')),
      SWAP([M2, M3, 'edge m9 a -> b'].join('\n')),
    );
    expect(merged).not.toContain('was-order');
    expect(reordered).toBe(false);
  });

  it('lengthens the older panel when its order draws longer', () => {
    const tall = 'edge m2 a -> b "a label long enough to wrap onto a few lines of text in its row"';
    const { merged } = compareDetailed(
      SWAP([M1, tall].join('\n'), 'm2'),
      SWAP([tall, M1].join('\n'), 'm2'),
    );
    const doc = projectScene(checkSource(merged)),
      before = panelDoc(doc, 'before'),
      grow = doc.layout.sequence!.before!.grow,
      a = before.graph.nodes[0];
    expect(grow).toBeGreaterThan(0);
    expect(a.lifeline).toBe(doc.graph.nodes[0].lifeline! + grow);
    expect(before.layout.sequence!.panel.h).toBe(doc.layout.sequence!.panel.h + grow);
    expect(doc.layout.nodes.a.y + doc.layout.nodes.a.h + a.lifeline!).toBeGreaterThan(
      before.layout.edges.m2.row!,
    );
  });

  it('holds the lanes and row for an old label bigger than its new one', () => {
    const old = 'Validate the password, the device and the session token against the old store',
      file = (extra: string) => `diagram "Sign in" version=1
${extra}
node a "A"
node b "B"
node c "C"
edge m1 a -> b "Open"
~edge m2 b -> c "Check" was="${old}"
layout root sequence
`;
    const doc = projectScene(checkSource(file('compare'))),
      plain = projectScene(checkSource(file(''))),
      gap = (d: typeof doc, from: string, to: string) =>
        d.layout.nodes[to].x - d.layout.nodes[from].x,
      rows = (d: typeof doc) => d.layout.edges.m2.row! - d.layout.edges.m1.row!;
    expect(rows(doc)).toBeGreaterThan(rows(plain));
    expect(gap(doc, 'b', 'c')).toBeGreaterThan(gap(plain, 'b', 'c'));
    // In Before, the label's box ends above its own line.
    const [, row, y, h] =
      /data-id="m2"[\s\S]*?d="M[\d.-]+,([\d.-]+)L[\s\S]*?y="([\d.-]+)" width="[\d.-]+" height="([\d.-]+)" rx="4"/.exec(
        renderSvg(doc),
      )!;
    expect(Number(y) + Number(h)).toBeLessThanOrEqual(Number(row));
  });

  it('keeps a phase whose removed message sat inside it', () => {
    const before = SWAP([M2, 'edge m9 a -> b', M3].join('\n'), 'm2 m9 m3');
    const { merged, unshown } = compareDetailed(before, SWAP([M2, M3].join('\n')));
    expect(merged).toContain('-edge m9 a -> b\n');
    expect(unshown).toEqual(['phase p']);
  });

  it('draws a note on a moved message in the frame, on no row of either panel', () => {
    const file = (order: string) => SWAP(order, 'm2') + 'compare\nnote "Why" near=m2\n';
    const { merged, unshown } = compareDetailed(
      file([M2, M3].join('\n')),
      file([M3, M2].join('\n')),
    );
    expect(unshown).toEqual([]);
    const doc = projectScene(checkSource(merged));
    doc.appearance.compare!.undrawn = 'a (color)';
    const svg = renderSvg(doc),
      note = /class="diagram-note"><rect x="[^"]+" y="([^"]+)"/.exec(svg)!,
      label = />Before<\/text>/.exec(svg)!,
      labelY = Number(/y="([^"]+)"[^>]*$/.exec(svg.slice(0, label.index))![1]);
    expect(svg.split('class="diagram-note"')).toHaveLength(2);
    expect(Number(note[1])).toBeLessThan(labelY);
    expect(svg).toContain('Drawn as new: a (color)');
  });

  it('drops the note margins from panels, whose notes sit in the frame', () => {
    const file = (lines: string) => `diagram "Notes" version=1
layout root sequence
node a "A"
node b "B"
${lines}
~edge m1 a -> b "Now" was="Then"
phase p "Start" m1
note "Right side" near=m1
note "Left side" near=m1 side=left
`;
    const panel = (svg: string) =>
      /class="sequence-panel" x="([^"]+)" y="[^"]+" width="([^"]+)"/
        .exec(svg)!
        .slice(1)
        .map(Number);
    const compared = projectScene(checkSource(file('compare'))),
      seq = compared.layout.sequence!;
    expect(seq.panel.w).toBeGreaterThan(seq.inner!.w);
    expect(panel(renderSvg(compared))).toEqual([seq.inner!.x, seq.inner!.w]);
    const states = projectScene(checkSource(file('state s "One" a')));
    expect(panel(renderSvg(states, { states: true }))).toEqual([seq.inner!.x, seq.inner!.w]);
    // One drawing keeps its margins.
    expect(panel(renderSvg(states))).toEqual([seq.panel.x, seq.panel.w]);
  });

  it('keeps was-order through format, and refuses it where it means nothing', () => {
    const file = SWAP([M2, M3].join('\n')) + 'was-order m3 m2\n';
    expect(formatSource(file)).toBe(file);
    expect(() => compareSources(file, file)).toThrow(/already has change marks/);
    expect(() => checkSource('node a "A"\nwas-order m1\n')).toThrow(/use layout root sequence/);
    expect(() => checkSource(SWAP(M2, 'm2') + 'was-order m2 m2\n')).toThrow(
      /lists a message twice/,
    );
    expect(() =>
      checkSource('layout root sequence\nnode a "A"\n+edge m1 a -> a\nwas-order m1\n'),
    ).toThrow(/m1 is added/);
    expect(() => checkSource(SWAP(M2, 'm2') + 'was-order\n')).toThrow(/was-order lists the older/);
  });

  it('warns on a stale was-order, so a visual edit never breaks the file', () => {
    const scene = checkSource(SWAP([M2, M3].join('\n'), 'm2') + 'was-order m7 m2\n');
    expect(scene.diagnostics.filter(d => d.code === 'was-order').map(d => d.message)).toEqual([
      'was-order lists m7, which is not a message. The panels skip it.',
      'was-order leaves out m3, so the older panel keeps it on its new row.',
    ]);
    expect(scene.sequence!.before!.rows.m3).toBe(scene.edges.find(e => e.id === 'm3')!.row);
  });

  it('holds room for an old flow label bigger than its new one, and draws it in Before', () => {
    const old = 'Validate the password, the device and the session token against the old store',
      file = (extra: string, label: string) => `diagram "Flow change" version=1
${extra}
node a "Api"
node b "Orders"
node c "Billing"
~edge e1 a -> b${label} was="${old}"
edge e2 b -> c "bills"
layout root flow direction=right
`;
    const gap = (d: ReturnType<typeof projectScene>) =>
        d.layout.nodes.b.x - d.layout.nodes.a.x - d.layout.nodes.a.w,
      // Each panel's line and label box for e1: Before first.
      marks = (svg: string) =>
        [...svg.matchAll(/data-id="e1">([\s\S]*?)<\/g>/g)].map(([, g]) => {
          const [, from, to] = /d="M([\d.]+),[\d.]+L([\d.]+)/.exec(g)!,
            [, x, w] = /<rect x="([\d.]+)" y="-?[\d.]+" width="([\d.]+)"/.exec(g) ?? [],
            // A long label wraps into tspans; join its lines back into one string.
            text = /<text[^>]*>([\s\S]*?)<\/text>/
              .exec(g)?.[1]
              .split(/<[^>]+>/)
              .filter(Boolean)
              .join(' ');
          return { from: +from, to: +to, x: +x, w: +w, text };
        });
    for (const label of [' "new"', '']) {
      const doc = projectScene(checkSource(file('compare', label)));
      expect(gap(doc)).toBeGreaterThan(gap(projectScene(checkSource(file('', label)))));
      const [before, after] = marks(renderSvg(doc));
      expect(before.text).toBe(old);
      expect(before.x).toBeGreaterThanOrEqual(before.from);
      expect(before.x + before.w).toBeLessThanOrEqual(before.to);
      expect(after?.text).toBe(label ? 'new' : undefined);
    }
  });

  it('moves only the lines that end on a changed shape', () => {
    const paths = (d: string) => [...d.matchAll(/<g data-id="(e\d)"[^]*?<path d="([^"]+)"/g)];
    const svg = renderSvg(
      projectScene(
        checkSource(
          compareSources(
            'node a "A"\nnode b "B" shape=circle\nnode c "C"\nnode d "D"\nedge e1 a -> b\nedge e2 a -> c\nedge e3 c -> d\n',
            'compare\nnode a "A"\nnode b "B" shape=diamond\nnode c "C"\nnode d "D"\nedge e1 a -> b\nedge e2 a -> c\nedge e3 c -> d\n',
          ),
        ),
      ),
    );
    const [was, is] = svg.split('<g transform=').slice(1).map(paths);
    expect(was.map(m => m[2]).slice(1)).toEqual(is.map(m => m[2]).slice(1));
  });

  it('counts the same file with other comments and attribute order as unchanged', () => {
    const { merged, unshown } = compareDetailed(
      'layout root flow gap=48 direction=down\nnode a "A" shape=box\n',
      'layout root flow direction=down gap=48 # tidy\nnode a "A"\n',
    );
    expect(merged).not.toMatch(/^~/m);
    expect(unshown).toEqual([]);
  });

  it('refuses files that already carry marks', () => {
    expect(() => compareSources('+node a "A"\n', AFTER)).toThrow(/already has change marks/);
  });
});
