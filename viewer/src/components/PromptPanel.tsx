import { useState } from 'react';
import type { BridgeAnswer } from '../types';

interface PromptPanelProps {
  answers: BridgeAnswer[];
  compact?: boolean;
}

export function PromptPanel({ answers, compact }: PromptPanelProps) {
  const [hidden, setHidden] = useState(false);

  if (hidden || answers.length === 0) return null;

  return (
    <div
      className="animate-fade-in-up"
      style={{
        position: 'absolute',
        bottom: compact ? '8px' : '16px',
        left: compact ? '8px' : '16px',
        right: compact ? '8px' : '16px',
        maxHeight: '60vh',
        overflow: 'auto',
        background: 'hsl(0 0% 6%)',
        border: '1px solid hsl(0 0% 14%)',
        borderRadius: compact ? '8px' : '12px',
        padding: compact ? '10px' : '14px',
        zIndex: 10,
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: compact ? '4px' : '8px' }}>
        <div style={{ fontSize: '9px', color: 'hsl(0 0% 30%)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600 }}>
          Answers
        </div>
        <button
          onClick={() => setHidden(true)}
          style={{ background: 'none', border: 'none', color: 'hsl(0 0% 30%)', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}
        >
          {'\u00D7'}
        </button>
      </div>
      {answers.map((a) => (
        <div key={a.id} style={{
          padding: compact ? '8px 10px' : '12px',
          background: a.error ? 'hsl(0 10% 8%)' : 'hsl(0 0% 8%)',
          borderRadius: compact ? '6px' : '8px',
          marginBottom: '6px',
          fontSize: compact ? '11px' : '12px',
          border: `1px solid ${a.error ? 'hsl(0 30% 20%)' : 'hsl(0 0% 12%)'}`,
        }}>
          <div style={{ color: 'hsl(0 0% 55%)', marginBottom: '6px', fontSize: '10px' }}>
            Q: {a.question} <span style={{ color: 'hsl(0 0% 30%)' }}>({a.nodeLabel})</span>
          </div>
          <div style={{ color: a.error ? 'hsl(0 40% 65%)' : 'hsl(0 0% 85%)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
            {a.answer}
          </div>
        </div>
      ))}
    </div>
  );
}
