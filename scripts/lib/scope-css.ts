/**
 * Scope the editor's stylesheets to the element it is mounted in, so they never style the host
 * page: `:root`, `html` and `body` become the editor itself, and every other rule applies only
 * inside it. Keyframes are left as they are.
 *
 * `scripts/build-editor.ts` applies it to the published editor. A host that compiles the editor
 * from source can apply the same step to the stylesheets it imports from `src/`.
 */
import postcss, { type Rule } from 'postcss';

/** The class a scoped stylesheet applies inside. */
export const EDITOR_SCOPE = '.draft-editor';

export function scopeEditorCss(css: string, scope: string = EDITOR_SCOPE): string {
  const ast = postcss.parse(css);
  ast.walkRules((rule: Rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes/.test((rule.parent as { name: string }).name))
      return;
    rule.selectors = rule.selectors.map(sel => {
      if (/^(:root|html|body)\b/.test(sel)) return sel.replace(/^(:root|html|body)/, scope);
      return `${scope} ${sel}`;
    });
  });
  return ast.toString();
}
