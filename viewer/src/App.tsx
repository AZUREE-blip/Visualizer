import { useState, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from './components/NodeTypes';
import { Sidebar } from './components/Sidebar';
import { NodeDetail } from './components/NodeDetail';
import { PromptPanel } from './components/PromptPanel';
import { Presentation } from './components/Presentation';

import { CompactToolbar } from './components/CompactToolbar';
import { Legend } from './components/Legend';
import { useGraphData } from './hooks/useGraphData';
import { useSelectionHighlight } from './hooks/useSelectionHighlight';
import { useWebSocket } from './hooks/useWebSocket';
import { useViewMode } from './hooks/useViewMode';
import { getLayerColor } from './layerColors';
import type { LayerType, BridgeQuestion } from './types';

function FitViewAuto({ layoutKey, compact }: { layoutKey: string; compact?: boolean }) {
  const { fitView } = useReactFlow();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevKey = useRef('');
  const padding = compact ? 0.02 : 0.05;

  useEffect(() => {
    if (layoutKey === prevKey.current) return;
    prevKey.current = layoutKey;
    clearTimeout(timer.current);
    requestAnimationFrame(() => {
      timer.current = setTimeout(() => fitView({ padding, duration: 400 }), 50);
    });
  }, [fitView, layoutKey, padding]);

  useEffect(() => {
    const onResize = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => fitView({ padding, duration: 200 }), 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('resize', onResize);
    };
  }, [fitView, padding]);

  return null;
}

type ViewMode = 'diagram' | 'presentation';

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('diagram');
  const [hiddenLayers, setHiddenLayers] = useState<Set<LayerType>>(new Set(['external']));
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const { isCompact } = useViewMode();
  const { connected, answers, pendingQuestions, askQuestion, graphVersion, watching, aiAvailable, enrichProgress } = useWebSocket();
  const { nodes, edges, meta, loading, error } = useGraphData(hiddenLayers, searchQuery, graphVersion, isCompact);

  // Auto-collapse sidebar in narrow mode (only relevant for non-compact)
  useEffect(() => {
    if (!isCompact) setSidebarOpen(true);
  }, [isCompact]);

  const layoutKey = `${nodes.length}-${graphVersion}-${hiddenLayers.size}-${searchQuery}-${sidebarOpen}-${isCompact}`;

  const { nodes: highlightedNodes, edges: highlightedEdges } = useSelectionHighlight(nodes, edges, selectedNode);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(highlightedNodes);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(highlightedEdges);

  // Sync React Flow internal state when computed nodes/edges change
  useEffect(() => { setRfNodes(highlightedNodes); }, [highlightedNodes, setRfNodes]);
  useEffect(() => { setRfEdges(highlightedEdges); }, [highlightedEdges, setRfEdges]);

  useEffect(() => {
    if (selectedNode && nodes.length > 0 && !nodes.some(n => n.id === selectedNode)) {
      setSelectedNode(null);
    }
  }, [nodes, selectedNode]);

  // Escape key handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!isCompact && sidebarOpen) { setSidebarOpen(false); return; }
        setSelectedNode(null);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isCompact, sidebarOpen]);

  const handleToggleLayer = useCallback((layer: LayerType) => {
    setHiddenLayers(prev => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer); else next.add(layer);
      return next;
    });
  }, []);

  const handleNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNode(prev => prev === node.id ? null : node.id);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleAskClaude = useCallback((question: BridgeQuestion) => {
    askQuestion(question);
  }, [askQuestion]);

  if (viewMode === 'presentation') {
    return <Presentation onExit={() => setViewMode('diagram')} />;
  }

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', background: 'hsl(0 0% 4%)',
      }}>
        <div className="animate-pulse-subtle" style={{
          color: 'hsl(0 0% 45%)', fontSize: '13px', letterSpacing: '-0.01em',
        }}>
          Loading graph data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="animate-fade-in" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', background: 'hsl(0 0% 4%)', gap: '8px',
      }}>
        <div style={{ color: 'hsl(0 0% 90%)', fontSize: '14px', fontWeight: 500 }}>No graph data</div>
        <div style={{ color: 'hsl(0 0% 35%)', fontSize: '11px', fontFamily: 'monospace' }}>
          Run: <code style={{ color: 'hsl(0 0% 60%)' }}>npm run analyze -- /path/to/project</code>
        </div>
      </div>
    );
  }

  const reactFlowProps = {
    nodes: rfNodes,
    edges: rfEdges,
    onNodesChange,
    onEdgesChange,
    onNodeClick: handleNodeClick,
    onPaneClick: handlePaneClick,
    nodeTypes,
    fitView: true,
    fitViewOptions: { padding: isCompact ? 0.02 : 0.08 },
    minZoom: 0.1,
    maxZoom: 3,
    defaultEdgeOptions: {
      type: 'smoothstep' as const,
      markerEnd: { type: 'arrowclosed' as any, width: 14, height: 14 },
    },
    proOptions: { hideAttribution: true },
    style: { background: 'hsl(0 0% 4%)' },
  };

  // ---------- Compact layout (preview panel / narrow viewport) ----------
  if (isCompact) {
    return (
      <div style={{ height: '100%', position: 'relative', background: 'hsl(0 0% 4%)' }}>
        <ReactFlow {...reactFlowProps}>
          <Background variant={BackgroundVariant.Dots} color="hsl(0 0% 18%)" gap={16} size={1} />
          <FitViewAuto layoutKey={layoutKey} compact />
          <CompactToolbar
            meta={meta}
            hiddenLayers={hiddenLayers}
            onToggleLayer={handleToggleLayer}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            connected={connected}
          />
        </ReactFlow>

        <PromptPanel answers={answers} compact />

        {/* Backdrop when bottom sheet is open */}
        {selectedNode && (
          <div
            className="animate-fade-in"
            onClick={() => setSelectedNode(null)}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.3)',
              zIndex: 30,
            }}
          />
        )}

        <NodeDetail
          nodeId={selectedNode}
          onClose={() => setSelectedNode(null)}
          onAskClaude={handleAskClaude}
          pendingCount={pendingQuestions.size}
          isCompact
        />
      </div>
    );
  }

  // ---------- Full layout (standalone browser) ----------
  return (
    <div style={{ display: 'flex', height: '100%', background: 'hsl(0 0% 4%)' }}>
      {sidebarOpen && (
        <Sidebar
          meta={meta}
          hiddenLayers={hiddenLayers}
          onToggleLayer={handleToggleLayer}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          connected={connected}
          watching={watching}
          aiAvailable={aiAvailable}
          enrichProgress={enrichProgress}
          onStartPresentation={() => setViewMode('presentation')}
        />
      )}

      <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%' }}>
        <ReactFlow {...reactFlowProps}>
          <Background variant={BackgroundVariant.Dots} color="hsl(0 0% 12%)" gap={24} size={1} />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              const layer = (node.data as any)?.layer || 'logic';
              return getLayerColor(layer).minimap;
            }}
            maskColor="rgba(0,0,0,0.7)"
          />
          <Legend />
          <FitViewAuto layoutKey={layoutKey} />
        </ReactFlow>
        <PromptPanel answers={answers} />
      </div>

      <NodeDetail
        nodeId={selectedNode}
        onClose={() => setSelectedNode(null)}
        onAskClaude={handleAskClaude}
        pendingCount={pendingQuestions.size}
      />
    </div>
  );
}
