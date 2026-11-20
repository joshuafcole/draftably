import type { RoutingSettings } from './types.ts';
import { clamp } from './geometry.ts';

export const defaults: RoutingSettings = {
  clearance: 10,
  portGap: 16,
  edgeGap: 16,
  bendPenalty: 32,
  crossingPenalty: 360,
  sharedPenalty: 8,
  parallelPenalty: 18,
  portStability: 20,
  fanoutPenalty: 50,
  passes: 3,
  cornerRadius: 6,
  standoff: 20,
};
/** Checked settings: defaults under `raw`, with every number held to its range. */
export function settings(raw: Partial<RoutingSettings> = {}): RoutingSettings {
  const s = { ...defaults, ...raw },
    ranges: Record<keyof RoutingSettings, [number, number]> = {
      clearance: [4, 30],
      portGap: [6, 28],
      bendPenalty: [0, 100],
      crossingPenalty: [0, 1200],
      sharedPenalty: [0, 20],
      portStability: [0, 150],
      fanoutPenalty: [0, 160],
      passes: [1, 5],
      edgeGap: [4, 48],
      parallelPenalty: [0, 60],
      cornerRadius: [0, 16],
      standoff: [0, 40],
    };
  for (const [k, [lo, hi]] of Object.entries(ranges) as Array<
    [keyof RoutingSettings, [number, number]]
  >) {
    if (typeof s[k] !== 'number' || !Number.isFinite(s[k]))
      throw Error('Routing ' + k + ' must be a finite number.');
    s[k] = clamp(s[k], lo, hi);
  }
  s.passes = Math.round(s.passes);
  return s;
}
