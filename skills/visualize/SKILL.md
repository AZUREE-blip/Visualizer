---
name: visualize
description: Show an interactive codebase diagram in the preview panel.
allowed-tools: Bash(node *) Bash(lsof *) Bash(kill *) Bash(echo *)
---

# Visualize Codebase

## Steps

### 1. Free port 3001

```bash
lsof -ti:3001 | xargs kill -9 2>/dev/null; echo "ready"
```

### 2. Analyze the codebase

```bash
node __PREPARE_BIN__
```

### 3. Open in preview panel

Use preview_start with configuration name "visualizer" to show the diagram.
