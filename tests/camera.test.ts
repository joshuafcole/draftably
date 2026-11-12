import { describe, expect, it } from 'vitest';
import { fitCamera, revealCamera, ZOOM_MAX, ZOOM_MIN } from '../src/runtime/camera';

const view = { width: 800, height: 600 };

describe('one camera for both handles', () => {
  it('fits a box in the padded view, centred, at most actual size', () => {
    expect(fitCamera({ x: 0, y: 0, width: 100, height: 50 }, view)).toEqual({
      centerX: 50,
      centerY: 25,
      zoom: 1,
    });
    const big = fitCamera({ x: 0, y: 0, width: 1472, height: 536 }, view);
    expect(big.zoom).toBeCloseTo((800 - 64) / 1472);
    // A host panel on the left: the box centres in the space that is left.
    const panel = fitCamera({ x: 0, y: 0, width: 100, height: 50 }, view, {
      padding: { top: 0, right: 0, bottom: 0, left: 300 },
      maxZoom: 2,
    });
    expect(panel.zoom).toBe(2);
    expect((50 - panel.centerX) * panel.zoom + 400).toBeCloseTo(300 + 250);
    expect(fitCamera({ x: 0, y: 0, width: 1e9, height: 1 }, view).zoom).toBe(ZOOM_MIN);
    expect(fitCamera({ x: 0, y: 0, width: 1, height: 1 }, view, { maxZoom: 99 }).zoom).toBe(
      ZOOM_MAX,
    );
  });

  it('reveals with the least move, and zooms out only when the box does not fit', () => {
    const camera = { centerX: 0, centerY: 0, zoom: 1 };
    expect(revealCamera(camera, { x: -10, y: -10, width: 20, height: 20 }, view)).toEqual(camera);
    const right = revealCamera(camera, { x: 500, y: 0, width: 40, height: 20 }, view);
    expect(right.zoom).toBe(1);
    expect((540 - right.centerX) * right.zoom + 400).toBeCloseTo(800 - 32);
    expect(right.centerY).toBe(0);
    const huge = revealCamera(camera, { x: 0, y: 0, width: 2000, height: 100 }, view);
    expect(huge.zoom).toBeLessThan(1);
  });
});
