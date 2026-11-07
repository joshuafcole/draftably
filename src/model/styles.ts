import type { NodeStyle, ShapeKind } from './types';

/** A portal's broken outline (`dsl/portals.ts`). */
export const PORTAL_DASH = '5 3';

export const SHAPES: ShapeKind[] = ['box', 'pill', 'circle', 'diamond', 'text', 'icon', 'image'];

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  box: 'Rectangle',
  pill: 'Pill',
  circle: 'Ellipse',
  diamond: 'Diamond',
  text: 'Text',
  icon: 'Icon',
  image: 'Image',
  marker: 'Marker',
  portal: 'Portal',
};

/** Icons offered in the inspector for a shape. */
export const NODE_ICONS = [
  'user',
  'browser',
  'server',
  'database',
  'key',
  'cloud',
  'bolt',
  'check',
  'file',
  'folder',
  'mail',
  'globe',
  'terminal',
  'cube',
  'chart',
  'truck',
];

/** Styles for version 1 node types, used only when migrating old files. */
export const LEGACY_TYPE_STYLE: Record<string, NodeStyle> = {
  actor: { shape: 'icon', color: 'slate', icon: 'user' },
  input: { shape: 'box', color: 'amber', icon: 'file' },
  process: { shape: 'box', color: 'violet', icon: 'bolt' },
  decision: { shape: 'diamond', color: 'amber', icon: '' },
  handoff: { shape: 'pill', color: 'blue', icon: 'arrow' },
  deliverable: { shape: 'box', color: 'mint', icon: 'check' },
  storage: { shape: 'box', color: 'blue', icon: 'database' },
  annotation: { shape: 'text', color: 'slate', icon: '' },
};

export const DEFAULT_STYLE: NodeStyle = { shape: 'box', color: 'auto', icon: '' };

/** Default size for a new shape of the given kind. */
export function defaultShapeSize(shape: ShapeKind): { w: number; h: number } {
  if (shape === 'circle' || shape === 'icon') return { w: 80, h: 80 };
  if (shape === 'diamond') return { w: 112, h: 112 };
  if (shape === 'text') return { w: 164, h: 38 };
  return { w: 164, h: 56 };
}
