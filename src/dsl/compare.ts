/**
 * Merge two versions of a diagram into one file with change marks (`+`, `-`, `~`), matching
 * nodes, groups and edges by ID. The result is the newer file, statement for statement, with
 * removed declarations put back where they stood in the older one, so a reader sees one drawing
 * that holds both versions instead of two near-identical files.
 */
import {
  bare,
  DslError,
  parseModel,
  printSource,
  quoted,
  readSource,
  type Hint,
  type Model,
  type ModelEdge,
  type ModelObject,
  type SourceLine,
  type Statement,
  type Word,
} from './syntax';

const DECLARATIONS = ['node', 'group', 'edge'];

/** What makes a declaration `~`: every parsed field but its line, so new fields count by default. */
const meaning = ({ line: _, ...fields }: ModelObject | ModelEdge) => JSON.stringify(fields);

/** A statement's content, whatever its comment or the order of its attributes. */
const content = (s: Statement) =>
  JSON.stringify([
    s.command,
    s.args.map(w => w.value),
    s.attrs.map(([k, w]) => [k, w.value]).sort(),
  ]);

/** The statements that marks can't carry, each by its content, with a name to report it by. */
const undeclared = (lines: SourceLine[]) =>
  new Map(
    lines.flatMap(l =>
      l.kind === 'statement' && !DECLARATIONS.includes(l.command)
        ? [
            [
              content(l),
              l.args[0]?.quoted === false ? `${l.command} ${l.args[0].value}` : l.command,
            ],
          ]
        : [],
    ),
  );

/** The attributes of one declaration that differ between versions; `in` is reported as a move. */
const attrChanges = (old: Statement, now: Statement) => {
  const value = (s: Statement, name: string) => s.attrs.find(([k]) => k === name)?.[1].value;
  return [...new Set([...old.attrs, ...now.attrs].map(([k]) => k))].filter(
    k => k !== 'in' && value(old, k) !== value(now, k),
  );
};

/**
 * A changed node's old shape and count as `was-` words, and the attributes those draw. A marker's
 * box is a thin cut between cells, so a change to or from one keeps its report instead.
 */
const pastNode = (old: ModelObject, now: ModelObject) => {
  const boxed = old.shape !== 'marker' && now.shape !== 'marker',
    words: [string, Word][] = [];
  if (boxed && old.shape !== now.shape) words.push(['was-shape', bare(old.shape)]);
  if ((old.count ?? 1) !== (now.count ?? 1)) words.push(['was-count', bare(old.count ?? 1)]);
  return { words, drawn: boxed ? ['shape', 'count'] : ['count'] };
};

/** Where an object sits in one version, from its `pin` (or else `stay`) line, and how big it is. */
const placeOf = (m: Model, id: string) => {
  const hint = <T extends Hint['type']>(type: T) =>
      m.hints.find(
        (h): h is Extract<Hint, { type: T }> => h.type === type && 'id' in h && h.id === id,
      ),
    at = hint('pin') ?? hint('stay'),
    size = hint('size');
  return {
    at,
    // `height=auto` is the title's height, which only a layout knows.
    size: size?.height !== undefined ? { w: size.width, h: size.height } : undefined,
  };
};

/**
 * A changed object's old corner and size as `was-at` and `was-size` words, where the older file
 * gives them and the newer one moved or resized it, and the lines those words carry, which then
 * need no other report. A newer file that drops the line draws a laid-out box; a Before panel
 * compares the old numbers with that box.
 */
const pastPlace = (old: Model, now: Model, id: string, node: boolean) => {
  const [was, is] = [placeOf(old, id), placeOf(now, id)],
    words: [string, Word][] = [],
    carried: string[] = [];
  if (was.at && (!is.at || was.at.x !== is.at.x || was.at.y !== is.at.y)) {
    words.push(['was-at', bare(`${was.at.x},${was.at.y}`)]);
    carried.push(`${was.at.type} ${id}`, ...(is.at ? [`${is.at.type} ${id}`] : []));
  }
  if (node && was.size && (!is.size || was.size.w !== is.size.w || was.size.h !== is.size.h)) {
    words.push(['was-size', bare(`${was.size.w},${was.size.h}`)]);
    carried.push(`size ${id}`);
  }
  return { words, carried };
};

