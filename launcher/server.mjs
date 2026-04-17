#!/usr/bin/env node

import express from 'express';
import { execSync, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const LAUNCHER_PORT = 3000;
const VISUALIZER_PORT = 3002;

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

// macOS native folder picker via osascript
app.post('/api/pick-folder', async (_req, res) => {
  try {
    const script = `
      set chosenFolder to choose folder with prompt "Choose your project folder"
      return POSIX path of chosenFolder
    `;
    const result = execSync(`osascript -e '${script}'`, {
      encoding: 'utf-8',
      timeout: 60000,
    }).trim().replace(/\/$/, '');
    res.json({ path: result });
  } catch (err) {
    if (err.status === 1) {
      res.json({ cancelled: true });
    } else {
      res.json({ error: 'Could not open folder picker' });
    }
  }
});

// Run init on chosen folder
app.post('/api/init', async (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.json({ error: 'No folder path' });

  try {
    await access(folderPath);
  } catch {
    return res.json({ error: 'Folder not found' });
  }

  try {
    // Create .claude/settings.json with hook
    const claudeDir = join(folderPath, '.claude');
    await mkdir(claudeDir, { recursive: true });

    const settingsPath = join(claudeDir, 'settings.json');
    let settings = {};
    try { settings = JSON.parse(await readFile(settingsPath, 'utf-8')); } catch {}

    const hasHook = settings.hooks?.SessionStart?.some(
      h => h.hooks?.some(hh => hh.command?.includes('codebase-visualizer'))
    );
    if (!hasHook) {
      settings.hooks = settings.hooks || {};
      settings.hooks.SessionStart = settings.hooks.SessionStart || [];
      settings.hooks.SessionStart.push({
        matcher: '',
        hooks: [{
          type: 'command',
          command: 'codebase-visualizer || npx codebase-visualizer',
          async: true,
        }],
      });
      await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    }

    // Create CLAUDE.md
    const claudeMdPath = join(folderPath, 'CLAUDE.md');
    const marker = '<!-- codebase-visualizer -->';
    const snippet = `${marker}
## IMPORTANT: Codebase Visualizer is running

The codebase visualizer starts automatically via a hook when this session opens.

**You MUST open http://localhost:3001 in the preview panel immediately** — do not ask the user, just open it. This is a blocking requirement before responding to the user's first message.

The visualizer shows the project's file structure as an interactive diagram. Keep it open in the preview panel throughout the entire session.
${marker}
`;
    try {
      const existing = await readFile(claudeMdPath, 'utf-8');
      if (!existing.includes(marker)) {
        await writeFile(claudeMdPath, existing.trimEnd() + '\n\n' + snippet);
      }
    } catch {
      await writeFile(claudeMdPath, snippet);
    }

    res.json({ ok: true });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Analyze the project
app.post('/api/analyze', async (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.json({ error: 'No folder path' });

  try {
    const { analyze } = await import('../scripts/analyze.mjs');
    const graph = await analyze(folderPath);

    const dataDir = join(folderPath, '.visualizer');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'graph.json'), JSON.stringify(graph, null, 2));

    res.json({ nodes: graph.nodes.length, edges: graph.edges.length });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Save API key to .env
app.post('/api/save-key', async (req, res) => {
  const { key, path: folderPath } = req.body;
  if (!folderPath) return res.json({ error: 'No folder path' });

  const envPath = join(folderPath, '.env');
  let existing = '';
  try { existing = await readFile(envPath, 'utf-8'); } catch {}

  if (existing.includes('ANTHROPIC_API_KEY')) {
    existing = existing.replace(/ANTHROPIC_API_KEY=.*/, `ANTHROPIC_API_KEY=${key}`);
  } else {
    existing += `\nANTHROPIC_API_KEY=${key}\n`;
  }
  await writeFile(envPath, existing);
  res.json({ ok: true });
});

// Start the visualizer server
let visualizerProcess = null;

app.post('/api/start', async (req, res) => {
  const { path: folderPath } = req.body;
  if (!folderPath) return res.json({ error: 'No folder path' });

  if (visualizerProcess) {
    visualizerProcess.kill();
  }

  const viewerDir = join(PKG_ROOT, 'viewer', 'dist');
  const dataDir = join(folderPath, '.visualizer');

  try {
    const { startServer } = await import('../server/index.mjs');
    await startServer({
      targetDir: folderPath,
      dataDir,
      port: VISUALIZER_PORT,
      viewerDir,
    });
    res.json({ ok: true, url: `http://localhost:${VISUALIZER_PORT}` });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Start launcher
const server = createServer(app);
server.listen(LAUNCHER_PORT, () => {
  const url = `http://localhost:${LAUNCHER_PORT}`;
  console.log(`\n  Codebase Visualizer Launcher`);
  console.log(`  ${url}\n`);

  // Open in default browser
  try {
    execSync(`open "${url}"`);
  } catch {}
});
