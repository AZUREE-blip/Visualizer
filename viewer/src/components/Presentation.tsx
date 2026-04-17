import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ReactFlow, MiniMap, Background, BackgroundVariant,
  useNodesState, useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { nodeTypes } from './NodeTypes';
import { applyDagreLayout } from '../layout/dagre';
import { LAYER_SHADES, dominantLayer } from '../constants';
import type { GraphData } from '../types';
import type { Node, Edge } from '@xyflow/react';

interface PresentationStep {
  type: string;
  nodeId?: string;
  narration: string;
  showNodes: string[];
  showEdges: string[];
  duration: number;
}

interface PresentationProps {
  onExit: () => void;
}

const API_BASE = '';

export function Presentation({ onExit }: PresentationProps) {
  const [steps, setSteps] = useState<PresentationStep[]>([]);
  const [currentStep, setCurrentStep] = useState(-1);
  const [narrationText, setNarrationText] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [displayedText, setDisplayedText] = useState('');
  const [narrationKey, setNarrationKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);

  // Stop all audio and timers
  const stopAll = useCallback(() => {
    generationRef.current++;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/presentation`).then(r => r.json()),
      fetch(`${API_BASE}/api/graph`).then(r => r.json()),
    ]).then(([pres, graph]) => {
      setSteps(pres.steps);
      setGraphData(graph);
    });
  }, []);

  const buildNodesAndEdges = useCallback((showNodeIds: string[]) => {
    if (!graphData) return;
    const modules = graphData.nodes.filter(n => n.type === 'module');
    const files = graphData.nodes.filter(n => n.type !== 'module' && n.type !== 'external');
    const moduleChildMap = new Map<string, typeof files>();
    for (const mod of modules) moduleChildMap.set(mod.id, files.filter(f => (mod.children || []).includes(f.id)));
    const grouped = new Set(modules.flatMap(m => m.children || []));
    const ungroupedFiles = files.filter(f => !grouped.has(f.id));
    const rfNodes: Node[] = [];

    for (const nodeId of showNodeIds) {
      const mod = modules.find(m => m.id === nodeId);
      if (mod) {
        const children = moduleChildMap.get(mod.id) || [];
        const layer = dominantLayer(children);
        rfNodes.push({
          id: mod.id, type: 'moduleNode', position: { x: 0, y: 0 },
          data: {
            ...mod, color: LAYER_SHADES[layer] || LAYER_SHADES.logic,
            dimmed: false, description: (mod as any).description || '',
            linesOfCode: children.reduce((s, c) => s + c.linesOfCode, 0),
            fileCount: children.length,
            childLabels: children.map(c => c.label),
            childDescriptions: children.map(c => (c as any).description || ''),
            importance: 3,
          },
        });
        continue;
      }
      const file = ungroupedFiles.find(f => f.id === nodeId);
      if (file) {
        rfNodes.push({
          id: file.id, type: 'fileNode', position: { x: 0, y: 0 },
          data: {
            ...file, color: LAYER_SHADES[file.layer] || LAYER_SHADES.logic,
            dimmed: false, description: (file as any).description || '', importance: 2,
          },
        });
      }
    }

    const moduleMap = new Map<string, string>();
    for (const mod of modules) for (const cid of mod.children || []) moduleMap.set(cid, mod.id);
    const edgeSet = new Set<string>();
    const rfEdges: Edge[] = [];
    for (const e of graphData.edges) {
      const src = moduleMap.get(e.source) || e.source;
      const tgt = moduleMap.get(e.target) || e.target;
      if (src === tgt || !showNodeIds.includes(src) || !showNodeIds.includes(tgt)) continue;
      const key = `${src}->${tgt}`;
      if (edgeSet.has(key)) continue;
      edgeSet.add(key);
      rfEdges.push({
        id: `e-${rfEdges.length}`, source: src, target: tgt,
        type: 'smoothstep',
        style: { stroke: 'rgba(255,255,255,0.30)', strokeWidth: 1.5 },
        animated: true,
        markerEnd: { type: 'arrowclosed' as any, width: 16, height: 16 },
      });
    }
    const { nodes: layouted, edges: layoutedEdges } = applyDagreLayout(rfNodes, rfEdges);
    setNodes(layouted);
    setEdges(layoutedEdges);
  }, [graphData, setNodes, setEdges]);

  // Typewriter effect — synced to audio progress
  useEffect(() => {
    if (!narrationText) { setDisplayedText(''); return; }
    setDisplayedText('');

    let revealed = 0;
    const startTime = performance.now();

    const interval = setInterval(() => {
      const audio = audioRef.current;
      if (audio && audio.duration > 0) {
        const progress = Math.min(audio.currentTime / audio.duration, 1);
        const target = Math.min(
          Math.ceil(progress * narrationText.length),
          narrationText.length,
        );
        if (target > revealed) {
          revealed = target;
          setDisplayedText(narrationText.slice(0, target));
        }
        if (revealed >= narrationText.length) clearInterval(interval);
      } else if (performance.now() - startTime > 3000) {
        // Fallback: if audio never loaded, reveal everything
        setDisplayedText(narrationText);
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [narrationText, narrationKey]);

  // Speak using server-side Edge TTS — returns promise that resolves when audio ends
  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const url = `${API_BASE}/api/tts?text=${encodeURIComponent(text)}`;
      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => resolve();
      audio.onerror = () => resolve(); // don't block on TTS failure

      // If aborted before playing, resolve immediately
      controller.signal.addEventListener('abort', () => {
        audio.pause();
        audio.src = '';
        resolve();
      });

      audio.play().catch(() => resolve());
    });
  }, []);

  const playStep = useCallback((stepIndex: number) => {
    if (stepIndex >= steps.length) { setIsPlaying(false); return; }
    const step = steps[stepIndex];
    const gen = generationRef.current;
    setCurrentStep(stepIndex);
    setNarrationText(step.narration);
    setNarrationKey(k => k + 1);
    buildNodesAndEdges(step.showNodes);
    speak(step.narration).then(() => {
      if (generationRef.current !== gen) return;
      timerRef.current = setTimeout(() => playStep(stepIndex + 1), 1200);
    });
  }, [steps, speak, buildNodesAndEdges]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      stopAll();
    } else {
      setIsPlaying(true);
      playStep(currentStep < 0 ? 0 : currentStep);
    }
  }, [isPlaying, currentStep, playStep, stopAll]);

  const handleRestart = useCallback(() => {
    stopAll();
    setCurrentStep(-1);
    setNodes([]);
    setEdges([]);
    setNarrationText('');
    setDisplayedText('');
    setIsPlaying(false);
  }, [setNodes, setEdges, stopAll]);

  const handleNext = useCallback(() => {
    stopAll();
    playStep(Math.min(currentStep + 1, steps.length - 1));
  }, [currentStep, steps, playStep, stopAll]);

  const handlePrev = useCallback(() => {
    stopAll();
    playStep(Math.max(currentStep - 1, 0));
  }, [currentStep, steps, playStep, stopAll]);

  // Handle exit — stop everything
  const handleExit = useCallback(() => {
    stopAll();
    onExit();
  }, [stopAll, onExit]);

  // Cleanup on unmount
  useEffect(() => () => stopAll(), [stopAll]);

  const progress = steps.length > 0 ? ((currentStep + 1) / steps.length) * 100 : 0;

  const btnBase: React.CSSProperties = {
    background: 'hsl(0 0% 12%)',
    border: '1px solid hsl(0 0% 18%)',
    borderRadius: '8px',
    color: 'hsl(0 0% 70%)',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    padding: '8px 14px',
    transition: 'all 0.15s ease',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'hsl(0 0% 4%)' }}>
      {/* Top bar */}
      <div className="animate-fade-in" style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px',
        background: 'hsl(0 0% 5%)',
        borderBottom: '1px solid hsl(0 0% 10%)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <button onClick={handleExit} style={btnBase}>{'\u2190'} Back</button>
          <span style={{ color: 'hsl(0 0% 35%)', fontSize: '12px' }}>
            {graphData?.meta.projectName || 'Codebase'} {'\u2014'} Architecture Tour
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={handleRestart} style={btnBase}>{'\u21BA'}</button>
          <button onClick={handlePrev} style={btnBase}>{'\u2039'}</button>
          <button onClick={handlePlayPause} style={{
            ...btnBase,
            background: isPlaying ? 'hsl(0 0% 20%)' : 'hsl(0 0% 90%)',
            color: isPlaying ? 'hsl(0 0% 80%)' : 'hsl(0 0% 4%)',
            fontWeight: 600,
          }}>
            {isPlaying ? '\u275A\u275A' : '\u25B6'}
          </button>
          <button onClick={handleNext} style={btnBase}>{'\u203A'}</button>
          <span style={{ color: 'hsl(0 0% 30%)', fontSize: '11px', marginLeft: '8px', fontFamily: 'monospace' }}>
            {currentStep + 1}/{steps.length}
          </span>
        </div>
      </div>

      {/* Progress */}
      <div style={{ height: '2px', background: 'hsl(0 0% 8%)' }}>
        <div className="animate-progress-fill" style={{
          height: '100%',
          width: `${progress}%`,
          background: 'hsl(0 0% 40%)',
          transition: 'width 0.4s ease-out',
        }} />
      </div>

      {/* Graph */}
      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.3, duration: 800 }}
          minZoom={0.1}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'hsl(0 0% 4%)' }}
        >
          <Background variant={BackgroundVariant.Dots} color="hsl(0 0% 10%)" gap={24} size={1} />
          <MiniMap
            style={{ background: 'hsl(0 0% 6%)', border: '1px solid hsl(0 0% 12%)', borderRadius: '8px' }}
            nodeColor={() => 'hsl(0 0% 30%)'}
            maskColor="rgba(0,0,0,0.7)"
          />
        </ReactFlow>

        {/* Narration */}
        {displayedText && (
          <div className="animate-fade-in" style={{
            position: 'absolute',
            bottom: '24px', left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '600px', width: '90%',
            background: 'hsl(0 0% 6%)',
            border: '1px solid hsl(0 0% 14%)',
            borderRadius: '14px',
            padding: '16px 22px',
            backdropFilter: 'blur(16px)',
          }}>
            <div className={displayedText.length < narrationText.length ? 'typewriter-cursor' : ''} style={{
              color: 'hsl(0 0% 75%)',
              fontSize: '13px',
              lineHeight: 1.6,
              letterSpacing: '-0.01em',
            }}>
              {displayedText}
            </div>
          </div>
        )}

        {/* Intro overlay when not started */}
        {currentStep < 0 && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(10,10,10,0.9)',
            gap: '16px',
          }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'hsl(0 0% 90%)', letterSpacing: '-0.03em' }}>
              Architecture Tour
            </div>
            <div style={{ fontSize: '13px', color: 'hsl(0 0% 40%)', maxWidth: '360px', textAlign: 'center', lineHeight: 1.5 }}>
              Watch the codebase get drawn step by step with narration explaining each part.
            </div>
            <button onClick={handlePlayPause} style={{
              ...btnBase,
              background: 'hsl(0 0% 90%)',
              color: 'hsl(0 0% 4%)',
              fontSize: '14px',
              padding: '12px 28px',
              borderRadius: '10px',
              fontWeight: 600,
              marginTop: '8px',
              border: 'none',
            }}>
              {'\u25B6'} Start Tour
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
