import { renderSvg as writeSvg, SvgLimitError, type Route } from './svg-renderer';
import { applyLinks, assertOptions, textLink } from './policy';
import { runtimeVersion, fontMetricsVersion } from './version';
import { forScheme, resolveAppearance } from '../model/appearance';
import { mergeSchemes } from './schemes';
import { compile, type Scene } from '../dsl/compile';
import { projectScene } from '../dsl/project';
import { DslError, parseModel, type Model } from '../dsl/syntax';
import { withState } from '../model/status';
import type { Rect } from '../model/types';
import { placedItems, type DrawnRoute, type Geometry } from './geometry';
import type {
  Diagnostic,
  RenderFailure,
  RenderLimits,
  RenderOptions,
  RenderResult,
  ValidateOptions,
  ValidationResult,
} from './types';

const NATIVE: RenderLimits = {
  maxSourceChars: 300_000,
  maxSourceBytes: 1_000_000,
  maxObjects: 500,
  maxEdges: 1_200,
  maxDepth: 12,
  maxOutputBytes: 8_000_000,
};
const encoder = new TextEncoder();
const xmlChar = (n: number) =>
  n === 0x9 ||
  n === 0xa ||
  n === 0xd ||
  (n >= 0x20 && n <= 0xd7ff) ||
  (n >= 0xe000 && n <= 0xfffd) ||
  (n >= 0x10000 && n <= 0x10ffff);

function checkText(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const n = value.charCodeAt(i);
    if (n >= 0xd800 && n <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
      if (!xmlChar(0x10000 + ((n - 0xd800) << 10) + (next - 0xdc00))) return false;
    } else if (n >= 0xdc00 && n <= 0xdfff) return false;
    else if (!xmlChar(n)) return false;
  }
  return true;
}

function hasInvalidText(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === 'string') return !checkText(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Array.isArray(value)
    ? value.some(v => hasInvalidText(v, seen))
    : Object.values(value).some(v => hasInvalidText(v, seen));
}

function limitsOf(input: Partial<RenderLimits> | undefined, compileOnly = false): RenderLimits {
  if (input !== undefined && (!input || typeof input !== 'object' || Array.isArray(input)))
    throw new TypeError('limits must be an object.');
  const allowed = compileOnly
    ? Object.keys(NATIVE).filter(k => k !== 'maxOutputBytes')
    : Object.keys(NATIVE);
  for (const key of Object.keys(input ?? {}))
    if (!allowed.includes(key)) throw new RangeError(`Unknown limit ${key}.`);
  const limits = { ...NATIVE, ...input };
  for (const key of allowed) {
    const value = limits[key as keyof RenderLimits];
    if (!Number.isSafeInteger(value) || value <= 0 || value > NATIVE[key as keyof RenderLimits])
      throw new RangeError(
        `${key} must be a positive safe integer no greater than ${NATIVE[key as keyof RenderLimits]}.`,
      );
  }
  return limits;
}

const diagnostic = (
  code: string,
  message: string,
  sourceId?: string,
  line?: number,
  column?: number,
  nativeCode?: string,
  itemIds: readonly string[] = [],
): Diagnostic => ({
  code,
  severity: 'error',
  message,
  ...(line
    ? { location: { ...(sourceId ? { sourceId } : {}), line, ...(column ? { column } : {}) } }
    : {}),
  itemIds: [...itemIds],
  ...(nativeCode ? { nativeCode } : {}),
});

function fail(reason: RenderFailure['reason'], d: Diagnostic): RenderFailure {
  return { ok: false, reason, diagnostics: [d] };
}

function nativeDiagnostic(error: unknown, sourceId?: string): Diagnostic {
  if (error instanceof DslError && /Limit:/.test(error.message))
    return diagnostic(
      'DRAFT_LIMIT',
      error.message.replace(/^Line \d+(?:, column \d+)?: /, ''),
      sourceId,
      error.line || undefined,
      error.column || undefined,
    );
  if (error instanceof DslError)
    return diagnostic(
      'DRAFT_PARSE',
      error.message.replace(/^Line \d+(?:, column \d+)?: /, ''),
      sourceId,
      error.line || undefined,
      error.column || undefined,
    );
  return diagnostic('DRAFT_INTERNAL', 'The diagram could not be compiled.', sourceId);
}

