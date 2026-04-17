import { useState, useRef, useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import type { LayerType, GraphMeta } from '../types';

const LAYERS: { key: LayerType; label: string }[] = [
  { key: 'ui', label: 'UI' },
  { key: 'api', label: 'API' },
  { key: 'logic', label: 'Logic' },
  { key: 'data', label: 'Data' },
  { key: 'external', label: 'External' },
  { key: 'config', label: 'Config' },
];

interface CompactToolbarProps {
  meta: GraphMeta | null;
  hiddenLayers: Set<LayerType>;
  onToggleLayer: (layer: LayerType) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  connected: boolean;
}

export function CompactToolbar({ meta, hiddenLayers, onToggleLayer, searchQuery, onSearchChange, connected }: CompactToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [layerOpen, setLayerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const { fitView } = useReactFlow();

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [searchOpen]);

  // Close layer dropdown on outside click
  useEffect(() => {
    if (!layerOpen) return;
    const handler = (e: MouseEvent) => {
      if (layerRef.current && !layerRef.current.contains(e.target as Node)) {
        setLayerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [layerOpen]);

  const btnStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'hsl(0 0% 60%)',
    cursor: 'pointer',
    padding: '4px 6px',
    fontSize: '14px',
    lineHeight: 1,
    borderRadius: '6px',
    transition: 'background 0.15s',
  };

  return (
    <div style={{
      position: 'absolute',
      top: '8px',
      left: '8px',
      right: '8px',
      zIndex: 5,
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      background: 'hsl(0 0% 6% / 0.92)',
      backdropFilter: 'blur(8px)',
      border: '1px solid hsl(0 0% 14%)',
      borderRadius: '10px',
      padding: '5px 10px',
      height: '36px',
    }}>
      {/* Connection dot */}
      <span style={{
        width: '5px', height: '5px', borderRadius: '50%',
        background: connected ? 'hsl(0 0% 60%)' : 'hsl(0 0% 25%)',
        flexShrink: 0,
      }} />

      {/* Project name */}
      <span style={{
        fontSize: '11px',
        fontWeight: 600,
        color: 'hsl(0 0% 80%)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        flex: 1,
        minWidth: 0,
      }}>
        {meta?.projectName || 'Codebase'}
      </span>

      {/* Search */}
      {searchOpen ? (
        <input
          ref={searchRef}
          type="text"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          onBlur={() => { if (!searchQuery) setSearchOpen(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onSearchChange('');
              setSearchOpen(false);
            }
          }}
          style={{
            width: '120px',
            padding: '3px 8px',
            background: 'hsl(0 0% 10%)',
            border: '1px solid hsl(0 0% 25%)',
            borderRadius: '6px',
            color: 'hsl(0 0% 85%)',
            fontSize: '11px',
            outline: 'none',
          }}
        />
      ) : (
        <button
          onClick={() => setSearchOpen(true)}
          style={btnStyle}
          onMouseEnter={e => e.currentTarget.style.background = 'hsl(0 0% 14%)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
          title="Search"
        >
          {'\u2315'}
        </button>
      )}

      {/* Layer filter */}
      <div ref={layerRef} style={{ position: 'relative' }}>
        <button
          onClick={() => setLayerOpen(!layerOpen)}
          style={{
            ...btnStyle,
            color: hiddenLayers.size > 0 ? 'hsl(0 0% 85%)' : 'hsl(0 0% 60%)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'hsl(0 0% 14%)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
          title="Filter layers"
        >
          {'\u2630'}
        </button>

        {layerOpen && (
          <div style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '4px',
            background: 'hsl(0 0% 8%)',
            border: '1px solid hsl(0 0% 18%)',
            borderRadius: '8px',
            padding: '6px',
            minWidth: '110px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            zIndex: 10,
          }}>
            {LAYERS.map(layer => (
              <label
                key={layer.key}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '4px 6px', borderRadius: '4px',
                  cursor: 'pointer', fontSize: '11px',
                  color: hiddenLayers.has(layer.key) ? 'hsl(0 0% 30%)' : 'hsl(0 0% 70%)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'hsl(0 0% 12%)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{
                  width: '8px', height: '8px', borderRadius: '2px',
                  background: hiddenLayers.has(layer.key) ? 'hsl(0 0% 15%)' : 'hsl(0 0% 45%)',
                  flexShrink: 0,
                }} />
                <input
                  type="checkbox"
                  checked={!hiddenLayers.has(layer.key)}
                  onChange={() => onToggleLayer(layer.key)}
                  style={{ display: 'none' }}
                />
                {layer.label}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Fit view */}
      <button
        onClick={() => fitView({ padding: 0.02, duration: 300 })}
        style={btnStyle}
        onMouseEnter={e => e.currentTarget.style.background = 'hsl(0 0% 14%)'}
        onMouseLeave={e => e.currentTarget.style.background = 'none'}
        title="Fit to view"
      >
        {'\u2922'}
      </button>
    </div>
  );
}
