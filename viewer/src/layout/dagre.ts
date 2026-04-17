import Dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

// Layer ordering — top to bottom like an architecture diagram
const LAYER_RANK: Record<string, number> = {
  ui: 0,
  api: 1,
  logic: 2,
  data: 3,
  config: 4,
  external: 5,
};

// User-requested spacious layout — do not reduce these values (standalone mode)
const GROUP_PADDING = { top: 55, bottom: 35, left: 35, right: 35 };
const GROUP_PADDING_COMPACT = { top: 40, bottom: 25, left: 25, right: 25 };

export interface DagreOptions {
  compact?: boolean;
}

function getNodeDimensions(node: Node, compact?: boolean): { width: number; height: number } {
  const isExternal = node.type === 'externalNode';
  if (isExternal) return compact ? { width: 100, height: 30 } : { width: 150, height: 40 };

  if (node.type === 'group') return { width: 0, height: 0 };

  const importance = (node.data as { importance?: number }).importance || 1;
  if (compact) {
    if (importance >= 2) return { width: 180, height: 70 };
    return { width: 140, height: 55 };
  }
  if (importance >= 2) return { width: 240, height: 110 };
  return { width: 200, height: 90 };
}

function getLayerFromNode(node: Node): string {
  return (node.data as { layer?: string }).layer || 'logic';
}

