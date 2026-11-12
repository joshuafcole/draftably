// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/editor/mount', () => ({
  mountEditor: () => {
    throw new Error('Canvas unavailable.');
  },
}));
await import('../src/editor/element');

describe('draft-editor element', () => {
  it('fails as <draft-diagram> does when the editor cannot start', async () => {
    const element = document.createElement('draft-editor');
    const updates: unknown[] = [];
    element.addEventListener('draft-update', e => updates.push(e.detail));
    element.source = 'node a "A"';
    document.body.append(element);
    await Promise.resolve();
    expect(element.getAttribute('status')).toBe('error');
    expect(element.getAttribute('data-error')).toBe('Canvas unavailable.');
    expect(updates).toMatchObject([
      { status: 'error', error: { diagnostics: [{ code: 'DRAFT_ELEMENT_MOUNT' }] } },
    ]);
    element.remove();
    expect(element.hasAttribute('status')).toBe(false);
  });
});
