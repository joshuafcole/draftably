/** Router settings: the named presets and the undoable edit that changes how lines are drawn. */
import { RouteLab } from '../../engines/routing-engine';
import type { RoutingSettings } from '../../model/types';
import { toast } from '../toast';
import type { DocumentPart } from './document';
import type { FileSessionPart } from './file-session';
import type { LayoutPart } from './layout';
import type { ScenePart } from './scene';

export const ROUTE_PRESETS = {
  Balanced: {},
  'Fewer crossings': { crossingPenalty: 900, sharedPenalty: 9, portStability: 10 },
} satisfies Record<string, Partial<RoutingSettings>>;

export type RoutePreset = keyof typeof ROUTE_PRESETS;

export function createRouting(s: DocumentPart & FileSessionPart & LayoutPart & ScenePart) {
  /** Routing settings are undoable edits: they change how every connection is drawn. */
  function setRouting(patch: Partial<RoutingSettings>, label: string) {
    const next = RouteLab.settings({ ...s.doc.settings.routing, ...patch });
    // A diagram file stores router settings in its `routing` line.
    if (s.fileMode()) {
      const blocked = s.fileBlocked();
      if (blocked) return toast(blocked);
      if (s.layoutPreview()) return void s.previewRouting(next);
      void s.commitSource(s.sourceWithRouting(next), label, 'routing');
      return;
    }
    const before = s.snapshot();
    s.setDoc('settings', 'routing', next);
    s.resetRoutes();
    s.commit(before, label);
  }

  /** Corner rounding is how lines look, not where they go, so a preset leaves it alone. */
  const presetSettings = (preset: RoutePreset): RoutingSettings => ({
    ...RouteLab.defaults,
    ...ROUTE_PRESETS[preset],
    cornerRadius: s.doc.settings.routing.cornerRadius,
  });

  /** A file previews a preset, like a direction or format. A browser diagram's edit is undoable. */
  function applyRoutePreset(preset: RoutePreset) {
    if (!s.fileMode()) return setRouting(presetSettings(preset), 'Change routing preset');
    const blocked = s.fileBlocked();
    if (blocked) return toast(blocked);
    void s.previewRouting(presetSettings(preset));
  }

  /** The preset the current settings match, or null for custom values. */
  function activeRoutePreset() {
    const current = s.doc.settings.routing;
    return (
      (Object.keys(ROUTE_PRESETS) as RoutePreset[]).find(preset =>
        (Object.entries(presetSettings(preset)) as Array<[keyof RoutingSettings, number]>).every(
          ([key, value]) => current[key] === value,
        ),
      ) ?? null
    );
  }
  return {
    setRouting,
    applyRoutePreset,
    activeRoutePreset,
  };
}

export type RoutingPart = ReturnType<typeof createRouting>;
