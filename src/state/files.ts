/** Opening, importing and exporting diagrams and images. */
import { batch, createSignal } from 'solid-js';
import { detectSource } from '../import/detect';
import { keepImportedSource } from '../import/scratch';
import { isLegacyDiagram } from '../model/document';
import { clamp } from '../model/geometry';
import { resolveAppearance } from '../model/appearance';
import { headingMarkup } from '../model/heading';
import { footnoteMarkup } from '../model/footnote';
import { legendMarkup } from '../model/legend';
import { renderSvg } from '../cli/svg';
import { findNode } from '../model/graph';
import { fontFaceCss } from '../lib/font-data';
import {
  createSvgElement,
  downloadBlob,
  downloadText,
  materializeSvg,
  serializeSvg,
  svgToPng,
  fileName,
} from '../lib/svg-export';
import { embedPngSource, readImageSource, embedSvgSource } from '../model/embed';
import { inlineSources } from '../dsl/inline-sources';
import { exportHref } from './links';
import { drawingBounds } from '../model/bounds';
import { FRAME_PAD } from '../model/frame';
import { toast } from './toast';
import { confirmAction, openDialog, showError } from './ui';
import type { PdfOptions } from '../cli/pdf';
import { activeSession } from './active-session';

const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;

/** How PNG, SVG and copied images look. The last choice is remembered in this browser. */
export interface ExportLook {
  /** PNG pixels per drawing pixel. */
  scale: number;
  /** Leave out the canvas color behind the drawing. */
  transparent: boolean;
  /** Draw the title, subtitle and key round the drawing. */
  heading: boolean;
  /** Carry the open file's `.draft` source. */
  source: boolean;
}

const LOOK_KEY = 'draftably-export-look';
const [exportLook, setLook] = createSignal<ExportLook>({
  scale: 2,
  transparent: false,
  heading: true,
  source: true,
  ...(() => {
    try {
      return JSON.parse(localStorage.getItem(LOOK_KEY) ?? '{}');
    } catch {
      return {};
    }
  })(),
});
export { exportLook };

export function setExportLook(patch: Partial<ExportLook>) {
  setLook({ ...exportLook(), ...patch });
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(exportLook()));
  } catch {
    // Storage is off; the choice lasts for this page.
  }
}

/** The `.draft` source to put in an export, or undefined when there is none to carry. */
/** The source an export carries, with each `src=` code node's file inlined. */
const exportSource = (look = exportLook()) =>
  activeSession().fileMode() && look.source
    ? inlineSources(activeSession().currentSource(), activeSession().codeFiles())
    : undefined;

/** Space round the selected objects when only they are exported. */
const SELECTION_MARGIN = 24;

/**
 * Open a PNG or SVG export that carries `.draft` source as a new scratch diagram, which the
 * example bar offers to save as a file. Resolves false when the image carries no source.
 */
export async function openImageSource(file: File) {
  if (!/\.(png|svg)$/i.test(file.name) && !/^image\/(png|svg\+xml)$/.test(file.type)) return false;
  const source = await readImageSource(new Uint8Array(await file.arrayBuffer()));
  if (source === null) return false;
  await activeSession().settleSave();
  // Named after the diagram's title, since a pasted image is just "image.png".
  const title = /^diagram\s+"([^"]*)"/m.exec(source)?.[1] ?? file.name.replace(/\.[^.]+$/, ''),
    name =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'diagram';
  history.pushState(null, '', location.pathname);
  activeSession().clearSelection();
  activeSession().setDoc('collapsed', []);
  await activeSession().openExampleSession(name, title || name, source);
  activeSession().fitView();
  toast('Opened the diagram in ' + (file.name || 'the pasted image'));
  return true;
}

/** The `<g>` that holds the active session's drawn diagram. */
const sceneElement = () =>
  activeSession().canvasElement()?.querySelector<SVGGElement>('g.scene') ?? undefined;
export const sceneReady = () => !!sceneElement();

