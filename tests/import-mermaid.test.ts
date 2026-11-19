import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { compile } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import { createMermaidFlowParser, makePlainLabel } from '../src/import/mermaid-facade';
import { importMermaidFlow } from '../src/import/mermaid-importer';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
const parse = createMermaidFlowParser(async () => (await import('mermaid')).default);
beforeAll(() => {
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('Option', dom.window.Option);
});
afterAll(() => {
  vi.unstubAllGlobals();
  dom.window.close();
});

describe('Mermaid flowchart import', () => {
  it('maps circle, cross and two-ended links to native ends', async () => {
    const parsed = await parse(`flowchart LR
A --o B
A --x C
A <--> D
A o--o E
A x--x F`);
    const imported = importMermaidFlow(parsed, makePlainLabel(dom.window.document));
    expect(imported.status).not.toBe('failed');
    const edges = imported.nativeSource!.split('\n').filter(l => l.startsWith('edge '));
    expect(edges.map(l => l.split('"" ')[1])).toEqual([
      'head=circle',
      'head=cross',
      'tail=arrow',
      'head=circle tail=circle',
      'head=cross tail=cross',
    ]);
    await compile(imported.nativeSource!);
  });

  it('preserves groups, edge occurrences, labels and arrowless links in native source', async () => {
    const parsed = await parse(`flowchart LR
subgraph system[System]
  A[API] -->|read| B[Database]
  A -->|write| B
end
X --- A`);
    expect(parsed.ok).toBe(true);
    const imported = importMermaidFlow(parsed, makePlainLabel(dom.window.document));
    expect(imported.status).toBe('needs-review');
    const graph = projectScene(await compile(imported.nativeSource!)).graph;
    expect(graph.groups.map(g => g.id)).toEqual(['system']);
    expect(graph.nodes.find(n => n.id === 'A')?.parentId).toBe('system');
    expect(graph.edges.map(e => [e.from, e.to, e.label, e.directed])).toEqual([
      ['A', 'B', 'read', true],
      ['A', 'B', 'write', true],
      ['X', 'A', '', false],
    ]);
  });

  it('rejects malformed input, non-flowchart families and configuration directives', async () => {
    for (const [source, code] of [
      ['flowchart LR\nA[Missing', 'MERMAID_PARSE_ERROR'],
      ['classDiagram\nA <|-- B', 'MERMAID_FAMILY_UNSUPPORTED'],
      [
        '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B',
        'MERMAID_CONFIGURATION_UNSUPPORTED',
      ],
    ]) {
      const parsed = await parse(source);
      expect(parsed.ok).toBe(false);
      expect(parsed.diagnostics.some(d => d.code === code)).toBe(true);
      expect(
        importMermaidFlow(parsed, makePlainLabel(dom.window.document)).nativeSource,
      ).toBeUndefined();
    }
  });
});

