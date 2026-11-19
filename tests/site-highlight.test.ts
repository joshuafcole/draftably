import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COMMANDS, tokenizeLine, tokenizeSource } from '../site/highlight';

describe('site highlighter', () => {
  it('knows every command the parser accepts', () => {
    const parser = fs.readFileSync(new URL('../src/dsl/syntax.ts', import.meta.url), 'utf8');
    const cases = [...parser.matchAll(/case '([a-z-]+)':/g)].map(m => m[1]);
    expect(cases.filter(c => !COMMANDS.includes(c))).toEqual([]);
  });

  it('gives back the line it was given', () => {
    const line =
      '+edge charge orders -> payments "authorize, then \\"capture\\"" kind=async # note';
    expect(
      tokenizeLine(line)
        .map(t => t.text)
        .join(''),
    ).toBe(line);
    expect(tokenizeLine(line).map(t => t.kind)).toEqual([
      'mark',
      'command',
      'space',
      'id',
      'space',
      'id',
      'space',
      'arrow',
      'space',
      'id',
      'space',
      'string',
      'space',
      'attr',
      'attr',
      'value',
      'space',
      'comment',
    ]);
  });

  it('reads a code node body as text, not statements', () => {
    const lines = [
      'node q "q" shape=code <<SQL',
      '  node x # not a statement',
      '',
      'SQL',
      'node y',
    ];
    expect(tokenizeSource(lines).map(l => l.map(t => t.kind).join(' '))).toEqual([
      'command space id space string space attr attr value space id',
      'body',
      '',
      'body',
      'command space id',
    ]);
  });
});
