/**
 * Targeted changes to `.draft` source lines. Each helper changes, adds or removes whole statements
 * so comments and unrelated statements are kept.
 */
import {
  bare,
  POSITION_HINTS,
  quoted,
  type SourceDoc,
  type SourceLine,
  type Statement,
  type Word,
} from './syntax';

export const isStatement = (line: SourceLine): line is Statement => line.kind === 'statement';

export const statements = (doc: SourceDoc) => doc.lines.filter(isStatement);

export function statement(
  command: string,
  args: Word[],
  attrs: Array<[string, Word]> = [],
): Statement {
  return { kind: 'statement', command, args, attrs, line: 0 };
}

/** The `node` or `group` declaration of an object. */
export const declaration = (doc: SourceDoc, id: string) =>
  statements(doc).find(
    s => (s.command === 'node' || s.command === 'group') && s.args[0]?.value === id,
  );

export const edgeStatement = (doc: SourceDoc, id: string) =>
  statements(doc).find(s => s.command === 'edge' && s.args[0]?.value === id);

export const layoutStatement = (doc: SourceDoc, scope: string) =>
  statements(doc).find(s => s.command === 'layout' && s.args[0]?.value === scope);

export function getAttr(s: Statement, key: string) {
  return s.attrs.find(([k]) => k === key)?.[1];
}

/** Set or (with `undefined`) remove an attribute, keeping the order of the others. */
export function setAttr(s: Statement, key: string, value: Word | undefined) {
  const i = s.attrs.findIndex(([k]) => k === key);
  if (value === undefined) {
    if (i >= 0) s.attrs.splice(i, 1);
  } else if (i >= 0) s.attrs[i] = [key, value];
  else s.attrs.push([key, value]);
}

export function removeWhere(doc: SourceDoc, test: (s: Statement) => boolean) {
  doc.lines = doc.lines.filter(line => !isStatement(line) || !test(line));
}

/** Insert after the last statement that passes `near`, or at the end of the file. */
export function insertAfter(doc: SourceDoc, s: Statement, near: (s: Statement) => boolean) {
  let at = -1;
  doc.lines.forEach((line, i) => {
    if (isStatement(line) && near(line)) at = i;
  });
  if (at < 0) {
    doc.lines.push({ kind: 'blank' }, s);
    return;
  }
  doc.lines.splice(at + 1, 0, s);
}

const REFINEMENTS = ['near', 'nudge', 'stay', 'pin', 'size', 'order', 'align', 'route', 'label'];

/** Add a refinement statement to the refinements section, starting one when there is none. */
export function addRefinement(doc: SourceDoc, s: Statement) {
  if (statements(doc).some(x => REFINEMENTS.includes(x.command)))
    insertAfter(doc, s, x => REFINEMENTS.includes(x.command));
  else doc.lines.push({ kind: 'blank' }, { kind: 'comment', text: '# Layout refinements' }, s);
}

/** Remove the positional refinements (`near`, `nudge`, `stay`, `pin`) for an object. */
export const clearPosition = (doc: SourceDoc, id: string) =>
  removeWhere(doc, s => POSITION_HINTS.includes(s.command as never) && s.args[0]?.value === id);

/**
 * Every statement that mentions `id` as an object: refinements, edges and alignment lists. Its
 * messages go with it, and they leave the phases and states that list them.
 */
export function removeReferences(doc: SourceDoc, id: string) {
  statements(doc)
    .filter(s => s.command === 'edge' && (s.args[1]?.value === id || s.args[3]?.value === id))
    .forEach(s => removeEdge(doc, s.args[0].value));
  removeWhere(doc, s => {
    if (s.command === 'near') return s.args[0]?.value === id || s.args[1]?.value === id;
    if (['nudge', 'stay', 'pin', 'size'].includes(s.command)) return s.args[0]?.value === id;
    if (s.command === 'layout' || s.command === 'order') return s.args[0]?.value === id;
    return false;
  });
  for (const s of statements(doc))
    if (s.command === 'order' || s.command === 'align')
      s.args = s.args.filter((w, i) => i === 0 || w.value !== id);
  removeFromStates(doc, id);
  unanchorNotes(doc, id);
  // An alignment needs at least two members, and an order at least one.
  removeWhere(
    doc,
    s =>
      (s.command === 'align' && s.args.length < 3) || (s.command === 'order' && s.args.length < 2),
  );
}

/**
 * Take an object or connection out of every `state` line, its `context=` list included; drop a
 * line left with no IDs in either.
 */
export function removeFromStates(doc: SourceDoc, id: string) {
  for (const s of statements(doc))
    if (s.command === 'state') {
      s.args = s.args.filter((w, i) => i === 0 || w.quoted || w.value !== id);
      const context = getAttr(s, 'context')?.value.split(',');
      if (context?.includes(id)) {
        const kept = context.filter(x => x !== id);
        setAttr(s, 'context', kept.length ? bare(kept.join(',')) : undefined);
      }
    }
  removeWhere(
    doc,
    s => s.command === 'state' && !s.args.slice(1).some(w => !w.quoted) && !getAttr(s, 'context'),
  );
}

/** A note on a deleted object or message keeps its words and moves to the frame. */
function unanchorNotes(doc: SourceDoc, id: string) {
  for (const s of statements(doc))
    if (s.command === 'note' && getAttr(s, 'near')?.value === id) {
      setAttr(s, 'near', undefined);
      setAttr(s, 'side', undefined);
      setAttr(s, 'leader', undefined);
    }
}

/**
 * Remove a connection and each mention of it, so its `phase`, `state` and `note` lines still
 * compile. A phase left with no messages goes too; a comment on its line stays, on a line of its
 * own.
 */
export function removeEdge(doc: SourceDoc, id: string) {
  removeWhere(doc, s => ['edge', 'route', 'label'].includes(s.command) && s.args[0]?.value === id);
  removeFromStates(doc, id);
  unanchorNotes(doc, id);
  for (const s of statements(doc))
    if (s.command === 'phase') s.args = s.args.filter((w, i) => i < 2 || w.value !== id);
  doc.lines = doc.lines.flatMap(line =>
    !isStatement(line) || line.command !== 'phase' || line.args.length > 2
      ? [line]
      : line.comment
        ? [{ kind: 'comment', text: line.comment }]
        : [],
  );
}

export const num = (n: number) => bare(String(Math.round(n)));
export { bare, quoted };
