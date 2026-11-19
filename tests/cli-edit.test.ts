import { describe, expect, it } from 'vitest';
import { removeIds, renameId, setFields } from '../src/cli/edit';

const source = [
  'diagram "Edits" version=1',
  '# Triggers',
  'group t1 "Trigger 1" color=teal',
  'node open "Open the record" in=t1 shape=pill',
  'node key "Cache key" in=t1',
  'node store "Store"',
  'edge a open -> key "reads"',
  'edge b key -> store',
  'near store key side=below',
  'state s1 "Read" open key store a',
  'layout root engine=layered direction=down',
  '',
].join('\n');

describe('set, rm and mv', () => {
  it('rm takes messages out of phases, by message or by participant', () => {
    const file = [
      'node a "A"',
      'node b "B"',
      'node c "C"',
      'edge m1 a -> b "1"',
      'edge m2 b -> c "2"',
      'edge m3 a -> c "3"',
      'phase p "P" m1 m2',
      'phase q "Q" m3',
      'layout root sequence',
    ].join('\n');
    expect(removeIds(file, ['m1'])).toContain('phase p "P" m2\n');
    const out = removeIds(file, ['b']);
    expect(out).not.toContain('phase p');
    expect(out).toContain('phase q "Q" m3');
  });

  it('sets a label with an apostrophe and attributes, and removes one with key=', () => {
    const out = setFields(source, 'node.open', [
      "label=Open the record's page",
      'color=amber',
      'shape=',
    ]);
    expect(out).toContain(`node open "Open the record's page" in=t1 color=amber`);
    expect(setFields(source, 'edge.a', ['label=loads'])).toContain('edge a open -> key "loads"');
    expect(out).toContain('# Triggers');
  });

  it('removes a node with its edges, refinements and state mentions', () => {
    const out = removeIds(source, ['key']);
    expect(out).not.toMatch(/(^| )key( |$)/m);
    expect(out).not.toMatch(/^edge/m);
    expect(out).toContain('state s1 "Read" open store\n');
  });

  it('removes a group and moves its members to its container', () => {
    const out = removeIds(source, ['t1']);
    expect(out).not.toContain('group t1');
    expect(out).toContain('node open "Open the record" shape=pill');
  });

  it('renames an id everywhere and refuses one in use', () => {
    const out = renameId(source, 'key', 'cache_key');
    expect(out).not.toMatch(/(^| )key( |$)/m);
    expect(out).toContain('edge a open -> cache_key "reads"');
    expect(out).toContain('near store cache_key side=below');
    expect(out).toContain('"Cache key"');
    expect(() => renameId(source, 'key', 'store')).toThrow('already used');
    expect(() => setFields(source, 'nope', ['color=red'])).toThrow(
      'No node, group, edge or action nope',
    );
  });
});
