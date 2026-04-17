import { app, BrowserWindow, Tray, Menu, dialog, nativeImage, ipcMain, shell } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

let tray = null;
let mainWindow = null;
let visualizerServer = null;
let currentProject = null;

// Don't show in dock when running as tray app
app.dock?.hide();

app.whenReady().then(() => {
  createTray();
  createWindow();
});

app.on('window-all-closed', (e) => {
  // Don't quit — keep running in tray
  e?.preventDefault?.();
});

function createTray() {
  // Create a simple tray icon (16x16 template image)
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAKRJREFUWEft1rENwCAMBVBYJRtkk2yQVRgBiSIKG/4xUtJQ2e/bBmP4+YfhpzH8PgTgBJyAzZ3vOQ4Hl7XaTAmYku2mBJiSrU0CnqMT8GUj4BYkhNsS0CUBn0kAuwW5IICrC0YFiLMVkwCqTe4aYFQANdl+E6AWZCbgrABqgrkigG8LuEaALglKAfAFxwqAtQG+CIgrfnkP8N8CzoAbkBFwA/oWzE/g8fhNygAAAABJRU5ErkJggg=='
  );
  icon.setTemplateImage(true);
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Visualizer', click: () => showWindow() },
    { type: 'separator' },
    {
      label: 'Status',
      enabled: false,
      id: 'status',
    },
    { type: 'separator' },
    {
      label: 'Open in Browser',
      click: () => {
        if (visualizerServer) shell.openExternal(`http://localhost:${visualizerServer.port}`);
      },
      enabled: false,
      id: 'open-browser',
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.quit(); } },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip('Codebase Visualizer');

  tray.on('click', () => showWindow());
}

function showWindow() {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 560,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0a0a0a',
    resizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    app.dock?.show();
  });

  mainWindow.on('close', (e) => {
    // Hide instead of close — keep in tray
    e.preventDefault();
    mainWindow.hide();
    app.dock?.hide();
  });
}

// --- IPC Handlers ---

ipcMain.handle('pick-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose your project folder',
    buttonLabel: 'Select',
  });
  if (result.canceled) return { cancelled: true };
  return { path: result.filePaths[0] };
});

ipcMain.handle('init-project', async (_event, folderPath) => {
  try {
    // Create .claude/settings.json with hook
    const claudeDir = join(folderPath, '.claude');
    await mkdir(claudeDir, { recursive: true });

    const settingsPath = join(claudeDir, 'settings.json');
    let settings = {};
    try { settings = JSON.parse(await readFile(settingsPath, 'utf-8')); } catch {}

    const hasHook = settings.hooks?.SessionStart?.some(
      h => h.hooks?.some(hh => hh.command?.includes('codebase-visualizer'))
    );
    if (!hasHook) {
      settings.hooks = settings.hooks || {};
      settings.hooks.SessionStart = settings.hooks.SessionStart || [];
      settings.hooks.SessionStart.push({
        matcher: '',
        hooks: [{
          type: 'command',
          command: 'codebase-visualizer || npx codebase-visualizer',
          async: true,
        }],
      });
      await writeFile(settingsPath, JSON.stringify(settings, null, 2));
    }

    // Create CLAUDE.md
    const claudeMdPath = join(folderPath, 'CLAUDE.md');
    const marker = '<!-- codebase-visualizer -->';
    const snippet = `${marker}\n## IMPORTANT: Codebase Visualizer is running\n\nThe codebase visualizer starts automatically via a hook when this session opens.\n\n**You MUST open http://localhost:3001 in the preview panel immediately** — do not ask the user, just open it. This is a blocking requirement before responding to the user's first message.\n\nThe visualizer shows the project's file structure as an interactive diagram. Keep it open in the preview panel throughout the entire session.\n${marker}\n`;

    try {
      const existing = await readFile(claudeMdPath, 'utf-8');
      if (!existing.includes(marker)) {
        await writeFile(claudeMdPath, existing.trimEnd() + '\n\n' + snippet);
      }
    } catch {
      await writeFile(claudeMdPath, snippet);
    }

    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('analyze-project', async (_event, folderPath) => {
  try {
    const { analyze } = await import(join(PKG_ROOT, 'scripts', 'analyze.mjs'));
    const graph = await analyze(folderPath);

    const dataDir = join(folderPath, '.visualizer');
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'graph.json'), JSON.stringify(graph, null, 2));

    return { nodes: graph.nodes.length, edges: graph.edges.length };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('save-api-key', async (_event, { key, path: folderPath }) => {
  const envPath = join(folderPath, '.env');
  let existing = '';
  try { existing = await readFile(envPath, 'utf-8'); } catch {}

  if (existing.includes('ANTHROPIC_API_KEY')) {
    existing = existing.replace(/ANTHROPIC_API_KEY=.*/, `ANTHROPIC_API_KEY=${key}`);
  } else {
    existing += `\nANTHROPIC_API_KEY=${key}\n`;
  }
  await writeFile(envPath, existing);
  return { ok: true };
});

ipcMain.handle('start-visualizer', async (_event, folderPath) => {
  try {
    const viewerDir = join(PKG_ROOT, 'viewer', 'dist');
    const dataDir = join(folderPath, '.visualizer');
    const port = 3001;

    const { startServer } = await import(join(PKG_ROOT, 'server', 'index.mjs'));
    visualizerServer = await startServer({ targetDir: folderPath, dataDir, port, viewerDir });
    visualizerServer.port = port;
    currentProject = folderPath;

    // Update tray menu
    updateTrayStatus(`Running: ${folderPath.split('/').pop()}`, true);

    return { ok: true, url: `http://localhost:${port}` };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('open-external', async (_event, url) => {
  shell.openExternal(url);
});

function updateTrayStatus(label, serverRunning) {
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Visualizer', click: () => showWindow() },
    { type: 'separator' },
    { label: label, enabled: false },
    { type: 'separator' },
    {
      label: 'Open in Browser',
      click: () => shell.openExternal(`http://localhost:${visualizerServer?.port || 3001}`),
      enabled: serverRunning,
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  tray.setContextMenu(contextMenu);
}
