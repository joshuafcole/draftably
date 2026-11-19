/**
 * A folder of `.draft` files served to the viewer by `draftably open`.
 *
 * The workspace lists the diagrams under its root, creates new ones, draws thumbnails of them, and
 * hands each file's
 * `/api/session`, `/api/source` and `/api/events` requests (selected with `?file=`) to that file's
 * own session. Paths are always relative to the root and never leave it.
 */
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { renderSvg } from '../cli/svg';
import { checkSource, compile } from '../dsl/compile';
import { projectScene } from '../dsl/project';
import { DslError } from '../dsl/syntax';
import type { PdfOptions } from '../cli/pdf';
import { readCodeFiles } from './code-files';
import { createFileSession, type FileSession } from './file-session';

export interface WorkspaceFile {
  /** Path relative to the workspace root, with forward slashes. */
  path: string;
  title: string;
  /** The `subtitle` line, when the file has one near its top. */
  subtitle?: string;
  modified: number;
}

export interface WorkspaceInfo {
  name: string;
  root: string;
  files: WorkspaceFile[];
}

/**
 * A Host header naming this machine. A page on another site that rebinds its DNS name to
 * 127.0.0.1 still sends its own name, so its requests for files are refused.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

const SKIP = new Set(['node_modules', 'dist', 'dist-cli', 'build', 'coverage', 'tmp', 'target']);
const MAX_FILES = 400;

/** The quoted text after `word` at the start of a line, e.g. `diagram "Checkout"` → "Checkout". */
const quoted = (word: string, source: string) =>
  new RegExp(`^\\s*${word}\\s+"((?:[^"\\\\]|\\\\.)*)"`, 'm')
    .exec(source)?.[1]
    .replace(/\\(.)/g, '$1') ?? '';

