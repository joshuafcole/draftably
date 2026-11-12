import {
  ExplorerLab,
  type CandidateResult,
  type CandidateSpec,
  type ComparisonConfig,
} from '../engines/explorer-engine.js';
import { LayoutLab, type LayoutOptions, type LayoutResult } from '../engines/layout-engine.js';
import { SculptLab, type Timeline } from '../engines/sculpt-engine.js';
import {
  RouteLab,
  type RouteInput,
  type RoutingOptions,
  type RoutingResult,
} from '../engines/routing-engine.js';
import { compile, type Scene } from '../dsl/compile';
import { projectScene, type ViewState } from '../dsl/project';
import { routingFingerprint } from '../model/document';
import { frameRect, makeGeometry, visibleGraph } from '../model/graph';
import { computeRoutes } from '../model/routes';
import type { Diagram, Rect } from '../model/types';

export type EngineTask =
  | { kind: 'layout'; doc: Diagram; options: LayoutOptions }
  | { kind: 'candidate'; baseline: Diagram; spec: CandidateSpec; config: ComparisonConfig }
  | { kind: 'timeline'; doc: Diagram; options: LayoutOptions }
  /** A diagram file variant, compiled exactly as the file would be. */
  | { kind: 'source'; source: string; spec: CandidateSpec }
  /** Full-quality routes for a drawing shown meanwhile with quick routes. */
  | { kind: 'route'; input: RouteInput; options: RoutingOptions }
  /** A diagram file compiled: laid out, not routed. */
  | { kind: 'compile'; source: string }
  /** A diagram file compiled, projected with the editor's view and routed, as the viewer shows it. */
  | { kind: 'scene'; source: string; view: ViewState };

/** A compiled file and its routes, keyed by the projected document they were drawn for. */
export interface SceneResult {
  scene: Scene;
  fingerprint: string;
  routing: RoutingResult;
}

export type EngineResult<T extends EngineTask> = T extends { kind: 'layout' }
  ? LayoutResult
  : T extends { kind: 'candidate' | 'source' }
    ? CandidateResult
    : T extends { kind: 'route' }
      ? RoutingResult
      : T extends { kind: 'scene' }
        ? SceneResult
        : T extends { kind: 'compile' }
          ? Scene
          : Timeline;

export function runEngineTask(
  task: EngineTask,
): Promise<LayoutResult | CandidateResult | Timeline | RoutingResult | SceneResult | Scene> {
  if (task.kind === 'scene') return compileScene(task.source, task.view);
  if (task.kind === 'compile') return compiled(task.source);
  if (task.kind === 'layout') return LayoutLab.compute(task.doc, task.options);
  if (task.kind === 'route') return Promise.resolve(RouteLab.compute(task.input, task.options));
  if (task.kind === 'candidate')
    return ExplorerLab.candidate(task.baseline, task.spec, task.config);
  if (task.kind === 'source') return compileCandidate(task.source, task.spec);
  return SculptLab.journey(task.doc, task.options);
}

/** Compile a source variant and route it with no prior routes, as the viewer and CLI do. */
async function compileCandidate(source: string, spec: CandidateSpec): Promise<CandidateResult> {
  const document = projectScene(await compile(source));
  const routing = RouteLab.compute(ExplorerLab.sceneInput(document), {
    ...document.settings.routing,
    previous: [],
  });
  return { spec, document, report: null, routing };
}

/**
 * Recent compiles in this thread. The viewer asks for a file's scene first and then for its
 * routes; the second task reuses the first one's layout.
 */
const recent = new Map<string, Promise<Scene>>();
function compiled(source: string) {
  let scene = recent.get(source);
  if (!scene) {
    scene = compile(source);
    scene.catch(() => recent.delete(source));
    recent.set(source, scene);
    while (recent.size > 4) recent.delete(recent.keys().next().value!);
  }
  return scene;
}

/** Compile, project and route a file exactly as the viewer's scene state would. */
async function compileScene(source: string, view: ViewState): Promise<SceneResult> {
  const scene = await compiled(source),
    document = projectScene(scene, view),
    vg = visibleGraph(document),
    geometry = makeGeometry(document),
    rects = new Map<string, Rect>();
  for (const n of vg.nodes) rects.set(n.id, { ...geometry(n.id) });
  for (const g of vg.groups) rects.set(g.id, frameRect(document, geometry, g.id));
  const { result } = computeRoutes(document, vg, rects, { previous: [] });
  return { scene, fingerprint: routingFingerprint(document), routing: result };
}

