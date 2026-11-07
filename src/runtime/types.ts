export type Severity = 'error' | 'warning' | 'info';

export interface SourceLocation {
  sourceId?: string;
  line: number;
  column?: number;
}

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  location?: SourceLocation;
  itemIds: readonly string[];
  related?: readonly { message: string; location: SourceLocation }[];
  nativeCode?: string;
}

export interface CompileLimits {
  maxSourceChars: number;
  maxSourceBytes: number;
  maxObjects: number;
  maxEdges: number;
  maxDepth: number;
}

export interface RenderLimits extends CompileLimits {
  maxOutputBytes: number;
}

export type LinkPolicy =
  | { mode: 'none' }
  | {
      mode: 'safe';
      baseUrl?: string;
      target?: '_self' | '_blank';
      resolve?: (request: { itemId: string; href: string }) => string | null;
      cacheKey?: string;
    };

export interface CommonRenderOptions {
  title?: string;
  description?: string;
  includeSource?: boolean;
  links?: LinkPolicy;
  styleNonce?: string;
  state?: string | null;
  sourceId?: string;
  signal?: AbortSignal;
  limits?: Partial<RenderLimits>;
}

export type RenderOptions = CommonRenderOptions &
  (
    | { target?: 'image'; idPrefix?: never; fonts?: 'embed' }
    | { target: 'inline'; idPrefix: string; fonts?: 'embed' | 'host' }
  );

export interface ValidateOptions {
  sourceId?: string;
  signal?: AbortSignal;
  limits?: Partial<CompileLimits>;
}

export interface ItemSummary {
  id: string;
  kind: 'node' | 'group' | 'edge';
  label: string;
  line: number;
  from?: string;
  to?: string;
}

export interface DiagramSummary {
  title: string;
  description?: string;
  width: number;
  height: number;
  viewBox: readonly [number, number, number, number];
  items: readonly ItemSummary[];
  /** Every state in file order; `hidden` marks one `chips=hidden` keeps off a reader's list. */
  states: readonly { id: string; label: string; hidden?: true }[];
  activeState: string | null;
}

export interface RenderedDiagram extends DiagramSummary {
  svg: string;
  provenance: {
    runtimeVersion: string;
    dslVersion: 1;
    fontMetricsVersion: string;
    renderContextVersion: string;
  };
}

export type RenderFailure = {
  ok: false;
  reason: 'input' | 'limit' | 'aborted' | 'environment' | 'internal';
  diagnostics: readonly Diagnostic[];
};

export type RenderResult =
  { ok: true; value: RenderedDiagram; diagnostics: readonly Diagnostic[] } | RenderFailure;

export type ValidationResult = { ok: true; diagnostics: readonly Diagnostic[] } | RenderFailure;