function checkCompiledLimits(
  scene: Scene,
  limits: RenderLimits,
  sourceId?: string,
): Diagnostic | undefined {
  const objects = scene.objects.length;
  if (objects > limits.maxObjects)
    return diagnostic(
      'DRAFT_LIMIT',
      `The diagram has ${objects} objects; the limit is ${limits.maxObjects}.`,
      sourceId,
    );
  if (scene.edges.length > limits.maxEdges)
    return diagnostic(
      'DRAFT_LIMIT',
      `The diagram has ${scene.edges.length} edges; the limit is ${limits.maxEdges}.`,
      sourceId,
    );
  const byId = scene.byId;
  for (const object of scene.objects) {
    let depth = 1,
      parent = object.parent;
    while (parent !== 'root') {
      depth++;
      parent = byId.get(parent)?.parent ?? 'root';
    }
    if (depth > limits.maxDepth)
      return diagnostic(
        'DRAFT_LIMIT',
        `The diagram has containment depth ${depth}; the limit is ${limits.maxDepth}.`,
        sourceId,
        object.line,
      );
  }
}

function checkModelLimits(
  model: Model,
  limits: RenderLimits,
  sourceId?: string,
): Diagnostic | undefined {
  if (model.objects.length > limits.maxObjects)
    return diagnostic(
      'DRAFT_LIMIT',
      `The diagram has ${model.objects.length} objects; the limit is ${limits.maxObjects}.`,
      sourceId,
    );
  if (model.edges.length > limits.maxEdges)
    return diagnostic(
      'DRAFT_LIMIT',
      `The diagram has ${model.edges.length} edges; the limit is ${limits.maxEdges}.`,
      sourceId,
    );
  const byId = new Map(model.objects.map(object => [object.id, object]));
  for (const object of model.objects) {
    let depth = 1,
      parent = object.parent;
    while (parent !== 'root') {
      depth++;
      parent = byId.get(parent)?.parent ?? 'root';
    }
    if (depth > limits.maxDepth)
      return diagnostic(
        'DRAFT_LIMIT',
        `The diagram has containment depth ${depth}; the limit is ${limits.maxDepth}.`,
        sourceId,
        object.line,
      );
  }
}

function preflight(
  source: string,
  limits: RenderLimits,
  sourceId?: string,
): Diagnostic | undefined {
  if (
    limits.maxObjects === NATIVE.maxObjects &&
    limits.maxEdges === NATIVE.maxEdges &&
    limits.maxDepth === NATIVE.maxDepth
  )
    return;
  try {
    return checkModelLimits(parseModel(source), limits, sourceId);
  } catch (error) {
    return nativeDiagnostic(error, sourceId);
  }
}

const failureReason = (d: Diagnostic): RenderFailure['reason'] =>
  d.code === 'DRAFT_INTERNAL' ? 'internal' : d.code === 'DRAFT_LIMIT' ? 'limit' : 'input';

export interface InternalRender {
  result: RenderResult;
  scene?: Scene;
}

