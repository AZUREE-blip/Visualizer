#!/usr/bin/env node

/**
 * Analyze CWD codebase and prepare for preview panel.
 * Writes graph.json to /tmp and creates .claude/launch.json.
 * Exits immediately — preview_start handles serving.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

const cwd = process.argv[2] || process.cwd();
const projectName = cwd.replace(/\//g, '-').replace(/^-/, '');
const tmpDataDir = join('/tmp', `codebase-visualizer-${projectName}`);
const serveBin = join(PKG_ROOT, 'bin', 'serve.mjs');
const viewerDir = join(PKG_ROOT, 'viewer', 'dist');

// 0. Persist API key to /tmp so sandbox server can read it
const envApiKey = process.env.ANTHROPIC_API_KEY;
if (envApiKey) {
  await writeFile('/tmp/codebase-visualizer-apikey', envApiKey);
} else {
  // Try reading from project .env
  try {
    const envFile = await readFile(join(cwd, '.env'), 'utf-8');
    const match = envFile.match(/ANTHROPIC_API_KEY=(.+)/);
    if (match?.[1]?.trim()) await writeFile('/tmp/codebase-visualizer-apikey', match[1].trim());
  } catch {}
}

// 1. Analyze
await mkdir(tmpDataDir, { recursive: true });
const { analyze } = await import('../scripts/analyze.mjs');
const graph = await analyze(cwd);
await writeFile(join(tmpDataDir, 'graph.json'), JSON.stringify(graph, null, 2));

// 2. Ensure launch.json exists
const claudeDir = join(cwd, '.claude');
await mkdir(claudeDir, { recursive: true });
const launchPath = join(claudeDir, 'launch.json');

let existingLaunch = {};
try { existingLaunch = JSON.parse(await readFile(launchPath, 'utf-8')); } catch {}
const configs = (existingLaunch.configurations || []).filter(c => c.name !== 'visualizer');
configs.push({
  name: 'visualizer',
  runtimeExecutable: 'bash',
  runtimeArgs: ['-c', `cd /tmp && node ${serveBin} ${tmpDataDir} ${viewerDir}`],
  port: 3001,
});
existingLaunch.version = '0.0.1';
existingLaunch.configurations = configs;
await writeFile(launchPath, JSON.stringify(existingLaunch, null, 2));

console.log(JSON.stringify({
  ok: true,
  nodes: graph.nodes.length,
  edges: graph.edges.length,
  project: graph.meta.projectName,
  framework: graph.meta.framework || 'unknown',
}));