export const filename = (extension: string) => fileName(activeSession().doc.title, extension);

/** Open diagram JSON, an editable SVG export, or a saved layout timeline. */
export async function importText(text: string, name = '') {
  const trimmed = text.trim();
  let data;
  if (trimmed.startsWith('<')) {
    const xml = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
    if (xml.querySelector('parsererror')) throw Error('This SVG is not valid XML.');
    const metadata = xml.querySelector('metadata#diagram-studio-data');
    if (!metadata)
      throw Error('Use an SVG exported by draftably. Other SVGs are not editable diagrams.');
    data = JSON.parse(metadata.textContent || '');
  } else if (trimmed.startsWith('{')) data = JSON.parse(trimmed);
  else throw Error('Open a saved JSON diagram or an exported, editable SVG.');
  if (data.kind === 'diagram-studio-journey') return activeSession().importTimeline(data);
  const legacy = isLegacyDiagram(data),
    needsLayout =
      !data.layout?.nodes &&
      !data.views?.some(
        (v: { layout?: { nodes?: object } }) => Object.keys(v.layout?.nodes || {}).length,
      );
  activeSession().openDocument(data, { label: 'Import diagram' });
  if (needsLayout) await activeSession().runLayout({ fit: true });
  toast(
    legacy
      ? 'Imported the active v1 diagram. The original file is unchanged.'
      : 'Opened ' + (name || 'diagram'),
  );
}

/** Embed an image as a new shape, or replace the image in an existing one. */
export async function insertImage(file: File, replaceId: string | null = null) {
  // A draftably export opens as the diagram it was drawn from.
  if (!replaceId && (await openImageSource(file))) return;
  if (!IMAGE_TYPES.test(file.type))
    throw Error(
      'Use a PNG, JPEG, WebP, or GIF image. SVG files are imported only as editable diagrams.',
    );
  if (file.size > 20 * 1024 * 1024) throw Error('Use an image smaller than 20 MB.');
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = url;
  await image.decode();
  // Large images are downscaled so the diagram stays small enough to save in the browser.
  const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.92),
    w = Math.min(300, canvas.width),
    h = clamp((w * canvas.height) / canvas.width, 32, 400);
  if (replaceId && findNode(activeSession().doc, replaceId)) {
    activeSession().transact('Replace image', d => {
      findNode(d, replaceId)!.image = data;
      (d.styles[replaceId] ||= { shape: 'image', color: 'slate', icon: '' }).shape = 'image';
      d.layout.nodes[replaceId].w = w;
      d.layout.nodes[replaceId].h = h;
    });
  } else
    activeSession().addNode({
      title: file.name.replace(/\.[^.]+$/, '') || 'Image',
      image: data,
      style: { shape: 'image', icon: '', color: 'slate' },
      w,
      h,
    });
  toast('Image embedded · no external file required');
}

export async function openFile(file: File | undefined, replaceImageId: string | null = null) {
  if (!file) return;
  if (!replaceImageId && (await openImageSource(file))) return;
  if (IMAGE_TYPES.test(file.type)) return insertImage(file, replaceImageId);
  if (file.size > 24 * 1024 * 1024) throw Error('Use a diagram smaller than 24 MB.');
  const text = await file.text();
  const detected = detectSource(text, { filename: file.name });
  if (detected.status === 'detected' && ['dot', 'mermaid', 'd2'].includes(detected.format)) {
    await importForeignText(text, file.name);
    return;
  }
  if (detected.status === 'choose-fence')
    throw Error('This file has more than one diagram. Open one diagram at a time.');
  await importText(text, file.name);
}

let importRequest = 0;

