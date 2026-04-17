import { Panel, useStore } from '@xyflow/react';
import type { LayerBounds } from '../hooks/useGraphData';
import { getLayerColor, LAYER_INFO } from '../layerColors';

interface LayerLanesProps {
  layerBounds: LayerBounds;
}

export function LayerLanes({ layerBounds }: LayerLanesProps) {
  const activeLayers = LAYER_INFO.filter(l => layerBounds[l.key]);
  if (activeLayers.length === 0) return null;

  return (
    <Panel position="top-left" style={{ margin: '12px 0 0 12px' }}>
      <div className="layer-lanes">
        <div className="layer-lanes-title">Architecture Flow</div>
        {activeLayers.map((layer, i) => {
          const color = getLayerColor(layer.key);
          return (
            <div key={layer.key} className="layer-lane">
              {i > 0 && <div className="layer-lane-connector" />}
              <div className="layer-lane-dot" style={{ background: color.dot }} />
              <div>
                <div className="layer-lane-label" style={{ color: color.text }}>{layer.label}</div>
                <div className="layer-lane-desc">{layer.description}</div>
              </div>
            </div>
          );
        })}
        <div className="layer-lanes-footer">Top {'\u2192'} Bottom flow</div>
      </div>
    </Panel>
  );
}

// Swimlane bands rendered behind nodes in the flow viewport
export function SwimLaneBands({ layerBounds }: LayerLanesProps) {
  const transform = useStore((s) => s.transform);
  const [, ty, zoom] = transform;

  const activeLayers = LAYER_INFO.filter(l => layerBounds[l.key]);
  if (activeLayers.length === 0) return null;

  const PAD = 40;

  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      pointerEvents: 'none', overflow: 'hidden', zIndex: 0,
    }}>
      {activeLayers.map(layer => {
        const bounds = layerBounds[layer.key];
        if (!bounds) return null;
        const color = getLayerColor(layer.key);
        const top = (bounds.minY - PAD) * zoom + ty;
        const height = (bounds.maxY - bounds.minY + PAD * 2) * zoom;
        // Don't render if the band is off-screen
        if (top + height < -50 || top > window.innerHeight + 50) return null;
        return (
          <div key={layer.key} style={{
            position: 'absolute',
            top: `${top}px`,
            left: 0,
            right: 0,
            height: `${Math.max(height, 20)}px`,
            background: color.swimlane,
            borderTop: `1px solid hsla(${color.hue} 30% 40% / 0.08)`,
            borderBottom: `1px solid hsla(${color.hue} 30% 40% / 0.08)`,
          }}>
            {/* Label pinned to left edge of viewport */}
            <div style={{
              position: 'absolute',
              left: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              padding: '3px 10px',
              fontSize: '10px',
              fontWeight: 700,
              color: color.text,
              opacity: 0.6,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              pointerEvents: 'none',
              background: `hsla(${color.hue} 20% 10% / 0.5)`,
              borderRadius: '4px',
              whiteSpace: 'nowrap',
            }}>
              {layer.label}
              <span style={{ fontSize: '8px', opacity: 0.6, marginLeft: '6px', fontWeight: 400, letterSpacing: '0.02em' }}>
                {layer.description}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
