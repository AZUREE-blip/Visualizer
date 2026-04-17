import { useState } from 'react';
import type { LayerType, GraphMeta, EnrichProgress } from '../types';
import { getLayerColor } from '../layerColors';

const LAYERS: { key: LayerType; label: string }[] = [
  { key: 'ui', label: 'UI' },
  { key: 'api', label: 'API' },
  { key: 'logic', label: 'Logic' },
  { key: 'data', label: 'Data' },
  { key: 'external', label: 'External' },
  { key: 'config', label: 'Config' },
];

interface SidebarProps {
  meta: GraphMeta | null;
  hiddenLayers: Set<LayerType>;
  onToggleLayer: (layer: LayerType) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  connected: boolean;
  watching?: boolean;
  aiAvailable?: boolean;
  enrichProgress?: EnrichProgress | null;
  onStartPresentation?: () => void;
  isNarrow?: boolean;
  onClose?: () => void;
}

export function Sidebar({ meta, hiddenLayers, onToggleLayer, searchQuery, onSearchChange, connected, watching, aiAvailable, enrichProgress, onStartPresentation, isNarrow, onClose }: SidebarProps) {
  const [enriching, setEnriching] = useState(false);

  const handleEnrich = async () => {
    setEnriching(true);
    try {
      await fetch('/api/enrich-auto', { method: 'POST' });
    } catch (err) {
      console.error('Enrich request failed:', err);
    }
    setEnriching(false);
  };

  return (
    <div className={`animate-slide-in-left sidebar ${isNarrow ? 'sidebar--narrow' : ''}`}>
      {/* Header */}
      <div className="sidebar-header">
        <div>
          <h2 className="sidebar-title">
            {meta?.projectName || 'Codebase'}
          </h2>
          <div className="sidebar-meta">
            {meta ? `${meta.fileCount} files` : ''}
            {meta?.framework ? ` \u00B7 ${meta.framework}` : ''}
          </div>
          <div className={`sidebar-status ${connected ? 'sidebar-status--on' : 'sidebar-status--off'}`}>
            <span className={`status-dot ${connected ? 'status-dot--connected' : 'status-dot--disconnected'}`} />
            {connected ? 'Connected' : 'Disconnected'}
          </div>
          {watching && (
            <div className="sidebar-status sidebar-status--on">
              <span className="status-dot status-dot--watching" />
              Watching for changes
            </div>
          )}
          <div className={`sidebar-status ${aiAvailable ? 'sidebar-status--on' : 'sidebar-status--off'}`}>
            <span className={`status-dot ${aiAvailable ? 'status-dot--ai-on' : 'status-dot--ai-off'}`} />
            {aiAvailable ? 'AI ready' : 'AI unavailable'}
          </div>
        </div>
        {isNarrow && onClose && (
          <button onClick={onClose} className="sidebar-close">{'\u00D7'}</button>
        )}
      </div>

      {/* Actions */}
      {onStartPresentation && (
        <div>
          <button onClick={onStartPresentation} className="sidebar-btn" style={{ width: '100%' }}>
            {'\u25B6'} Tour
          </button>
        </div>
      )}

      {/* AI Enrich */}
      {aiAvailable && (
        <button
          onClick={handleEnrich}
          disabled={enriching}
          className={`sidebar-btn ${enriching ? 'sidebar-btn--enriching' : ''}`}
        >
          {enriching
            ? enrichProgress
              ? `Enriching ${enrichProgress.completed}/${enrichProgress.total}...`
              : 'Starting enrichment...'
            : 'Enrich with AI'}
        </button>
      )}

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search\u2026"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="sidebar-search"
        />
      </div>

      {/* Layers */}
      <div>
        <div className="section-label">Layers</div>
        <div className="layer-list">
          {LAYERS.map(layer => {
            const hidden = hiddenLayers.has(layer.key);
            const color = getLayerColor(layer.key);
            return (
              <label
                key={layer.key}
                className={`layer-item ${hidden ? 'layer-item--hidden' : 'layer-item--active'}`}
              >
                <div
                  className="layer-dot"
                  style={{ background: hidden ? 'hsl(0 0% 12%)' : color.dot }}
                />
                <input
                  type="checkbox"
                  checked={!hidden}
                  onChange={() => onToggleLayer(layer.key)}
                  style={{ display: 'none' }}
                />
                <span style={{ color: hidden ? undefined : color.text }}>{layer.label}</span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}
