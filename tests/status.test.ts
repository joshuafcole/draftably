import { describe, expect, it } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { checkSource } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import { formatSource, parseModel } from '../src/dsl/syntax';
import { normalize } from '../src/model/document';
import { statusLabel, usedStatuses } from '../src/model/status';

const SOURCE = `node api "API"
~node orders "Orders service" was="Orders"
+node refunds "Refunds"
-node hook "Webhook"
.node audit "Audit"
+edge refund orders -> refunds
-edge notify api -> hook
`;

describe('change marks', () => {
  it('reads +, -, ~ and . as statuses, and keeps them through formatting and JSON', () => {
    const m = parseModel(SOURCE);
    expect(m.objects.map(o => o.status)).toEqual([
      undefined,
      'changed',
      'added',
      'removed',
      'context',
    ]);
    expect(m.objects[1].was).toBe('Orders');
    expect(formatSource(SOURCE)).toBe(SOURCE);
    const doc = normalize(JSON.parse(JSON.stringify(projectScene(checkSource(SOURCE)))));
    // Shapes and lines count apart, so an added box and its line don't read as two boxes.
    expect(usedStatuses(doc).map(statusLabel)).toEqual([
      '1 added · 1 line',
      '1 changed',
      '1 removed · 1 line',
      '1 shown for context',
    ]);
    const svg = renderSvg(doc);
    expect(svg).toContain('1 shown for context');
    // A removed title stays readable unless the file asks for a strike.
    expect(svg).not.toContain('line-through');
    const struck = `${SOURCE}config strike-removed=on\n`;
    const strikeDoc = normalize(JSON.parse(JSON.stringify(projectScene(checkSource(struck)))));
    expect(renderSvg(strikeDoc)).toContain('line-through');
  });

  it('rejects marks and was= where they mean nothing', () => {
    expect(() => parseModel('+layout root flow\n')).toThrow(/Only node, group, edge and range/);
    expect(() => parseModel('node a "A" was="B"\n')).toThrow(/changed/);
  });

  it('never moves anything', () => {
    const plain = SOURCE.replace(/^[+~.-]/gm, '').replace(/ was="Orders"/, '');
    const at = (s: string) => checkSource(s).objects.map(o => [o.id, o.x, o.y]);
    expect(at(SOURCE)).toEqual(at(plain));
  });
});

describe('compare panels', () => {
  it('draws each version once, at the same positions, with old labels on the left', () => {
    const svg = renderSvg(projectScene(checkSource('compare "main" "PR 9"\n' + SOURCE)));
    expect(svg).toContain('>main</text>');
    expect(svg).toContain('>PR 9</text>');
    // Refunds is only new, the webhook only old; both versions show the unchanged API.
    expect(svg.match(/>Refunds</g)).toHaveLength(1);
    expect(svg.match(/>Webhook</g)).toHaveLength(1);
    expect(svg.match(/>API</g)).toHaveLength(2);
    expect(svg).toContain('>Orders</tspan>');
    expect(svg).toContain('>Orders service</tspan>');
  });
});

describe('panel fit', () => {
  it('shrinks a container that lost members, without moving anything', async () => {
    const { panelDoc } = await import('../src/model/panels');
    const doc = projectScene(
      checkSource(
        'group g "Group"\nnode a "A" in=g\nnode b "B" in=g\n+node c "C" in=g\nedge e a -> b\nedge f b -> c\nlayout g column\n',
      ),
    );
    const before = panelDoc(doc, 'before'),
      after = panelDoc(doc, 'after');
    expect(before.layout.nodes.g.h).toBeLessThan(doc.layout.nodes.g.h);
    expect(after.layout.nodes.g).toEqual(doc.layout.nodes.g);
    for (const id of ['a', 'b']) expect(before.layout.nodes[id]).toEqual(doc.layout.nodes[id]);
  });
});

describe('links and counts', () => {
  it('links objects with href and draws count as a stack with a badge', () => {
    const doc = projectScene(
      checkSource(
        'node a "A" href="src/a.ts"\nnode many "Consumers" count=1200\nedge e many -> a\n',
      ),
    );
    expect(normalize(JSON.parse(JSON.stringify(doc))).graph.nodes[1].count).toBe(1200);
    const svg = renderSvg(doc);
    expect(svg).toContain('<a class="link" href="src/a.ts">');
    expect(svg).not.toContain('<title>A');
    expect(svg).toContain('class="link-mark"');
    expect(svg).toContain('×1.2k');
    expect(() => parseModel('group g "G" count=3\n')).toThrow(/Unknown group attribute: count/);
  });
});

describe('panel direction', () => {
  const size = (source: string) => {
    const svg = renderSvg(projectScene(checkSource(source)));
    const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg)!.map(Number);
    return { w, h };
  };
  const flow =
    'node a "A"\nnode b "B"\nnode c "C"\n+node d "D"\nedge x a -> b\nedge y b -> c\n+edge z c -> d\n';

  it('follows direction=, and otherwise picks the arrangement nearest the aspect', () => {
    const right = size(`compare direction=right\n${flow}layout root flow direction=right\n`),
      down = size(`compare direction=down\n${flow}layout root flow direction=right\n`),
      auto = size(`compare\n${flow}layout root flow direction=right\n`);
    expect(right.w / right.h).toBeGreaterThan(down.w / down.h);
    expect(auto).toEqual(down);
    const tall = size(`compare aspect=8\n${flow}layout root flow direction=right\n`);
    expect(tall).toEqual(right);
  });
});
