import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { watch } from 'chokidar';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { initClaude, getAiStatus, askAboutFile, generateDescription, generateBrief, buildRelatedContext } from './claude.mjs';
import { analyze, SKIP_DIRS } from '../scripts/analyze.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

/**
 * Start the visualizer server.
 * @param {object} opts
 * @param {string} opts.targetDir  - project directory to analyze
 * @param {string} opts.dataDir    - where to store graph.json & caches
 * @param {number} opts.port       - HTTP port (default 3001)
 * @param {string} opts.viewerDir  - path to built viewer static files
 */
export async function startServer(opts = {}) {
  const config = {
    targetDir: opts.targetDir || null,
    dataDir: opts.dataDir || join(PKG_ROOT, 'data'),
    port: opts.port || process.env.PORT || 3001,
    viewerDir: opts.viewerDir || join(PKG_ROOT, 'viewer', 'dist'),
  };

  // Load .env from package root (dev) and target dir (user project)
  dotenv.config({ path: join(PKG_ROOT, '.env') });
  if (config.targetDir) {
    dotenv.config({ path: join(config.targetDir, '.env') });
  }

  await mkdir(config.dataDir, { recursive: true });

  return _boot(config);
}

async function _boot(config) {
  const DATA_DIR = config.dataDir;

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Serve built viewer as static files
  app.use(express.static(config.viewerDir));

  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // --- Claude AI ---
  const aiStatus = initClaude();
  console.log(aiStatus.available ? `Claude AI ready (${aiStatus.model})` : `Claude AI unavailable: ${aiStatus.error}`);

  // --- Graph Cache ---
  let cachedGraph = null;
  let cachedNodeMap = null;

  async function loadGraph() {
    const graphPath = join(DATA_DIR, 'graph.json');
    const graph = JSON.parse(await readFile(graphPath, 'utf-8'));
    cachedGraph = graph;
    cachedNodeMap = new Map(graph.nodes.map(n => [n.id, n]));
    return graph;
  }

  function getGraph() { return cachedGraph; }
  function getNode(id) { return cachedNodeMap?.get(id) || null; }

  // If targetDir provided, analyze it on startup
  if (config.targetDir) {
    try {
      console.log(`Analyzing ${config.targetDir}...`);
      const graph = await analyze(config.targetDir);
      const graphPath = join(DATA_DIR, 'graph.json');
      await writeFile(graphPath, JSON.stringify(graph, null, 2));
      cachedGraph = graph;
      cachedNodeMap = new Map(graph.nodes.map(n => [n.id, n]));
      console.log(`Analysis complete: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    } catch (err) {
      console.error('Initial analysis failed:', err.message);
    }
  }

  // Try loading existing graph
  if (!cachedGraph) {
    try {
      await loadGraph();
      console.log(`Graph loaded: ${cachedGraph.nodes.length} nodes, ${cachedGraph.edges.length} edges`);
    } catch {
      console.warn('No graph.json found on startup');
    }
  }

  // --- WebSocket ---
  const clients = new Set();
  const PING_INTERVAL = 30000;
  const pingInterval = setInterval(() => {
    for (const ws of clients) {
      if (ws.isAlive === false) { clients.delete(ws); ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, PING_INTERVAL);
  wss.on('close', () => clearInterval(pingInterval));

  function broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of clients) {
      if (ws.readyState === 1) ws.send(data);
    }
  }

  // Shared helper: find node, read file, compute deps/dependents
  async function getNodeContext(nodeId) {
    const graph = getGraph();
    if (!graph) return null;
    const node = getNode(nodeId);
    if (!node) return null;

    let content = null;
    if (node.type === 'module' && node.children?.length > 0) {
      const parts = await Promise.all(
        node.children.map(async (childId) => {
          const child = getNode(childId);
          if (!child?.filePath || child.type === 'external' || child.type === 'module') return null;
          try {
            const src = await readFile(join(graph.meta.rootDir, child.filePath), 'utf-8');
            const lines = src.split('\n');
            const preview = lines.slice(0, 40).join('\n');
            return `// === ${child.filePath} (${child.label}, ${child.linesOfCode} lines) ===\n${preview}${lines.length > 40 ? '\n// ...' : ''}\n`;
          } catch { return null; }
        })
      );
      const joined = parts.filter(Boolean).join('\n');
      if (joined) content = joined;
    } else if (node.filePath && node.type !== 'external') {
      try {
        content = await readFile(join(graph.meta.rootDir, node.filePath), 'utf-8');
      } catch (err) {
        console.warn(`Could not read file for node ${nodeId}:`, err.message);
      }
    }

    const dependencies = graph.edges
      .filter(e => e.source === node.id)
      .map(e => { const t = getNode(e.target); return t ? { id: t.id, label: t.label, type: t.type, layer: t.layer, description: t.description || '', symbols: e.symbols || [] } : null; })
      .filter(Boolean);

    const dependents = graph.edges
      .filter(e => e.target === node.id)
      .map(e => { const s = getNode(e.source); return s ? { id: s.id, label: s.label, type: s.type, layer: s.layer, description: s.description || '', symbols: e.symbols || [] } : null; })
      .filter(Boolean);

    return { node, content, dependencies, dependents, graph };
  }

  // --- Project File Watcher ---
  let projectWatcher = null;
  let reanalyzeTimer = null;
  let analyzing = false;
  let watchedRootDir = null;
  const DEBOUNCE_MS = 2000;

  async function runReanalysis() {
    if (analyzing || !watchedRootDir) return;
    analyzing = true;
    try {
      const oldDescriptions = {};
      const oldGraph = getGraph();
      if (oldGraph) {
        for (const node of oldGraph.nodes) {
          if (node.description) oldDescriptions[node.id] = node.description;
        }
      }

      console.log('Re-analyzing project...');
      const newGraph = await analyze(watchedRootDir);
      for (const node of newGraph.nodes) {
        if (!node.description && oldDescriptions[node.id]) node.description = oldDescriptions[node.id];
      }

      const graphPath = join(DATA_DIR, 'graph.json');
      await writeFile(graphPath, JSON.stringify(newGraph, null, 2));
      cachedGraph = newGraph;
      cachedNodeMap = new Map(newGraph.nodes.map(n => [n.id, n]));
      broadcast({ type: 'graph_updated' });
      console.log(`Re-analysis complete: ${newGraph.nodes.length} nodes, ${newGraph.edges.length} edges`);
    } catch (err) {
      console.error('Re-analysis error:', err.message);
    } finally {
      analyzing = false;
    }
  }

  function scheduleReanalyze() {
    if (reanalyzeTimer) clearTimeout(reanalyzeTimer);
    reanalyzeTimer = setTimeout(runReanalysis, DEBOUNCE_MS);
  }

  async function watchProject() {
    const graph = getGraph();
    if (!graph) { console.log('No graph data, skipping project watch'); return; }
    watchedRootDir = graph.meta?.rootDir;
    if (!watchedRootDir) return;

    const ignored = (filePath) => {
      const parts = filePath.split('/');
      if (parts.some(p => SKIP_DIRS.has(p))) return true;
      if (parts.some(p => p !== '.' && p !== '..' && p.startsWith('.'))) return true;
      if (filePath.endsWith('.json') || filePath.endsWith('.lock')) return true;
      return false;
    };

    try {
      const { access } = await import('node:fs/promises');
      await access(watchedRootDir);
    } catch (err) {
      console.warn(`Project directory not accessible: ${watchedRootDir}:`, err.message);
      watchedRootDir = null;
      return;
    }

    console.log(`Watching project: ${watchedRootDir}`);
    projectWatcher = watch(watchedRootDir, {
      ignored, ignoreInitial: true, persistent: true,
      awaitWriteFinish: { stabilityThreshold: 300 },
    });
    projectWatcher
      .on('add', scheduleReanalyze)
      .on('change', scheduleReanalyze)
      .on('unlink', scheduleReanalyze)
      .on('error', (err) => console.error(`Watcher error: ${err.message}`));
    broadcast({ type: 'watching', data: { rootDir: watchedRootDir } });
  }

  // Watch graph.json for external changes
  try {
    watch(join(DATA_DIR, 'graph.json'), { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 500 } })
      .on('change', async () => {
        if (analyzing) return;
        try {
          await loadGraph();
          const newRoot = cachedGraph.meta?.rootDir;
          if (newRoot && newRoot !== watchedRootDir) {
            console.log(`Project changed to ${newRoot}, re-watching...`);
            if (projectWatcher) await projectWatcher.close();
            watchedRootDir = null;
            projectWatcher = null;
            await watchProject();
          }
        } catch (err) {
          console.error('Error reloading graph.json after external change:', err.message);
        }
      })
      .on('error', (err) => console.warn('graph.json watcher error:', err.message));
  } catch (err) {
    console.warn('Could not watch graph.json:', err.message);
  }

  // --- REST API ---

  app.get('/api/graph', async (_req, res) => {
    try {
      const graph = getGraph() || await loadGraph();
      res.json(graph);
    } catch { res.status(404).json({ error: 'No graph data. Run the analyzer first.' }); }
  });

  app.get('/api/node', async (req, res) => {
    const id = req.query.id;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing or invalid "id" query parameter' });
    try {
      const ctx = await getNodeContext(id);
      if (!ctx) return res.status(404).json({ error: 'Node not found' });
      const { node, content, dependencies, dependents } = ctx;
      res.json({ node, content, dependencies, dependents });
    } catch (err) {
      console.error('Error fetching node:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/node-brief', async (req, res) => {
    const id = req.query.id;
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'Missing or invalid "id" query parameter' });
    try {
      const ctx = await getNodeContext(id);
      if (!ctx) return res.status(404).json({ error: 'Node not found' });
      const { node, content, dependencies, dependents, graph } = ctx;
      if (node.brief) return res.json({ brief: node.brief, cached: true });
      const staticSummary = buildStaticSummary(node, dependencies, dependents, graph);
      const status = getAiStatus();
      if (status.available && content) {
        try {
          const result = await generateBrief({ fileContent: content, filePath: node.filePath, node, dependencies, dependents, graphMeta: graph.meta });
          node.brief = result.brief;
          await writeFile(join(DATA_DIR, 'graph.json'), JSON.stringify(graph, null, 2));
          return res.json({ brief: result.brief, cached: false });
        } catch (err) {
          console.error('Brief generation failed, using static:', err.message);
          return res.json({ brief: staticSummary, cached: false, static: true });
        }
      }
      res.json({ brief: staticSummary, cached: false, static: true });
    } catch (err) {
      console.error('Error generating brief:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  function buildStaticSummary(node, dependencies, dependents, graph) {
    const lines = [];
    if (node.description) {
      lines.push(`PURPOSE: ${node.description}`);
    } else if (node.type === 'module') {
      const childCount = node.children?.length || 0;
      lines.push(`PURPOSE: Module containing ${childCount} file${childCount !== 1 ? 's' : ''} that handles ${node.label.toLowerCase()} functionality.`);
    } else if (node.type === 'external') {
      lines.push(`PURPOSE: External dependency "${node.label}" used by the project.`);
    } else {
      lines.push(`PURPOSE: ${node.type} file in the ${node.layer} layer — ${node.filePath}`);
    }
    const layerDescriptions = {
      ui: 'user interface layer — handles rendering and user interaction',
      api: 'API layer — defines endpoints and request handling',
      logic: 'business logic layer — core application functionality',
      data: 'data layer — manages data access and storage',
      config: 'configuration layer — project setup and constants',
      external: 'external dependency',
    };
    lines.push(`ROLE: Part of the ${layerDescriptions[node.layer] || node.layer}. ${dependents.length} file${dependents.length !== 1 ? 's' : ''} depend on this, it depends on ${dependencies.length}.`);
    if (node.exports && node.exports.length > 0) {
      lines.push(`KEY EXPORTS:`);
      for (const exp of node.exports.slice(0, 6)) {
        const usedBy = dependents.filter(d => d.symbols?.includes(exp));
        lines.push(usedBy.length > 0 ? `- ${exp} — used by ${usedBy.map(d => d.label).join(', ')}` : `- ${exp}`);
      }
      if (node.exports.length > 6) lines.push(`- ...and ${node.exports.length - 6} more`);
    }
    if (dependencies.length > 0) {
      const depLabels = dependencies.slice(0, 4).map(d => d.label).join(', ');
      lines.push(`CONTEXT: Depends on ${depLabels}${dependencies.length > 4 ? ` and ${dependencies.length - 4} more` : ''}.`);
    }
    if (dependents.length > 3) lines.push(`This is a high-connectivity file (${dependents.length} dependents) — changes here may have wide impact.`);
    return lines.join('\n');
  }

  app.post('/api/enrich', async (req, res) => {
    try {
      const descriptions = req.body.descriptions;
      if (!descriptions || typeof descriptions !== 'object' || Array.isArray(descriptions))
        return res.status(400).json({ error: 'Expected { descriptions: { nodeId: "text" } }' });
      for (const [key, val] of Object.entries(descriptions)) {
        if (typeof val !== 'string') return res.status(400).json({ error: `Description for "${key}" must be a string` });
      }
      const graph = await loadGraph();
      let updated = 0;
      for (const [nodeId, desc] of Object.entries(descriptions)) {
        const node = getNode(nodeId);
        if (node) { node.description = desc; updated++; }
      }
      await writeFile(join(DATA_DIR, 'graph.json'), JSON.stringify(graph, null, 2));
      broadcast({ type: 'graph_updated' });
      res.json({ updated });
    } catch (err) {
      console.error('Error enriching graph:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/snippets', async (_req, res) => {
    try {
      const graph = getGraph() || await loadGraph();
      const snippets = graph.nodes
        .filter(n => n.snippet && !n.description)
        .map(n => ({ id: n.id, label: n.label, type: n.type, layer: n.layer, filePath: n.filePath, exports: n.exports, snippet: n.snippet }));
      res.json({ snippets, total: snippets.length });
    } catch (err) {
      console.error('Error fetching snippets:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/status', async (_req, res) => {
    const graph = getGraph();
    res.json({ watching: !!projectWatcher, rootDir: graph?.meta?.rootDir || null, analyzedAt: graph?.meta?.analyzedAt || null });
  });

  app.get('/api/ai-status', (_req, res) => { res.json(getAiStatus()); });

  app.post('/api/enrich-auto', async (_req, res) => {
    const status = getAiStatus();
    if (!status.available) return res.status(503).json({ error: 'AI not available: ' + status.error });
    try {
      const graph = getGraph() || await loadGraph();
      const toEnrich = graph.nodes.filter(n => n.filePath && n.type !== 'external' && !n.description);
      if (toEnrich.length === 0) return res.json({ enriched: 0, total: 0 });

      let enriched = 0;
      const CONCURRENCY = 3;
      for (let i = 0; i < toEnrich.length; i += CONCURRENCY) {
        const batch = toEnrich.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (node) => {
            const filePath = join(graph.meta.rootDir, node.filePath);
            const content = await readFile(filePath, 'utf-8');
            const result = await generateDescription({ fileContent: content, filePath: node.filePath, node, graphMeta: graph.meta });
            return { node, description: result.description };
          })
        );
        for (const result of results) {
          if (result.status === 'fulfilled') {
            result.value.node.description = result.value.description;
            enriched++;
            broadcast({ type: 'enrich_progress', data: { completed: enriched, total: toEnrich.length, current: result.value.node.label } });
          } else {
            console.error(`Enrich failed:`, result.reason?.message || result.reason);
          }
        }
      }
      await writeFile(join(DATA_DIR, 'graph.json'), JSON.stringify(graph, null, 2));
      cachedGraph = graph;
      cachedNodeMap = new Map(graph.nodes.map(n => [n.id, n]));
      broadcast({ type: 'graph_updated' });
      res.json({ enriched, total: toEnrich.length });
    } catch (err) {
      console.error('Auto-enrich error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Presentation ---

  function buildPresentationSteps(graph) {
    const modules = graph.nodes.filter(n => n.type === 'module');
    const files = graph.nodes.filter(n => n.type !== 'module' && n.type !== 'external');
    const moduleChildren = new Map();
    for (const mod of modules) moduleChildren.set(mod.id, files.filter(f => (mod.children || []).includes(f.id)));
    const grouped = new Set(modules.flatMap(m => m.children || []));
    const ungrouped = files.filter(f => !grouped.has(f.id));
    const steps = [];

    const descList = modules.filter(m => m.description).map(m => m.description.toLowerCase());
    const purposeHint = descList.length > 0 ? ` From what I can see, it ${descList[0].replace(/\.$/, '')}.` : '';
    steps.push({
      type: 'intro',
      narration: `Let me walk you through ${graph.meta.projectName}.${purposeHint} It's made up of ${graph.meta.fileCount} source files${graph.meta.framework ? ` built with ${graph.meta.framework}` : ''}. I'll show you each part and how they connect.`,
      showNodes: [], showEdges: [], duration: 5000,
    });

    const shownNodes = [];
    const shownEdges = [];
    const sortedModules = [...modules].sort((a, b) => (moduleChildren.get(b.id) || []).length - (moduleChildren.get(a.id) || []).length);

    for (let i = 0; i < sortedModules.length; i++) {
      const mod = sortedModules[i];
      const children = moduleChildren.get(mod.id) || [];
      shownNodes.push(mod.id);

      const connectedTo = [];
      const newEdges = [];
      for (const prev of shownNodes.slice(0, -1)) {
        const hasConnection = graph.edges.some(e => {
          const sourceModule = modules.find(m => (m.children || []).includes(e.source))?.id || e.source;
          const targetModule = modules.find(m => (m.children || []).includes(e.target))?.id || e.target;
          return (sourceModule === prev && targetModule === mod.id) || (sourceModule === mod.id && targetModule === prev);
        });
        if (hasConnection) {
          newEdges.push(`${prev}->${mod.id}`);
          const prevMod = sortedModules.find(m => m.id === prev);
          if (prevMod) connectedTo.push(prevMod.label);
        }
      }
      shownEdges.push(...newEdges);

      let narration = '';
      if (i === 0) {
        narration = `The biggest piece is ${mod.label}. `;
        if (mod.description) narration += `${mod.description} `;
        narration += `It contains ${children.length} files.`;
      } else {
        narration = `Next is ${mod.label}. `;
        if (mod.description) narration += `${mod.description} `;
        if (connectedTo.length > 0) {
          narration += `It connects to ${connectedTo.join(' and ')}, `;
          narration += connectedTo.length === 1 ? `so these two work together.` : `so all of these work together.`;
        }
      }
      const topChildren = children.filter(c => c.description).slice(0, 2);
      if (topChildren.length > 0) {
        narration += ` Inside, ${topChildren.map(c => `${c.label} ${c.description.toLowerCase().replace(/\.$/, '')}`).join(', and ')}.`;
      }
      steps.push({ type: 'module', nodeId: mod.id, narration: narration.trim(), showNodes: [...shownNodes], showEdges: [...shownEdges], duration: Math.max(5000, narration.length * 55) });

      if (connectedTo.length >= 2 && i < sortedModules.length - 1) {
        steps.push({
          type: 'context',
          narration: `So let's pause and look at how these fit together. ${shownNodes.map(id => sortedModules.find(x => x.id === id)?.label).filter(Boolean).join(', ')} — they're all connected. Data flows between them to make the app work as a whole.`,
          showNodes: [...shownNodes], showEdges: [...shownEdges], duration: 5000,
        });
      }
    }

    if (ungrouped.length > 0) {
      for (const file of ungrouped) shownNodes.push(file.id);
      const fileNames = ungrouped.map(f => f.label).join(', ');
      steps.push({
        type: 'file',
        narration: ungrouped.length === 1
          ? `There's also ${ungrouped[0].label} sitting outside the main modules.${ungrouped[0].description ? ' ' + ungrouped[0].description + '.' : ''}`
          : `There are also a few standalone files: ${fileNames}. They don't belong to any specific module but support the rest.`,
        showNodes: [...shownNodes], showEdges: [...shownEdges], duration: 4000,
      });
    }

    const allModuleIds = modules.map(m => m.id);
    const allFileIds = ungrouped.map(f => f.id);
    const totalConnections = new Set(graph.edges.map(e => {
      const src = modules.find(m => (m.children || []).includes(e.source))?.id || e.source;
      const tgt = modules.find(m => (m.children || []).includes(e.target))?.id || e.target;
      return src !== tgt ? `${src}->${tgt}` : null;
    }).filter(Boolean)).size;

    steps.push({
      type: 'summary',
      narration: `And here's the full picture. ${graph.meta.projectName} has ${modules.length} main parts with ${totalConnections} connections between them. ${graph.meta.fileCount} files total. You can click on any card to explore the code, or ask me questions about anything you see.`,
      showNodes: [...allModuleIds, ...allFileIds], showEdges: [...shownEdges], duration: 6000,
    });

    return steps;
  }

  app.post('/api/presentation', async (req, res) => {
    try {
      const { steps } = req.body;
      if (!steps || !Array.isArray(steps)) return res.status(400).json({ error: 'Missing steps array' });
      await writeFile(join(DATA_DIR, 'presentation.json'), JSON.stringify({ steps, generatedAt: new Date().toISOString() }, null, 2));
      broadcast({ type: 'presentation_updated' });
      res.json({ ok: true, stepCount: steps.length });
    } catch (err) {
      console.error('Error saving presentation:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/presentation', async (_req, res) => {
    try {
      try {
        const custom = JSON.parse(await readFile(join(DATA_DIR, 'presentation.json'), 'utf-8'));
        if (custom.steps && custom.steps.length > 0) {
          const graph = getGraph() || await loadGraph();
          return res.json({ steps: custom.steps, meta: graph.meta });
        }
      } catch { /* no custom script */ }
      const graph = getGraph() || await loadGraph();
      res.json({ steps: buildPresentationSteps(graph), meta: graph.meta });
    } catch (err) {
      console.error('Error generating presentation:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // --- TTS ---
  const TTS_CACHE = join(DATA_DIR, 'tts_cache');
  await mkdir(TTS_CACHE, { recursive: true });

  const tts = new MsEdgeTTS();
  await tts.setMetadata('en-US-AvaMultilingualNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const ttsRequestTimes = [];
  const TTS_MAX_REQUESTS = 20;
  const TTS_WINDOW_MS = 60000;
  const TTS_MAX_TEXT_LENGTH = 2000;

  function ttsRateLimitOk() {
    const now = Date.now();
    while (ttsRequestTimes.length > 0 && ttsRequestTimes[0] < now - TTS_WINDOW_MS) ttsRequestTimes.shift();
    if (ttsRequestTimes.length >= TTS_MAX_REQUESTS) return false;
    ttsRequestTimes.push(now);
    return true;
  }

  app.get('/api/tts', async (req, res) => {
    try {
      const text = req.query.text;
      if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text parameter' });
      if (text.length > TTS_MAX_TEXT_LENGTH) return res.status(400).json({ error: `Text too long (max ${TTS_MAX_TEXT_LENGTH} chars)` });
      if (!ttsRateLimitOk()) return res.status(429).json({ error: 'Too many TTS requests. Try again shortly.' });

      const hash = createHash('md5').update(text).digest('hex');
      const cachePath = join(TTS_CACHE, `${hash}.mp3`);
      try {
        const cached = await readFile(cachePath);
        res.set('Content-Type', 'audio/mpeg');
        res.set('Cache-Control', 'public, max-age=86400');
        return res.send(cached);
      } catch { /* cache miss */ }

      const { audioStream } = tts.toStream(text);
      const audio = await new Promise((resolve, reject) => {
        const chunks = [];
        audioStream.on('data', (chunk) => chunks.push(chunk));
        audioStream.on('end', () => resolve(Buffer.concat(chunks)));
        audioStream.on('error', reject);
      });
      await writeFile(cachePath, audio);
      res.set('Content-Type', 'audio/mpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(audio);
    } catch (err) {
      console.error('TTS error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // --- WebSocket ---
  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    clients.add(ws);
    console.log(`Client connected (${clients.size} total)`);
    ws.send(JSON.stringify({ type: 'ai_status', data: getAiStatus() }));

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'question') {
          const questionId = `q_${Date.now()}`;
          const { nodeId, nodeLabel, filePath, question } = msg.data || {};
          if (!nodeId || !question) {
            ws.send(JSON.stringify({ type: 'error', data: { message: 'Missing nodeId or question' } }));
            return;
          }
          ws.send(JSON.stringify({ type: 'question_submitted', data: { id: questionId } }));

          const status = getAiStatus();
          if (!status.available) {
            ws.send(JSON.stringify({ type: 'answer', data: { id: questionId, nodeId, nodeLabel, question, answer: 'AI is not available. Set the ANTHROPIC_API_KEY environment variable and restart the server.', answeredAt: new Date().toISOString(), error: true } }));
            return;
          }

          const ctx = await getNodeContext(nodeId);
          if (!ctx || !ctx.content) {
            ws.send(JSON.stringify({ type: 'answer', data: { id: questionId, nodeId, nodeLabel, question, answer: 'Could not read the source file for this node.', answeredAt: new Date().toISOString(), error: true } }));
            return;
          }

          const relatedFiles = await buildRelatedContext(ctx.graph, nodeId, ctx.graph.meta.rootDir);
          try {
            const result = await askAboutFile({ question, fileContent: ctx.content, filePath: ctx.node.filePath, node: ctx.node, dependencies: ctx.dependencies, dependents: ctx.dependents, graphMeta: ctx.graph.meta, relatedFiles });
            broadcast({ type: 'answer', data: { id: questionId, nodeId, nodeLabel, question, answer: result.answer, answeredAt: new Date().toISOString() } });
          } catch (aiErr) {
            console.error('AI question error:', aiErr.message);
            ws.send(JSON.stringify({ type: 'answer', data: { id: questionId, nodeId, nodeLabel, question, answer: `AI error: ${aiErr.message}`, answeredAt: new Date().toISOString(), error: true } }));
          }
        }
      } catch (err) {
        console.error('WebSocket message error:', err.message);
        ws.send(JSON.stringify({ type: 'error', data: { message: err.message } }));
      }
    });

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`Client disconnected (${clients.size} total)`);
    });
  });

  // SPA fallback: serve index.html for non-API routes
  app.get('/*splat', (_req, res) => {
    res.sendFile(join(config.viewerDir, 'index.html'));
  });

  // --- Start ---
  return new Promise((resolve) => {
    server.listen(config.port, async () => {
      console.log(`\nVisualizer running on http://localhost:${config.port}`);
      console.log(`WebSocket at ws://localhost:${config.port}/ws`);
      await watchProject();
      resolve({ server, port: config.port, url: `http://localhost:${config.port}` });
    });
  });
}

// --- Direct run (backwards compat: node server/index.mjs) ---
const isDirectRun = process.argv[1] &&
  new URL(import.meta.url).pathname === resolve(process.argv[1]);

if (isDirectRun) {
  dotenv.config({ path: join(PKG_ROOT, '.env') });
  const targetDir = process.argv[2] || null;
  startServer({
    targetDir,
    dataDir: join(PKG_ROOT, 'data'),
    port: process.env.PORT || 3001,
  });
}
