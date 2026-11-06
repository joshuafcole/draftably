import { describe, expect, it } from 'vitest';
import { scopeEditorCss } from '../scripts/lib/scope-css.ts';

describe('scopeEditorCss', () => {
  it('turns the page roots into the editor and keeps every other rule inside it', () => {
    const css = scopeEditorCss(
      ':root { --accent: red; } :root[data-theme="dark"] { --accent: blue; } body, p { margin: 0; } .node .label { fill: red; }',
    );
    expect(css).toContain('.draft-editor { --accent: red; }');
    expect(css).toContain('.draft-editor[data-theme="dark"] { --accent: blue; }');
    expect(css).toContain('.draft-editor, .draft-editor p { margin: 0; }');
    expect(css).toContain('.draft-editor .node .label { fill: red; }');
  });

  it('leaves keyframe steps alone and takes another scope', () => {
    const css = scopeEditorCss(
      '@keyframes pulse { from { opacity: 0; } to { opacity: 1; } } .x {}',
      '.host',
    );
    expect(css).toContain('from { opacity: 0; }');
    expect(css).toContain('.host .x {}');
  });
});
