/**
 * Graphs for the graph API harness: shapes other tools hand a layout engine. Each entry is
 * `{ name, input }`, where `input` is what `layout()` takes, keyed or not.
 */

/** A small seeded random source, so every run builds the same graphs. */
function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const range = n => Array.from({ length: n }, (_, i) => i);
const node = i => ({ id: `n${i}`, label: `Node ${i}` });

function chain(n) {
  return {
    nodes: range(n).map(node),
    edges: range(n - 1).map(i => ({ source: `n${i}`, target: `n${i + 1}` })),
  };
}

function tree(n, k = 2) {
  return {
    nodes: range(n).map(node),
    edges: range(n - 1).map(i => ({ source: `n${Math.floor(i / k)}`, target: `n${i + 1}` })),
  };
}

/** Ranks of nodes, each edge from one rank to a later one: a typical pipeline or build graph. */
function dag(n, extra, seed) {
  const rand = random(seed),
    width = Math.max(2, Math.round(Math.sqrt(n))),
    rank = i => Math.floor(i / width),
    edges = [];
  for (let i = width; i < n; i++) {
    const below = range(i).filter(j => rank(j) === rank(i) - 1);
    edges.push({ source: `n${below[Math.floor(rand() * below.length)]}`, target: `n${i}` });
  }
  for (let k = 0; k < extra; k++) {
    const a = Math.floor(rand() * (n - width)),
      later = range(n).filter(j => rank(j) > rank(a));
    const b = later[Math.floor(rand() * later.length)];
    if (!edges.some(e => e.source === `n${a}` && e.target === `n${b}`))
      edges.push({ source: `n${a}`, target: `n${b}` });
  }
  return { nodes: range(n).map(node), edges };
}

/** Services in groups, with calls inside and across groups: an architecture diagram. */
function architecture(groups, per, seed) {
  const rand = random(seed),
    nodes = [],
    edges = [];
  for (let g = 0; g < groups; g++)
    for (let i = 0; i < per; i++) {
      const id = `s${g}_${i}`;
      nodes.push({ id, label: `Service ${g}.${i}`, parent: `g${g}` });
      if (i) edges.push({ source: `s${g}_${i - 1}`, target: id });
    }
  for (let g = 1; g < groups; g++)
    edges.push({
      source: `s${g - 1}_${Math.floor(rand() * per)}`,
      target: `s${g}_${Math.floor(rand() * per)}`,
      label: 'calls',
    });
  return {
    groups: range(groups).map(g => ({ id: `g${g}`, label: `Domain ${g}` })),
    nodes,
    edges,
  };
}

export const corpus = [
  { name: 'empty', input: { nodes: [] } },
  { name: 'one node', input: { nodes: [{ id: 'a' }] } },
  { name: 'two nodes, no edges', input: { nodes: [{ id: 'a' }, { id: 'b' }] } },
  { name: 'self loop', input: { nodes: [{ id: 'a' }], edges: [{ source: 'a', target: 'a' }] } },
  {
    name: 'parallel edges',
    input: {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { source: 'a', target: 'b', label: 'one' },
        { source: 'a', target: 'b', label: 'two' },
        { source: 'b', target: 'a', label: 'back' },
      ],
    },
  },
  {
    name: 'awkward ids and labels',
    input: {
      nodes: [
        { id: '1', label: 'Ünïcödé — "quoted" \\ back' },
        { id: 'a b', label: '' },
        { id: 'x.y-z', label: 'A label long enough that it has to wrap across more than one line' },
        { id: '__proto__', label: 'proto' },
      ],
      edges: [
        { source: '1', target: 'a b', label: 'emoji 🚀' },
        { source: 'a b', target: 'x.y-z' },
        { source: 'x.y-z', target: '__proto__' },
      ],
    },
  },
  {
    name: 'edge to a group',
    input: {
      groups: [{ id: 'g', label: 'Group' }],
      nodes: [{ id: 'a' }, { id: 'b', parent: 'g' }, { id: 'c', parent: 'g' }],
      edges: [
        { source: 'a', target: 'g' },
        { source: 'b', target: 'c' },
      ],
    },
  },
  {
    name: 'nested groups',
    input: {
      groups: [
        { id: 'outer', label: 'Outer' },
        { id: 'mid', label: 'Middle', parent: 'outer' },
        { id: 'inner', label: 'Inner', parent: 'mid' },
      ],
      nodes: [
        { id: 'a' },
        { id: 'b', parent: 'outer' },
        { id: 'c', parent: 'mid' },
        { id: 'd', parent: 'inner' },
        { id: 'e', parent: 'inner' },
      ],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'c', target: 'd' },
        { source: 'd', target: 'e' },
        { source: 'e', target: 'a' },
      ],
    },
  },
  {
    name: 'fan out 16',
    input: {
      nodes: [{ id: 'hub' }, ...range(16).map(node)],
      edges: range(16).map(i => ({ source: 'hub', target: `n${i}` })),
    },
  },
  {
    name: 'cycle of 12',
    input: {
      nodes: range(12).map(node),
      edges: range(12).map(i => ({ source: `n${i}`, target: `n${(i + 1) % 12}` })),
    },
  },
  {
    name: 'components',
    input: {
      nodes: range(14).map(node),
      edges: [
        { source: 'n0', target: 'n1' },
        { source: 'n1', target: 'n2' },
        { source: 'n3', target: 'n4' },
        { source: 'n5', target: 'n6' },
        { source: 'n5', target: 'n7' },
      ],
    },
  },
  {
    name: 'fixed sizes',
    input: {
      nodes: range(8).map(i => ({
        id: `n${i}`,
        label: `N${i}`,
        width: 60 + i * 30,
        height: 30 + i * 10,
      })),
      edges: range(7).map(i => ({ source: `n${i}`, target: `n${i + 1}` })),
    },
  },
  {
    name: 'down with sides',
    input: {
      direction: 'down',
      groups: [{ id: 'g', label: 'Backend' }],
      nodes: [{ id: 'a' }, { id: 'b', parent: 'g' }, { id: 'c', parent: 'g' }],
      edges: [
        { source: 'a', target: 'b', sourceSide: 'bottom' },
        { source: 'b', target: 'c' },
      ],
    },
  },
  {
    name: 'shapes and dashes',
    input: {
      nodes: [
        { id: 'start', shape: 'pill' },
        { id: 'check', shape: 'diamond', label: 'OK?' },
        { id: 'done', shape: 'circle' },
        { id: 'retry', shape: 'box' },
        { id: 'note', shape: 'text', label: 'A note' },
      ],
      edges: [
        { source: 'start', target: 'check' },
        { source: 'check', target: 'done', label: 'yes' },
        { source: 'check', target: 'retry', label: 'no', dashed: true },
        { source: 'retry', target: 'check' },
      ],
    },
  },
  { name: 'chain 20', input: chain(20) },
  { name: 'chain 100', input: chain(100) },
  { name: 'tree 15', input: tree(15) },
  { name: 'tree 31', input: tree(31) },
  { name: 'tree 63', input: tree(63) },
  { name: 'tree 40 by 3', input: tree(40, 3) },
  { name: 'dag 30', input: dag(30, 10, 1) },
  { name: 'dag 60', input: dag(60, 25, 2) },
  { name: 'dag 100', input: dag(100, 40, 3) },
  { name: 'architecture 4x5', input: architecture(4, 5, 4) },
  { name: 'architecture 6x8', input: architecture(6, 8, 5) },
  { name: 'engine stress 30', input: { ...dag(30, 15, 6), arrange: 'engine:stress' } },
];
