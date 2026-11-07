import { describe, expect, it } from 'vitest';
import { readSource, sourceOperations } from '../src/lib';

const ops = (before: string, after: string) =>
  sourceOperations(readSource(before), readSource(after));

describe('the statements an edit changed', () => {
  it('names each statement by what it is about, with its words by name', () => {
    const before = `node a "Alpha"\nnode b "Beta"\nnear b a side=right gap=40\n`;
    const after = `node a "Alpha prime" in=g\nnode b "Beta"\nedge go a -> b "go" kind=async\nstay b x=10 y=-4\norder g a b\n# a comment\n`;
    expect(ops(before, after)).toEqual([
      {
        kind: 'remove',
        statement: 'near',
        id: 'b',
        fields: { ref: 'a', side: 'right', gap: '40' },
      },
      {
        kind: 'set',
        statement: 'node',
        id: 'a',
        fields: { label: 'Alpha prime', in: 'g' },
        was: { label: 'Alpha' },
      },
      {
        kind: 'add',
        statement: 'edge',
        id: 'go',
        fields: { from: 'a', to: 'b', label: 'go', kind: 'async' },
      },
      { kind: 'add', statement: 'stay', id: 'b', fields: { x: '10', y: '-4' } },
      { kind: 'add', statement: 'order', id: 'g', fields: { members: 'a,b' } },
    ]);
  });

  it('reports nothing for a comment, a blank line or reformatting', () => {
    expect(ops(`node a "A"\n`, `# about a\n\nnode   a   "A"  # inline\n`)).toEqual([]);
  });

  it('keys statements about the whole diagram by command, and align lines by their ids', () => {
    expect(
      ops(`theme paper\nalign x a b\n`, `theme ink\nalign x a b strength=required\nalign y a c\n`),
    ).toEqual([
      { kind: 'set', statement: 'theme', id: '', fields: { arg1: 'ink' }, was: { arg1: 'paper' } },
      {
        kind: 'set',
        statement: 'align',
        id: 'a,b',
        fields: { axis: 'x', members: 'a,b', strength: 'required' },
        was: { axis: 'x', members: 'a,b' },
      },
      { kind: 'add', statement: 'align', id: 'a,c', fields: { axis: 'y', members: 'a,c' } },
    ]);
  });
});
