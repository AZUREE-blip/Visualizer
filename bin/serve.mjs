#!/usr/bin/env node

/**
 * Preview server with WebSocket Q&A support.
 * Uses graph.json snippets for AI context (no project file access needed).
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { WebSocketServer } from 'ws';
import Anthropic from '@anthropic-ai/sdk';

const dataDir = process.argv[2];
const viewerDir = process.argv[3];
const port = process.argv[4] || 3001;

if (!dataDir || !viewerDir) {
  console.error('Usage: serve.mjs <dataDir> <viewerDir> [port]');
  process.exit(1);
}

// --- Claude AI ---
let ai = null;
let aiModel = 'claude-sonnet-4-6';
const apiKey = process.env.ANTHROPIC_API_KEY;
if (apiKey) {
  try { ai = new Anthropic({ apiKey }); } catch {}
}

// --- Graph cache ---
let cachedGraph = null;
async function getGraph() {
  if (cachedGraph) return cachedGraph;
  cachedGraph = JSON.parse(await readFile(join(dataDir, 'graph.json'), 'utf-8'));
  return cachedGraph;
}

// --- MIME types ---
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

async function serveFile(res, filePath, contentType) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });
    res.end(data);
    return true;
  } catch { return false; }
}

// --- HTTP Server ---
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;

  if (path === '/api/graph') {
    try {
      const graph = await readFile(join(dataDir, 'graph.json'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(graph);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"No graph data"}');
    }
    return;
  }

  if (path === '/api/node') {
    const id = url.searchParams.get('id');
    try {
      const graph = await getGraph();
      const node = graph.nodes.find(n => n.id === id);
      if (!node) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"Not found"}'); return; }
      const dependencies = graph.edges.filter(e => e.source === id).map(e => {
        const t = graph.nodes.find(n => n.id === e.target);
        return t ? { id: t.id, label: t.label, type: t.type, layer: t.layer, description: t.description || '', symbols: e.symbols || [] } : null;
      }).filter(Boolean);
      const dependents = graph.edges.filter(e => e.target === id).map(e => {
        const s = graph.nodes.find(n => n.id === e.source);
        return s ? { id: s.id, label: s.label, type: s.type, layer: s.layer, description: s.description || '', symbols: e.symbols || [] } : null;
      }).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ node, content: node.snippet || null, dependencies, dependents }));
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"No data"}');
    }
    return;
  }

  if (path === '/api/ai-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: !!ai, model: aiModel, error: ai ? null : 'No ANTHROPIC_API_KEY' }));
    return;
  }

  if (path === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"watching":false}'); return; }
  if (path === '/api/snippets') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"snippets":[],"total":0}'); return; }
  if (path === '/api/presentation') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"steps":[],"meta":{}}'); return; }
  if (path === '/api/node-brief') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"brief":null,"cached":false,"static":true}'); return; }
  if (path.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"Not available"}'); return; }

  const ext = extname(path);
  if (ext && MIME[ext]) {
    const served = await serveFile(res, join(viewerDir, path), MIME[ext]);
    if (served) return;
  }

  await serveFile(res, join(viewerDir, 'index.html'), 'text/html');
});

// --- WebSocket for Q&A ---
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data);
  }
}

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: 'ai_status', data: { available: !!ai, model: aiModel, error: ai ? null : 'No ANTHROPIC_API_KEY' } }));

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type !== 'question') return;

      const { nodeId, nodeLabel, question } = msg.data || {};
      const questionId = `q_${Date.now()}`;

      if (!nodeId || !question) {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Missing nodeId or question' } }));
        return;
      }

      ws.send(JSON.stringify({ type: 'question_submitted', data: { id: questionId } }));

      if (!ai) {
        broadcast({ type: 'answer', data: { id: questionId, nodeId, nodeLabel, question, answer: 'AI is not available. Set ANTHROPIC_API_KEY in your .env file.', answeredAt: new Date().toISOString(), error: true } });
        return;
      }

      // Build context from graph.json (snippets + dependencies)
      const graph = await getGraph();
      const node = graph.nodes.find(n => n.id === nodeId);
      if (!node) {
        broadcast({ type: 'answer', data: { id: questionId, nodeId, nodeLabel, question, answer: 'Node not found.', answeredAt: new Date().toISOString(), error: true } });
        return;
      }

      const deps = graph.edges.filter(e => e.source === nodeId).map(e => graph.nodes.find(n => n.id === e.target)).filter(Boolean);
      const dependents = graph.edges.filter(e => e.target === nodeId).map(e => graph.nodes.find(n => n.id === e.source)).filter(Boolean);

      let context = `## File: ${node.filePath}\nType: ${node.type}, Layer: ${node.layer}, ${node.linesOfCode} lines\n`;
      if (node.exports?.length) context += `Exports: ${node.exports.join(', ')}\n`;
      if (node.snippet) context += `\n\`\`\`\n${node.snippet}\n\`\`\`\n`;
      if (deps.length) context += `\nDepends on: ${deps.map(d => d.label).join(', ')}`;
      if (dependents.length) context += `\nUsed by: ${dependents.map(d => d.label).join(', ')}`;

      try {
        const response = await ai.messages.create({
          model: aiModel,
          max_tokens: 1024,
          system: `You are a friendly guide explaining a codebase called "${graph.meta.projectName}" to someone who is not deeply technical. Explain in plain, conversational English. No code snippets. Use analogies. Keep answers under 150 words.`,
          messages: [{ role: 'user', content: `${context}\n\n## Question\n${question}` }],
        });

        broadcast({ type: 'answer', data: { id: questionId, nodeId, nodeLabel, question, answer: response.content[0].text, answeredAt: new Date().toISOString() } });
      } catch (err) {
        broadcast({ type: 'answer', data: { id: questionId, nodeId, nodeLabel, question, answer: `AI error: ${err.message}`, answeredAt: new Date().toISOString(), error: true } });
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', data: { message: err.message } }));
    }
  });

  ws.on('close', () => clients.delete(ws));
});

server.listen(port, () => {
  console.log(`Visualizer preview on http://localhost:${port}`);
  if (ai) console.log(`Claude AI ready (${aiModel})`);
  else console.log('AI disabled — set ANTHROPIC_API_KEY for Q&A');
});
