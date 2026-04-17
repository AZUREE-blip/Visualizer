import { useState, useEffect } from 'react';
import type { Node, Edge } from '@xyflow/react';
import type { GraphData, GraphNode, LayerType } from '../types';
import { applyDagreLayout } from '../layout/dagre';
import { getLayerColor } from '../layerColors';

const API_BASE = '';

function edgeStroke(count: number): number {
  if (count >= 6) return 3.5;
  if (count >= 3) return 2.5;
  return 1.25;
}

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
    const externals = rawData.nodes.filter(n => n.type === 'external');

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
    function canonical(fileId: string): string {
      return fileToModule.get(fileId) || fileId;
    }

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

    // Module nodes
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
    }

    // Ungrouped files — rendered at module grain alongside modules
    for (const f of files) {
      if (fileToModule.has(f.id)) continue;
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
    }

    // Externals (hidden by default via hiddenLayers containing 'external')
    if (!hiddenLayers.has('external')) {
      const extColor = getLayerColor('external');
      for (const e of externals) {
        rfNodes.push({
          id: e.id,
          type: 'externalNode',
          position: { x: 0, y: 0 },
          data: {
            ...e,
            color: extColor.primary,
            layerColor: extColor,
            dimmed: searchQuery ? !e.label.toLowerCase().includes(searchLower) : false,
            importance: 1,
          },
        });
      }
    }

    // ── Aggregate edges at canonical (module-or-file) grain ─────────────
    // For each raw file-edge, map both endpoints to their canonical node.
    // Skip self-edges (internal to a module). Count duplicates → thickness.
    const visibleIds = new Set(rfNodes.map(n => n.id));
    const agg = new Map<string, { source: string; target: string; count: number; sourceLayer: string }>();

    for (const e of rawData.edges) {
      const src = canonical(e.source);
      const tgt = canonical(e.target);
      if (src === tgt) continue;
      if (!visibleIds.has(src) || !visibleIds.has(tgt)) continue;

      const key = `${src}->${tgt}`;
      const existing = agg.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        // Resolve source layer from the canonical source node
        const srcNode = rfNodes.find(n => n.id === src);
        const sourceLayer = (srcNode?.data as any)?.layer || 'logic';
        agg.set(key, { source: src, target: tgt, count: 1, sourceLayer });
      }
    }

    const rfEdges: Edge[] = [];
    for (const [key, a] of agg) {
      const lc = getLayerColor(a.sourceLayer);
      rfEdges.push({
        id: `e-${key}`,
        source: a.source,
        target: a.target,
        type: 'smoothstep',
        style: { stroke: lc.edge, strokeWidth: edgeStroke(a.count) },
        data: { count: a.count, sourceLayer: a.sourceLayer, edgeType: 'import' },
      });
    }

    const { nodes: layouted, edges: layoutedEdges, layerBounds: bounds } = applyDagreLayout(rfNodes, rfEdges, undefined, { compact });
    setNodes(layouted);
    setEdges(layoutedEdges);
    setLayerBounds(bounds);
  }, [rawData, hiddenLayers, searchQuery, compact]);

  return { nodes, edges, layerBounds, meta: rawData?.meta ?? null, loading, error, setNodes, setEdges };
}
