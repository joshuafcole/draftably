import {
  autocompletion,
  closeBrackets,
  completionKeymap,
  type Completion,
  type CompletionContext,
} from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { lintGutter, setDiagnostics, type Diagnostic as LintDiagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  hoverTooltip,
  keymap,
  lineNumbers,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { createEffect, on, onCleanup, onMount } from 'solid-js';
import { COLORS, DSL_SHAPES } from '../../src/dsl/syntax';
import type { Diagnostic } from '../../src/dsl/compile';
import { THEME_IDS } from '../../src/model/appearance';
import { formatSource } from '../../src/dsl/syntax';
import {
  COMMANDS,
  highlightHtml,
  tokenClass,
  tokenizeLine,
  tokenizeSource,
  type Token,
} from '../highlight';
import { HELP } from './reference';

/** What the page can do to the editor. */
export interface EditorApi {
  /** Replace the whole text as one undoable step. */
  replace(text: string): void;
  /** Scroll `line` into view without moving the cursor or taking focus. */
  reveal(line: number): void;
  /** Put the cursor at the start of a line and scroll it into view. */
  goto(line: number): void;
  focus(): void;
  /** Rewrite the source in the parser's canonical layout; false when it does not parse. */
  format(): boolean;
}

const marks = new Map<string, Decoration>();
const markFor = (t: Token) => {
  const cls = tokenClass(t);
  let m = marks.get(cls);
  if (!m) marks.set(cls, (m = Decoration.mark({ class: cls })));
  return m;
};

/** Colors the visible lines with the same tokens the rest of the site uses. */
const tokens = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView) {
      const out = new RangeSetBuilder<Decoration>();
      // Whole-file tokens, so a code node's body reads as body text wherever the view starts.
      const lines = tokenizeSource(view.state.doc.toString().split('\n'));
      for (const { from, to } of view.visibleRanges) {
        for (let pos = from; pos <= to;) {
          const line = view.state.doc.lineAt(pos);
          let at = line.from;
          for (const t of lines[line.number - 1] ?? []) {
            if (t.kind !== 'space') out.add(at, at + t.text.length, markFor(t));
            at += t.text.length;
          }
          pos = line.to + 1;
        }
      }
      return out.finish();
    }
  },
  { decorations: v => v.decorations },
);

/** Lines whose object is hovered or picked in the drawing. */
const setLinked = StateEffect.define<number[]>();
const linkedLine = Decoration.line({ class: 'cm-linked' });
const linked = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (!e.is(setLinked)) continue;
      const lines = [...new Set(e.value)]
        .filter(n => n >= 1 && n <= tr.state.doc.lines)
        .sort((a, b) => a - b);
      return Decoration.set(lines.map(n => linkedLine.range(tr.state.doc.line(n).from)));
    }
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: f => EditorView.decorations.from(f),
});

const EDGE_KINDS = ['sync', 'async'];

/** The nodes and groups the text declares, read from the text so a new one counts at once. */
function declared(text: string) {
  const out: { id: string; label: string; group: boolean }[] = [];
  for (const line of text.split('\n')) {
    const [command, id, label] = tokenizeLine(line).filter(
      t => t.kind !== 'space' && t.kind !== 'mark',
    );
    if (command?.kind !== 'command' || (command.text !== 'node' && command.text !== 'group'))
      continue;
    if (id?.kind !== 'id') continue;
    out.push({
      id: id.text,
      label: label?.kind === 'string' ? label.text.slice(1, -1) : '',
      group: command.text === 'group',
    });
  }
  return out;
}

