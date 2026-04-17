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
    const hierarchyEdge = { stroke: 'hsl(0 0% 20%)', strokeWidth: 1.5 };
    const depEdge = { stroke: 'hsl(0 0% 35%)', strokeWidth: 1.5 };

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

    // Only modules — no individual files
    for (const [id, meta] of moduleMeta) {
      if (!isModuleVisible(id)) continue;
      const lc = getLayerColor(meta.layer);

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
          importance: meta.fileCount >= 5 ? 3 : 2,
          childLabels: meta.children.map(c => c.label),
          childDescriptions: meta.children.map(c => (c as any).description || ''),
        },
      });

      // Hierarchy edge: root → module
      rfEdges.push({
        id: `h-root-${id}`,
        source: '__root__',
        target: id,
        type: 'smoothstep',
        style: hierarchyEdge,
        data: {},
      });
    }

    // Ungrouped files as single nodes (files not in any module)
    for (const f of files) {
      if (fileToModule.has(f.id)) continue;
      if (!isFileVisible(f)) continue;
      const lc = getLayerColor(f.layer);
      rfNodes.push({
        id: f.id,
        type: 'fileNode',
        position: { x: 0, y: 0 },
        data: {
          ...f, color: lc.primary, layerColor: lc,
          dimmed: searchQuery ? !f.label.toLowerCase().includes(searchLower) : false,
          description: (f as any).description || '', importance: 1,
        },
      });
      rfEdges.push({
        id: `h-root-${f.id}`,
        source: '__root__',
        target: f.id,
        type: 'smoothstep',
        style: hierarchyEdge,
        data: {},
      });
    }

    // Inter-module dependency edges (max 2 per source node)
    const visibleIds = new Set(rfNodes.map(n => n.id));
    const seenPairs = new Set<string>();
    const edgesPerSource = new Map<string, number>();

    for (const e of rawData.edges) {
      const srcMod = fileToModule.get(e.source) || e.source;
      const tgtMod = fileToModule.get(e.target) || e.target;
      if (srcMod === tgtMod) continue;
      if (!visibleIds.has(srcMod) || !visibleIds.has(tgtMod)) continue;
      const key = `${srcMod}->${tgtMod}`;
      if (seenPairs.has(key)) continue;
      seenPairs.add(key);
      const count = edgesPerSource.get(srcMod) || 0;
      if (count >= 2) continue;
      edgesPerSource.set(srcMod, count + 1);

      rfEdges.push({
        id: `dep-${key}`,
        source: srcMod,
        target: tgtMod,
        type: 'smoothstep',
        style: depEdge,
        animated: true,
        data: { edgeType: 'dependency' },
      });
    }

    const { nodes: layouted, edges: layoutedEdges, layerBounds: bounds } = applyDagreLayout(rfNodes, rfEdges, undefined, { compact });
    setNodes(layouted);
    setEdges(layoutedEdges);
    setLayerBounds(bounds);
  }, [rawData, hiddenLayers, searchQuery, compact]);

  return { nodes, edges, layerBounds, meta: rawData?.meta ?? null, loading, error, setNodes, setEdges };
}
