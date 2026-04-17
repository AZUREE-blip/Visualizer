---
name: visualize
description: Open the codebase visualizer in the preview panel. Shows an interactive architecture diagram of the project. The visualizer server starts automatically via a SessionStart hook — this skill just opens the preview panel.
allowed-tools: Bash(codebase-visualizer*) Bash(npx codebase-visualizer*) Bash(curl*) Bash(lsof*) Bash(kill*) Bash(node*)
---

# Open Codebase Visualizer

The codebase visualizer server should already be running on port 3001 (started by the SessionStart hook). This skill opens it in the preview panel.

## Steps

### 1. Check if server is running

```bash
curl -s http://localhost:3001/api/status
```

If the server is NOT running (curl fails), start it:

```bash
codebase-visualizer || npx codebase-visualizer &
```

Wait 5 seconds for analysis to complete.

### 2. Open in browser

```bash
open http://localhost:3001
```

This opens the interactive codebase diagram in the browser. The user places this window side-by-side with the chat.

### 3. Done

The visualizer is now visible. The user can:
- Click nodes to see file details
- Ask questions about files (requires ANTHROPIC_API_KEY in .env)
- Search and filter by layer
- Toggle between overview and detailed mode

Keep the preview panel open for the rest of the session.
