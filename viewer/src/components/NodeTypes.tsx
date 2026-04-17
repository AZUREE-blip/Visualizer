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
  const childLabels = (data.childLabels || []) as string[];
  const childDescs = (data.childDescriptions || []) as string[];

  return (
    <div style={{
      position: 'relative',
      opacity: opacity(data),
      background: isRoot ? 'hsl(0 0% 10%)' : lc.bg,
      border: border(data),
      borderRadius: isRoot ? '14px' : '10px',
      padding: isRoot ? '18px 28px' : '14px 18px',
      minWidth: isRoot ? '200px' : '160px',
      maxWidth: '260px',
      cursor: 'pointer',
      transition: 'opacity 0.25s ease',
    }}>
      <Handle type="target" position={Position.Top} style={{ ...hHidden, top: -2 }} />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: childLabels.length > 0 ? '8px' : 0 }}>
        <div style={{
          width: '8px', height: '8px', borderRadius: '50%',
          background: isRoot ? 'hsl(0 0% 50%)' : lc.dot,
          flexShrink: 0,
        }} />
        <div>
          <div style={{
            fontSize: isRoot ? '16px' : '13px',
            fontWeight: 700,
            color: isRoot ? 'hsl(0 0% 93%)' : lc.text,
            letterSpacing: '-0.01em',
          }}>
            {data.label}
          </div>
          <div style={{ fontSize: '10px', color: 'hsl(0 0% 40%)', marginTop: '1px' }}>
            {files > 0 ? `${files} files` : ''}{data.linesOfCode > 0 ? ` · ${data.linesOfCode}L` : ''}{data.layer !== 'logic' ? ` · ${data.layer}` : ''}
          </div>
        </div>
      </div>

      {/* Child file list inside the node */}
      {childLabels.length > 0 && (
        <div style={{
          borderTop: `1px solid ${isRoot ? 'hsl(0 0% 16%)' : lc.border}`,
          paddingTop: '6px',
          display: 'flex',
          flexDirection: 'column',
          gap: '3px',
        }}>
          {childLabels.slice(0, 6).map((label, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span style={{ fontSize: '10px', color: 'hsl(0 0% 55%)', fontWeight: 500 }}>{label}</span>
              {childDescs[i] && (
                <span style={{ fontSize: '9px', color: 'hsl(0 0% 35%)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '120px' }}>
                  {childDescs[i]}
                </span>
              )}
            </div>
          ))}
          {childLabels.length > 6 && (
            <div style={{ fontSize: '9px', color: 'hsl(0 0% 30%)' }}>
              +{childLabels.length - 6} more
            </div>
          )}
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
