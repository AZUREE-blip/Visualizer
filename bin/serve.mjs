#!/usr/bin/env node

/**
 * Minimal static server for the preview panel.
 * Reads pre-generated graph.json from a data dir (e.g. /tmp).
 * No project directory access needed — sandbox safe.
 *
 * Usage: node serve.mjs <dataDir> <viewerDir> [port]
 */

import express from 'express';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const dataDir = process.argv[2];
const viewerDir = process.argv[3];
const port = process.argv[4] || 3001;

if (!dataDir || !viewerDir) {
  console.error('Usage: serve.mjs <dataDir> <viewerDir> [port]');
  process.exit(1);
}

const app = express();

// Serve viewer static files
app.use(express.static(viewerDir));

// Serve graph data from /tmp
app.get('/api/graph', async (_req, res) => {
  try {
    const graph = JSON.parse(await readFile(join(dataDir, 'graph.json'), 'utf-8'));
    res.json(graph);
  } catch {
    res.status(404).json({ error: 'No graph data. Run codebase-visualizer init first.' });
  }
});

// Stub endpoints so the viewer doesn't error
app.get('/api/status', (_req, res) => res.json({ watching: false, rootDir: null }));
app.get('/api/ai-status', (_req, res) => res.json({ available: false, error: 'Preview mode' }));
app.get('/api/node', (_req, res) => res.status(404).json({ error: 'Not available in preview mode' }));
app.get('/api/node-brief', (_req, res) => res.status(404).json({ error: 'Not available in preview mode' }));
app.get('/api/snippets', (_req, res) => res.json({ snippets: [], total: 0 }));
app.get('/api/presentation', async (_req, res) => {
  try {
    const graph = JSON.parse(await readFile(join(dataDir, 'graph.json'), 'utf-8'));
    res.json({ steps: [], meta: graph.meta });
  } catch {
    res.json({ steps: [], meta: {} });
  }
});

// SPA fallback (Express 5 syntax)
app.get('/{*path}', (_req, res) => res.sendFile(join(viewerDir, 'index.html')));

app.listen(port, () => {
  console.log(`Visualizer preview on http://localhost:${port}`);
});
