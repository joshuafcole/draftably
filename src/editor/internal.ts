/** The session behind a mounted editor, for this repository's tests and proofs only. */
import type { DiagramSession } from '../state/session';

export const sessions = new WeakMap<object, DiagramSession>();

export const sessionOf = (editor: object): DiagramSession => {
  const session = sessions.get(editor);
  if (!session) throw Error('Not a mounted editor.');
  return session;
};