/** Internal bridge for repository callers that need the editable Scene alongside public output. */
export async function renderWithScene(
  source: string,
  options: RenderOptions = {},
): Promise<InternalRender> {
  assertOptions(options);
  if (typeof source !== 'string') throw new TypeError('source must be a string.');
  const limits = limitsOf(options.limits),
    sourceId = options.sourceId;
  if (options.signal?.aborted)
    return {
      result: fail('aborted', diagnostic('DRAFT_ABORTED', 'Rendering was aborted.', sourceId)),
    };
  if (
    source.length > limits.maxSourceChars ||
    encoder.encode(source).byteLength > limits.maxSourceBytes
  )
    return {
      result: fail(
        'limit',
        diagnostic('DRAFT_LIMIT', 'The source exceeds the configured size limit.', sourceId),
      ),
    };
  if (
    !checkText(source) ||
    [options.title, options.description, options.styleNonce].some(
      v => v !== undefined && !checkText(v),
    )
  )
    return {
      result: fail(
        'input',
        diagnostic(
          'DRAFT_TEXT_INVALID',
          'The source contains text that XML cannot represent.',
          sourceId,
        ),
      ),
    };
  const preflightError = preflight(source, limits, sourceId);
  if (preflightError) return { result: fail(failureReason(preflightError), preflightError) };
  let scene: Scene;
  try {
    scene = await compile(source);
  } catch (error) {
    const d = nativeDiagnostic(error, sourceId);
    return {
      result: fail(
        error instanceof DslError && /Limit:/.test(error.message) ? 'limit' : failureReason(d),
        d,
      ),
    };
  }
  if (options.signal?.aborted)
    return {
      result: fail('aborted', diagnostic('DRAFT_ABORTED', 'Rendering was aborted.', sourceId)),
    };
  const limitError = checkCompiledLimits(scene, limits, sourceId);
  if (limitError) return { result: fail('limit', limitError), scene };
  if (scene.diagnostics.some(d => d.level === 'error')) {
    const d = scene.diagnostics.find(x => x.level === 'error')!;
    return {
      result: fail(
        'input',
        diagnostic('DRAFT_COMPILE', d.message, sourceId, d.line, undefined, d.code, d.ids),
      ),
      scene,
    };
  }
  if (hasInvalidText(scene))
    return {
      result: fail(
        'input',
        diagnostic(
          'DRAFT_TEXT_INVALID',
          'A decoded diagram label contains text that XML cannot represent.',
          sourceId,
        ),
      ),
      scene,
    };
  if (
    options.state != null &&
    !(scene.model.appearance.states ?? []).some(s => s.id === options.state)
  )
    return {
      result: fail(
        'input',
        diagnostic('DRAFT_STATE_UNKNOWN', `Unknown state ${options.state}.`, sourceId),
      ),
      scene,
    };
  if (options.signal?.aborted)
    return {
      result: fail('aborted', diagnostic('DRAFT_ABORTED', 'Rendering was aborted.', sourceId)),
    };
  let doc = projectScene(scene);
  if (options.state) doc = withState(doc, options.state);
  // The dark drawing shares the light one's layout; only its theme differs. A file's own theme
  // draws the same in both, so it needs no second drawing.
  const scheme = options.colorScheme ?? 'light',
    darkLook = scheme === 'light' ? doc.appearance : forScheme(doc.appearance, true),
    both = scheme === 'auto' && darkLook !== doc.appearance;
  if (scheme === 'dark') doc = { ...doc, appearance: darkLook };
  const linkDiagnostics = applyLinks(doc, options);
  const prefix = options.target === 'inline' ? options.idPrefix : 'draft';
  const esc = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const metadata = options.includeSource
    ? `<metadata id="${prefix}-source" data-draftably-source="1" data-draftably-version="${runtimeVersion}">${esc(source)}</metadata>`
    : undefined;
  let fontCss = '';
  try {
    if (options.fonts !== 'host')
      fontCss = (await import('../lib/font-data')).fontFaceCss(resolveAppearance(doc.appearance));
  } catch {
    return {
      result: fail(
        'environment',
        diagnostic('DRAFT_ENVIRONMENT', 'Bundled fonts could not be loaded.', sourceId),
      ),
    };
  }
  if (options.signal?.aborted)
    return {
      result: fail('aborted', diagnostic('DRAFT_ABORTED', 'Rendering was aborted.', sourceId)),
    };
  let svg: string;
  let drawn: { rects: Map<string, Rect>; routes: DrawnRoute[] } | undefined;
  try {
    // Both drawings embed the same fonts. They go in once, after the merge, so neither the second
    // drawing nor the color scan copies them.
    const fonts = both ? '/*draft-fonts*/' : fontCss;
    const write = (d: typeof doc, routes?: Route[]) =>
      writeSvg(d, {
        routes,
        onDrawn: value => (drawn = value),
        idPrefix: prefix,
        fontCss: fonts,
        title: options.title,
        description: options.description,
        styleNonce: options.styleNonce,
        linkTarget: options.links?.mode === 'safe' ? (options.links.target ?? '_self') : '_self',
        textHref: textLink(options),
        metadata,
        maxOutputBytes: limits.maxOutputBytes,
      });
    svg = write(doc);
    if (both) {
      // Should the drawings ever differ in more than color, the page gets the light one.
      // The dark drawing reuses the light one's routes: colors never move a line.
      const routes = (drawn as { routes: Route[] } | undefined)?.routes;
      svg = mergeSchemes(svg, write({ ...doc, appearance: darkLook }, routes)) ?? svg;
      const at = svg.indexOf(fonts);
      svg = svg.slice(0, at) + fontCss + svg.slice(at + fonts.length);
      if (new TextEncoder().encode(svg).length > limits.maxOutputBytes)
        throw new SvgLimitError(`The SVG is larger than ${limits.maxOutputBytes} bytes.`);
    }
  } catch (error) {
    return {
      result:
        error instanceof SvgLimitError
          ? fail('limit', diagnostic('DRAFT_LIMIT', error.message, sourceId))
          : fail(
              'internal',
              diagnostic('DRAFT_INTERNAL', 'The diagram could not be drawn.', sourceId),
            ),
      scene,
    };
  }
  if (!checkText(svg))
    return {
      result: fail(
        'input',
        diagnostic(
          'DRAFT_TEXT_INVALID',
          'The generated SVG contains text that XML cannot represent.',
          sourceId,
        ),
      ),
      scene,
    };
  const match =
    /<svg[^>]*viewBox="([\d.-]+) ([\d.-]+) ([\d.]+) ([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"/.exec(
      svg,
    );
  if (!match)
    return {
      result: fail(
        'internal',
        diagnostic('DRAFT_INTERNAL', 'The SVG dimensions could not be read.', sourceId),
      ),
      scene,
    };
  const items = [
    ...scene.objects.map(o => ({ id: o.id, kind: o.type, label: o.label, line: o.line })),
    ...scene.edges.map(e => ({
      id: e.id,
      kind: 'edge' as const,
      label: e.label ?? '',
      line: e.line,
      from: e.source,
      to: e.target,
    })),
  ];
  const viewBox = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as const;
  const geometry: Geometry | null = drawn
    ? {
        revision: 0,
        frame: { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] },
        ...placedItems(doc, drawn.rects, drawn.routes),
      }
    : null;
  const value = {
    svg,
    title: options.title ?? scene.title,
    ...(options.description !== undefined ? { description: options.description } : {}),
    width: Number(match[5]),
    height: Number(match[6]),
    viewBox,
    items,
    geometry,
    states: (scene.model.appearance.states ?? []).map(s => ({
      id: s.id,
      label: s.label,
      ...(s.hidden ? { hidden: true as const } : {}),
    })),
    activeState: options.state ?? null,
    provenance: {
      runtimeVersion,
      fontMetricsVersion,
      dslVersion: 1 as const,
      renderContextVersion: '1',
    },
  };
  const diagnostics = scene.diagnostics.map(d => ({
    code: d.code === 'fit' ? 'DRAFT_LAYOUT_NOTE' : 'DRAFT_COMPILE',
    severity: d.level,
    message: d.message,
    ...(d.line ? { location: { ...(sourceId ? { sourceId } : {}), line: d.line } } : {}),
    itemIds: [...d.ids],
    nativeCode: d.code,
  })) satisfies Diagnostic[];
  if (options.signal?.aborted)
    return {
      result: fail('aborted', diagnostic('DRAFT_ABORTED', 'Rendering was aborted.', sourceId)),
      scene,
    };
  return { result: { ok: true, value, diagnostics: [...diagnostics, ...linkDiagnostics] }, scene };
}