/** Convert before switching files; failed or cancelled imports leave the current work in place. */
export async function importForeignText(text: string, name = '') {
  const request = ++importRequest;
  activeSession().prepareForEdit();
  await activeSession().settleSave();
  if (
    activeSession().fileMode() &&
    !activeSession().exampleMode() &&
    activeSession().fileStatus() !== 'saved'
  )
    throw Error('Resolve the current file’s save status before importing another diagram.');
  const address = location.href;
  const original = activeSession().fileMode()
    ? activeSession().currentSource()
    : activeSession().snapshot();
  const { importBrowser } = await import('../import/browser');
  const result = await importBrowser(text, name);
  if (request !== importRequest) return;
  const errors = result.diagnostics.filter(item => item.severity === 'error');
  if (!result.nativeSource || errors.length)
    throw Error(errors.map(item => item.message).join('\n') || 'Could not import this diagram.');
  const source = result.nativeSource;
  const open = async () => {
    await activeSession().settleSave();
    if (
      request !== importRequest ||
      location.href !== address ||
      (activeSession().fileMode()
        ? activeSession().currentSource()
        : activeSession().snapshot()) !== original
    )
      throw Error('The current diagram changed during import. Import again to continue.');
    if (
      activeSession().fileMode() &&
      !activeSession().exampleMode() &&
      activeSession().fileStatus() !== 'saved'
    )
      throw Error('Resolve the current file’s save status before importing another diagram.');
    const id = keepImportedSource(source);
    location.assign(`${location.pathname}?import=${encodeURIComponent(id)}`);
  };
  const warnings = result.diagnostics.filter(item => item.severity === 'warning');
  if (warnings.length) {
    confirmAction({
      title: 'Review import changes',
      message: warnings.map(item => item.message).join('\n'),
      confirmLabel: 'Open imported diagram',
      onConfirm: () =>
        void open().catch(error =>
          showError(error instanceof Error ? error.message : String(error)),
        ),
    });
  } else await open();
}

/**
 * Editable SVG: the drawing plus the full diagram in a metadata element. With `onlySelection` and
 * something selected, the image is cropped to the selected objects with a margin and no heading.
 */
export function exportSvg(look = exportLook(), onlySelection = false): string {
  activeSession().finishInlineEdit(true);
  // A comparison draws each version as its own panel, which the canvas does not show.
  const source = exportSource(look),
    carry = (svg: string) => (source === undefined ? svg : embedSvgSource(svg, source));
  if (activeSession().doc.appearance.compare) {
    const svg = renderSvg(activeSession().doc);
    return (
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      carry(look.transparent ? svg.replace(/(<\/defs>)\s*<rect[^>]*\/>/, '$1') : svg)
    );
  }
  const picked = onlySelection ? activeSession().selection() : new Set<string>();
  const world = sceneElement();
  if (!world) throw Error('The canvas is not ready.');
  const previousSelection = activeSession().selection(),
    previousConnect = activeSession().connectFrom();
  // Clearing the selection removes handles and rings before the DOM is copied.
  batch(() => {
    activeSession().setSelection([]);
    activeSession().setConnectFrom(null);
  });
  try {
    const theme = resolveAppearance(activeSession().doc.appearance),
      frame = activeSession().viewerFrame(),
      vg = activeSession().visibleScene();
    // The frame as the viewer draws it; the drawing alone without the heading; or the selection.
    const { x, y, w, h } = picked.size
      ? drawingBounds(
          activeSession().doc,
          {
            ...vg,
            nodes: vg.nodes.filter(n => picked.has(n.id)),
            groups: vg.groups.filter(g => picked.has(g.id)),
          },
          activeSession().sceneRects(),
          activeSession()
            .routes()
            .filter(r => picked.has(r.id)),
          SELECTION_MARGIN,
        )
      : look.heading
        ? frame
        : drawingBounds(
            activeSession().doc,
            vg,
            activeSession().sceneRects(),
            activeSession().routes(),
            FRAME_PAD,
          );
    const svg = createSvgElement('svg', {
      xmlns: 'http://www.w3.org/2000/svg',
      width: Math.ceil(w),
      height: Math.ceil(h),
      viewBox: `${x} ${y} ${w} ${h}`,
      role: 'img',
    });
    const title = createSvgElement('title');
    title.textContent = activeSession().doc.title;
    const meta = createSvgElement('metadata', { id: 'diagram-studio-data' });
    meta.textContent = activeSession().snapshot();
    // The drawing's own canvas and fonts, so the file renders the same without the app.
    const defs = createSvgElement('defs'),
      style = createSvgElement('style');
    style.textContent = fontFaceCss(
      theme,
      activeSession().doc.graph.nodes.some(n => n.code),
    );
    defs.append(style);
    svg.append(title, meta, defs);
    if (!look.transparent)
      svg.append(createSvgElement('rect', { x, y, width: w, height: h, fill: theme.canvas }));
    svg.appendChild(materializeSvg(world, href => exportHref(activeSession(), href)));
    // The key from the file's legend lines goes under the drawing, as in `inspect --svg`.
    const markup =
      picked.size || !look.heading
        ? ''
        : headingMarkup(
            theme,
            activeSession().doc.appearance.heading,
            frame.heading.x,
            frame.heading.y,
            frame.heading.wrap,
          ) +
          footnoteMarkup(theme, frame.foot, frame.foot.x, frame.foot.y, href =>
            exportHref(activeSession(), href),
          ) +
          legendMarkup(theme, frame.key, frame.legend.x, frame.legend.y);
    if (markup) {
      const parsed = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
        'image/svg+xml',
      );
      svg.append(
        ...[...parsed.documentElement.childNodes].map(n => svg.ownerDocument.importNode(n, true)),
      );
    }
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + carry(serializeSvg(svg));
  } finally {
    batch(() => {
      activeSession().setSelection(previousSelection);
      activeSession().setConnectFrom(previousConnect);
    });
  }
}

