// Shared by every framework example: three diagrams on one page.
export const sources = [
  'diagram "Alpha" version=1\nnode web "Alpha web"\nnode api "Alpha API"\nedge e1 web -> api "calls"\nsize api width=200 height=auto min-height=96\n',
  'diagram "Beta" version=1\nnode queue "Beta queue"\nnode worker "Beta worker"\nedge e1 queue -> worker "feeds"\n',
  'diagram "Gamma" version=1\nnode user "Gamma user"\nnode app "Gamma app"\nedge e1 user -> app "opens"\n',
];
export const updated = sources[0].replace('Alpha API', 'Updated API');

/** Test hook: each editor's reported sources, by index. */
export const recordChange = (i, source) => {
  const all = (globalThis.__changes ??= [[], []]);
  all[i].push(source);
};

/** Test hook: count each host event the wrappers deliver through their event props. */
export const recordEvent = name => {
  const all = (globalThis.__events ??= {});
  all[name] = (all[name] ?? 0) + 1;
};

/** Test hook: the first diagram's element, from the wrapper's ref or binding. */
export const recordElement = el => {
  if (el) globalThis.__first = el;
};

/** Options as a new object on every render; the element must not re-mount for it. */
export const viewerOptions = () => ({ toolbar: false });
export const editorOptions = () => ({ onInteract: () => recordEvent('interact') });

/**
 * Slot content for the first diagram: a body on each card's node, a badge over api, and a slot
 * for an ID the drawing lacks. `slotUpdate` drops web, adds cache and relabels api's card.
 */
export const cards = [
  { id: 'web', label: 'Web card' },
  { id: 'api', label: 'API card' },
];
export const slotSource =
  'diagram "Alpha" version=1\nnode cache "Alpha cache"\nnode api "Alpha API"\nedge e1 cache -> api "reads"\nsize api width=200 height=auto min-height=96\n';
export const slotCards = [
  { id: 'api', label: 'API card 2' },
  { id: 'cache', label: 'Cache card' },
];

/** Test hook: clicks on the marked button inside a body. */
export const recordClick = () => {
  globalThis.__clicks = (globalThis.__clicks ?? 0) + 1;
};
