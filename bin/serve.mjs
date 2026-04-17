#!/usr/bin/env node

/**
 * Zero-dependency static server for the preview panel.
 * Uses only Node.js built-ins — no npm install needed.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const dataDir = process.argv[2];
const viewerDir = process.argv[3];
const port = process.argv[4] || 3001;

if (!dataDir || !viewerDir) {
  console.error('Usage: serve.mjs <dataDir> <viewerDir> [port]');
  process.exit(1);
}

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveFile(res, filePath, contentType) {
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=3600' });
    res.end(data);
  } catch {
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const path = url.pathname;

  // API: graph data from /tmp
  if (path === '/api/graph') {
    try {
      const graph = await readFile(join(dataDir, 'graph.json'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(graph);
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"No graph data"}');
    }
    return;
  }

  // API: node detail (from graph.json)
  if (path === '/api/node') {
    const id = url.searchParams.get('id');
    try {
      const graph = JSON.parse(await readFile(join(dataDir, 'graph.json'), 'utf-8'));
      const node = graph.nodes.find(n => n.id === id);
      if (!node) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"Node not found"}'); return; }
      const dependencies = graph.edges.filter(e => e.source === id).map(e => graph.nodes.find(n => n.id === e.target)).filter(Boolean);
      const dependents = graph.edges.filter(e => e.target === id).map(e => graph.nodes.find(n => n.id === e.source)).filter(Boolean);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ node, content: null, dependencies, dependents }));
    } catch {
      res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"No graph data"}');
    }
    return;
  }

  // API stubs
  if (path === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"watching":false}'); return; }
  if (path === '/api/ai-status') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"available":false}'); return; }
  if (path === '/api/snippets') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"snippets":[],"total":0}'); return; }
  if (path === '/api/presentation') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"steps":[],"meta":{}}'); return; }
  if (path === '/api/node-brief') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"brief":null,"cached":false,"static":true}'); return; }
  if (path.startsWith('/api/')) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"Not available in preview mode"}'); return; }

  // Static files from viewer/dist
  const ext = extname(path);
  if (ext && MIME[ext]) {
    const served = await serveFile(res, join(viewerDir, path), MIME[ext]);
    if (served) return;
  }

  // SPA fallback: serve index.html
  await serveFile(res, join(viewerDir, 'index.html'), 'text/html');
});

server.listen(port, () => {
  console.log(`Visualizer preview on http://localhost:${port}`);
});