/** The files the PDF dialog starts with checked, in order. */
const [pdfFiles, setPdfFiles] = createSignal<string[]>([]);
export { pdfFiles };

/** Open the export dialog on PDF with `paths` chosen. */
export function openPdfExport(paths: string[]) {
  setPdfFiles(paths);
  setExportKind('pdf');
  openDialog('export');
}

/**
 * Ask the server for one PDF of `paths` in order, as `draftably pdf` makes it, and download it.
 * Throws with the server's message, such as the file whose errors stopped the export.
 */
export async function exportPdf(paths: string[], opts: PdfOptions) {
  await activeSession().settleSave();
  const res = await fetch('./api/workspace/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: paths, order: 'given', ...opts }),
  });
  if (!res.ok) throw Error(((await res.json()) as { error: string }).error);
  const base =
    opts.title || (paths.length === 1 ? paths[0].replace(/^.*\/|\.draft$/g, '') : 'diagrams');
  downloadBlob(
    await res.blob(),
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + '.pdf',
  );
  toast(`Exported ${paths.length === 1 ? '1 diagram' : `${paths.length} diagrams`} as PDF`);
}

export type ExportFormat = 'json' | 'svg' | 'png';

/** `svg` as a PNG at the look's scale, carrying the file's source when the look keeps it. */
async function pngOf(svg: string, look: ExportLook) {
  const png = await svgToPng(svg, look.scale),
    source = exportSource(look);
  if (source === undefined) return png;
  const bytes = await embedPngSource(new Uint8Array(await png.arrayBuffer()), source);
  return new Blob([bytes as BlobPart], { type: 'image/png' });
}

export async function exportDocument(
  format: ExportFormat,
  look = exportLook(),
  onlySelection = false,
) {
  activeSession().finishInlineEdit(true);
  if (format === 'json')
    downloadText(
      JSON.stringify(JSON.parse(activeSession().snapshot()), null, 2),
      filename('json'),
      'application/json',
    );
  else if (format === 'svg')
    downloadText(exportSvg(look, onlySelection), filename('svg'), 'image/svg+xml');
  else downloadBlob(await pngOf(exportSvg(look, onlySelection), look), filename('png'));
  toast(format.toUpperCase() + ' export created');
}

