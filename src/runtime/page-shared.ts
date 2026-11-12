/**
 * What every viewer on a page shares: a small pool of render workers and one font registry. A
 * page with 20 diagrams starts at most `POOL_SIZE` workers and loads each font face once.
 */
import type { RenderOptions, RenderResult } from './types';

type Reply = { id: number; result: RenderResult };
type Job = {
  id: number;
  source: string;
  options: RenderOptions;
  timeoutMs: number;
  resolve: (result: RenderResult) => void;
  reject: (error: Error) => void;
};
/** `last`: the viewer this worker drew most recently; its layout cache is warm for it. */
type Slot = { worker: Worker; job?: Job; timer?: number; idle?: number; last?: string };
type Pool = { slots: Slot[]; queue: Job[] };

/** Workers per page: diagrams draw in parallel, and the page keeps a core for itself. */
const POOL_SIZE = Math.max(
  1,
  Math.min(4, ((globalThis.navigator?.hardwareConcurrency as number | undefined) || 2) - 1),
);
/** A worker with no job for this long ends; the next update starts a new one. */
const IDLE_MS = 30_000;
const pools = new Map<(() => Worker) | undefined, Pool>();
let nextId = 0;

/** Names the worker and the usual fix, so "worker failed" is not a dead end. */
export const WORKER_HELP =
  "The worker is the module next to @draftably/runtime's viewer. With Vite 5–7, add optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] } to vite.config.";

const defaultWorker = () =>
  new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });

/** Stop one worker. Only its own job fails; queued jobs go to another worker. */
function stop(pool: Pool, slot: Slot, error?: Error) {
  pool.slots.splice(pool.slots.indexOf(slot), 1);
  clearTimeout(slot.timer);
  clearTimeout(slot.idle);
  slot.worker.terminate();
  const job = slot.job;
  slot.job = undefined;
  if (job && error) job.reject(error);
}

function start(create: (() => Worker) | undefined, pool: Pool): Slot {
  let worker: Worker;
  try {
    worker = (create ?? defaultWorker)();
  } catch (error) {
    throw new Error(
      `Viewer render worker could not start${error instanceof Error ? `: ${error.message}` : ''}. ${WORKER_HELP}`,
      { cause: error },
    );
  }
  const slot: Slot = { worker };
  pool.slots.push(slot);
  worker.addEventListener('message', (event: MessageEvent<Reply>) => {
    const job = slot.job;
    if (!job || event.data?.id !== job.id) return;
    clearTimeout(slot.timer);
    slot.job = undefined;
    job.resolve(event.data.result);
    slot.idle = setTimeout(() => stop(pool, slot), IDLE_MS) as unknown as number;
    dispatch(create, pool);
  });
  worker.addEventListener('error', event => {
    event.preventDefault();
    stop(
      pool,
      slot,
      new Error(`${event.message || 'Viewer render worker failed.'} ${WORKER_HELP}`),
    );
    dispatch(create, pool);
  });
  worker.addEventListener('messageerror', () => {
    stop(pool, slot, new Error('Viewer render worker returned an unreadable result.'));
    dispatch(create, pool);
  });
  return slot;
}

/**
 * Give queued jobs to free workers, starting workers up to `POOL_SIZE`. A job goes back to the
 * worker that last drew its viewer when that one is free, then to a new worker, then to any.
 */
function dispatch(create: (() => Worker) | undefined, pool: Pool) {
  while (pool.queue.length) {
    const key = pool.queue[0].options.idPrefix;
    let slot = pool.slots.find(s => !s.job && s.last === key);
    if (!slot && pool.slots.length >= POOL_SIZE) slot = pool.slots.find(s => !s.job);
    if (!slot && pool.slots.length < POOL_SIZE) {
      try {
        slot = start(create, pool);
      } catch (error) {
        for (const job of pool.queue.splice(0)) job.reject(error as Error);
        return;
      }
    }
    if (!slot) return;
    const job = pool.queue.shift()!;
    clearTimeout(slot.idle);
    slot.job = job;
    slot.last = key;
    // The timeout counts from dispatch, so a job that waited in the queue is not cut short.
    const busy = slot;
    slot.timer = setTimeout(() => {
      stop(pool, busy, new Error('Viewer render worker timed out.'));
      dispatch(create, pool);
    }, job.timeoutMs) as unknown as number;
    slot.worker.postMessage({ id: job.id, source: job.source, options: job.options });
  }
}

/**
 * Render in the page's worker pool. Jobs queue on the main thread; an aborted job leaves the
 * queue before a worker sees it. A job that runs past `timeoutMs` stops its worker only.
 */
export function renderInWorker(
  source: string,
  options: RenderOptions,
  {
    create,
    timeoutMs = 5000,
    signal,
  }: { create?: () => Worker; timeoutMs?: number; signal?: AbortSignal },
): Promise<RenderResult> {
  return new Promise((resolve, reject) => {
    const pool = pools.get(create) ?? { slots: [], queue: [] };
    pools.set(create, pool);
    let settled = false;
    const settle = () => {
      settled = true;
      signal?.removeEventListener('abort', abort);
    };
    const job: Job = {
      id: ++nextId,
      source,
      options,
      timeoutMs,
      resolve: result => settled || (settle(), resolve(result)),
      reject: error => settled || (settle(), reject(error)),
    };
    const abort = () => {
      const at = pool.queue.indexOf(job);
      if (at >= 0) pool.queue.splice(at, 1);
      // A job already in a worker finishes there; its result is dropped.
      job.reject(new Error('Viewer render was aborted.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    pool.queue.push(job);
    dispatch(create, pool);
  });
}

type Face = { face: FontFace; refs: number };
const fonts = new WeakMap<Document, Map<string, Face>>();

/** The page's registered face for `key`, if any. */
export const sharedFace = (doc: Document, key: string) => fonts.get(doc)?.get(key)?.face;

/** Take a reference to `face` under `key`, adding it to the page on first use. */
export function retainFace(doc: Document, key: string, face: FontFace) {
  const page = fonts.get(doc) ?? new Map<string, Face>();
  fonts.set(doc, page);
  const held = page.get(key);
  if (held) return void held.refs++;
  doc.fonts.add(face);
  page.set(key, { face, refs: 1 });
}

/** Drop a reference; the last one removes the face from the page. */
export function releaseFace(doc: Document, key: string) {
  const page = fonts.get(doc),
    held = page?.get(key);
  if (!held || --held.refs > 0) return;
  doc.fonts.delete(held.face);
  page!.delete(key);
}

/** Tests only: stop every worker and forget every face, as a new page would. */
export function resetPageShared() {
  for (const pool of pools.values()) {
    pool.queue.length = 0;
    for (const slot of [...pool.slots]) stop(pool, slot);
  }
  pools.clear();
  fonts.delete(globalThis.document);
}
