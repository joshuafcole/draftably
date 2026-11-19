import { describe, expect, it } from 'vitest';
import { rasterize } from '../src/cli/png';
import { FONT_ROLES, measureText, typeProfile } from '../src/model/fonts';

// A face that falls back to Inter draws `iiii` and `MMMM` 10 to 30 px off the stored widths at
// this size; the right face draws them within its two outer side bearings.
const SIZE = 20;

describe('PNG fonts', () => {
  for (const role of FONT_ROLES)
    it(`draws ${role} text in its own face, at the width the compiler measured`, async () => {
      const type = typeProfile(role, true, SIZE, SIZE);
      for (const text of ['iiii', 'MMMM']) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="40"><text x="0" y="30" font-size="${SIZE}" font-weight="${type.weight}" font-family="${type.family}">${text}</text></svg>`;
        const drawn = (await rasterize(svg)).getBBox()!.width;
        expect(drawn, `${role} ${text}`).toBeLessThanOrEqual(measureText(text, type) + 0.5);
        expect(drawn, `${role} ${text}`).toBeGreaterThan(measureText(text, type) - 4);
      }
    });
});
