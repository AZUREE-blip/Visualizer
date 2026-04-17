---
name: visualize
description: Visualize the current codebase as an interactive diagram in the preview panel. No setup needed — just run /visualize.
allowed-tools: Bash(node*) Bash(lsof*) Bash(kill*) Bash(sleep*) preview_start preview_stop
---

# Visualize Codebase

Show an interactive architecture diagram in the preview panel.

## Steps

### 1. Stop any existing visualizer

```bash
lsof -ti:3001 | xargs kill -9 2>/dev/null; echo "ready"
```

Also stop any existing preview:

Use the preview_stop tool if a preview is currently running.

### 2. Analyze the codebase

Run the prepare script. It analyzes the project, writes data to /tmp, and creates .claude/launch.json:

```bash
node __PREPARE_BIN__
```

### 3. Open in preview panel

Use preview_start with configuration name "visualizer" to open the diagram in the preview panel.

Done — the user can now see and interact with the codebase diagram.
