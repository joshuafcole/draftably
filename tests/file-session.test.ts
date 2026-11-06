import { afterAll, expect, it, vi } from 'vitest';
// Imported with the file, not inside a test: loading the session's modules can take seconds
// while the whole suite transforms at once, and a test's timeout should not pay for it.
// Only creating a session reads the page globals that the first test stubs.
import { createDiagramSession, type DiagramSession } from '../src/state/session';

afterAll(() => vi.unstubAllGlobals());

// One session for the file: the tests run in order and later ones start from earlier state.
let shared: DiagramSession | undefined;
const session = () => (shared ??= createDiagramSession());

it('keeps the first title edit on a new file-mode shape and selects its source id', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal(
    'DOMRect',
    class {
      x = 0;
      y = 0;
      width = 1;
      height = 1;
      left = 0;
      top = 0;
      right = 1;
      bottom = 1;
    },
  );
  vi.stubGlobal('document', {
    title: '',
    createElement: () => ({
      getContext: () => ({ measureText: (text: string) => ({ width: text.length * 7 }) }),
    }),
  });

  const s = session();
  await s.openExampleSession(
    'title-race',
    'Title race',
    'diagram "Title race" version=1\nnode start "Start"\n',
  );

  s.quickExtend();
  for (let i = 0; i < 20 && s.fileCompiling(); i++)
    await new Promise(resolve => setTimeout(resolve, 0));
  expect(s.selectedIds()).toEqual(['next-step']);
  expect(s.inlineEditId()).toBe('next-step');

  s.setInlineDraft('Approve request');
  s.finishInlineEdit(true);
  for (let i = 0; i < 20 && s.fileCompiling(); i++)
    await new Promise(resolve => setTimeout(resolve, 0));

  expect(s.currentSource()).toContain('node next-step "Approve request"');
  expect(s.selectedIds()).toEqual(['next-step']);
});

it('keeps a title finished while the new shape is still compiling', async () => {
  const s = session();
  s.quickExtend();
  // Finish before the add's compile ends: the edit waits for it instead of being refused.
  expect(s.fileCompiling()).toBe(true);
  s.setInlineDraft('Ship order');
  s.finishInlineEdit(true);
  for (let i = 0; i < 40 && s.fileCompiling(); i++)
    await new Promise(resolve => setTimeout(resolve, 0));

  expect(s.currentSource()).toMatch(/node \S+ "Ship order"/);
});

it('releases cached-page streams and catches up when the file page returns', async () => {
  const page = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  vi.stubGlobal('window', page);
  const streams: FakeEventSource[] = [];
  class FakeEventSource extends EventTarget {
    close = vi.fn();
    constructor(readonly url: string) {
      super();
      streams.push(this);
    }
  }
  vi.stubGlobal('EventSource', FakeEventSource);
  let source = 'diagram "File" version=1\nnode a "Before leaving"\n';
  vi.stubGlobal('fetch', async () =>
    Response.json({ name: 'file.draft', path: '/file.draft', source, revision: source }),
  );
  const s = session();
  await s.openFileSession('one.draft');
  await s.openFileSession('two.draft');
  expect(streams[0].close).toHaveBeenCalledOnce();
  expect(streams[1].url).toBe('./api/events?file=two.draft');

  page.dispatchEvent(new Event('pagehide'));
  expect(streams[1].close).toHaveBeenCalledOnce();
  streams[1].dispatchEvent(new Event('error'));
  expect(s.fileStatus()).toBe('saved');

  source = 'diagram "File" version=1\nnode a "Changed while away"\n';
  const restored = Object.assign(new Event('pageshow'), { persisted: true });
  page.dispatchEvent(restored);
  expect(streams).toHaveLength(3);
  streams[2].dispatchEvent(new Event('open'));
  await vi.waitFor(() => expect(s.currentSource()).toContain('Changed while away'));

  await s.openExampleSession('scratch', 'Scratch', 'node a "Scratch"\n');
  expect(streams[2].close).toHaveBeenCalledOnce();
  page.dispatchEvent(restored);
  expect(streams).toHaveLength(3);
});

it('keeps framing through a theme change, in a document and in a file', async () => {
  const s = session();
  const framing = {
    heading: { title: 'T', subtitle: 'Why' },
    notes: [{ text: 'Scope' }],
    legend: [{ color: 'blue', label: 'Blue' }],
    states: [{ id: 's', label: 'S', ids: [] }],
  };
  s.closeFileSession();
  s.setDoc('appearance', { ...s.doc.appearance, ...framing } as never);
  s.chooseTheme('ink');
  expect(s.doc.appearance).toMatchObject({ theme: 'ink', ...framing });

  const source = [
    'diagram "Framed" version=1',
    'subtitle "Why it matters"',
    'note "Scope"',
    'legend blue "Blue"',
    'node a "A" color=blue',
    'node b "B"',
    'edge m1 a -> b "1"',
    'state s "S" m1',
    'layout root sequence',
  ].join('\n');
  await s.openExampleSession('framed', 'Framed', source);
  s.chooseTheme('ink');
  for (let i = 0; i < 20 && s.fileCompiling(); i++)
    await new Promise(resolve => setTimeout(resolve, 0));
  const saved = s.currentSource();
  expect(saved).toContain('theme ink');
  for (const line of source.split('\n')) expect(saved).toContain(line);
  s.undo();
  for (let i = 0; i < 20 && s.fileCompiling(); i++)
    await new Promise(resolve => setTimeout(resolve, 0));
  expect(s.currentSource().trim()).toBe(source);
});

it('draws typed source, keeps the last valid drawing for a broken line, and undoes one step', async () => {
  const s = session();
  const source = 'diagram "Typed" version=1\nnode a "Start"\nnode b "End"\nedge ab a -> b\n';
  await s.openExampleSession('typed', 'Typed', source);
  const title = (id: string) => s.doc.graph.nodes.find(n => n.id === id)?.title;

  await s.typeSource(source.replace('"Start"', '"Sta"'), 1);
  const typed = source.replace('"Start"', '"Started"');
  await s.typeSource(typed, 1);
  expect(title('a')).toBe('Started');
  expect(s.currentSource()).toBe(typed);

  const broken = `${typed}edge bad a -> nowhere\n`;
  await s.typeSource(broken, 1);
  expect(s.sourceError()?.line).toBe(5);
  expect(s.sourceDraft()).toBe(broken);
  expect(s.currentSource()).toBe(typed);
  expect(title('a')).toBe('Started');

  await s.typeSource(typed, 1);
  expect(s.sourceError()).toBeNull();
  expect(s.sourceDraft()).toBeNull();

  // Both valid texts typed in one focus of the panel undo together.
  s.undo();
  for (let i = 0; i < 20 && s.fileCompiling(); i++)
    await new Promise(resolve => setTimeout(resolve, 0));
  expect(s.currentSource()).toBe(source);
  expect(title('a')).toBe('Start');
});
