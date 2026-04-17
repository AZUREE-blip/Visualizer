---
name: visualize
description: Visualize codebase architecture as an interactive diagram. Use when the user wants to see a visual map of their code structure, understand module dependencies, or explore how files connect to each other.
allowed-tools: Bash(node *) Bash(npm *) Bash(open *) Bash(curl *) Bash(kill *) Bash(lsof *) Read Write Glob Grep
---

# Codebase Visualizer

Generate and display an interactive architecture diagram for any codebase.

## Steps

### 1. Analyze the codebase

Run the analyzer on the target directory (use $ARGUMENTS as the path, default to current directory):

```bash
node ${CLAUDE_SKILL_DIR}/../../scripts/analyze.mjs ${1:-.}
```

This creates `data/graph.json` with nodes (files, modules, databases, external packages) and edges (imports, routes, API calls).

### 2. Generate AI descriptions

If the `ANTHROPIC_API_KEY` environment variable is set, the server can auto-generate descriptions using Claude. Just call:

```bash
curl -s -X POST http://localhost:3001/api/enrich-auto
```

This reads the full source code of every un-described file and generates a concise, plain-English description via the Claude API. Progress is broadcast to the viewer in real time.

Alternatively, you can still manually provide descriptions via:

```bash
curl -s -X POST http://localhost:3001/api/enrich \
  -H 'Content-Type: application/json' \
  -d '{"descriptions": {"path/to/file.js": "What this file does in plain English", ...}}'
```

The viewer will auto-refresh with the new descriptions.

### 3. Generate the Architecture Tour narration

This is what makes the presentation mode valuable. Read `data/graph.json` and write a compelling tour script that tells the **story** of the codebase — what it does, how data flows, and why each part exists.

First, read the graph to understand the codebase structure:

```bash
curl -s http://localhost:3001/api/graph | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps({'meta':d['meta'],'modules':[{'id':n['id'],'label':n['label'],'desc':n.get('description',''),'children':n.get('children',[])} for n in d['nodes'] if n['type']=='module'],'files':[{'id':n['id'],'label':n['label'],'desc':n.get('description','')} for n in d['nodes'] if n['type'] not in ('module','external')],'edges':[{'src':e['source'],'tgt':e['target']} for e in d['edges']]}, indent=2))"
```

Then build a presentation script as a JSON array of steps. Each step has:
- `type`: "intro", "context", "module", "file", or "summary"
- `narration`: The spoken text (2-4 sentences, conversational, like explaining to a friend)
- `showNodes`: Array of node IDs to show on screen at this point (cumulative — include previously shown nodes)
- `showEdges`: Array of edge strings like `"module:server->module:test"` (cumulative)
- `duration`: Milliseconds (5000-8000 typical)

**Script structure — tell a STORY, not a list:**

1. **Intro slide** (no nodes shown): Explain what this project IS. "This is a Shopify product scraper. It crawls stores, pulls product data, classifies it with AI, and exports CSVs." Give the user the big picture FIRST.

2. **Purpose slide** (no nodes shown): Explain the user's problem this solves. "If you wanted to analyze a competitor's Shopify store, you'd need to manually visit every page. This automates that entire process."

3. **First module**: Start with the most important module. Explain what it does and WHY.

4. **Connection slides**: After showing 2-3 modules, add a "context" step that explains how they work TOGETHER. "So when a user enters a Shopify URL, the Server's Crawler kicks off, which uses the AI Browser to navigate the site. Then the data flows to..."

5. **Remaining modules**: Continue revealing modules, always explaining connections to what's already visible.

6. **Summary slide**: Show everything. Tie it all together with a one-sentence summary of the full flow.

**Narration tone:**
- Talk like you're explaining to a friend, not reading documentation
- Use "you" and "your" — "When you enter a URL..."
- Explain the WHY, not just the WHAT — "This exists because websites have different layouts..."
- Reference real user actions — "So when someone clicks 'Start Crawl'..."

POST the script:

```bash
curl -s -X POST http://localhost:3001/api/presentation \
  -H 'Content-Type: application/json' \
  -d '{"steps": [... your steps array ...]}'
```

### 4. Start the visualization server

If the server isn't already running:

```bash
cd ${CLAUDE_SKILL_DIR}/../.. && node server/index.mjs &
```

Then start the viewer:

```bash
cd ${CLAUDE_SKILL_DIR}/../../viewer && npx vite --host &
```

Wait a few seconds, then open the browser:

```bash
open http://localhost:5173
```

### 5. AI-powered Q&A (automatic)

When `ANTHROPIC_API_KEY` is set, the server handles questions automatically. When a user asks a question about a file in the viewer:

1. The server reads the full source file from disk
2. It also reads related files (dependencies + dependents) for context
3. It sends everything to the Claude API with the user's question
4. The answer is returned instantly via WebSocket

No manual monitoring is needed. You can check AI status with:

```bash
curl -s http://localhost:3001/api/ai-status
```

If `ANTHROPIC_API_KEY` is not set, the "Ask Claude" feature will show an error message directing users to set the key.