/** What Copy puts on the clipboard: every format at once, or one thing as text. */
export type CopyAs = 'image' | 'svg' | 'source' | 'link';

/** Clipboard formats, richest first, with the word the toast uses for each. */
const FORMATS: [string, string][] = [
  ['image/png', 'PNG'],
  ['image/svg+xml', 'SVG'],
  ['web image/svg+xml', 'SVG'],
  ['text/html', 'HTML'],
  ['text/plain', 'text'],
];

const and = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0];

const blobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });

/**
 * Copy the diagram, or the selection when something is selected. `image` writes one clipboard item
 * with PNG, SVG, HTML and the SVG markup as text, so the app it is pasted into takes the format it
 * reads; a browser that refuses some of them gets the richest set it accepts, down to PNG alone.
 * The other kinds copy one thing as text.
 */
export async function copyImage(kind: CopyAs = 'image', look = exportLook(), onlySelection = true) {
  activeSession().finishInlineEdit(true);
  const clip = navigator.clipboard;
  if (kind === 'source') {
    const source = activeSession().currentSource();
    if (source == null) throw Error('Only a diagram file has .draft source to copy.');
    await clip.writeText(source);
    return toast('Copied the .draft source');
  }
  if (kind === 'link') {
    await clip.writeText(location.href);
    return toast('Copied a link to this diagram');
  }
  const part = onlySelection && activeSession().selection().size > 0,
    svg = exportSvg(look, part),
    what = part ? 'the selection' : '';
  if (kind === 'svg') {
    await clip.writeText(svg);
    return toast(`Copied ${what || 'the diagram'} as SVG markup`);
  }
  const png = pngOf(svg, look);
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) ?? [];
  const blobs: Record<string, Promise<Blob>> = {
    'image/png': png,
    'image/svg+xml': Promise.resolve(new Blob([svg], { type: 'image/svg+xml' })),
    'web image/svg+xml': Promise.resolve(new Blob([svg], { type: 'image/svg+xml' })),
    'text/html': png.then(
      async b =>
        new Blob(
          [
            `<img src="${await blobText(b)}" width="${w}" height="${h}" alt="${activeSession().doc.title.replace(/"/g, '&quot;')}">`,
          ],
          { type: 'text/html' },
        ),
    ),
    'text/plain': Promise.resolve(new Blob([svg], { type: 'text/plain' })),
  };
  const supports = (type: string) =>
    typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports(type);
  let failure: unknown;
  for (const drop of [
    [],
    ['web image/svg+xml'],
    ['image/svg+xml', 'web image/svg+xml'],
    FORMATS.slice(1).map(f => f[0]),
  ]) {
    const types = FORMATS.map(f => f[0]).filter(t => supports(t) && !drop.includes(t));
    try {
      await clip.write([new ClipboardItem(Object.fromEntries(types.map(t => [t, blobs[t]])))]);
      const words = [...new Set(FORMATS.filter(f => types.includes(f[0])).map(f => f[1]))];
      return toast(`Copied ${what ? what + ' ' : ''}as ${and(words)}`);
    } catch (error) {
      failure = error;
    }
  }
  throw failure instanceof Error && failure.name !== 'NotAllowedError'
    ? failure
    : Error(
        'The browser blocked the clipboard. Allow clipboard access for this page and copy again.',
      );
}

/** Formats the export dialog makes. */
export type ExportKind = 'png' | 'svg' | 'pdf' | 'copy';
const [exportKind, setExportKind] = createSignal<ExportKind>('png');
export { exportKind, setExportKind };

/** Open the export dialog on `kind`. */
export function openExport(kind: ExportKind) {
  setExportKind(kind);
  const file = activeSession().fileSession()?.file;
  // The PDF tab starts with the open file checked, whichever tab the dialog opens on.
  setPdfFiles(file ? [file] : []);
  openDialog('export');
}
