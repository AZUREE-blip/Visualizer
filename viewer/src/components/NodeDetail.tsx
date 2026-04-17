import { useState, useEffect } from 'react';
import type { NodeDetail as NodeDetailType, BridgeQuestion, ConnectionInfo } from '../types';

const API_BASE = '';

interface NodeDetailProps {
  nodeId: string | null;
  onClose: () => void;
  onAskClaude: (question: BridgeQuestion) => void;
  pendingCount: number;
  isNarrow?: boolean;
  isCompact?: boolean;
}

export function NodeDetail({ nodeId, onClose, onAskClaude, pendingCount, isNarrow, isCompact }: NodeDetailProps) {
  const [detail, setDetail] = useState<NodeDetailType | null>(null);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState('');
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);

  useEffect(() => {
    if (!nodeId) { setDetail(null); setBrief(null); return; }
    setLoading(true);
    setBrief(null);
    fetch(`${API_BASE}/api/node?id=${encodeURIComponent(nodeId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.node) setDetail(data); setLoading(false); })
      .catch(() => setLoading(false));

    // Fetch the brief in parallel
    setBriefLoading(true);
    fetch(`${API_BASE}/api/node-brief?id=${encodeURIComponent(nodeId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.brief) setBrief(data.brief); setBriefLoading(false); })
      .catch(() => setBriefLoading(false));
  }, [nodeId]);

  // Stay mounted but hidden to avoid re-mount animations and lost state
  if (!nodeId) {
    return <div className="node-detail--hidden" />;
  }

  // Bottom sheet for compact/preview mode
  if (isCompact) {
    return (
      <div className="animate-slide-up" style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: '55vh',
        background: 'hsl(0 0% 5%)',
        borderTop: '1px solid hsl(0 0% 16%)',
        borderRadius: '14px 14px 0 0',
        padding: '0 16px 16px',
        overflow: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        zIndex: 40,
        boxShadow: '0 -4px 24px rgba(0,0,0,0.5)',
      }}>
        {/* Drag handle */}
        <div style={{
          display: 'flex', justifyContent: 'center',
          padding: '10px 0 4px',
          position: 'sticky', top: 0,
          background: 'hsl(0 0% 5%)',
          zIndex: 1,
        }}>
          <div style={{
            width: '32px', height: '4px',
            borderRadius: '2px',
            background: 'hsl(0 0% 25%)',
          }} />
        </div>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'hsl(0 0% 90%)' }}>
            {loading ? 'Loading\u2026' : detail?.node?.label || nodeId}
          </h3>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none',
              color: 'hsl(0 0% 35%)', cursor: 'pointer',
              fontSize: '16px', padding: '0 4px',
            }}
          >
            {'\u00D7'}
          </button>
        </div>

        {detail && (
          <>
            <div style={{ fontSize: '10px', color: 'hsl(0 0% 35%)', fontFamily: 'monospace' }}>
              <div>{detail.node.filePath}</div>
              <div style={{ marginTop: '2px' }}>{detail.node.linesOfCode} lines {'\u00B7'} {detail.node.type} {'\u00B7'} {detail.node.layer}</div>
            </div>

            <FileBrief brief={brief} loading={briefLoading} />

            {(detail.node.exports || []).length > 0 && (
              <Section title="Exports">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {(detail.node.exports || []).slice(0, 8).map(exp => (
                    <span key={exp} style={{
                      background: 'hsl(0 0% 10%)',
                      padding: '2px 6px', borderRadius: '4px',
                      fontSize: '10px', color: 'hsl(0 0% 60%)',
                      fontFamily: 'monospace',
                      border: '1px solid hsl(0 0% 14%)',
                    }}>
                      {exp}
                    </span>
                  ))}
                  {(detail.node.exports || []).length > 8 && (
                    <span style={{ fontSize: '10px', color: 'hsl(0 0% 40%)' }}>
                      +{(detail.node.exports || []).length - 8} more
                    </span>
                  )}
                </div>
              </Section>
            )}

            {detail.dependencies.length > 0 && (
              <Section title={`Depends on (${detail.dependencies.length})`}>
                {detail.dependencies.map(dep => (
                  <ConnectionItem key={dep.id} conn={dep} direction="depends" />
                ))}
              </Section>
            )}

            {detail.dependents.length > 0 && (
              <Section title={`Used by (${detail.dependents.length})`}>
                {detail.dependents.map(dep => (
                  <ConnectionItem key={dep.id} conn={dep} direction="usedBy" />
                ))}
              </Section>
            )}

            {/* Ask Claude */}
            <div>
              <div style={{ fontSize: '9px', color: 'hsl(0 0% 30%)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>
                Ask Claude
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input
                  type="text"
                  placeholder={`Ask about ${detail.node.label}\u2026`}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && question.trim()) {
                      onAskClaude({
                        nodeId: detail.node.id,
                        nodeLabel: detail.node.label,
                        filePath: detail.node.filePath,
                        question: question.trim(),
                        context: {
                          type: detail.node.type, layer: detail.node.layer,
                          exports: detail.node.exports,
                          dependencyCount: detail.dependencies.length,
                          dependentCount: detail.dependents.length,
                        },
                      });
                      setQuestion('');
                    }
                  }}
                  style={{
                    flex: 1, padding: '8px 10px',
                    background: 'hsl(0 0% 8%)',
                    border: '1px solid hsl(0 0% 14%)',
                    borderRadius: '8px',
                    color: 'hsl(0 0% 80%)',
                    fontSize: '11px', outline: 'none',
                  }}
                />
                <button
                  onClick={() => {
                    if (question.trim()) {
                      onAskClaude({
                        nodeId: detail.node.id,
                        nodeLabel: detail.node.label,
                        filePath: detail.node.filePath,
                        question: question.trim(),
                      });
                      setQuestion('');
                    }
                  }}
                  style={{
                    padding: '8px 14px',
                    background: 'hsl(0 0% 90%)',
                    border: 'none', borderRadius: '8px',
                    color: 'hsl(0 0% 4%)',
                    fontSize: '11px', fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Ask
                </button>
              </div>
              {pendingCount > 0 && (
                <div className="animate-pulse-subtle" style={{ fontSize: '10px', color: 'hsl(0 0% 40%)', marginTop: '6px' }}>
                  {pendingCount} pending{'\u2026'}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // Standard side panel (standalone mode)
  return (
    <div className="animate-slide-in-right" style={{
      width: '320px',
      background: 'hsl(0 0% 5%)',
      borderLeft: '1px solid hsl(0 0% 12%)',
      padding: '20px 16px',
      overflow: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
      ...(isNarrow ? {
        position: 'fixed' as const,
        top: 0, right: 0, bottom: 0,
        zIndex: 50,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.5)',
        maxWidth: '85vw',
      } : {}),
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'hsl(0 0% 90%)' }}>
          {loading ? 'Loading\u2026' : detail?.node?.label || nodeId}
        </h3>
        <button
          onClick={onClose}
          style={{
            background: 'none', border: 'none',
            color: 'hsl(0 0% 35%)', cursor: 'pointer',
            fontSize: '16px', padding: '0 4px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = 'hsl(0 0% 70%)'}
          onMouseLeave={e => e.currentTarget.style.color = 'hsl(0 0% 35%)'}
        >
          {'\u00D7'}
        </button>
      </div>

      {detail && (
        <>
          <div style={{ fontSize: '10px', color: 'hsl(0 0% 35%)', fontFamily: 'monospace' }}>
            <div>{detail.node.filePath}</div>
            <div style={{ marginTop: '2px' }}>{detail.node.linesOfCode} lines {'\u00B7'} {detail.node.type} {'\u00B7'} {detail.node.layer}</div>
          </div>

          <FileBrief brief={brief} loading={briefLoading} />

          {(detail.node.exports || []).length > 0 && (
            <Section title="Exports">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {(detail.node.exports || []).map(exp => (
                  <span key={exp} style={{
                    background: 'hsl(0 0% 10%)',
                    padding: '2px 6px', borderRadius: '4px',
                    fontSize: '10px', color: 'hsl(0 0% 60%)',
                    fontFamily: 'monospace',
                    border: '1px solid hsl(0 0% 14%)',
                  }}>
                    {exp}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {detail.dependencies.length > 0 && (
            <Section title={`Depends on (${detail.dependencies.length})`}>
              {detail.dependencies.map(dep => (
                <ConnectionItem key={dep.id} conn={dep} direction="depends" />
              ))}
            </Section>
          )}

          {detail.dependents.length > 0 && (
            <Section title={`Used by (${detail.dependents.length})`}>
              {detail.dependents.map(dep => (
                <ConnectionItem key={dep.id} conn={dep} direction="usedBy" />
              ))}
            </Section>
          )}

          {detail.content && (
            <Section title="Preview">
              <pre style={{
                background: 'hsl(0 0% 6%)',
                padding: '10px',
                borderRadius: '8px',
                fontSize: '10px',
                color: 'hsl(0 0% 60%)',
                overflow: 'auto',
                maxHeight: '200px',
                margin: 0,
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                border: '1px solid hsl(0 0% 12%)',
              }}>
                {detail.content.split('\n').slice(0, 30).join('\n')}
                {detail.content.split('\n').length > 30 && '\n\u2026'}
              </pre>
            </Section>
          )}

          {/* Ask Claude */}
          <div style={{ marginTop: 'auto' }}>
            <div style={{ fontSize: '9px', color: 'hsl(0 0% 30%)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>
              Ask Claude
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                placeholder={`Ask about ${detail.node.label}\u2026`}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && question.trim()) {
                    onAskClaude({
                      nodeId: detail.node.id,
                      nodeLabel: detail.node.label,
                      filePath: detail.node.filePath,
                      question: question.trim(),
                      context: {
                        type: detail.node.type, layer: detail.node.layer,
                        exports: detail.node.exports,
                        dependencyCount: detail.dependencies.length,
                        dependentCount: detail.dependents.length,
                      },
                    });
                    setQuestion('');
                  }
                }}
                style={{
                  flex: 1, padding: '8px 10px',
                  background: 'hsl(0 0% 8%)',
                  border: '1px solid hsl(0 0% 14%)',
                  borderRadius: '8px',
                  color: 'hsl(0 0% 80%)',
                  fontSize: '11px', outline: 'none',
                  transition: 'border-color 0.2s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = 'hsl(0 0% 30%)'}
                onBlur={e => e.currentTarget.style.borderColor = 'hsl(0 0% 14%)'}
              />
              <button
                onClick={() => {
                  if (question.trim()) {
                    onAskClaude({
                      nodeId: detail.node.id,
                      nodeLabel: detail.node.label,
                      filePath: detail.node.filePath,
                      question: question.trim(),
                    });
                    setQuestion('');
                  }
                }}
                style={{
                  padding: '8px 14px',
                  background: 'hsl(0 0% 90%)',
                  border: 'none', borderRadius: '8px',
                  color: 'hsl(0 0% 4%)',
                  fontSize: '11px', fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'hsl(0 0% 100%)'}
                onMouseLeave={e => e.currentTarget.style.background = 'hsl(0 0% 90%)'}
              >
                Ask
              </button>
            </div>
            {pendingCount > 0 && (
              <div className="animate-pulse-subtle" style={{ fontSize: '10px', color: 'hsl(0 0% 40%)', marginTop: '6px' }}>
                {pendingCount} pending{'\u2026'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function FileBrief({ brief, loading }: { brief: string | null; loading: boolean }) {
  if (loading) {
    return (
      <div style={{
        background: 'hsl(0 0% 7%)',
        borderRadius: '8px',
        padding: '10px 12px',
        border: '1px solid hsl(0 0% 14%)',
      }}>
        <div className="animate-pulse-subtle" style={{ fontSize: '10px', color: 'hsl(0 0% 40%)' }}>
          Analyzing file...
        </div>
      </div>
    );
  }

  if (!brief) return null;

  // Parse the structured brief into labeled sections
  const sections = brief.split('\n').reduce<{ label: string; text: string }[]>((acc, line) => {
    const match = line.match(/^(PURPOSE|ROLE|KEY EXPORTS|CONTEXT):\s*(.*)/);
    if (match) {
      acc.push({ label: match[1], text: match[2] });
    } else if (acc.length > 0 && line.trim()) {
      // Continuation line (e.g., bullet points under KEY EXPORTS)
      acc[acc.length - 1].text += '\n' + line;
    }
    return acc;
  }, []);

  // If parsing failed, just show the raw text
  if (sections.length === 0) {
    return (
      <div style={{
        background: 'hsl(0 0% 7%)',
        borderRadius: '8px',
        padding: '10px 12px',
        border: '1px solid hsl(0 0% 14%)',
        fontSize: '11px',
        color: 'hsl(0 0% 70%)',
        lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      }}>
        {brief}
      </div>
    );
  }

  const labelColors: Record<string, string> = {
    'PURPOSE': 'hsl(210 40% 65%)',
    'ROLE': 'hsl(160 35% 60%)',
    'KEY EXPORTS': 'hsl(45 50% 65%)',
    'CONTEXT': 'hsl(0 40% 65%)',
  };

  return (
    <div style={{
      background: 'hsl(0 0% 7%)',
      borderRadius: '8px',
      padding: '10px 12px',
      border: '1px solid hsl(0 0% 14%)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    }}>
      {sections.map((s, i) => (
        <div key={i}>
          <div style={{
            fontSize: '8px',
            fontWeight: 700,
            color: labelColors[s.label] || 'hsl(0 0% 50%)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            marginBottom: '3px',
          }}>
            {s.label}
          </div>
          <div style={{
            fontSize: '11px',
            color: 'hsl(0 0% 75%)',
            lineHeight: 1.45,
            whiteSpace: 'pre-wrap',
          }}>
            {s.text}
          </div>
        </div>
      ))}
    </div>
  );
}

function ConnectionItem({ conn, direction }: { conn: ConnectionInfo; direction: 'depends' | 'usedBy' }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = conn.description || conn.symbols.length > 0;

  return (
    <div
      style={{
        padding: '8px 10px',
        marginBottom: '4px',
        background: 'hsl(0 0% 7%)',
        borderRadius: '6px',
        border: '1px solid hsl(0 0% 12%)',
        cursor: hasDetails ? 'pointer' : 'default',
        transition: 'border-color 0.15s',
      }}
      onClick={() => hasDetails && setExpanded(!expanded)}
      onMouseEnter={e => { if (hasDetails) e.currentTarget.style.borderColor = 'hsl(0 0% 20%)'; }}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'hsl(0 0% 12%)'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{ fontSize: '11px', color: 'hsl(0 0% 75%)', fontWeight: 500 }}>{conn.label}</span>
        <span style={{
          fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
          background: 'hsl(0 0% 12%)', color: 'hsl(0 0% 45%)',
          fontFamily: 'monospace',
        }}>
          {conn.layer}
        </span>
        {hasDetails && (
          <span style={{ fontSize: '9px', color: 'hsl(0 0% 30%)', marginLeft: 'auto' }}>
            {expanded ? '\u25B4' : '\u25BE'}
          </span>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: '6px' }}>
          {conn.symbols.length > 0 && (
            <div style={{ marginBottom: '4px' }}>
              <div style={{ fontSize: '9px', color: 'hsl(0 0% 35%)', marginBottom: '3px' }}>
                {direction === 'depends' ? 'Imports:' : 'Provides:'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                {conn.symbols.map(s => (
                  <span key={s} style={{
                    fontSize: '9px', fontFamily: 'monospace',
                    padding: '1px 5px', borderRadius: '3px',
                    background: 'hsl(0 0% 10%)', color: 'hsl(0 0% 55%)',
                    border: '1px solid hsl(0 0% 14%)',
                  }}>
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {conn.description && (
            <div style={{ fontSize: '10px', color: 'hsl(0 0% 45%)', lineHeight: 1.4 }}>
              {conn.description}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '9px', color: 'hsl(0 0% 30%)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '6px', fontWeight: 600 }}>
        {title}
      </div>
      {children}
    </div>
  );
}
