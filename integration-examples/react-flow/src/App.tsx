import { useEffect, useState } from 'react';
import {
  Background,
  MarkerType,
  ReactFlow,
  applyNodeChanges,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { layout, route } from '@draftably/runtime/graph';
import { DraftablyEdge } from '@draftably/react/flow';

const edgeTypes = { draftably: DraftablyEdge };

// An ordinary React Flow graph: positions start at 0 and React Flow measures each node.
const at = { x: 0, y: 0 };
const startNodes: Node[] = [
  { id: 'web', position: at, data: { label: 'Web app' } },
  { id: 'mobile', position: at, data: { label: 'Mobile app' } },
  { id: 'api', position: at, data: { label: 'API gateway' } },
  { id: 'services', type: 'group', position: at, data: { label: 'Domain services' } },
  { id: 'orders', position: at, data: { label: 'Orders' }, parentId: 'services' },
  { id: 'payments', position: at, data: { label: 'Payments' }, parentId: 'services' },
  { id: 'stock', position: at, data: { label: 'Inventory' }, parentId: 'services' },
  { id: 'db', position: at, data: { label: 'Postgres' } },
  { id: 'queue', position: at, data: { label: 'Event queue' } },
];
const arrow = { markerEnd: { type: MarkerType.ArrowClosed } };
const startEdges: Edge[] = [
  { id: 'w-a', source: 'web', target: 'api', label: 'HTTPS', ...arrow },
  { id: 'm-a', source: 'mobile', target: 'api', label: 'HTTPS', ...arrow },
  { id: 'a-o', source: 'api', target: 'orders', label: 'create order', ...arrow },
  { id: 'a-p', source: 'api', target: 'payments', ...arrow },
  { id: 'o-s', source: 'orders', target: 'stock', label: 'reserve', ...arrow },
  { id: 'o-d', source: 'orders', target: 'db', ...arrow },
  { id: 'p-d', source: 'payments', target: 'db', ...arrow },
  { id: 'o-q', source: 'orders', target: 'queue', animated: true, label: 'order placed', ...arrow },
];

declare global {
  interface Window {
    draftably?: { quality: string; ms: number; blocked: number; routes: number };
  }
}

export function App() {
  const [nodes, setNodes] = useState(startNodes);
  const [edges, setEdges] = useState<Edge[]>(startEdges);
  const [status, setStatus] = useState('Measuring nodes…');
  const measured = useNodesInitialized();
  const flow = useReactFlow();

  // Once React Flow has measured every node, lay the graph out with its real sizes.
  useEffect(() => {
    if (!measured || window.draftably) return;
    const t = performance.now();
    layout({ reactFlow: { nodes: flow.getNodes(), edges }, direction: 'right' }).then(
      ({ reactFlow, result }) => {
        const ms = Math.round(performance.now() - t),
          blocked = Object.values(result.edges).filter(e => e.blocked).length;
        setNodes(reactFlow.nodes);
        setEdges(reactFlow.edges);
        setStatus(`Laid out in ${ms} ms, ${result.quality} routing. Drag a node.`);
        window.draftably = { quality: result.quality, ms, blocked, routes: 0 };
        requestAnimationFrame(() => flow.fitView({ padding: 0.1 }));
      },
    );
  }, [measured]);

  // While a node moves, route the lines again round the boxes where they are now.
  const onNodesChange = (changes: NodeChange[]) => {
    const next = applyNodeChanges(changes, nodes);
    setNodes(next);
    if (window.draftably && changes.some(c => c.type === 'position')) {
      const { reactFlow } = route({
        reactFlow: { nodes: next, edges },
        routing: { quality: 'quick' },
      });
      setEdges(reactFlow.edges);
      window.draftably.routes++;
    }
  };

  return (
    <>
      <div className="status">{status}</div>
      <ReactFlow nodes={nodes} edges={edges} edgeTypes={edgeTypes} onNodesChange={onNodesChange}>
        <Background />
      </ReactFlow>
    </>
  );
}
