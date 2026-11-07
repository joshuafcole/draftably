import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { checkSource } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import { readSource, printSource } from '../src/dsl/syntax';
import { removeReferences } from '../src/dsl/source-edits';
import { renameId } from '../src/cli/edit';
import { styleOf } from '../src/model/graph';
import { withState } from '../src/model/status';

const SOURCE = fs.readFileSync(path.join(__dirname, '../examples/emphasis.draft'), 'utf8');
const doc = () => projectScene(checkSource(SOURCE));

describe('emphasis states', () => {
  it('focuses what a state lists, keeps their containers plain, and fades the rest', () => {
    const d = withState(doc(), 'read'),
      spot = (id: string) => styleOf(d, id).spot,
      edge = (id: string) => d.graph.edges.find(e => e.id === id)!.spot;
    expect([spot('catalog'), spot('cache'), spot('orders'), spot('services')]).toEqual([
      'focus',
      'focus',
      'dim',
      undefined,
    ]);
    // A connection between two focused nodes is in focus; one with an end outside fades.
    expect([edge('read'), edge('browse'), edge('place')]).toEqual(['focus', 'focus', 'dim']);
    // rest=plain leaves everything outside the state as it was, and rings what is in focus.
    const e = withState(doc(), 'events');
    expect([styleOf(e, 'queue').spot, styleOf(e, 'orders').spot]).toEqual(['ring', undefined]);
  });

  it('never moves anything', () => {
    const plain = renderSvg(doc())
        .match(/<rect class="shape"[^>]*>/g)!
        .map(r => r.replace(/fill="[^"]*"|stroke[^ ]*="[^"]*"/g, '')),
      read = renderSvg(withState(doc(), 'read'))
        .match(/<rect class="shape"[^>]*>/g)!
        .map(r => r.replace(/fill="[^"]*"|stroke[^ ]*="[^"]*"/g, ''));
    expect(read).toEqual(plain);
  });

  it('reports an unknown ID on its line, and a deleted object leaves the state', () => {
    expect(() => checkSource('node a "A"\nstate s "S" a ghost\n')).toThrow(/ghost in state s/);
    const src = readSource('node a "A"\nnode b "B"\nstate s "S" a b\nstate t "T" b\n');
    removeReferences(src, 'b');
    expect(printSource(src)).toBe('node a "A"\nnode b "B"\nstate s "S" a\n');
  });
});

describe('state panels', () => {
  it('draws each state once, labelled, from one set of routes', () => {
    const svg = renderSvg(doc(), { states: true });
    expect(svg.match(/data-state="/g)).toHaveLength(3);
    for (const label of ['Write path', 'Read path', 'Events'])
      expect(svg).toContain(`>${label}</text>`);
    const paths = (id: string) =>
      [...svg.matchAll(new RegExp(`data-id="${id}"[^>]*>\\s*<path d="([^"]+)"`, 'g'))].map(
        m => m[1],
      );
    expect(new Set(paths('persist')).size).toBe(1);
  });
});

describe('states hidden from the chips', () => {
  const HIDDEN = SOURCE + 'state step1 "Step 1" orders chips=hidden\n';

  it('parses chips=hidden, and old lines parse as before', () => {
    const states = projectScene(checkSource(HIDDEN)).appearance.states!;
    expect(states.map(s => [s.id, !!s.hidden])).toEqual([
      ['write', false],
      ['read', false],
      ['events', false],
      ['step1', true],
    ]);
    expect(() => checkSource('node a "A"\nstate s "S" a chips=off\n')).toThrow(
      /chips=shown\|hidden/,
    );
  });

  it('leaves a hidden state out of the panels, but draws it on its own', () => {
    const d = projectScene(checkSource(HIDDEN)),
      svg = renderSvg(d, { states: true });
    expect(svg.match(/data-state="/g)).toHaveLength(3);
    expect(svg).not.toContain('Step 1');
    expect(styleOf(withState(d, 'step1'), 'orders').spot).toBe('focus');
  });
});

describe('context around a state', () => {
  // A route a -> b -> c -> d, a side branch to e, and one step of the route in focus.
  const ROUTE = `node a "A"
node b "B"
node c "C"
node d "D"
node e "E"
edge ab a -> b
edge bc b -> c
edge cd c -> d
edge be b -> e
state step "Step" b context=a,c,d
`;
  const drawn = () => withState(projectScene(checkSource(ROUTE)), 'step'),
    spots = (d: ReturnType<typeof drawn>, ids: string[]) =>
      ids.map(id => styleOf(d, id).spot ?? d.graph.edges.find(e => e.id === id)?.spot ?? 'plain');

  it('draws the context plain between the focus and the faded rest', () => {
    const d = drawn();
    expect(spots(d, ['b', 'a', 'c', 'd', 'e'])).toEqual([
      'focus',
      'plain',
      'plain',
      'plain',
      'dim',
    ]);
    // A connection with both ends in focus or context is context; one leaving it fades.
    const edge = (id: string) => d.graph.edges.find(e => e.id === id)!.spot ?? 'plain';
    expect(['ab', 'bc', 'cd', 'be'].map(edge)).toEqual(['plain', 'plain', 'plain', 'dim']);
  });

  it('leaves a state without context as it was', () => {
    // Two containers that hold focus still draw plain, and a line between them still fades.
    const d = withState(
      projectScene(
        checkSource(
          'group g "G"\ngroup h "H"\nnode a "A" in=g\nnode b "B" in=h\nedge gh g -> h\nstate s "S" a b\n',
        ),
      ),
      's',
    );
    expect([styleOf(d, 'g').spot, d.graph.edges[0].spot]).toEqual([undefined, 'dim']);
  });

  it('checks, continues, prunes and renames context IDs like focus IDs', () => {
    expect(() => checkSource('node a "A"\nstate s "S" a context=ghost\n')).toThrow(
      /ghost in the context of state s/,
    );
    const two = projectScene(
      checkSource(
        'node a "A"\nnode b "B"\nnode c "C"\nstate s "S" a context=b\nstate s context=c\n',
      ),
    );
    expect(two.appearance.states![0].context).toEqual(['b', 'c']);
    const src = readSource(
      'node a "A"\nnode b "B"\nstate s "S" a context=a,b\nstate t context=b\n',
    );
    removeReferences(src, 'b');
    expect(printSource(src)).toBe('node a "A"\nnode b "B"\nstate s "S" a context=a\n');
    expect(renameId('node a "A"\nnode b "B"\nstate s "S" a context=a,b\n', 'b', 'bee')).toContain(
      'context=a,bee',
    );
  });
});
