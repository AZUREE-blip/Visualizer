#!/usr/bin/env node

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

const command = process.argv[2] || 'start';

if (command === 'init') {
  await runInit();
} else if (command === 'launch') {
  await runLaunch();
} else if (command === 'start' || command === '.') {
  await runStart();
} else if (command === 'help' || command === '--help' || command === '-h') {
  printHelp();
} else {
  // Treat as target directory path
  await runStart(command);
}

function printHelp() {
  console.log(`
codebase-visualizer — Understand your codebase visually

Usage:
  npx codebase-visualizer              Analyze current directory and start viewer
  npx codebase-visualizer [path]       Analyze a specific project directory
  npx codebase-visualizer launch       Open the launcher GUI (pick folder, set API key)
  npx codebase-visualizer init         Add CLAUDE.md instructions for auto-opening in Claude Code
  npx codebase-visualizer help         Show this help

Options:
  ANTHROPIC_API_KEY=sk-...             Your Claude API key (enables AI features)
  PORT=3001                            Set server port (env var)

AI features (file descriptions, Q&A) require your own Anthropic API key.
Get one at: https://console.anthropic.com/settings/keys
`);
}

async function runInit() {
  const cwd = process.cwd();
  const claudeDir = join(cwd, '.claude');
  await mkdir(claudeDir, { recursive: true });

  const projectName = cwd.replace(/\//g, '-').replace(/^-/, '');
  const tmpDataDir = join('/tmp', `codebase-visualizer-${projectName}`);
  await mkdir(tmpDataDir, { recursive: true });

  // 1. Analyze now and write graph.json to /tmp (sandbox-safe)
  console.log('Analyzing codebase...');
  const { analyze } = await import('../scripts/analyze.mjs');
  const graph = await analyze(cwd);
  await writeFile(join(tmpDataDir, 'graph.json'), JSON.stringify(graph, null, 2));
  console.log(`Analysis complete: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);

  // 2. Create launch.json — preview panel starts a serve-only server reading from /tmp
  const serveBin = join(PKG_ROOT, 'bin', 'serve.mjs');
  const viewerDir = join(PKG_ROOT, 'viewer', 'dist');
  const launchPath = join(claudeDir, 'launch.json');

  const launchConfig = {
    version: '0.0.1',
    configurations: [{
      name: 'visualizer',
      command: `node ${serveBin} ${tmpDataDir} ${viewerDir}`,
      url: 'http://localhost:3001',
      port: 3001,
      timeout: 10000,
    }],
  };

  let existingLaunch = {};
  try { existingLaunch = JSON.parse(await readFile(launchPath, 'utf-8')); } catch {}
  const configs = (existingLaunch.configurations || []).filter(c => c.name !== 'visualizer');
  configs.push(launchConfig.configurations[0]);
  existingLaunch.version = '0.0.1';
  existingLaunch.configurations = configs;
  await writeFile(launchPath, JSON.stringify(existingLaunch, null, 2));
  console.log('Created .claude/launch.json');

  // 3. CLAUDE.md
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  const marker = '<!-- codebase-visualizer -->';
  const snippet = `
${marker}
## Codebase Visualizer

At the start of every conversation, start the "visualizer" preview configuration to show the interactive codebase diagram in the preview panel.
${marker}
`;

  try {
    const existing = await readFile(claudeMdPath, 'utf-8');
    if (!existing.includes(marker)) {
      await writeFile(claudeMdPath, existing.trimEnd() + '\n' + snippet);
    }
  } catch {
    await writeFile(claudeMdPath, snippet.trimStart());
  }
  console.log('Updated CLAUDE.md');

  // 4. Install /visualize skill into project
  const skillDir = join(claudeDir, 'skills', 'visualize');
  await mkdir(skillDir, { recursive: true });
  const skillSrc = join(PKG_ROOT, 'skills', 'visualize', 'SKILL.md');
  try {
    const skillContent = await readFile(skillSrc, 'utf-8');
    await writeFile(join(skillDir, 'SKILL.md'), skillContent);
    console.log('Installed /visualize skill');
  } catch (err) {
    console.warn('Could not install skill:', err.message);
  }

  // 5. .env placeholder
  const envPath = join(cwd, '.env');
  try {
    await access(envPath);
  } catch {
    await writeFile(envPath, '# Get your key at https://console.anthropic.com/settings/keys\nANTHROPIC_API_KEY=\n');
    console.log('Created .env — add your ANTHROPIC_API_KEY for AI features');
  }

  console.log('\nDone! Open this project in Claude Code Desktop and the');
  console.log('visualizer will appear in the preview panel automatically.');
  console.log('\nFor AI features (descriptions, Q&A), add your Anthropic API key to .env');
}

async function runLaunch() {
  await import('../launcher/server.mjs');
}

async function runStart(targetPath) {
  const targetDir = resolve(targetPath || process.cwd());

  try {
    await access(targetDir);
  } catch {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }

  const dataDir = join(targetDir, '.visualizer');
  const port = process.env.PORT || 3001;
  const viewerDir = join(PKG_ROOT, 'viewer', 'dist');

  // Verify viewer dist exists
  try {
    await access(join(viewerDir, 'index.html'));
  } catch {
    console.error('Viewer build not found. Run `npm run build --workspace=viewer` first.');
    process.exit(1);
  }

  console.log(`Codebase Visualizer`);
  console.log(`Target: ${targetDir}`);
  console.log(`Data:   ${dataDir}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('\nNote: No ANTHROPIC_API_KEY found. The graph will work but AI');
    console.log('features (descriptions, Q&A) are disabled. Add your key to .env');
    console.log('or set it: ANTHROPIC_API_KEY=sk-... codebase-visualizer');
  }
  console.log('');

  const { startServer } = await import('../server/index.mjs');
  const { url } = await startServer({ targetDir, dataDir, port, viewerDir });

  console.log(`\nOpen ${url} to view your codebase`);
}
