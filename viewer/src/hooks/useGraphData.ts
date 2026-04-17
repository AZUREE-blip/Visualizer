import { useState, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { GraphData, GraphNode, LayerType } from '../types';
import { applyDagreLayout } from '../layout/dagre';
import { getLayerColor } from '../layerColors';

const API_BASE = '';

function dominantLayer(children: GraphNode[]): LayerType {
  const counts: Record<string, number> = {};
  for (const c of children) counts[c.layer] = (counts[c.layer] || 0) + 1;
  let max = 0, best: LayerType = 'logic';
  for (const [layer, count] of Object.entries(counts)) {
    if (count > max) { max = count; best = layer as LayerType; }
  }
  return best;
}

export interface LayerBounds {
  [layer: string]: { minY: number; maxY: number };
}

export function useGraphData(hiddenLayers: Set<LayerType>, searchQuery: string, graphVersion: number, compact?: boolean) {
  const [rawData, setRawData] = useState<GraphData | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [layerBounds, setLayerBounds] = useState<LayerBounds>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/graph`)
      .then(r => {
        if (!r.ok) throw new Error('No graph data. Run the analyzer first.');
        return r.json();
      })
      .then(data => { setRawData(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [graphVersion]);

  useEffect(() => {
    if (!rawData) return;
    const searchLower = searchQuery.toLowerCase();

    const modules = rawData.nodes.filter(n => n.type === 'module');
    const files = rawData.nodes.filter(n => n.type !== 'module' && n.type !== 'external');
    // const externals = rawData.nodes.filter(n => n.type === 'external');

    // Map each file → its module (if any)
    const fileToModule = new Map<string, string>();
    for (const mod of modules) {
      for (const childId of mod.children || []) fileToModule.set(childId, mod.id);
    }

    // Per-module metadata (dominant layer, file count, lines)
    interface ModuleMeta {
      node: GraphNode;
      layer: LayerType;
      children: GraphNode[];
      fileCount: number;
      linesOfCode: number;
      labelMatches: boolean;
    }
    const moduleMeta = new Map<string, ModuleMeta>();
    for (const mod of modules) {
      const children = files.filter(f => mod.children?.includes(f.id));
      if (children.length === 0) continue;
      const layer = dominantLayer(children);
      const labelMatches =
        mod.label.toLowerCase().includes(searchLower) ||
        children.some(c => c.label.toLowerCase().includes(searchLower));
      moduleMeta.set(mod.id, {
        node: mod,
        layer,
        children,
        fileCount: children.length,
        linesOfCode: children.reduce((s, c) => s + c.linesOfCode, 0),
        labelMatches,
      });
    }

    // Resolve a file's canonical visible node id (module if present, else file id)
    // Visibility: module hidden if its dominant layer is hidden; file hidden by its own layer
    function isModuleVisible(id: string): boolean {
      const meta = moduleMeta.get(id);
      if (!meta) return false;
      return !hiddenLayers.has(meta.layer);
    }
    function isFileVisible(f: GraphNode): boolean {
      return !hiddenLayers.has(f.layer);
    }

    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];
    const edgeColor = { stroke: 'hsl(0 0% 25%)', strokeWidth: 1.5 };

    // Root project node
    const projectName = rawData.meta?.projectName || 'Project';
    const projectLc = getLayerColor('logic');
    rfNodes.push({
      id: '__root__',
      type: 'moduleNode',
      position: { x: 0, y: 0 },
      data: {
        label: projectName, type: 'module', layer: 'logic', filePath: '',
        linesOfCode: files.reduce((s, f) => s + f.linesOfCode, 0),
        exports: [], color: projectLc.primary, layerColor: projectLc,
        dimmed: false, fileCount: files.length, importance: 3,
      },
    });

    // Module nodes with hierarchy edges
    const moduleIds = new Set(modules.map(m => m.id));

    function findParentModule(modPath: string): string {
      const parts = modPath.split('/');
      for (let i = parts.length - 1; i >= 1; i--) {
        const parentPath = parts.slice(0, i).join('/');
        const parentId = `module:${parentPath}`;
        if (moduleIds.has(parentId)) return parentId;
      }
      return '__root__';
    }

    for (const [id, meta] of moduleMeta) {
      if (!isModuleVisible(id)) continue;
      const lc = getLayerColor(meta.layer);
      const importance = meta.fileCount >= 5 ? 3 : meta.fileCount >= 2 ? 2 : 1;

      rfNodes.push({
        id,
        type: 'moduleNode',
        position: { x: 0, y: 0 },
        data: {
          ...meta.node,
          layer: meta.layer,
          color: lc.primary,
          layerColor: lc,
          dimmed: searchQuery ? !meta.labelMatches : false,
          linesOfCode: meta.linesOfCode,
          fileCount: meta.fileCount,
          importance,
        },
      });

      // Hierarchy edge: parent → module
      const parentId = findParentModule(meta.node.filePath);
      rfEdges.push({
        id: `h-${parentId}-${id}`,
        source: parentId,
        target: id,
        type: 'smoothstep',
        style: edgeColor,
        data: {},
      });
    }

    // ALL files as individual nodes (not just ungrouped)
    for (const f of files) {
      if (!isFileVisible(f)) continue;
      const lc = getLayerColor(f.layer);
      rfNodes.push({
        id: f.id,
        type: 'fileNode',
        position: { x: 0, y: 0 },
        data: {
          ...f,
          color: lc.primary,
          layerColor: lc,
          dimmed: searchQuery ? !f.label.toLowerCase().includes(searchLower) : false,
          description: (f as any).description || '',
          importance: 1,
        },
      });

      // Hierarchy edge: module/root → file
      const parentId = fileToModule.get(f.id) || '__root__';
      if (parentId === '__root__' || rfNodes.some(n => n.id === parentId)) {
        rfEdges.push({
          id: `h-${parentId}-${f.id}`,
          source: parentId,
          target: f.id,
          type: 'smoothstep',
          style: edgeColor,
          data: {},
        });
      }
    }

    // Dependency edges between files
    const visibleIds = new Set(rfNodes.map(n => n.id));
    for (const e of rawData.edges) {
      if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) continue;
      const sourceNode = rawData.nodes.find(n => n.id === e.source);
      const sourceLayer = sourceNode?.layer || 'logic';
      const lc = getLayerColor(sourceLayer);
      rfEdges.push({
        id: `e-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        style: { stroke: lc.edge, strokeWidth: 1.5 },
        animated: true,
        data: { symbols: (e as any).symbols || [], edgeType: e.type, sourceLayer },
      });
    }

    const { nodes: layouted, edges: layoutedEdges, layerBounds: bounds } = applyDagreLayout(rfNodes, rfEdges, undefined, { compact });
    setNodes(layouted);
    setEdges(layoutedEdges);
    setLayerBounds(bounds);
  }, [rawData, hiddenLayers, searchQuery, compact]);

  return { nodes, edges, layerBounds, meta: rawData?.meta ?? null, loading, error, setNodes, setEdges };
}
