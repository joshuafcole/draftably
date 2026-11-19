/**
 * `src=` on a code node: the body comes from a file next to the `.draft`, with an optional line
 * range (`src="queries/orders.sql#L10-L40"`). The compiler gets the files' text from its host as
 * `CodeFiles`: the CLI and the viewer's file server read them, and the static app has none, so
 * there a `src=` node draws a placeholder that names the file it needs.
 */
import { CODE_TAB, codeLines } from './code';

/** One file a `src=` names: its text, or why the host could not read it. */
export type CodeFile = { text: string } | { error: string };
/** Files by the path the `src=` gives, relative to the `.draft` file. */
export type CodeFiles = Record<string, CodeFile>;

export interface SrcRef {
  path: string;
  /** 1-based first and last line of `#Lstart-Lend`. */
  from?: number;
  to?: number;
}

const REF = /^([^#]+?)(?:#L(\d+)(?:-L?(\d+))?)?$/;

/** `path#L10-L40` as a path and a line range, or null when it is not one. */
export function parseSrc(value: string): SrcRef | null {
  const m = REF.exec(value.trim());
  if (!m) return null;
  if (!m[2]) return { path: m[1] };
  const from = Number(m[2]);
  return { path: m[1], from, to: m[3] ? Number(m[3]) : from };
}

const LANGS: Record<string, string> = {
  sql: 'sql',
  py: 'python',
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  diff: 'diff',
  patch: 'diff',
};

/** The `lang=` a file's extension implies, if draftably colors that language. */
export const langOf = (file: string) => LANGS[/\.([^./]+)$/.exec(file)?.[1].toLowerCase() ?? ''];

/** A `src=` body: its lines, the number of its first line, and any problem to report. */
export interface SrcBody {
  lines: string[];
  start: number;
  /** The file was not read: the lines are a placeholder that names it. */
  placeholder?: boolean;
  problem?: { level: 'error' | 'warning'; message: string };
}

/** The body a `src=` draws from `file`, the host's copy of it (undefined when it has none). */
export function srcBody(value: string, ref: SrcRef, file: CodeFile | undefined, tab = CODE_TAB) {
  const stand = (level: 'error' | 'warning', message: string, why: string): SrcBody => ({
    lines: [`src="${value}"`, why],
    start: 1,
    placeholder: true,
    problem: { level, message },
  });
  if (!file)
    return stand(
      'warning',
      `src="${ref.path}" needs file access, so it draws a placeholder here. Open the .draft with draftably open or the CLI to read the file.`,
      `Needs ${ref.path}: open the .draft with draftably.`,
    );
  if ('error' in file) return stand('error', file.error, file.error);
  const all = file.text.split(/\r?\n/);
  if (all.length > 1 && all[all.length - 1] === '') all.pop();
  const from = ref.from ?? 1,
    last = ref.to ?? all.length;
  if (from < 1)
    return stand(
      'error',
      `src="${value}": lines count from 1, so #L0 names no line.`,
      `Lines of ${ref.path} count from 1.`,
    );
  if (last < from)
    return stand(
      'error',
      `src="${value}" runs backwards: line ${last} comes before line ${from}. Write #L${last}-L${from}.`,
      `The range of ${ref.path} runs backwards.`,
    );
  if (from > all.length)
    return stand(
      'error',
      `src="${value}" starts at line ${from}, past the end of ${ref.path} (${all.length} lines).`,
      `${ref.path} has ${all.length} lines; the range starts at ${from}.`,
    );
  const to = Math.min(last, all.length),
    slice = all.slice(from - 1, to),
    lead = slice.findIndex(l => l.trim()),
    body: SrcBody = {
      lines: codeLines(slice, tab),
      start: from + Math.max(0, lead),
    };
  if (last > all.length)
    body.problem = {
      level: 'error',
      message: `src="${value}" runs to line ${last}, past the end of ${ref.path} (${all.length} lines).`,
    };
  return body;
}
