import { Panel } from '@xyflow/react';

export function Legend() {
  return (
    <Panel position="bottom-left" style={{ margin: '0 0 12px 12px' }}>
      <div style={{
        background: 'hsl(0 0% 6%)',
        border: '1px solid hsl(0 0% 16%)',
        borderRadius: '8px',
        padding: '8px 12px',
        fontSize: '10px',
        color: 'hsl(0 0% 50%)',
        lineHeight: 1.8,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'hsl(210 55% 55%)', flexShrink: 0 }} />
          <span style={{ color: 'hsl(210 40% 80%)' }}>Frontend</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'hsl(150 45% 48%)', flexShrink: 0 }} />
          <span style={{ color: 'hsl(150 30% 78%)' }}>Backend</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: 'hsl(0 0% 45%)', flexShrink: 0 }} />
          <span style={{ color: 'hsl(0 0% 68%)' }}>Config / Deps</span>
        </div>
        <div style={{ marginTop: '4px', fontSize: '9px', color: 'hsl(0 0% 35%)' }}>
          Lines = contains. Click a box for details.
        </div>
      </div>
    </Panel>
  );
}