describe('Mermaid sequence import', () => {
  const run = async (body: string) =>
    importMermaidFlow(
      await parse('sequenceDiagram\n' + body),
      makePlainLabel(dom.window.document),
      'Seq',
    );
  const lines = (source: string, word: string) =>
    source.split('\n').filter(l => l.startsWith(word + ' '));

  it('maps participants, boxes and each message line', async () => {
    const r = await run(`box Client
participant a as App
end
participant b
a->>b: call
b-->>a: reply
a->b: plain
a-xb: lost
a--xb: late
a<<->>b: both`);
    // The dotted cross loses its cross, so the import asks for a review.
    expect(r.status).toBe('needs-review');
    expect(lines(r.nativeSource!, 'group')).toEqual(['group box_1 "Client"']);
    expect(lines(r.nativeSource!, 'node')).toEqual(['node a "App" in=box_1', 'node b "b"']);
    expect(lines(r.nativeSource!, 'layout')).toEqual(['layout root sequence']);
    expect(lines(r.nativeSource!, 'edge')).toEqual([
      'edge m1 a -> b "call" message=call',
      'edge m2 b -> a "reply" answers=m1',
      'edge m3 a -> b "plain" head=none',
      'edge m4 a -> b "lost" head=cross',
      // A dotted line with another end is a reply with the plain arrowhead. It runs the same
      // way as the call, so it answers nothing.
      'edge m5 a -> b "late" message=reply',
      'edge m6 a -> b "both" tail=arrow',
    ]);
    expect(r.nativeSource).not.toContain('kind=async');
    expect(r.diagnostics.map(d => d.code)).toEqual(['MERMAID_SEQUENCE_DOTTED_END']);
    await compile(r.nativeSource!);
  });

  it('turns each top-level branch into a band and warns', async () => {
    const r = await run(`a->>b: first
alt ok
  b-->>a: yes
  loop retry
    a->>b: again
  end
else failed
  b-->>a: no
end
opt
end
a->>b: last`);
    expect(lines(r.nativeSource!, 'phase')).toEqual([
      'phase phase_1 "alt: ok" m2 m3',
      'phase phase_2 "else: failed" m4',
    ]);
    expect(r.status).toBe('needs-review');
    expect(r.diagnostics.map(d => d.code)).toEqual([
      'MERMAID_SEQUENCE_BLOCK',
      'MERMAID_SEQUENCE_NESTED_BLOCK',
    ]);
    await compile(r.nativeSource!);
  });

  it('anchors a note to the message it follows, or else to its participant', async () => {
    const r = await run(`participant a
participant b
participant c
Note left of a: before
a->>b: go
Note over a,b: on the message
Note right of c: elsewhere`);
    expect(lines(r.nativeSource!, 'note')).toEqual([
      'note "before" near=a side=left',
      'note "on the message" near=m1 side=right',
      'note "elsewhere" near=c side=right',
    ]);
    await compile(r.nativeSource!);
  });

  it('answers the nearest call with no answer yet, and each call once', async () => {
    const r = await run(`a->>b: outer
b->>c: inner
c-->>b: inner done
a-)b: fire
b-->>a: outer done
b-->>a: extra
c-->>c: to itself`);
    expect(lines(r.nativeSource!, 'edge')).toEqual([
      'edge m1 a -> b "outer" message=call',
      'edge m2 b -> c "inner" message=call',
      'edge m3 c -> b "inner done" answers=m2',
      'edge m4 a -> b "fire" message=send',
      // The nearest message from a to b with no answer is the send, then the call.
      'edge m5 b -> a "outer done" answers=m4',
      'edge m6 b -> a "extra" answers=m1',
      'edge m7 c -> c "to itself" message=reply',
    ]);
    await compile(r.nativeSource!);
  });

  it('keeps bars off, with both counts, when they are not from a call to its reply', async () => {
    const r = await run(`a->>b: go
activate a
b-->>a: back
deactivate a`);
    expect(lines(r.nativeSource!, 'layout')).toEqual(['layout root sequence']);
    const warning = r.diagnostics.find(d => d.code === 'MERMAID_SEQUENCE_ACTIVATION')!;
    expect(warning.message).toContain('gives 1 bar where the source draws 1');
    // Nested activations that match turn the bars on.
    const nested = await run(`a->>+b: one
b->>+c: two
c-->>-b: two done
b-->>-a: one done`);
    expect(lines(nested.nativeSource!, 'layout')).toEqual(['layout root sequence activations=on']);
    expect(nested.diagnostics).toEqual([]);
  });

  it('reports what has no native form and refuses half arrows', async () => {
    const r = await run(`autonumber
actor a
a->>+b: go
b-->>-a: back
a-)b: send`);
    // The bar runs from the call to its reply, so the native bars are the source's.
    expect(r.diagnostics.map(d => d.code).sort()).toEqual([
      'MERMAID_SEQUENCE_ACTOR_TYPE',
      'MERMAID_SEQUENCE_AUTONUMBER',
    ]);
    expect(lines(r.nativeSource!, 'layout')).toEqual(['layout root sequence activations=on']);
    expect(lines(r.nativeSource!, 'edge')).toEqual([
      'edge m1 a -> b "go" message=call',
      'edge m2 b -> a "back" answers=m1',
      'edge m3 a -> b "send" message=send',
    ]);
    await compile(r.nativeSource!);
    expect((await run('a-|\\b: half')).status).toBe('failed');
  });
});