export async function renderSvg(source: string, options?: RenderOptions): Promise<RenderResult> {
  return (await renderWithScene(source, options)).result;
}

export async function validate(
  source: string,
  options: ValidateOptions = {},
): Promise<ValidationResult> {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Validation options must be an object.');
  if (options.sourceId !== undefined && typeof options.sourceId !== 'string')
    throw new TypeError('sourceId must be a string.');
  if (typeof source !== 'string') throw new TypeError('source must be a string.');
  const limits = limitsOf(options.limits, true),
    sourceId = options.sourceId;
  if (options.signal?.aborted)
    return fail('aborted', diagnostic('DRAFT_ABORTED', 'Validation was aborted.', sourceId));
  if (
    source.length > limits.maxSourceChars ||
    encoder.encode(source).byteLength > limits.maxSourceBytes
  )
    return fail(
      'limit',
      diagnostic('DRAFT_LIMIT', 'The source exceeds the configured size limit.', sourceId),
    );
  if (!checkText(source))
    return fail(
      'input',
      diagnostic(
        'DRAFT_TEXT_INVALID',
        'The source contains text that XML cannot represent.',
        sourceId,
      ),
    );
  const preflightError = preflight(source, limits as RenderLimits, sourceId);
  if (preflightError) return fail(failureReason(preflightError), preflightError);
  try {
    const scene = await compile(source);
    if (options.signal?.aborted)
      return fail('aborted', diagnostic('DRAFT_ABORTED', 'Validation was aborted.', sourceId));
    const limitError = checkCompiledLimits(scene, limits as RenderLimits, sourceId);
    if (limitError) return fail('limit', limitError);
    if (hasInvalidText(scene))
      return fail(
        'input',
        diagnostic(
          'DRAFT_TEXT_INVALID',
          'A decoded diagram label contains text that XML cannot represent.',
          sourceId,
        ),
      );
    const errors = scene.diagnostics.filter(d => d.level === 'error');
    if (errors.length)
      return {
        ok: false,
        reason: 'input',
        diagnostics: errors.map(d =>
          diagnostic('DRAFT_COMPILE', d.message, sourceId, d.line, undefined, d.code, d.ids),
        ),
      };
    return {
      ok: true,
      diagnostics: scene.diagnostics.map(d => ({
        code: 'DRAFT_COMPILE',
        severity: d.level,
        message: d.message,
        ...(d.line ? { location: { ...(sourceId ? { sourceId } : {}), line: d.line } } : {}),
        itemIds: [...d.ids],
        nativeCode: d.code,
      })),
    };
  } catch (error) {
    const d = nativeDiagnostic(error, sourceId);
    return fail(
      error instanceof DslError && /Limit:/.test(error.message) ? 'limit' : failureReason(d),
      d,
    );
  }
}
