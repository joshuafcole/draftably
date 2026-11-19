import { describe, expect, it } from 'vitest';
import { LayoutLab } from '../src/engines/layout-engine';
import { renderSvg } from '../src/cli/svg';
import { checkSource } from '../src/dsl/compile';
import { legendNotes } from '../src/dsl/legend-notes';
import { projectScene } from '../src/dsl/project';
import { DslError, formatSource, parseModel } from '../src/dsl/syntax';
import { normalize } from '../src/model/document';

const SOURCE = `diagram "Keyed" version=1
theme-color brand shade=500 fill="#405D48" stroke="#2F4535" ink="#FFFFFF"
node api "API" color=blue
node db "Postgres" color=brand
legend blue "Public entry points"
legend brand "Data stores"
legend red "Failure path" shade=600
`;

describe('legend', () => {
  it('warns when a swatch shade matches no node of its family', () => {
    const notes = legendNotes(
      parseModel(`diagram "K" version=1
node drop "Dropped" color=rose shade=200
node api "API" color=blue
legend rose "Dropped when nobody waits"
legend blue "Entry points"
legend violet "Unused family"
`),
    );
    expect(notes.map(n => [n.line, n.message])).toEqual([
      [4, 'legend rose is shade 500; rose nodes use 200. Add `shade=200`.'],
    ]);
  });

  it('warns on heading prose: a long subtitle and a note with no near=', () => {
    const notes = legendNotes(
      parseModel(`diagram "K" version=1
subtitle "${'word '.repeat(40)}"
note "Context the drawing should say"
note "Beside the API" near=api
node api "API"
`),
    );
    expect(notes.map(n => [n.code, n.line])).toEqual([
      ['heading-prose', undefined],
      ['heading-prose', 3],
    ]);
  });

  it('reads entries in file order, with optional shades', () => {
    expect(parseModel(SOURCE).appearance.legend).toEqual([
      { family: 'blue', label: 'Public entry points' },
      { family: 'brand', label: 'Data stores' },
      { family: 'red', label: 'Failure path', shade: 600 },
    ]);
  });

  it('reports bad entries on their line', () => {
    const line = (source: string) => {
      try {
        parseModel(source);
      } catch (error) {
        return (error as DslError).line;
      }
      return 0;
    };
    expect(line('node a "A"\nlegend teal-ish "x"\n')).toBe(2);
    expect(line('node a "A"\nlegend blue\n')).toBe(2);
    expect(line('legend blue "A"\nlegend blue "B"\n')).toBe(2);
    expect(line('node a "A"\nlegend auto "x"\n')).toBe(2);
  });

  it('keeps line entries through normalize and an editor relayout', async () => {
    const doc = projectScene(
      checkSource(`diagram "K" version=1
node a "A"
node b "B"
edge e1 a -> b kind=async
legend line dashed "Today's signal"
`),
    );
    const line = { line: 'dashed', label: "Today's signal" };
    expect(normalize(JSON.parse(JSON.stringify(doc))).appearance.legend).toEqual([line]);
    // The editor normalizes each engine result; this threw before line entries were accepted.
    const { document: after } = await LayoutLab.compute(doc, { mode: 'rebuild' });
    expect(normalize(after).appearance.legend).toEqual([line]);
  });

  it('survives projection, JSON and formatting, and draws under the SVG', () => {
    const doc = projectScene(checkSource(SOURCE));
    expect(normalize(JSON.parse(JSON.stringify(doc))).appearance.legend).toHaveLength(3);
    expect(formatSource(SOURCE)).toContain('legend red "Failure path" shade=600');
    const svg = renderSvg(doc);
    expect(svg).toContain('Public entry points');
    expect(svg).toContain('Failure path');
  });

  it('never moves anything', () => {
    const plain = SOURCE.split('\n')
      .filter(l => !l.startsWith('legend'))
      .join('\n');
    const at = (s: string) => checkSource(s).objects.map(o => [o.id, o.x, o.y]);
    expect(at(SOURCE)).toEqual(at(plain));
  });
});
