import { describe, expect, it } from 'vitest';
import { checkSource } from '../src/dsl/compile';
import { projectScene, visibleRects } from '../src/dsl/project';
import { computeRoutes, HALO_REACH, haloPath, wholeLines } from '../src/model/routes';

const p = (x: number, y: number) => ({ x, y });

describe('edge halo', () => {
  it('is empty for a line that crosses nothing', () => {
    expect(haloPath([p(0, 0), p(200, 0)], [], [])).toBe('');
  });

  it('runs only a short way either side of a crossing line or a frame border', () => {
    const line = [p(0, 50), p(300, 50)],
      other = [p(100, 0), p(100, 100)],
      frame = { x: 200, y: 0, w: 200, h: 100 };
    expect(haloPath(line, [other], [frame])).toBe(
      `M${100 - HALO_REACH} 50L${100 + HALO_REACH} 50M${200 - HALO_REACH} 50L${200 + HALO_REACH} 50`,
    );
  });

  it('ignores lines that only touch at an end', () => {
    expect(haloPath([p(0, 50), p(100, 50)], [[p(100, 0), p(100, 100)]], [])).toBe('');
  });

  it('keeps a line whole only where a crossing would cut its mark', () => {
    const mark = { x: 88, y: 45, w: 12, h: 10 },
      marked = { points: [p(0, 50), p(100, 50)], marks: [mark] },
      across = (x: number) => ({ points: [p(x, 0), p(x, 100)], marks: [] });
    expect([...wholeLines([marked, across(90)])]).toEqual([0]);
    expect([...wholeLines([marked, across(40)])]).toEqual([]);
  });

  it('draws a short marked line over the line that crosses it, in every output', () => {
    const doc = projectScene(
        checkSource(`diagram "flow" version=1
node Client "Client"
node Api "API"
node Cache "Cache"
node Legacy "Legacy service"
node Db "Database"
node Worker "Worker"
node Queue "Queue"
node Admin "Admin"
edge edge_1 Client -> Api "" tail=arrow
edge edge_2 Api -> Cache "" head=circle
edge edge_3 Api -> Legacy "" head=cross
edge edge_4 Api -> Db ""
edge edge_5 Worker -> Queue "" head=circle tail=circle
edge edge_6 Api -> Admin "" head=cross tail=cross
layout root flow direction=right
pin Client x=0 y=0
pin Api x=400 y=0
pin Cache x=800 y=0
pin Legacy x=800 y=100
pin Db x=800 y=200
pin Worker x=304 y=320
pin Queue x=496 y=320
pin Admin x=400 y=480
`),
      ),
      { vg, rects } = visibleRects(doc),
      routes = computeRoutes(doc, vg, rects, { previous: [] }).routes,
      ids = routes.map(r => r.id);
    // The pins make API → Admin run straight down through the short gap from Worker to Queue.
    expect(
      haloPath(routes[ids.indexOf('edge_5')].points, [routes[ids.indexOf('edge_6')].points], []),
    ).not.toBe('');
    expect(ids.indexOf('edge_5')).toBeGreaterThan(ids.indexOf('edge_6'));
  });
});
