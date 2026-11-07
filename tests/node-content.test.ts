// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { describe, expect, it, vi } from 'vitest';
import { renderSvg } from '../src/cli/svg';
import { NodeContentProvider, type NodeContentProps } from '../src/components/scene/node-content';
import { NodeView } from '../src/components/scene/NodeView';
import { compile } from '../src/dsl/compile';
import { projectScene, visibleRects } from '../src/dsl/project';

// The editor state the canvas parts import reads this at load; jsdom lacks it.
vi.hoisted(() => {
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {} })) as never;
});

const SOURCE = (size: string) =>
  ['node a "Collect the inputs"', 'node b "Build"', 'edge e a -> b', size].join('\n');

describe('node content', () => {
  const drawn = async (draws: (id: string) => boolean) => {
    const doc = projectScene(await compile(SOURCE('size a width=140 height=auto min-height=90')));
    const { rects } = visibleRects(doc);
    const seen: NodeContentProps[] = [];
    const scene = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const dispose = render(
      () =>
        NodeContentProvider({
          content: {
            draws,
            Body: props => {
              seen.push(props);
              const div = document.createElement('div');
              div.className = 'host-body';
              div.textContent = `body of ${props.id}`;
              return div;
            },
          },
          get children() {
            return ['a', 'b'].map(id =>
              NodeView({ doc, id, rect: rects.get(id)!, interactive: true }),
            );
          },
        }),
      scene,
    );
    return { scene, seen, rects, doc, dispose };
  };

  it("draws the host's body in place of the title, the size of the node", async () => {
    const { scene, seen, rects, dispose } = await drawn(id => id === 'a');
    const a = scene.querySelector('[data-id="a"]')!;
    const body = a.querySelector('foreignObject.node-content')!;
    expect(body).not.toBeNull();
    expect(body.getAttribute('width')).toBe(String(rects.get('a')!.w));
    expect(body.getAttribute('height')).toBe('90');
    expect(body.getAttribute('pointer-events')).toBe('none');
    expect(body.textContent).toBe('body of a');
    expect(a.querySelector('.node-title')).toBeNull();
    // The shape and the ports stay the scene's, and the body sits under the ports.
    expect(a.querySelector('.node-shape')).not.toBeNull();
    const port = a.querySelector('[data-port]')!;
    expect(body.compareDocumentPosition(port) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(seen.map(p => [p.id, p.width, p.height])).toEqual([['a', 140, 90]]);
    // A node the host does not draw keeps its title.
    const b = scene.querySelector('[data-id="b"]')!;
    expect(b.querySelector('foreignObject')).toBeNull();
    expect(b.querySelector('.node-title')?.textContent).toBe('Build');
    dispose();
  });

  it('leaves exports to the title: the CLI svg draws no host body', async () => {
    const { doc, dispose } = await drawn(() => true);
    const svg = renderSvg(doc);
    expect(svg).not.toContain('foreignObject');
    expect(svg).toContain('Collect the inputs');
    dispose();
  });
});
