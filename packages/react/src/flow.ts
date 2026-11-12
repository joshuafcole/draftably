'use client';
/**
 * `DraftablyEdge`: a React Flow (and Svelte Flow) custom edge that draws the line and label box
 * that `layout({ reactFlow })` or `route({ reactFlow })` from `@draftably/runtime/graph` routed.
 *
 *   <ReactFlow nodes={nodes} edges={edges} edgeTypes={{ draftably: DraftablyEdge }} />
 *
 * It uses plain SVG, so this package does not depend on React Flow.
 */
import type { DraftablyEdgeData } from '@draftably/runtime/graph';
import { createElement, type CSSProperties, type ReactNode } from 'react';

export type { DraftablyEdgeData };

/** The props React Flow passes to a custom edge that this edge reads. */
export interface DraftablyEdgeProps {
  id: string;
  data?: { draftably?: DraftablyEdgeData; [key: string]: unknown };
  label?: ReactNode;
  markerStart?: string;
  markerEnd?: string;
  style?: CSSProperties;
  /** Width of the invisible line that takes clicks and hovers. React Flow's default is 20. */
  interactionWidth?: number;
}

export function DraftablyEdge({
  id,
  data,
  label,
  markerStart,
  markerEnd,
  style,
  interactionWidth = 20,
}: DraftablyEdgeProps) {
  const routed = data?.draftably;
  if (!routed?.path) return null;
  const box = routed.label;
  return createElement(
    'g',
    { className: 'draftably-edge' },
    createElement('path', {
      id,
      d: routed.path,
      fill: 'none',
      className: 'react-flow__edge-path',
      markerStart,
      markerEnd,
      style,
    }),
    interactionWidth
      ? createElement('path', {
          d: routed.path,
          fill: 'none',
          strokeOpacity: 0,
          strokeWidth: interactionWidth,
          className: 'react-flow__edge-interaction',
        })
      : null,
    // The label sits on its own backing: other lines may pass under it.
    box && label !== undefined && label !== null && label !== ''
      ? createElement(
          'g',
          { className: 'draftably-edge-label' },
          createElement('rect', {
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height,
            rx: 4,
            fill: 'var(--draftably-edge-label-bg, #fff)',
          }),
          createElement(
            'text',
            {
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
              textAnchor: 'middle',
              dominantBaseline: 'central',
              fontSize: 12,
              fill: 'var(--draftably-edge-label-color, #222)',
            },
            label,
          ),
        )
      : null,
  );
}
