/**
 * One local `.draft` file shared by the viewer and anyone editing it on disk.
 *
 * The session owns the path: it serves the source with a content revision, watches the folder
 * (so editors that save by renaming a temporary file are seen), pushes changes to the viewer over
 * server-sent events, and writes viewer saves atomically. A save based on an older revision is
 * refused, so neither writer silently erases the other's work.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { checkSource } from '../dsl/compile';
import { DslError } from '../dsl/syntax';
import type { CodeFiles } from '../model/code-src';
import { codeFolders, readCodeFiles } from './code-files';

export interface SessionInfo {
  name: string;
  path: string;
  source: string;
  revision: string;
  /** Where the file's relative links start: its git root, or its folder outside a repository. */
  root: string;
  /** The files its `src=` code nodes name, read from beside it. */
  files: CodeFiles;
}

/** The nearest folder at or above `dir` that holds `.git`, or `dir` when there is none. */
export function gitRoot(dir: string) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return dir;
  }
}

export const revisionOf = (source: string) =>
  createHash('sha256').update(source).digest('hex').slice(0, 16);

export interface FileSession {
  readonly file: string;
  /** Handle `/api/...` requests. Returns false for anything else. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
  close(): void;
}

/**
 * `served` is the folder the viewer serves: `src=` files outside it are refused. It defaults to
 * the file's git root.
 */
export function createFileSession(file: string, served?: string): FileSession {
  file = path.resolve(file);
  if (!fs.existsSync(file)) throw Error(`No such file: ${file}`);
  const dir = path.dirname(file),
    name = path.basename(file),
    root = gitRoot(dir);
  served = path.resolve(served ?? root);
  let source = fs.readFileSync(file, 'utf8'),
    revision = revisionOf(source),
    files: CodeFiles = {},
    filesKey = '';
  const clients = new Set<ServerResponse>();
  const send = (event: string, body: unknown) => {
    const data = JSON.stringify(body);
    for (const res of clients) res.write(`event: ${event}\ndata: ${data}\n\n`);
  };

  const broadcast = () => {
    readFiles();
    send('source', { source, revision, files });
  };

  // The folders of the files `src=` names are watched too, so editing one redraws the viewer.
  const codeWatchers = new Map<string, fs.FSWatcher>();
  let codeTimer: NodeJS.Timeout | undefined;
  /** Read the `src=` files again and follow their folders. True when any text changed. */
  function readFiles() {
    files = readCodeFiles(source, file, served!);
    const folders = new Set(codeFolders(source, file, served!).filter(d => d !== dir));
    for (const [d, w] of codeWatchers)
      if (!folders.has(d)) {
        w.close();
        codeWatchers.delete(d);
      }
    for (const d of folders) {
      if (codeWatchers.has(d) || !fs.existsSync(d)) continue;
      // A folder that cannot be watched (EACCES, ENOSPC) only loses live redraws.
      try {
        const w = fs.watch(d, () => {
          clearTimeout(codeTimer);
          codeTimer = setTimeout(checkFiles, 40);
        });
        w.on('error', () => {
          w.close();
          codeWatchers.delete(d);
        });
        codeWatchers.set(d, w);
      } catch {
        // Not watched; the file is still read on each change to the .draft.
      }
    }
    const key = JSON.stringify(files),
      changed = key !== filesKey;
    filesKey = key;
    return changed;
  }
  const checkFiles = () => {
    if (readFiles()) send('files', { files, revision });
  };
  readFiles();

  // Writes made here already updated `revision`, so their watcher events are ignored.
  let timer: NodeJS.Timeout | undefined;
  const check = () => {
    let next: string;
    try {
      next = fs.readFileSync(file, 'utf8');
    } catch {
      return; // Mid-replacement; the rename event follows.
    }
    const nextRevision = revisionOf(next);
    if (nextRevision === revision) return;
    source = next;
    revision = nextRevision;
    broadcast();
  };
  const watcher = fs.watch(dir, (_event, changed) => {
    // A `src=` file beside the .draft changed.
    if (changed && changed !== name) {
      if (!Object.keys(files).length) return;
      clearTimeout(codeTimer);
      codeTimer = setTimeout(checkFiles, 40);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(check, 40);
  });
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': keep-alive\n\n');
  }, 20_000);

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const save = (body: string, res: ServerResponse) => {
    let request: { source?: unknown; base?: unknown };
    try {
      request = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Expected JSON.' });
    }
    if (typeof request.source !== 'string' || typeof request.base !== 'string')
      return json(res, 400, { error: 'Expected { source, base }.' });
    check(); // Catch an external change the watcher has not reported yet.
    if (request.base !== revision)
      return json(res, 409, { error: 'The file changed on disk.', source, revision });
    try {
      checkSource(request.source);
    } catch (error) {
      if (error instanceof DslError)
        return json(res, 422, { error: error.message, line: error.line });
      throw error;
    }
    const temporary = path.join(dir, `.${name}.${process.pid}.tmp`);
    try {
      fs.writeFileSync(temporary, request.source);
      source = request.source;
      revision = revisionOf(source);
      fs.renameSync(temporary, file);
    } catch (error) {
      fs.rmSync(temporary, { force: true });
      source = fs.readFileSync(file, 'utf8');
      revision = revisionOf(source);
      return json(res, 500, { error: `Could not write ${name}: ${(error as Error).message}` });
    }
    readFiles();
    json(res, 200, { revision, files });
  };

  return {
    file,
    handle(req, res) {
      const url = (req.url ?? '').split('?')[0];
      if (url === '/api/session' && req.method === 'GET') {
        check();
        checkFiles();
        json(res, 200, {
          name,
          path: file,
          source,
          revision,
          root,
          files,
        } satisfies SessionInfo);
      } else if (url === '/api/source' && req.method === 'PUT') {
        let body = '';
        req.setEncoding('utf8');
        req.on('data', chunk => (body += chunk));
        req.on('end', () => save(body, res));
      } else if (url === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write(': connected\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
      } else return false;
      return true;
    },
    close() {
      watcher.close();
      for (const w of codeWatchers.values()) w.close();
      clearInterval(heartbeat);
      clearTimeout(timer);
      clearTimeout(codeTimer);
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}