/** Commands at the start of a line, ids where a statement names objects, and attribute values. */
function completions() {
  return (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/[\w.-]*/);
    if (!word) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const head = line.text.slice(0, word.from - line.from);
    const attr = /([\w-]+)=$/.exec(head)?.[1];
    if (word.from === word.to && !ctx.explicit && !attr) return null;

    const objects = declared(ctx.state.doc.toString()).filter(o => o.id !== word.text);
    const ids = (list: typeof objects): Completion[] =>
      list.map(o => ({ label: o.id, detail: o.label, type: o.group ? 'class' : 'variable' }));
    const words = (list: readonly string[], type: string): Completion[] =>
      list.map(label => ({ label, type }));

    let options: Completion[];
    if (!head.trim() || /^\s*[+~.-]$/.test(head)) options = words(COMMANDS, 'keyword');
    else if (attr === 'in') options = ids(objects.filter(o => o.group));
    else if (attr === 'color') options = words(COLORS, 'constant');
    else if (attr === 'shape') options = words(DSL_SHAPES, 'constant');
    else if (attr === 'kind') options = words(EDGE_KINDS, 'constant');
    else if (attr) return null;
    else if (/^\s*theme\s+$/.test(head)) options = words(THEME_IDS, 'constant');
    else {
      const command = head
        .trim()
        .split(/\s+/)[0]
        .replace(/^[+~.-]/, '');
      // An edge's own id comes first; its ends are objects.
      const args = head.trim().split(/\s+/).length;
      if (command === 'edge' && args >= 2) options = ids(objects);
      else if (
        ['order', 'align', 'near', 'nudge', 'stay', 'pin', 'size', 'layout'].includes(command)
      )
        options = ids(objects);
      else return null;
    }
    return { from: word.from, options, validFor: /^[\w.-]*$/ };
  };
}

const DOCS = `${import.meta.env.BASE_URL}docs/`;

/** Help from the language reference for the word under the pointer. */
const help = hoverTooltip(
  (view, pos) => {
    const line = view.state.doc.lineAt(pos);
    let at = line.from;
    const toks = tokenizeLine(line.text);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      const end = at + t.text.length;
      if (pos >= at && pos <= end && t.kind !== 'space') {
        // An attribute's value or `=` explains the attribute unless the value has its own entry.
        let key = t.text;
        if (t.kind === 'attr' && t.text === '=') key = toks[i - 1]?.text ?? '';
        if ((t.kind === 'value' || t.kind === 'number') && !HELP.has(key))
          key = toks[i - 2]?.text ?? '';
        if (t.kind === 'mark') key = toks[i + 1]?.text ?? '';
        // An attribute without a row of its own is explained by its statement's row.
        const command = toks.find(x => x.kind === 'command')?.text ?? '';
        const rows =
          HELP.get(key) ??
          (t.kind === 'attr' || t.kind === 'value'
            ? HELP.get(command)?.filter(r => r.meaning.includes(`${key}=`))
            : undefined);
        if (!rows?.length) return null;
        // A command with several forms (layout) shows the forms this line matches best.
        const words = line.text
          .trim()
          .split(/\s+/)
          .filter(w => w.length > 2 && w !== key);
        const score = (r: (typeof rows)[number]) => words.filter(w => r.syntax.includes(w)).length;
        const best = Math.max(...rows.map(score));
        const shown = rows.filter(r => score(r) === best).slice(0, 3);
        return {
          pos: at,
          end,
          above: true,
          create() {
            const dom = document.createElement('div');
            dom.className = 'help';
            for (const r of shown) {
              const row = document.createElement('div');
              row.className = 'help-row';
              const code = document.createElement('code');
              // Built from escaped tokens by highlightHtml.
              code.innerHTML = highlightHtml(r.syntax);
              const text = document.createElement('p');
              // `code` spans read as code; everything else is plain text.
              for (const part of r.meaning.split(/(`[^`]+`)/)) {
                if (!part.startsWith('`')) {
                  text.append(part);
                  continue;
                }
                const c = document.createElement('code');
                c.textContent = part.slice(1, -1);
                text.append(c);
              }
              row.append(code, text);
              if (r.anchor) {
                const link = document.createElement('a');
                link.href = DOCS + r.anchor;
                link.textContent = 'Read more';
                row.append(link);
              }
              dom.append(row);
            }
            return { dom };
          },
        };
      }
      at = end;
    }
    return null;
  },
  { hoverTime: 350 },
);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--surface)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '20px', fontVariantLigatures: 'none' },
  '.cm-content': { padding: '10px 0' },
  '.cm-gutters': { backgroundColor: 'var(--surface)', border: 'none', color: '#8c92a4' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 14px', minWidth: '40px' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
  '&.cm-focused .cm-activeLine, &.cm-focused .cm-activeLineGutter': { backgroundColor: '#f4f5f9' },
  '.cm-linked': { backgroundColor: 'var(--accent-soft)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: '#6650d92e !important',
  },
  '.cm-cursor': { borderLeftColor: 'var(--text)' },
  '.cm-tooltip': {
    border: '1px solid var(--line-strong)',
    borderRadius: '6px',
    backgroundColor: 'var(--surface)',
    boxShadow: '0 8px 24px #25213b1f',
    fontFamily: 'var(--font)',
  },
  '.cm-tooltip-autocomplete > ul > li': { padding: '2px 10px', fontFamily: 'var(--mono)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--accent-soft)',
    color: 'var(--text)',
  },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '12px' },
  '.cm-diagnostic': { fontFamily: 'var(--font)', fontSize: '12.5px' },
  '.cm-lint-marker': { width: '0.9em', height: '0.9em' },
});

