// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';
import * as host from '../src/host';

const SOURCE =
  'diagram "Checkout" version=1\nnode cart "Cart"\nnode pay "Pay"\nedge go cart -> pay "next"\n';

describe('@draftably/solid/host', () => {
  it('compiles, draws in its own Solid tree, and prints the source back', async () => {
    const scene = await host.compile(SOURCE);
    expect(scene.diagnostics.filter(d => d.level === 'error')).toEqual([]);

    const drawing = host.draw(scene);
    expect([...drawing.rects.keys()].sort()).toEqual(['cart', 'pay']);
    expect(drawing.routes.map(r => r.id)).toEqual(['go']);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const dispose = render(() => host.StaticScene({ scene: drawing, idPrefix: 'a-' }), svg);
    expect(svg.textContent).toContain('Cart');
    // Without the editor's stylesheet, edges still draw unfilled.
    for (const line of svg.querySelectorAll('.edge-line'))
      expect(line.getAttribute('fill')).toBe('none');
    dispose();

    expect(host.printSource(host.readSource(SOURCE))).toBe(SOURCE);
  });
});
