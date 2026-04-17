import { useEffect, useRef, useState, useCallback } from 'react';
import type { BridgeQuestion, BridgeAnswer, EnrichProgress } from '../types';

const WS_URL = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [answers, setAnswers] = useState<BridgeAnswer[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<Set<string>>(new Set());
  const [graphVersion, setGraphVersion] = useState(0);
  const [watching, setWatching] = useState(false);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<EnrichProgress | null>(null);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnected(true);
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'answer') {
          setAnswers(prev => [msg.data, ...prev]);
          setPendingQuestions(prev => {
            const next = new Set(prev);
            next.delete(msg.data.id);
            return next;
          });
        }

        if (msg.type === 'question_submitted') {
          setPendingQuestions(prev => new Set(prev).add(msg.data.id));
        }

        // Graph was enriched or re-analyzed — trigger a refetch
        if (msg.type === 'graph_updated') {
          setGraphVersion(v => v + 1);
          setEnrichProgress(null);
        }

        if (msg.type === 'watching') {
          setWatching(true);
        }

        if (msg.type === 'ai_status') {
          setAiAvailable(msg.data.available);
        }

        if (msg.type === 'enrich_progress') {
          setEnrichProgress(msg.data);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      wsRef.current?.close();
    };
  }, []);

  const askQuestion = useCallback((question: BridgeQuestion) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'question', data: question }));
    }
  }, []);

  return { connected, answers, pendingQuestions, askQuestion, graphVersion, watching, aiAvailable, enrichProgress };
}