function listFiles(root: string): WorkspaceFile[] {
  const files: WorkspaceFile[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth < 8 && !SKIP.has(entry.name)) walk(full, depth + 1);
      } else if (entry.name.endsWith('.draft')) {
        try {
          const stat = fs.statSync(full);
          const head = fs.readFileSync(full, 'utf8').slice(0, 4000);
          files.push({
            path: path.relative(root, full).split(path.sep).join('/'),
            title: quoted('diagram', head),
            subtitle: quoted('subtitle', head) || undefined,
            modified: stat.mtimeMs,
          });
        } catch {
          // Unreadable files are left out of the list.
        }
      }
    }
  };
  walk(root, 0);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export interface Workspace {
  readonly root: string;
  /** Handle `/api/...` requests. Returns false for anything else. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
  close(): void;
}

export function createWorkspace(root: string): Workspace {
  root = path.resolve(root);
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory())
    throw Error(`No such folder: ${root}`);
  const sessions = new Map<string, FileSession>();
  /** Resolve a relative `.draft` path inside the root, or null when it is not one. */
  const resolve = (relative: unknown) => {
    if (typeof relative !== 'string' || !relative.endsWith('.draft')) return null;
    const full = path.resolve(root, relative);
    return full.startsWith(root + path.sep) ? full : null;
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  /** Thumbnails by file, kept until the file changes. */
  const thumbnails = new Map<string, { modified: number; svg: Promise<string | null> }>();

  /**
   * The file drawn as SVG without its embedded fonts, which a thumbnail does not need. Null when
   * the source does not compile.
   */
  const thumbnail = (full: string, modified: number) => {
    const cached = thumbnails.get(full);
    if (cached?.modified === modified) return cached.svg;
    const source = fs.readFileSync(full, 'utf8');
    const svg = compile(source, readCodeFiles(source, full, root))
      .then(scene => renderSvg(projectScene(scene)).replace(/<style>[\s\S]*?<\/style>/, ''))
      .catch(() => null);
    thumbnails.set(full, { modified, svg });
    return svg;
  };

  const sendThumbnail = async (req: IncomingMessage, res: ServerResponse, full: string) => {
    const modified = fs.statSync(full).mtimeMs;
    const etag = `"${modified}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag });
      return res.end();
    }
    const svg = await thumbnail(full, modified);
    if (!svg) return json(res, 422, { error: 'The diagram does not compile.' });
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-cache', etag });
    res.end(svg);
  };

  const create = (body: string, res: ServerResponse) => {
    let request: { path?: unknown; source?: unknown };
    try {
      request = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Expected JSON.' });
    }
    const full = resolve(request.path);
    if (!full) return json(res, 400, { error: 'Use a .draft path inside this folder.' });
    if (typeof request.source !== 'string') return json(res, 400, { error: 'Expected source.' });
    if (fs.existsSync(full))
      return json(res, 409, { error: `${request.path} already exists. Choose another name.` });
    try {
      checkSource(request.source);
    } catch (error) {
      if (error instanceof DslError) return json(res, 422, { error: error.message });
      throw error;
    }
    try {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, request.source, { flag: 'wx' });
    } catch (error) {
      return json(res, 500, { error: `Could not create the file: ${(error as Error).message}` });
    }
    json(res, 201, { path: path.relative(root, full).split(path.sep).join('/') });
  };

  /** One PDF of the listed files, drawn as `draftably pdf` draws it. */
  const pdf = async (body: string, res: ServerResponse) => {
    let request: { files?: unknown } & PdfOptions;
    try {
      request = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Expected JSON.' });
    }
    const files = Array.isArray(request.files) ? request.files.map(resolve) : [];
    if (!files.length || files.some(f => !f || !fs.existsSync(f)))
      return json(res, 400, { error: 'Choose .draft files inside this folder.' });
    try {
      const { buildPdf } = await import('../cli/pdf');
      const { bytes } = await buildPdf(
        files.map(f => {
          const source = fs.readFileSync(f!, 'utf8');
          return {
            name: path.relative(root, f!).split(path.sep).join('/'),
            source,
            files: readCodeFiles(source, f!, root),
          };
        }),
        request,
      );
      res.writeHead(200, { 'content-type': 'application/pdf', 'cache-control': 'no-store' });
      res.end(bytes);
    } catch (error) {
      json(res, 422, { error: (error as Error).message });
    }
  };

  return {
    root,
    handle(req, res) {
      const [url, query = ''] = (req.url ?? '').split('?');
      if (url.startsWith('/api/') && !LOCAL_HOST.test(req.headers.host ?? '')) {
        json(res, 403, { error: 'The draftably viewer answers localhost only.' });
        return true;
      }
      if (url === '/api/workspace' && req.method === 'GET') {
        json(res, 200, {
          name: path.basename(root),
          root,
          files: listFiles(root),
        } satisfies WorkspaceInfo);
        return true;
      }
      if (
        (url === '/api/workspace/files' || url === '/api/workspace/pdf') &&
        req.method === 'POST'
      ) {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => (body += chunk));
        req.on('end', () => void (url.endsWith('pdf') ? pdf(body, res) : create(body, res)));
        return true;
      }
      const perFile = ['/api/session', '/api/source', '/api/events', '/api/workspace/thumbnail'];
      if (!perFile.includes(url)) return false;
      const relative = new URLSearchParams(query).get('file');
      const full = resolve(relative);
      if (!full || !fs.existsSync(full)) {
        json(res, 404, { error: `No diagram at ${relative ?? '(no file given)'}.` });
        return true;
      }
      if (url === '/api/workspace/thumbnail') {
        void sendThumbnail(req, res, full);
        return true;
      }
      let session = sessions.get(full);
      if (!session) {
        session = createFileSession(full, root);
        sessions.set(full, session);
      }
      return session.handle(req, res);
    },
    close() {
      for (const session of sessions.values()) session.close();
      sessions.clear();
      thumbnails.clear();
    },
  };
}
