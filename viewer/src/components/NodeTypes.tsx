import { Handle, Position } from '@xyflow/react';
import { getLayerColor, type LayerColorSet } from '../layerColors';
import type { ConnectionType } from '../hooks/useSelectionHighlight';

interface NodeData {
  label: string;
  description?: string;
  color: string;
  layerColor?: LayerColorSet;
  dimmed: boolean;
  importance?: number;
  type: string;
  layer: string;
  filePath: string;
  linesOfCode: number;
  exports: string[];
  childLabels?: string[];
  fileCount?: number;
  fanIn?: number;
  fanOut?: number;
  moduleName?: string;
  selected?: boolean;
  connectionType?: ConnectionType;
  selectionDimmed?: boolean;
  [key: string]: unknown;
}

// Minimal invisible handle
const hHidden = { background: 'transparent', width: 4, height: 4, border: 'none' };

function opacity(data: NodeData): number {
  return (data.dimmed || data.selectionDimmed) ? 0.12 : 1;
}

function border(data: NodeData): string {
  const lc = data.layerColor || getLayerColor(data.layer);
  if (data.selected) return `2px solid ${lc.primary}`;
  if (data.connectionType) return `1.5px solid ${lc.text}`;
  return `1px solid ${lc.border}`;
}

// ── ModuleNode (overview mode) ──────────────────────────────────────
// Simple box: name + file count. No icons, no shadows.

export function ModuleNode({ data }: { data: NodeData }) {
  const lc = data.layerColor || getLayerColor(data.layer);
  const files = data.fileCount || 0;
  const isRoot = data.importance === 3;

  return (
    <div style={{
      position: 'relative',
      opacity: opacity(data),
      background: isRoot ? 'hsl(0 0% 12%)' : lc.bg,
      border: border(data),
      borderRadius: isRoot ? '14px' : '10px',
      padding: isRoot ? '18px 28px' : '12px 18px',
      minWidth: isRoot ? '180px' : '120px',
      cursor: 'pointer',
      transition: 'opacity 0.25s ease',
      textAlign: 'center',
    }}>
      <Handle type="target" position={Position.Top} style={{ ...hHidden, top: -2 }} />
      <div style={{
        fontSize: isRoot ? '18px' : '14px',
        fontWeight: 600,
        color: isRoot ? 'hsl(0 0% 90%)' : lc.text,
      }}>
        {data.label}
      </div>
      {files > 0 && (
        <div style={{ fontSize: '11px', color: 'hsl(0 0% 45%)', marginTop: '2px' }}>
          {files} files
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ ...hHidden, bottom: -2 }} />
    </div>
  );
}

// ── FileNode (detailed mode) ────────────────────────────────────────
// Just the name. Color = layer. That's it.

export function FileNode({ data }: { data: NodeData }) {
  const lc = data.layerColor || getLayerColor(data.layer);

  return (
    <div style={{
      position: 'relative',
      opacity: opacity(data),
      background: lc.bg,
      border: border(data),
      borderRadius: '8px',
      padding: '8px 14px',
      minWidth: '100px',
      cursor: 'pointer',
      transition: 'opacity 0.25s ease',
    }}>
      <Handle type="target" position={Position.Top} style={{ ...hHidden, top: -2 }} />
      <div style={{
        fontSize: '13px',
        fontWeight: 500,
        color: lc.text,
      }}>
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...hHidden, bottom: -2 }} />
    </div>
  );
}

// ── ExternalNode ────────────────────────────────────────────────────
// Dashed border, muted. Clearly "not your code".

export function ExternalNode({ data }: { data: NodeData }) {
  return (
    <div style={{
      position: 'relative',
      opacity: (data.dimmed || data.selectionDimmed) ? 0.1 : 0.6,
      border: '1px dashed hsl(0 0% 30%)',
      borderRadius: '14px',
      padding: '5px 12px',
      cursor: 'pointer',
      transition: 'opacity 0.25s ease',
    }}>
      <Handle type="target" position={Position.Top} style={{ ...hHidden, top: -2 }} />
      <div style={{ fontSize: '11px', color: 'hsl(0 0% 50%)' }}>
        {data.label}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ ...hHidden, bottom: -2 }} />
    </div>
  );
}

// ── GroupNode (kept for compatibility, not used in new layout) ───────

export function GroupNode({ data }: { data: NodeData }) {
  return (
    <div style={{
      width: '100%', height: '100%',
      border: '1px solid hsl(0 0% 20%)',
      borderRadius: '12px',
      position: 'relative',
      opacity: (data.dimmed || data.selectionDimmed) ? 0.1 : 0.5,
    }} />
  );
}

// Aliases
export function ComponentNode({ data }: { data: NodeData }) { return <FileNode data={data} />; }
export function RouteNode({ data }: { data: NodeData }) { return <FileNode data={data} />; }
export function DatabaseNode({ data }: { data: NodeData }) { return <FileNode data={data} />; }

export const nodeTypes = {
  fileNode: FileNode,
  componentNode: ComponentNode,
  routeNode: RouteNode,
  databaseNode: DatabaseNode,
  externalNode: ExternalNode,
  moduleNode: ModuleNode,
  group: GroupNode,
};
