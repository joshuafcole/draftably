// Both handles, for `pnpm prove:handles`: a viewer and an editor of one file, side by side.
import '../../src/runtime/viewer.css';
import { mountEditor } from '../../src/editor';
import { mountViewer } from '../../src/runtime/viewer';

const source = `diagram "Camera" version=1
group back "Back end"
node web "Web" href="https://example.com/web"
node api "API"
node db "Database" in=back
node queue "Queue" in=back
node worker "Worker" in=back
edge e1 web -> api
edge e2 api -> db
edge e3 api -> queue
edge e4 queue -> worker
`;

const events: Record<string, Array<{ reason: string; t: number }>> = { viewer: [], editor: [] };
const viewer = mountViewer(document.getElementById('viewer')!, {
  toolbar: false,
  render: { links: { mode: 'safe' } },
});
const editor = mountEditor(document.getElementById('editor')!, { source });
viewer.on('camera', e => events.viewer.push({ reason: e.reason, t: performance.now() }));
const log: Record<string, unknown[]> = { render: [], select: [], contextmenu: [], link: [] };
viewer.on('render', e => log.render.push({ revision: e.revision, geometry: e.geometry }));
viewer.on('contextmenu', e => log.contextmenu.push({ side: 'viewer', id: e.id, kind: e.kind }));
viewer.on('link', e => {
  e.preventDefault();
  log.link.push(e.href);
});
editor.on('select', e => log.select.push(e));
editor.on('contextmenu', e => log.contextmenu.push({ side: 'editor', id: e.id, kind: e.kind }));
editor.on('camera', e => events.editor.push({ reason: e.reason, t: performance.now() }));
const hidden = mountViewer(document.getElementById('hidden')!);

Object.assign(window, {
  viewer,
  editor,
  hidden,
  events,
  log,
  ready: Promise.all([viewer.update(source), editor.ready, hidden.update(source)]),
});