/** Whether what both lists hold comes in the same order in each. */
const sameOrder = (a: { id: string }[], b: { id: string }[]) => {
  const shared = (x: { id: string }[], y: { id: string }[]) =>
    x.filter(o => y.some(p => p.id === o.id)).map(o => o.id);
  return shared(a, b).join('\0') === shared(b, a).join('\0');
};

const nodesOf = (m: Model) => m.objects.filter(o => o.type === 'node');

const isSequence = (m: Model) =>
  m.layouts.some(l => l.scope === 'root' && l.algorithm === 'sequence');

const keyOf = (s: Statement) => (s.command === 'edge' ? 'edge:' : 'object:') + s.args[0]?.value;

/**
 * Merge two plain versions into one marked file. `moved` lists groups that changed container:
 * they keep one position, so the older panel draws them in their new container. `unshown` lists
 * the other changes with no old version in the file, which both panels draw as they are now.
 * `reordered` says a sequence's messages changed order, which `was-order` records.
 */
export function compareSources(before: string, after: string): string {
  return compareDetailed(before, after).merged;
}

export function compareDetailed(before: string, after: string) {
  const docs = [readSource(before), readSource(after)];
  for (const doc of docs)
    for (const s of doc.lines)
      if (s.kind === 'statement' && (s.mark || s.command === 'was-order'))
        throw new DslError('Compare plain files; this one already has change marks.', s.line);
  const [old, next] = [parseModel(docs[0]), parseModel(docs[1])];
  const [was, now] = [old, next].map(
    m =>
      new Map<string, ModelObject | ModelEdge>([
        ...m.objects.map(o => ['object:' + o.id, o] as const),
        ...m.edges.map(e => ['edge:' + e.id, e] as const),
      ]),
  );
  const scopes = new Set(next.layouts.map(l => l.scope));
  // A node in another container, or an edge that joins other objects or touches such a node, is
  // a different thing in each version, as is a changed direction: remove the old one under a
  // spare ID and add the new one, so each panel draws its own and the merged drawing shows it.
  const taken = new Set([...was.keys(), ...now.keys()]),
    spare = (kind: string, id: string) => {
      let n = `${id}-was`;
      for (let i = 2; taken.has(kind + n); i++) n = `${id}-was${i}`;
      taken.add(kind + n);
      return n;
    };
  const parentMoved = next.objects.filter(o =>
      old.objects.some(p => p.id === o.id && p.parent !== o.parent),
    ),
    movedNodes = new Map(
      parentMoved.filter(o => o.type === 'node').map(o => [o.id, spare('object:', o.id)]),
    ),
    moved = parentMoved.filter(o => o.type === 'group').map(o => o.id);
  const ends = (e: ModelEdge) => [e.source, e.target, e.directed !== false].join('\0'),
    split = new Set([
      ...[...movedNodes.keys()].map(id => 'object:' + id),
      ...next.edges
        .filter(e =>
          old.edges.some(
            o =>
              o.id === e.id &&
              (ends(o) !== ends(e) || [o.source, o.target].some(id => movedNodes.has(id))),
          ),
        )
        .map(e => 'edge:' + e.id),
    ]);
  // A removed line, joined to the old copies of moved nodes; a split one also takes a spare ID.
  const spares = new Map<string, string>();
  const removedLine = (line: Statement): Statement => {
    const args = line.args.map(w => ({ ...w })),
      own = split.has(keyOf(line));
    if (line.command === 'edge') {
      if (own) spares.set(line.args[0].value, (args[0].value = spare('edge:', args[0].value)));
      for (const i of [1, 3]) args[i].value = movedNodes.get(args[i].value) ?? args[i].value;
    } else if (own) args[0].value = movedNodes.get(args[0].value)!;
    return { ...line, args, mark: '-', comment: undefined };
  };

  const out: SourceLine[] = [],
    unshown: string[] = [],
    carried: string[] = [];
  for (const line of docs[1].lines) {
    if (line.kind !== 'statement' || !DECLARATIONS.includes(line.command)) {
      out.push(line);
      continue;
    }
    const prior = was.get(keyOf(line));
    if (!prior || split.has(keyOf(line))) {
      out.push({ ...line, mark: '+' });
      continue;
    }
    const place =
      'shape' in prior
        ? pastPlace(old, next, prior.id, prior.type === 'node')
        : { words: [], carried: [] };
    carried.push(...place.carried);
    if (meaning(prior) !== meaning(now.get(keyOf(line))!) || place.words.length) {
      const label = line.args[line.command === 'edge' ? 4 : 1]?.value ?? '',
        { words, drawn } =
          'shape' in prior
            ? pastNode(prior, now.get(keyOf(line)) as ModelObject)
            : { words: [], drawn: [] },
        attrs = attrChanges(
          docs[0].lines.find(
            (l): l is Statement =>
              l.kind === 'statement' &&
              DECLARATIONS.includes(l.command) &&
              keyOf(l) === keyOf(line),
          )!,
          line,
        ).filter(k => !drawn.includes(k));
      if (attrs.length) unshown.push(`${line.args[0].value} (${attrs.join(', ')})`);
      out.push({
        ...line,
        mark: '~',
        attrs: [
          ...line.attrs,
          ...(label !== prior.label ? [['was', quoted(prior.label)] as [string, Word]] : []),
          ...words,
          ...place.words,
        ],
      });
    } else out.push(line);
  }

  // Put each removed declaration back after the declaration that preceded it in the older file,
  // and keep the older layout line of a removed group so its contents arrange as they did.
  let anchor = -1;
  for (const line of docs[0].lines) {
    if (line.kind !== 'statement') continue;
    const scope = line.args[0]?.value,
      removedLayout =
        line.command === 'layout' &&
        !scopes.has(scope) &&
        !now.has('object:' + scope) &&
        old.objects.some(o => o.id === scope);
    if (removedLayout) {
      out.push(line);
      continue;
    }
    if (!DECLARATIONS.includes(line.command)) continue;
    const key = keyOf(line);
    if (now.has(key) && !split.has(key)) {
      anchor = out.findIndex(
        l => l.kind === 'statement' && DECLARATIONS.includes(l.command) && keyOf(l) === key,
      );
      continue;
    }
    const removed = removedLine(line);
    if (anchor < 0) {
      const first = out.findIndex(l => l.kind === 'statement' && DECLARATIONS.includes(l.command));
      anchor = (first < 0 ? out.length : first) - 1;
    }
    out.splice(anchor + 1, 0, removed);
    anchor += 1;
  }
  const [gone, kept] = [undeclared(docs[0].lines), undeclared(out)];
  for (const [text, name] of [...gone, ...kept])
    if ((!gone.has(text) || !kept.has(text)) && !carried.includes(name)) unshown.push(name);
  let reordered = false;
  if (isSequence(old) && isSequence(next)) {
    if (!sameOrder(nodesOf(old), nodesOf(next))) unshown.push('participant order');
    // Rows come from file order, so the older order needs a line when the merged file loses it.
    const edges = out.filter((l): l is Statement => l.kind === 'statement' && l.command === 'edge'),
      order = old.edges.map(e => spares.get(e.id) ?? e.id);
    if (edges.filter(l => l.mark !== '+').some((l, i) => l.args[0].value !== order[i])) {
      reordered = true;
      out.splice(out.indexOf(edges.at(-1)!) + 1, 0, {
        kind: 'statement',
        command: 'was-order',
        args: order.map(bare),
        attrs: [],
        line: 0,
      });
    }
  }
  const merged = printSource({ lines: out });
  parseModel(merged);
  return { merged, moved, unshown: [...new Set(unshown)], reordered };
}