export function CodeEditor(props: {
  value: string;
  onChange: (text: string) => void;
  diagnostics: Diagnostic[];
  linkedLines: number[];
  onCursorLine: (line: number) => void;
  onFocusChange: (focused: boolean) => void;
  /** The user changed the text (not a replace from the page). */
  onType: () => void;
  ref: (api: EditorApi) => void;
}) {
  let host!: HTMLDivElement;
  let view: EditorView | undefined;

  const format = () => {
    if (!view) return false;
    let text: string;
    try {
      text = formatSource(view.state.doc.toString());
    } catch {
      return false;
    }
    if (text !== view.state.doc.toString())
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
    return true;
  };

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          history(),
          drawSelection(),
          closeBrackets(),
          highlightSelectionMatches(),
          lintGutter(),
          help,
          EditorView.lineWrapping,
          autocompletion({ override: [completions()], icons: false }),
          keymap.of([
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
            { key: 'Shift-Alt-f', run: () => (format(), true) },
          ]),
          tokens,
          // DOM focus, not view.hasFocus, which also needs the window focused.
          EditorView.domEventHandlers({
            focus: () => props.onFocusChange(true),
            blur: () => props.onFocusChange(false),
          }),
          linked,
          theme,
          EditorView.contentAttributes.of({ 'aria-label': 'Diagram source', spellcheck: 'false' }),
          // CodeMirror calls this outside Solid; it reads the latest props each time.
          // eslint-disable-next-line solid/reactivity
          EditorView.updateListener.of(u => {
            if (u.docChanged) props.onChange(u.state.doc.toString());
            if (u.transactions.some(t => t.isUserEvent('input') || t.isUserEvent('delete')))
              props.onType();
            if (u.selectionSet || u.docChanged)
              props.onCursorLine(u.state.doc.lineAt(u.state.selection.main.head).number);
          }),
        ],
      }),
    });
    props.ref({
      // Only the changed middle is replaced, so the scroll, the cursor and undo steps stay put.
      replace(text) {
        const old = view?.state.doc.toString();
        if (!view || old === undefined || text === old) return;
        let a = 0;
        while (a < old.length && a < text.length && old[a] === text[a]) a++;
        let b = 0;
        while (b < old.length - a && b < text.length - a && old.at(-1 - b) === text.at(-1 - b)) b++;
        view.dispatch({
          changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) },
        });
      },
      reveal(line) {
        if (!view) return;
        const at = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines)).from;
        view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'center' }) });
      },
      goto(line) {
        if (!view) return;
        const at = view.state.doc.line(Math.min(Math.max(line, 1), view.state.doc.lines)).from;
        view.dispatch({
          selection: { anchor: at },
          effects: EditorView.scrollIntoView(at, { y: 'center' }),
        });
        // After the click that asked for it, which would otherwise take focus back.
        requestAnimationFrame(() => view?.focus());
      },
      focus: () => view?.focus(),
      format,
    });
  });
  onCleanup(() => view?.destroy());

  // Compiler diagnostics become lint marks on their lines.
  createEffect(
    on(
      () => props.diagnostics,
      list => {
        if (!view) return;
        const doc = view.state.doc;
        const marks: LintDiagnostic[] = list
          .filter(d => d.line && d.line <= doc.lines && d.level !== 'info')
          .map(d => {
            const line = doc.line(d.line!);
            return {
              from: line.from,
              to: line.to,
              severity: d.level === 'error' ? 'error' : 'warning',
              message: d.message,
            };
          });
        view.dispatch(setDiagnostics(view.state, marks));
      },
    ),
  );

  createEffect(
    on(
      () => props.linkedLines,
      lines => view?.dispatch({ effects: setLinked.of(lines) }),
    ),
  );

  return <div class="code-editor" ref={host} />;
}
