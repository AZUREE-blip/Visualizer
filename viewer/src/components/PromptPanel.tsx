import { useState } from 'react';
import type { BridgeAnswer } from '../types';

interface PromptPanelProps {
  answers: BridgeAnswer[];
  compact?: boolean;
}

export function PromptPanel({ answers, compact }: PromptPanelProps) {
  const [hovered, setHovered] = useState(false);

  if (answers.length === 0) return null;

  const collapsedHeight = compact ? '120px' : '180px';
  const expandedHeight = '70vh';

  return (
    <div
      className="animate-fade-in-up"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'absolute',
        bottom: compact ? '8px' : '16px',
        left: compact ? '8px' : '16px',
        right: compact ? '8px' : '16px',
        maxHeight: hovered ? expandedHeight : collapsedHeight,
        overflow: 'auto',
        background: 'hsl(0 0% 6%)',
        border: `1px solid ${hovered ? 'hsl(0 0% 22%)' : 'hsl(0 0% 14%)'}`,
        borderRadius: compact ? '8px' : '12px',
        padding: compact ? '10px' : '14px',
        zIndex: 10,
        backdropFilter: 'blur(12px)',
        transition: 'max-height 0.3s ease, border-color 0.2s ease',
      }}
    >
      <div style={{ fontSize: '9px', color: 'hsl(0 0% 30%)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: compact ? '4px' : '8px', fontWeight: 600 }}>
        Answers
      </div>
      {answers.map((a, i) => (
        <div key={i} style={{
          padding: compact ? '6px 8px' : '10px',
          background: a.error ? 'hsl(0 10% 8%)' : 'hsl(0 0% 8%)',
          borderRadius: compact ? '6px' : '8px',
          marginBottom: '6px',
          fontSize: compact ? '10px' : '11px',
          border: `1px solid ${a.error ? 'hsl(0 30% 20%)' : 'hsl(0 0% 12%)'}`,
        }}>
          <div style={{ color: 'hsl(0 0% 60%)', marginBottom: '4px' }}>
            Q: {a.question} <span style={{ color: 'hsl(0 0% 30%)' }}>({a.nodeLabel})</span>
          </div>
          <div style={{ color: a.error ? 'hsl(0 40% 65%)' : 'hsl(0 0% 80%)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
            {a.answer}
          </div>
        </div>
      ))}
    </div>
  );
}
