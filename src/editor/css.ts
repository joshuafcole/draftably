/**
 * The editor's stylesheets, adopted where the editor renders: the page for `mountEditor`, or the
 * shadow root of `<draft-editor>`. The package build registers the scoped CSS here
 * (`scripts/build-editor.ts`); in this repository's dev server Vite injects it, and nothing is
 * registered.
 */
const parts = new Map<string, string>();
const sheets = new WeakMap<Document, CSSStyleSheet>();

export function registerEditorCss(key: string, css: string) {
  parts.set(key, css);
}

/** Add the editor's styles to `root`, once. One constructable sheet per page, shared. */
export function adoptEditorCss(root: Document | ShadowRoot) {
  if (!parts.size) return;
  const doc = root instanceof Document ? root : root.ownerDocument;
  const win = doc.defaultView;
  const css = [...parts.values()].join('\n');
  if (
    win &&
    'adoptedStyleSheets' in win.Document.prototype &&
    'replaceSync' in win.CSSStyleSheet.prototype
  ) {
    let sheet = sheets.get(doc);
    if (!sheet) {
      sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
      sheets.set(doc, sheet);
    }
    if (!root.adoptedStyleSheets.includes(sheet))
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  }
  const into = root instanceof Document ? root.head : root;
  if (into.querySelector('style[data-draft-editor]')) return;
  const style = doc.createElement('style');
  style.dataset.draftEditor = '';
  style.textContent = css;
  into.append(style);
}