// --- One long-lived worker -------------------------------------------------------------------

let shared: Worker | null | undefined;
let nextId = 0;
const waiting = new Map<number, { resolve: (value: never) => void; reject: (e: Error) => void }>();

/**
 * Run a short task in one worker that stays up, so frequent work such as recompiling a file after
 * each edit pays no start-up cost. Without workers the task runs on the main thread.
 */
export function runShared<T extends EngineTask>(input: T): Promise<EngineResult<T>> {
  const task: T = JSON.parse(JSON.stringify(input));
  if (shared === undefined) shared = startShared();
  if (!shared) return runEngineTask(task) as Promise<EngineResult<T>>;
  const id = ++nextId,
    worker = shared;
  return new Promise<EngineResult<T>>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (value: never) => void, reject });
    worker.postMessage({ id, task });
  });
}

function startShared(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = ({
      data,
    }: MessageEvent<{ id: number; ok: boolean; result: never; error: string }>) => {
      const job = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.ok) job?.resolve(data.result);
      else job?.reject(Error(data.error));
    };
    worker.onerror = e => {
      e.preventDefault();
      shared = null;
      for (const job of waiting.values()) job.reject(Error('The engine worker stopped.'));
      waiting.clear();
    };
    return worker;
  } catch {
    return null;
  }
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
  }
}

export interface RunningTask<T> {
  promise: Promise<T>;
  /** Stop the computation. The promise rejects with `CancelledError`. */
  cancel(): void;
  /** `worker`, or `main thread` when workers are unavailable. */
  thread: () => string;
}

/** Computations to run at once: one core stays with the page. */
export const poolSize = () => Math.max(1, (navigator.hardwareConcurrency || 2) - 1);

/** Call `work` for each index up to `count`, with at most `poolSize()` calls going at once. */
export async function inPool(count: number, work: (index: number) => Promise<void>) {
  let next = 0;
  const lane = async () => {
    while (next < count) await work(next++);
  };
  await Promise.all(Array.from({ length: Math.min(poolSize(), count) }, lane));
}

/**
 * Run an engine computation in a worker. If the browser blocks workers, the same computation
 * runs on the main thread instead.
 */
export function startEngineTask<T extends EngineTask>(
  input: T,
  { timeout }: { timeout?: number } = {},
): RunningTask<EngineResult<T>> {
  // Tasks may contain reactive store proxies, which workers cannot receive. Send plain data.
  const task: T = JSON.parse(JSON.stringify(input));
  let worker: Worker | null = null,
    timer: number | undefined,
    thread = 'worker',
    rejectRun: (error: Error) => void = () => {};
  const cleanup = () => {
    window.clearTimeout(timer);
    worker?.terminate();
    worker = null;
  };
  const fallback = () => {
    thread = 'main thread';
    return runEngineTask(task) as Promise<EngineResult<T>>;
  };
  const promise = new Promise<EngineResult<T>>((resolve, reject) => {
    rejectRun = reject;
    try {
      worker = new Worker(new URL('../workers/engine.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (error) {
      console.warn('[engine] Worker unavailable; computing on the main thread', error);
      fallback().then(resolve, reject);
      return;
    }
    if (timeout)
      timer = window.setTimeout(() => {
        cleanup();
        reject(
          Error(
            `Computation exceeded ${timeout / 1000} seconds. Try a smaller diagram or lower effort.`,
          ),
        );
      }, timeout);
    worker.onmessage = (
      e: MessageEvent<{ ok: boolean; result: EngineResult<T>; error: string }>,
    ) => {
      cleanup();
      if (e.data.ok) resolve(e.data.result);
      else reject(Error(e.data.error));
    };
    worker.onerror = e => {
      e.preventDefault();
      cleanup();
      console.warn(
        `[engine] Worker failed to start; computing on the main thread. With Vite 5–7, add optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] } to vite.config.`,
        e.message,
      );
      fallback().then(resolve, reject);
    };
    worker.postMessage(task);
  });
  return {
    promise,
    cancel() {
      cleanup();
      rejectRun(new CancelledError());
    },
    thread: () => thread,
  };
}
