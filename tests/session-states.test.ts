import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// Imported with the file: loading the session's modules can take seconds under a full suite.
import { createDiagramSession } from '../src/state/session';

// Two states a reader picks from, and two a host steps through itself.
const STATES = `diagram "Steps" version=1
node a "Alpha"
node b "Beta"
node c "Gamma"
edge ab a -> b
edge bc b -> c
state write "Write" a b
state step1 "Step 1" a chips=hidden
state step2 "Step 2" b c chips=hidden
state read "Read" c
`;

beforeAll(() => {
  // A session reads the page's motion preference and timers; these tests run without a DOM.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('window', { setTimeout, clearTimeout, open: vi.fn() });
  vi.stubGlobal('document', { title: '', elementFromPoint: () => null });
});
afterAll(() => vi.unstubAllGlobals());

async function open(source = STATES) {
  const s = createDiagramSession({ readOnly: true });
  await s.openSource(source);
  for (let i = 0; i < 40 && s.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
  return s;
}

const focused = (s: Awaited<ReturnType<typeof open>>) =>
  s
    .drawnDoc()
    .graph.nodes.filter(n => s.drawnDoc().styles[n.id]?.spot === 'focus')
    .map(n => n.id);

describe('states hidden from the chips', () => {
  it('lists only the states a reader picks from', async () => {
    const s = await open();
    expect(s.states().map(x => x.id)).toEqual(['write', 'read']);
  });

  it('draws a hidden state when the host shows it', async () => {
    const s = await open();
    s.showState('step2');
    expect(s.activeState()).toBe('step2');
    expect(focused(s)).toEqual(['b', 'c']);
  });

  it('steps through the listed states only, and from a hidden one onto the list', async () => {
    const s = await open(),
      steps: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      s.stepState(1);
      steps.push(s.activeState());
    }
    expect(steps).toEqual(['write', 'read', null]);
    s.showState('step1');
    s.stepState(1);
    expect(s.activeState()).toBe('write');
    s.showState('step1');
    s.stepState(-1);
    expect(s.activeState()).toBe('read');
  });

  it('has nothing to step through when every state is hidden', async () => {
    const s = await open('node a "A"\nstate x "X" a chips=hidden\n');
    expect(s.states()).toEqual([]);
    expect(s.stepState(1)).toBe(false);
  });
});

describe('notes per state on the canvas', () => {
  const NOTED =
    STATES +
    'note always "Everywhere." near=a\n' +
    'note s1 "Step one only." near=a states=step1\n' +
    'note w "Write only." near=c states=write\n';
  const shown = (s: Awaited<ReturnType<typeof open>>) =>
    s
      .viewerFrame()
      .notes.filter(n => !n.hidden)
      .map(n => n.note.id);

  it('frames only the notes the drawn state shows, hidden states included', async () => {
    const s = await open(NOTED);
    expect(shown(s)).toEqual(['always']);
    s.showState('step1');
    expect(shown(s)).toEqual(['always', 's1']);
    s.showState('write');
    expect(shown(s)).toEqual(['always', 'w']);
    expect(s.drawnDoc().drawnState).toBe('write');
  });

  it('reveals a note only while it is shown', async () => {
    const s = await open(NOTED);
    s.setStageSize({ width: 800, height: 600 });
    expect(s.reveal('s1')).toBe(false);
    s.showState('step1');
    s.moveCamera({ x: 5000, y: 5000, k: 1 });
    expect(s.reveal('s1')).toBe(true);
  });
});
