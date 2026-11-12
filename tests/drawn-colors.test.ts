import { describe, expect, it } from 'vitest';
import { checkSource } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import { resolveAppearance } from '../src/model/appearance';
import { drawnShade } from '../src/model/colors';

const drawn = (source: string) => {
  const doc = projectScene(checkSource(source)),
    look = resolveAppearance(doc.appearance);
  return (id: string) => drawnShade(doc, look, id);
};

describe('drawn colors', () => {
  it('steps nested containers of one family instead of repeating the fill', () => {
    const shade = drawn(`diagram "Nest" version=1
group outer "Outer" color=red
group middle "Middle" in=outer
group inner "Inner" in=middle color=red
node a "A" in=inner
`);
    expect([shade('outer'), shade('middle'), shade('inner')]).toEqual([100, 200, 300]);
    // A member with no shade of its own is a pale card on its frame's tint.
    expect(shade('a')).toBe(50);
  });

  it('draws members as pale cards and keeps 500 for a node that names a color', () => {
    const source = (theme: string) => `diagram "Cards" version=1
theme ${theme}
group g "G" color=teal
node member "Member" in=g
group plan "Plan" color=slate
node pick "Pick" in=plan color=violet
node loose "Loose" color=teal
legend teal "Teal"
legend violet "Violet"
`;
    const shade = drawn(source('drafting'));
    expect([shade('member'), shade('pick'), shade('loose')]).toEqual([50, 500, 500]);
    // A node of the family names it, so its legend swatch keeps the colored node's shade.
    expect(checkSource(source('drafting')).model.appearance.legend?.map(e => e.shade)).toEqual([
      500, 500,
    ]);
    const dark = drawn(source('blueprint'));
    expect([dark('g'), dark('member')]).toEqual([900, 950]);
  });

  it('keys a family that only members draw at the card shade', () => {
    const scene = checkSource(`diagram "Key" version=1
group g "G" color=teal
node a "A" in=g
legend teal "Teal"
legend teal "Strong" shade=500
`);
    expect(scene.model.appearance.legend?.map(e => e.shade)).toEqual([50, 500]);
    expect(scene.diagnostics.filter(d => d.code === 'legend-shade')).toEqual([]);
  });

  it('moves a pale member clear of a container in its own family', () => {
    const shade = drawn(`diagram "Verify" version=1
group verify "Verify" color=rose
node check "Check" in=verify shade=100
node far "Far" in=verify shade=200
node other "Other" in=verify color=blue shade=100
`);
    expect(shade('check')).toBe(400);
    expect(shade('far')).toBe(400);
    expect(shade('other')).toBe(100);
  });

  it('steps toward lighter shades in a dark theme', () => {
    const shade = drawn(`diagram "Dark" version=1
theme blueprint
group outer "Outer" color=teal
group inner "Inner" in=outer
`);
    expect([shade('outer'), shade('inner')]).toEqual([900, 800]);
  });

  it('keeps an explicit shade that already stands apart', () => {
    const shade = drawn(`diagram "Apart" version=1
group g "G" color=amber
node a "A" in=g shade=700
group h "H" in=g shade=50
`);
    expect(shade('a')).toBe(700);
    // One step paler than its frame reads as the same fill, so it steps past the frame instead.
    expect(shade('h')).toBe(200);
  });
});
