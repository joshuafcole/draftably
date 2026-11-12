// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import { StaticScene } from '../src/components/scene/StaticScene';
import { checkSource } from '../src/dsl/compile';
import { projectScene, visibleRects } from '../src/dsl/project';
import { computeRoutes } from '../src/model/routes';
import { buildStaticScene } from '../src/model/static-scene';

const SOURCE = 'node cart "Cart"\nnode pay "Pay"\nedge go cart -> pay "next"\n';

describe('the Solid scene without the editor', () => {
  it('draws unfilled lines and centred labels with no stylesheet', () => {
    const doc = projectScene(checkSource(SOURCE));
    const { vg, rects } = visibleRects(doc);
    const scene = buildStaticScene(doc, computeRoutes(doc, vg, rects, { previous: [] }).result);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const dispose = render(() => StaticScene({ scene, idPrefix: 'a-' }), svg);
    expect(svg.textContent).toContain('Cart');
    const lines = [...svg.querySelectorAll('.edge-line')];
    expect(lines.length).toBe(1);
    for (const line of lines) expect(line.getAttribute('fill')).toBe('none');
    expect(svg.querySelector('.edge-label')?.getAttribute('text-anchor')).toBe('middle');
    dispose();
  });
});
