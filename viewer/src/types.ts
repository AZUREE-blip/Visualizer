export interface GraphMeta {
  projectName: string;
  analyzedAt: string;
  rootDir: string;
  fileCount: number;
  framework?: string;
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'file' | 'module' | 'database' | 'external' | 'route' | 'component';
  filePath: string;
  layer: 'ui' | 'api' | 'logic' | 'data' | 'external' | 'config';
  linesOfCode: number;
  exports: string[];
  children?: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'import' | 'route' | 'database' | 'api-call';
  label?: string;
  symbols?: string[];
}

export interface GraphData {
  meta: GraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ConnectionInfo {
  id: string;
  label: string;
  type: string;
  layer: string;
  description: string;
  symbols: string[];
}

export interface NodeDetail {
  node: GraphNode;
  content: string | null;
  dependencies: ConnectionInfo[];
  dependents: ConnectionInfo[];
}

export interface BridgeQuestion {
  nodeId: string;
  nodeLabel: string;
  filePath: string;
  question: string;
  context?: Record<string, unknown>;
}

export interface BridgeAnswer {
  id: string;
  nodeId: string;
  nodeLabel: string;
  question: string;
  answer: string;
  answeredAt: string;
  error?: boolean;
}

export interface EnrichProgress {
  completed: number;
  total: number;
  current: string;
}

export type LayerType = GraphNode['layer'];
export type NodeType = GraphNode['type'];
