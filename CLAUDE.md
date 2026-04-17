@AGENTS.md

# Development

This is the codebase-visualizer npm package. It has three parts:
- `scripts/analyze.mjs` — static analysis that builds a dependency graph
- `server/index.mjs` — Express API + WebSocket server + Claude AI integration
- `viewer/` — React + Vite frontend (builds to `viewer/dist/`)

## CLI

`bin/cli.mjs` is the entry point. Two commands:
- `codebase-visualizer init` — adds CLAUDE.md instructions to user's project
- `codebase-visualizer [path]` — analyzes target dir, starts server, serves viewer on one port

## Build

```bash
npm run build          # builds viewer to viewer/dist/
npm run dev            # dev mode (separate vite + server)
```
