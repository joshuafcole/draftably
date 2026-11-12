import { describe, expect, it } from 'vitest';
import { marks, search, words } from '../site/docs/find';

const top = (query: string) => {
  const hit = search(query)[0]?.entry;
  return hit ? `${hit.page.title} > ${hit.heading ?? ''}` : '';
};

// The October 31 audit's query lists. The patterns stay loose, so a new heading can take first
// place without failing this file.
describe('docs search', () => {
  it.each([
    'upgrade',
    'dark mode',
    'colour',
    'swimlane',
    'flowchart',
    'uml',
    'class diagram',
    'horizontal',
    'vertical',
    'keyboard shortcuts',
    'shortcut',
    'hotkey',
    'zoom',
    'dotted',
    'clipboard',
    'icon',
    'logo',
    'offline',
    'privacy',
    'troubleshoot',
    'not working',
    'codex',
    'mcp',
    'github actions',
  ])('finds a task word: %s', query => {
    expect(search(query).length).toBeGreaterThan(0);
  });

  it.each([
    ['colour', /Themes/],
    // A dark page draws the diagram dark; the section says how, and how to opt out.
    ['dark mode', /Dark pages/],
    ['swimlane', /Swim lanes/],
    ['codex', /Agent skill/],
    ['offline', /Save/],
    ['order', /Refinements/],
    ['port', /CLI|Routing/],
    ['pan', /Edit|Shortcut/],
    ['rm', /rm/],
    ['ci', /Get started/],
    ['edge', /Rules|Routing/],
    ['change theme', /Themes/],
    ['er diagram', /Cells/],
    ['move a box', /Refinements/],
    ['not working', /Troubleshoot/],
    ['keyboard shortcuts', /Shortcuts/],
    ['hotkey', /Shortcuts/],
    ['which engine', /Choose an engine/],
    ['engine', /Choose an engine/],
    ['scopes', /Scopes and groups/],
    ['engine settings', /Engine settings/],
    ['feedback', /Feedback lines and ties/],
    ['back edge', /Feedback lines and ties/],
    ['group layout', /Scopes and groups/],
    ['docusaurus', /Documentation sites/],
    ['mountViewer', /API reference/],
    ['renderSvg', /Render SVG/],
    ['mermaid drop-in', /Switch from Mermaid/],
  ])('ranks the right page first: %s', (query, page) => {
    expect(top(query)).toMatch(page);
  });

  it.each([
    ['fold=never', /Rules/],
    ['span=var', /Byte and bit/],
    ['kind=async', /Sequence/],
    ['vary --apply', /vary/],
    ['crossing-penalty', /Routing/],
    ['reopen', /Reopen/],
    ['export png', /Export a PNG/],
    ['save diagram', /Export a PNG/],
  ])('keeps an exact query first: %s', (query, page) => {
    expect(top(query)).toMatch(page);
  });

  it('marks the words it matched, and not the inside of another word', () => {
    const marked = (text: string, query: string) =>
      marks(text, words(query))
        .filter(run => run.match)
        .map(run => run.text);
    expect(marked('format and rm', 'rm')).toEqual(['rm']);
    expect(marked('The Color of it', 'colour')).toEqual(['Color']);
  });

  it('finds nothing for nonsense, so the empty state shows', () => {
    expect(search('zzzz')).toEqual([]);
  });
});