export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  parentMap?: Map<string, string>,
  options?: DagreOptions,
) {
  const compact = options?.compact;
  const padding = compact ? GROUP_PADDING_COMPACT : GROUP_PADDING;

  // Spacing values: compact for preview, spacious for standalone
  const nodesep = compact ? 60 : 120;
  const ranksep = compact ? 100 : 180;
  const edgesep = compact ? 30 : 50;
  const margin = compact ? 30 : 50;

  const g = new Dagre.graphlib.Graph({ compound: true }).setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    nodesep,
    ranksep,
    edgesep,
    marginx: margin,
    marginy: margin,
  });

  // Build a set of group IDs and child IDs for quick lookup
  const groupIds = new Set<string>();
  const childIds = new Set<string>();
  if (parentMap) {
    for (const [childId, groupId] of parentMap) {
      groupIds.add(groupId);
      childIds.add(childId);
    }
  }

  // Add nodes to dagre
  for (const node of nodes) {
    const { width, height } = getNodeDimensions(node, compact);
    g.setNode(node.id, { width, height });
  }

  // Set parent relationships for compound layout
  if (parentMap) {
    for (const [childId, groupId] of parentMap) {
      if (g.hasNode(childId) && g.hasNode(groupId)) {
        g.setParent(childId, groupId);
      }
    }
  }

  // Add real edges
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Layer rank enforcement
  const layerGroups = new Map<number, string[]>();
  for (const node of nodes) {
    if (childIds.has(node.id)) continue;
    const layer = getLayerFromNode(node);
    const rank = LAYER_RANK[layer] ?? 2;
    if (!layerGroups.has(rank)) layerGroups.set(rank, []);
    layerGroups.get(rank)!.push(node.id);
  }

  const sortedRanks = [...layerGroups.keys()].sort((a, b) => a - b);
  for (let i = 0; i < sortedRanks.length - 1; i++) {
    const currentNodes = layerGroups.get(sortedRanks[i])!;
    const nextNodes = layerGroups.get(sortedRanks[i + 1])!;
    const curr = currentNodes.find(id => !groupIds.has(id) && !childIds.has(id));
    const next = nextNodes.find(id => !groupIds.has(id) && !childIds.has(id));
    if (curr && next && curr !== next) {
      g.setEdge(curr, next, { minlen: 1, weight: 0 });
    }
  }

  try {
    Dagre.layout(g);
  } catch {
    // Fallback: retry without compound grouping
    try {
      const g2 = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
      g2.setGraph({ rankdir: 'TB', nodesep, ranksep, edgesep, marginx: margin, marginy: margin });
      for (const node of nodes) {
        const { width, height } = getNodeDimensions(node, compact);
        g2.setNode(node.id, { width: width || 200, height: height || 100 });
      }
      for (const edge of edges) {
        if (g2.hasNode(edge.source) && g2.hasNode(edge.target)) {
          g2.setEdge(edge.source, edge.target);
        }
      }
      Dagre.layout(g2);
      for (const node of nodes) {
        const pos = g2.node(node.id);
        if (pos) g.setNode(node.id, pos);
      }
    } catch {
      // Last resort: grid layout
      let x = 30, y = 30, col = 0;
      for (const node of nodes) {
        const { width, height } = getNodeDimensions(node, compact);
        g.setNode(node.id, { x, y, width: width || 170, height: height || 76 });
        col++;
        x += 220;
        if (col >= 4) { col = 0; x = 30; y += 140; }
      }
    }
  }

  // Collect absolute center positions from dagre
  const absPositions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const pos = g.node(node.id);
    if (pos) absPositions.set(node.id, { x: pos.x, y: pos.y });
  }

  // Compute group bounding boxes
  const groupBounds = new Map<string, { x: number; y: number; width: number; height: number }>();

  for (const groupId of groupIds) {
    const children = [...(parentMap?.entries() || [])].filter(([, gId]) => gId === groupId).map(([cId]) => cId);
    if (children.length === 0) continue;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const cId of children) {
      const pos = absPositions.get(cId);
      if (!pos) continue;
      const cNode = nodes.find(n => n.id === cId);
      if (!cNode) continue;
      const { width, height } = getNodeDimensions(cNode, compact);
      const left = pos.x - width / 2;
      const top = pos.y - height / 2;
      minX = Math.min(minX, left);
      minY = Math.min(minY, top);
      maxX = Math.max(maxX, left + width);
      maxY = Math.max(maxY, top + height);
    }

    const gx = minX - padding.left;
    const gy = minY - padding.top;
    const gw = (maxX - minX) + padding.left + padding.right;
    const gh = (maxY - minY) + padding.top + padding.bottom;

    groupBounds.set(groupId, { x: gx, y: gy, width: gw, height: gh });
  }

  // Build final layouted nodes
  const layoutedNodes = nodes.map(node => {
    const pos = absPositions.get(node.id);
    if (!pos) return { ...node, position: { x: 0, y: 0 } };

    if (groupIds.has(node.id)) {
      const bounds = groupBounds.get(node.id);
      if (bounds) {
        return {
          ...node,
          position: { x: bounds.x, y: bounds.y },
          style: { ...((node.style as Record<string, unknown>) || {}), width: bounds.width, height: bounds.height },
        };
      }
      return { ...node, position: { x: pos.x, y: pos.y } };
    }

    if (parentMap?.has(node.id)) {
      const groupId = parentMap.get(node.id)!;
      const bounds = groupBounds.get(groupId);
      if (bounds) {
        const { width, height } = getNodeDimensions(node, compact);
        return {
          ...node,
          position: {
            x: (pos.x - width / 2) - bounds.x,
            y: (pos.y - height / 2) - bounds.y,
          },
        };
      }
    }

    const { width, height } = getNodeDimensions(node, compact);
    return {
      ...node,
      position: { x: pos.x - width / 2, y: pos.y - height / 2 },
    };
  });

  // Compute layer Y-ranges for swim lane rendering
  const layerBounds: Record<string, { minY: number; maxY: number }> = {};
  for (const node of layoutedNodes) {
    if (childIds.has(node.id)) continue;
    const layer = getLayerFromNode(node);

    let top: number, bottom: number;
    if (groupIds.has(node.id)) {
      const bounds = groupBounds.get(node.id);
      if (!bounds) continue;
      top = bounds.y;
      bottom = bounds.y + bounds.height;
    } else {
      const { height } = getNodeDimensions(node, compact);
      top = node.position.y;
      bottom = top + height;
    }

    if (!layerBounds[layer]) {
      layerBounds[layer] = { minY: top, maxY: bottom };
    } else {
      layerBounds[layer].minY = Math.min(layerBounds[layer].minY, top);
      layerBounds[layer].maxY = Math.max(layerBounds[layer].maxY, bottom);
    }
  }

  return { nodes: layoutedNodes, edges, layerBounds };
}
