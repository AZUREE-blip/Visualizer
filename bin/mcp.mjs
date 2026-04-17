#!/usr/bin/env node

/**
 * MCP server for codebase-visualizer.
 *
 * Provides a single tool: open_visualizer
 * - Analyzes the codebase
 * - Starts the viewer on a port
 * - Returns the URL so Claude can open it via preview_start
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

let serverInstance = null;
let serverPort = null;

const mcp = new McpServer({
  name: 'codebase-visualizer',
  version: '0.1.0',
});

mcp.tool(
  'open_visualizer',
  'Analyze the codebase and start the interactive visualizer. Returns a URL to open in the preview panel.',
  {
    path: z.string().optional().describe('Project directory to analyze. Defaults to current working directory.'),
    port: z.number().optional().describe('Port for the viewer server. Defaults to 3001.'),
  },
  async ({ path, port }) => {
    const targetDir = resolve(path || process.cwd());
    const usePort = port || 3001;
    const viewerDir = join(PKG_ROOT, 'viewer', 'dist');
    const dataDir = join(targetDir, '.visualizer');

    // Kill existing process on port if any
    try {
      execSync(`lsof -ti:${usePort} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
    } catch {}

    // If already running on this port, return URL
    if (serverInstance && serverPort === usePort) {
      return {
        content: [{
          type: 'text',
          text: `Visualizer already running.\n\nOpen http://localhost:${usePort} in the preview panel.`,
        }],
      };
    }

    try {
      await mkdir(dataDir, { recursive: true });

      // Analyze
      const { analyze } = await import(join(PKG_ROOT, 'scripts', 'analyze.mjs'));
      const graph = await analyze(targetDir);
      await writeFile(join(dataDir, 'graph.json'), JSON.stringify(graph, null, 2));

      // Start server
      const { startServer } = await import(join(PKG_ROOT, 'server', 'index.mjs'));
      serverInstance = await startServer({ targetDir, dataDir, port: usePort, viewerDir });
      serverPort = usePort;

      return {
        content: [{
          type: 'text',
          text: `Visualizer started.\n\n**Open http://localhost:${usePort} in the preview panel now.**\n\nProject: ${graph.meta.projectName}\nFiles: ${graph.nodes.length} nodes, ${graph.edges.length} edges\nFramework: ${graph.meta.framework || 'unknown'}`,
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Failed to start visualizer: ${err.message}`,
        }],
        isError: true,
      };
    }
  }
);

mcp.tool(
  'get_codebase_structure',
  'Get the codebase structure as text without starting the viewer. Useful for quick overview.',
  {
    path: z.string().optional().describe('Project directory to analyze. Defaults to current working directory.'),
  },
  async ({ path }) => {
    const targetDir = resolve(path || process.cwd());

    try {
      const { analyze } = await import(join(PKG_ROOT, 'scripts', 'analyze.mjs'));
      const graph = await analyze(targetDir);

      const modules = graph.nodes.filter(n => n.type === 'module');
      const files = graph.nodes.filter(n => n.type !== 'module' && n.type !== 'external');

      let text = `# ${graph.meta.projectName}\n`;
      text += `${graph.meta.fileCount} files | ${graph.meta.framework || 'no framework detected'}\n\n`;

      for (const mod of modules) {
        const children = files.filter(f => (mod.children || []).includes(f.id));
        text += `## ${mod.label} (${children.length} files, ${mod.layer})\n`;
        for (const child of children) {
          text += `  - ${child.label} [${child.type}/${child.layer}] ${child.linesOfCode}L\n`;
        }
        text += '\n';
      }

      const grouped = new Set(modules.flatMap(m => m.children || []));
      const ungrouped = files.filter(f => !grouped.has(f.id));
      if (ungrouped.length > 0) {
        text += `## Standalone files\n`;
        for (const f of ungrouped) {
          text += `  - ${f.label} [${f.type}/${f.layer}] ${f.linesOfCode}L\n`;
        }
      }

      return { content: [{ type: 'text', text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Analysis failed: ${err.message}` }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
await mcp.connect(transport);
