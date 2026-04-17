#!/usr/bin/env node

import { readFile, writeFile, access, mkdir } from 'node:fs/promises';
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
  ANTHROPIC_API_KEY=sk-...             Your Claude API key (enables AI features)
  PORT=3001                            Set server port (env var)

AI features (file descriptions, Q&A) require your own Anthropic API key.
Get one at: https://console.anthropic.com/settings/keys
`);
}

async function runInit() {
  const cwd = process.cwd();
  const claudeMdPath = join(cwd, 'CLAUDE.md');
  const marker = '<!-- codebase-visualizer -->';

  const snippet = `
${marker}
## IMPORTANT: Codebase Visualizer is running

The codebase visualizer starts automatically via a hook when this session opens.

**You MUST open http://localhost:3001 in the preview panel immediately** — do not ask the user, just open it. This is a blocking requirement before responding to the user's first message.

The visualizer shows the project's file structure as an interactive diagram. Keep it open in the preview panel throughout the entire session.
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

  // Create .env with placeholder if it doesn't exist
  const envPath = join(cwd, '.env');
  try {
    await access(envPath);
  } catch {
    await writeFile(envPath, '# Get your key at https://console.anthropic.com/settings/keys\nANTHROPIC_API_KEY=\n');
    console.log('Created .env — add your ANTHROPIC_API_KEY there for AI features');
  }

  // Create .claude/settings.json with SessionStart hook
  const claudeDir = join(cwd, '.claude');
  const settingsPath = join(claudeDir, 'settings.json');
  await mkdir(claudeDir, { recursive: true });

  const hookCommand = `codebase-visualizer || npx codebase-visualizer`;

  let settings = {};
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8'));
  } catch { /* no existing settings */ }

  // Add hook if not already present
  if (!settings.hooks?.SessionStart?.some(h => h.hooks?.some(hh => hh.command?.includes('codebase-visualizer')))) {
    settings.hooks = settings.hooks || {};
    settings.hooks.SessionStart = settings.hooks.SessionStart || [];
    settings.hooks.SessionStart.push({
      matcher: "",
      hooks: [{
        type: "command",
        command: hookCommand,
        async: true
      }]
    });
    await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    console.log('Created .claude/settings.json with auto-start hook');
  }

  console.log('\nDone! When you open this project in Claude Code Desktop:');
  console.log('  1. The visualizer starts automatically (via hook)');
  console.log('  2. Claude opens http://localhost:3001 in the preview panel');
  console.log('\nFor AI features (descriptions, Q&A), add your Anthropic API key to .env');
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
