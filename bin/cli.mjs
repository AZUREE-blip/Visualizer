#!/usr/bin/env node

import { readFile, writeFile, access } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

const command = process.argv[2] || 'start';

if (command === 'init') {
  await runInit();
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
  npx codebase-visualizer init         Add CLAUDE.md instructions for auto-opening in Claude Code
  npx codebase-visualizer help         Show this help

Options:
  PORT=3001                            Set server port (env var)
`);
}

async function runInit() {
  const cwd = process.cwd();
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  const marker = '<!-- codebase-visualizer -->';

  const snippet = `
${marker}
## Codebase Visualizer

When starting a conversation in this project, automatically run the visualizer:

1. Run \`npx codebase-visualizer\` in the background from the project root
2. Wait a few seconds for analysis to complete
3. Open \`http://localhost:3001\` in the **preview panel** (not a browser tab)

Keep the visualizer open in the preview panel throughout the session so the user can always see the codebase structure alongside our conversation.
${marker}
`;

  try {
    const existing = await readFile(claudeMdPath, 'utf-8');
    if (existing.includes(marker)) {
      console.log('CLAUDE.md already has visualizer instructions. Nothing to do.');
      return;
    }
    await writeFile(claudeMdPath, existing.trimEnd() + '\n' + snippet);
    console.log('Added visualizer instructions to existing CLAUDE.md');
  } catch {
    await writeFile(claudeMdPath, snippet.trimStart());
    console.log('Created CLAUDE.md with visualizer instructions');
  }

  console.log('\nDone! When you open this project in Claude Code Desktop,');
  console.log('the visualizer will automatically start and open in the preview panel.');
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
  console.log('');

  const { startServer } = await import('../server/index.mjs');
  const { url } = await startServer({ targetDir, dataDir, port, viewerDir });

  console.log(`\nOpen ${url} to view your codebase`);
}
