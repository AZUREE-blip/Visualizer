import { useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { getLayerColor } from '../layerColors';

export type ConnectionType = 'dependency' | 'dependent' | 'both' | null;

export function useSelectionHighlight(
  nodes: Node[],
  edges: Edge[],
  selectedNodeId: string | null,
) {
  return useMemo(() => {
    if (!selectedNodeId) return { nodes, edges };

    // Build sets of connected node IDs
    const dependencyIds = new Set<string>(); // nodes the selected imports FROM
    const dependentIds = new Set<string>();  // nodes that import the selected
    const connectedEdgeIds = new Set<string>();

    for (const edge of edges) {
      if (edge.source === selectedNodeId) {
        dependencyIds.add(edge.target);
        connectedEdgeIds.add(edge.id);
      }
      if (edge.target === selectedNodeId) {
        dependentIds.add(edge.source);
        connectedEdgeIds.add(edge.id);
      }
    }

    // Determine connection type for each node
    function getConnectionType(nodeId: string): ConnectionType {
      if (nodeId === selectedNodeId) return null;
      const isDep = dependencyIds.has(nodeId);
      const isDependent = dependentIds.has(nodeId);
      if (isDep && isDependent) return 'both';
      if (isDep) return 'dependency';
      if (isDependent) return 'dependent';
      return null;
    }

    // Don't dim parent group nodes of connected children
    const activeGroupIds = new Set<string>();
    for (const node of nodes) {
      const nodeId = node.id;
      const isConn = nodeId === selectedNodeId || dependencyIds.has(nodeId) || dependentIds.has(nodeId);
      if (isConn && node.parentId) {
        activeGroupIds.add(node.parentId as string);
      }
    }
    // Also keep group active if the selected node is inside it
    const selectedNode = nodes.find(n => n.id === selectedNodeId);
    if (selectedNode?.parentId) {
      activeGroupIds.add(selectedNode.parentId as string);
    }

    const isConnected = (nodeId: string) =>
      nodeId === selectedNodeId ||
      dependencyIds.has(nodeId) ||
      dependentIds.has(nodeId) ||
      activeGroupIds.has(nodeId);

    // Enrich nodes
    const highlightedNodes = nodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        selected: node.id === selectedNodeId,
        connectionType: getConnectionType(node.id),
        selectionDimmed: !isConnected(node.id),
      },
    }));

    // Restyle edges
    const highlightedEdges = edges.map(edge => {
      const isHighlighted = connectedEdgeIds.has(edge.id);
      if (isHighlighted) {
        const sourceLayer = (edge.data as any)?.sourceLayer as string || 'logic';
        const lc = getLayerColor(sourceLayer);
        return {
          ...edge,
          style: { stroke: lc.primary, strokeWidth: 2.5 },
          className: 'edge-highlighted',
          zIndex: 10,
          label: '',
        };
      }
      // Dim unrelated edges
      const baseStyle = edge.style || {};
      return {
        ...edge,
        style: {
          ...baseStyle,
          stroke: 'rgba(255,255,255,0.06)',
          strokeWidth: 0.5,
        },
        className: '',
        label: '',
        zIndex: 0,
      };
    });

    return { nodes: highlightedNodes, edges: highlightedEdges };
  }, [nodes, edges, selectedNodeId]);
}
