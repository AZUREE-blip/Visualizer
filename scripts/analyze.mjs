#!/usr/bin/env node

import { readdir, readFile, stat, access } from 'node:fs/promises';
import { join, relative, basename, extname, dirname, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '__pycache__', '.venv', 'venv',
  'dist', 'build', '.cache', 'coverage', '.turbo', '.nuxt',
  'vendor', 'target', '.svelte-kit', '.output',
]);

const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.rb',
  '.vue', '.svelte', '.astro',
]);

const CONFIG_FILES = new Set([
  'package.json', 'tsconfig.json', 'next.config.js', 'next.config.mjs', 'next.config.ts',
  'vite.config.ts', 'vite.config.js', 'webpack.config.js',
  'manage.py', 'go.mod', 'Cargo.toml', 'Gemfile',
  'docker-compose.yml', 'Dockerfile',
]);

// Config files that add noise without architectural value — skip entirely
const SKIP_CONFIG_FILES = new Set([
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.tsbuildinfo',
  '.eslintrc', '.eslintrc.js', '.eslintrc.json', '.prettierrc', '.prettierrc.js',
  'jest.config.js', 'jest.config.ts', 'vitest.config.ts',
  'postcss.config.js', 'postcss.config.mjs', 'postcss.config.cjs',
  'tailwind.config.js', 'tailwind.config.ts',
  '.babelrc', 'babel.config.js',
]);

const DB_PATTERNS = [
  /schema\.prisma$/,
  /\.entity\.(ts|js)$/,
  /models?\.(py|ts|js)$/,
  /migrations?\//,
  /\.sql$/,
  /drizzle.*schema/,
];

// --- Import Regexes ---

const IMPORT_PATTERNS = {
  js: [
    // import X from 'Y'  /  import { X } from 'Y'  /  import 'Y'
    /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
    // require('Y')
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // dynamic import('Y')
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ],
  python: [
    // from X import Y
    /from\s+([\w.]+)\s+import/g,
    // import X
    /^import\s+([\w.]+)/gm,
  ],
  go: [
    // import "X"
    /import\s+"([^"]+)"/g,
    // import ( "X" )
    /"([^"]+)"/g,
  ],
};

const EXPORT_PATTERNS = {
  js: [
    // export function/class/const name
    /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g,
    // export { name }
    /export\s*\{([^}]+)\}/g,
    // module.exports
    /module\.exports\s*=\s*(?:\{([^}]*)\}|(\w+))/g,
  ],
};

// --- Framework Detection ---

function detectFramework(files, rootDir) {
  const filenames = new Set(files.map(f => relative(rootDir, f)));
  const basenames = new Set(files.map(f => basename(f)));

  if (basenames.has('next.config.js') || basenames.has('next.config.mjs') || basenames.has('next.config.ts')) {
    return 'nextjs';
  }
  if ([...filenames].some(f => f.match(/^(app|pages)\/(layout|page)\.(tsx?|jsx?)$/))) {
    return 'nextjs';
  }
  if (basenames.has('nuxt.config.ts') || basenames.has('nuxt.config.js')) {
    return 'nuxt';
  }
  if (basenames.has('manage.py') && [...filenames].some(f => f.includes('urls.py'))) {
    return 'django';
  }
  if (basenames.has('go.mod')) return 'go';
  if (basenames.has('Cargo.toml')) return 'rust';
  if (basenames.has('vite.config.ts') || basenames.has('vite.config.js')) return 'vite';

  return undefined;
}

// --- Layer Classification ---

function classifyLayer(filePath, framework) {
  const p = filePath.toLowerCase();
  const base = basename(filePath).toLowerCase();

  // Database / data layer
  if (DB_PATTERNS.some(pat => pat.test(p))) return 'data';
  if (p.includes('model') || p.includes('schema') || p.includes('entity') || p.includes('migration')) return 'data';

  // Route / API layer — server-side handlers
  if (p.includes('/api/') || p.includes('route') || p.includes('controller') || p.includes('endpoint')) return 'api';
  if (framework === 'nextjs' && p.includes('/app/') && p.includes('route.')) return 'api';
  if (p.includes('urls.py') || p.includes('views.py')) return 'api';
  // Express/Fastify server entry points are API layer
  if (p.includes('server/') && (base.startsWith('index.') || base.startsWith('server.') || base.startsWith('app.'))) return 'api';

  // UI layer — components, pages, visual things
  if (p.includes('component') || p.includes('/ui/') || p.includes('.vue') || p.includes('.svelte')) return 'ui';
  if (p.includes('page') || p.includes('template')) return 'ui';
  if (framework === 'nextjs' && (p.includes('page.') || p.includes('layout.'))) return 'ui';
  // Layout algorithms (e.g. dagre) are logic, not UI — check before generic 'layout' match
  if (p.includes('/layout/') && !p.includes('dagre') && !p.includes('algorithm')) return 'ui';
  if (p.includes('layout') && p.includes('component')) return 'ui';
  // App.tsx / App.jsx in src/ is the UI entry point
  if (base.match(/^app\.(tsx?|jsx?)$/) && (p.includes('/src/') || p.includes('/viewer/'))) return 'ui';
  // main.tsx that renders the app is UI entry
  if (base.match(/^main\.(tsx?|jsx?)$/) && (p.includes('/src/') || p.includes('/viewer/'))) return 'ui';

  // Config — only real framework config files, not just anything with "config" in the name
  if (CONFIG_FILES.has(base)) return 'config';
  if (base.includes('config') && !p.includes('src/')) return 'config';
  if (p.includes('.env')) return 'config';

  // Logic (default for source files)
  if (SOURCE_EXTENSIONS.has(extname(filePath))) return 'logic';

  return 'config';
}

// --- Node Type Classification ---

function classifyNodeType(filePath, layer, framework) {
  const p = filePath.toLowerCase();
  const ext = extname(filePath);

  if (layer === 'data') return 'database';
  if (layer === 'api') return 'route';
  if (layer === 'ui') return 'component';

  if (p.includes('component') || ['.vue', '.svelte', '.astro'].includes(ext)) return 'component';
  if (p.includes('/api/') || p.includes('route')) return 'route';

  return 'file';
}

// --- File Walking ---

async function loadGitignore(rootDir) {
  try {
    const content = await readFile(join(rootDir, '.gitignore'), 'utf-8');
    return content
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
      .map(l => l.replace(/\/$/, ''));
  } catch {
    return [];
  }
}

async function walkDir(dir, rootDir, gitignorePatterns = []) {
  const files = [];
  let entries;

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relPath = relative(rootDir, fullPath);

    if (SKIP_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.isDirectory()) continue;
    if (gitignorePatterns.some(p => relPath.includes(p))) continue;

    if (entry.isDirectory()) {
      const subFiles = await walkDir(fullPath, rootDir, gitignorePatterns);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      // Skip noisy config files
      if (SKIP_CONFIG_FILES.has(entry.name)) continue;
      // Also skip eslint.config.* files
      if (entry.name.startsWith('eslint.config.')) continue;

      const ext = extname(entry.name);
      if (SOURCE_EXTENSIONS.has(ext) || CONFIG_FILES.has(entry.name)) {
        files.push(fullPath);
      }
      // Also pick up DB files
      if (DB_PATTERNS.some(pat => pat.test(fullPath))) {
        if (!files.includes(fullPath)) files.push(fullPath);
      }
    }
  }

  return files;
}

// --- Import Parsing ---

function getLanguage(filePath) {
  const ext = extname(filePath);
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro'].includes(ext)) return 'js';
  if (ext === '.py') return 'python';
  if (ext === '.go') return 'go';
  return null;
}

function parseImports(content, filePath) {
  const lang = getLanguage(filePath);
  if (!lang || !IMPORT_PATTERNS[lang]) return [];

  const imports = [];
  for (const pattern of IMPORT_PATTERNS[lang]) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      imports.push(match[1]);
    }
  }
  return [...new Set(imports)];
}

// Extract named imports/symbols from import statements
function parseImportSymbols(content, filePath) {
  const lang = getLanguage(filePath);
  if (lang !== 'js') return new Map(); // path -> symbols[]

  const symbolMap = new Map();
  const patterns = [
    // import { X, Y } from 'path'
    /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    // import X from 'path'
    /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    // import * as X from 'path'
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    // const { X, Y } = require('path')
    /(?:const|let|var)\s+\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    // const X = require('path')
    /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const rawSymbols = match[1];
      const importPath = match[2];
      const symbols = rawSymbols
        .split(',')
        .map(s => s.trim().split(/\s+as\s+/).shift().trim())
        .filter(s => s && s !== '*');
      if (symbols.length > 0) {
        const existing = symbolMap.get(importPath) || [];
        symbolMap.set(importPath, [...new Set([...existing, ...symbols])]);
      }
    }
  }

  return symbolMap;
}

function parseExports(content, filePath) {
  const lang = getLanguage(filePath);
  if (lang !== 'js') return [];

  const exports = [];
  for (const pattern of EXPORT_PATTERNS.js) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const names = (match[1] || match[2] || '').split(',').map(s => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean);
      exports.push(...names);
    }
  }
  return [...new Set(exports)];
}

// --- Import Resolution ---

function resolveImport(importPath, fromFile, rootDir, allFilesSet) {
  // Skip external packages
  if (!importPath.startsWith('.') && !importPath.startsWith('/') && !importPath.startsWith('@/') && !importPath.startsWith('~/')) {
    return { resolved: null, isExternal: true, packageName: importPath.split('/')[0] };
  }

  // Handle aliases like @/ and ~/
  let resolvedBase;
  if (importPath.startsWith('@/') || importPath.startsWith('~/')) {
    resolvedBase = join(rootDir, 'src', importPath.slice(2));
  } else {
    resolvedBase = resolve(dirname(fromFile), importPath);
  }

  // Try resolving with extensions
  const tryPaths = [
    resolvedBase,
    ...SOURCE_EXTENSIONS.values().map(ext => `${resolvedBase}${ext}`).toArray(),
    ...SOURCE_EXTENSIONS.values().map(ext => join(resolvedBase, `index${ext}`)).toArray(),
  ];

  for (const tryPath of tryPaths) {
    if (allFilesSet.has(tryPath)) {
      return { resolved: tryPath, isExternal: false };
    }
  }

  return { resolved: null, isExternal: false };
}

// --- Label Generation ---

// Generic filenames that need parent directory context to be meaningful
const GENERIC_NAMES = new Set([
  'index', 'main', 'app', 'server', 'client', 'utils', 'helpers',
  'types', 'constants', 'config', 'package', 'setup', 'init',
]);

// Parent dirs too generic to use as label prefix
const GENERIC_DIRS = new Set([
  'src', 'lib', 'app', 'source', 'sources', 'core',
]);

function prettifyName(name) {
  return name
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

function getMeaningfulParent(relPath) {
  const parts = dirname(relPath).split('/').filter(p => p !== '.');
  // Walk up from the immediate parent, skip generic dirs
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!GENERIC_DIRS.has(parts[i].toLowerCase())) {
      return parts[i];
    }
  }
  return '';
}

function generateLabel(relPath) {
  const name = basename(relPath, extname(relPath));
  const parentDir = getMeaningfulParent(relPath);

  // For generic names, prepend the first meaningful parent directory
  if (GENERIC_NAMES.has(name.toLowerCase()) && parentDir) {
    return `${prettifyName(parentDir)}/${prettifyName(name)}`;
  }

  return prettifyName(name);
}

// Deduplicate labels after all nodes are built — if two nodes have the
// same label, disambiguate by prepending the nearest meaningful directory.
function deduplicateLabels(nodes) {
  const labelCounts = {};
  for (const n of nodes) {
    labelCounts[n.label] = (labelCounts[n.label] || 0) + 1;
  }
  for (const n of nodes) {
    if (labelCounts[n.label] > 1 && n.filePath) {
      const parentDir = getMeaningfulParent(n.filePath);
      if (parentDir) {
        n.label = `${prettifyName(parentDir)}/${n.label}`;
      }
    }
  }
}

// --- Module Grouping ---

function groupIntoModules(nodes, rootDir) {
  const dirCounts = {};
  for (const node of nodes) {
    const dir = dirname(node.filePath);
    dirCounts[dir] = (dirCounts[dir] || 0) + 1;
  }

  // Which directories qualify as modules (2+ direct files)
  const moduleDirs = new Set(
    Object.entries(dirCounts).filter(([dir, count]) => count >= 2 && dir !== '.').map(([dir]) => dir)
  );

  // Assign each file to its most specific (deepest) module directory.
  // Walk up from the file's directory until we find a module dir.
  function findModuleDir(filePath) {
    let dir = dirname(filePath);
    while (dir && dir !== '.') {
      if (moduleDirs.has(dir)) return dir;
      const parent = dirname(dir);
      if (parent === dir) break; // reached root
      dir = parent;
    }
    return null;
  }

  // Build module children maps (each file assigned to exactly one module)
  const moduleChildren = new Map();
  for (const dir of moduleDirs) moduleChildren.set(dir, []);

  for (const node of nodes) {
    const modDir = findModuleDir(node.filePath);
    if (modDir) moduleChildren.get(modDir).push(node);
  }

  const modules = [];
  for (const [dir, childNodes] of moduleChildren) {
    if (childNodes.length < 2) continue;

    // Compute dominant layer from direct children
    const layerCounts = {};
    for (const c of childNodes) layerCounts[c.layer] = (layerCounts[c.layer] || 0) + 1;
    let bestLayer = 'logic', bestCount = 0;
    for (const [l, cnt] of Object.entries(layerCounts)) {
      if (cnt > bestCount) { bestCount = cnt; bestLayer = l; }
    }

    modules.push({
      id: `module:${dir}`,
      label: prettifyName(getMeaningfulParent(dir + '/x') || dir.split('/').pop()),
      type: 'module',
      filePath: dir,
      layer: bestLayer,
      linesOfCode: 0,
      exports: [],
      children: childNodes.map(n => n.id),
    });
  }
  return modules;
}

// --- Main ---

export async function analyze(targetDir) {
  const rootDir = resolve(targetDir);
  console.log(`Analyzing: ${rootDir}`);

  const gitignorePatterns = await loadGitignore(rootDir);
  const files = await walkDir(rootDir, rootDir, gitignorePatterns);
  console.log(`Found ${files.length} source files`);

  const framework = detectFramework(files, rootDir);
  if (framework) console.log(`Detected framework: ${framework}`);

  const nodes = [];
  const edges = [];
  const externalPackages = new Map();

  // Process each file
  const allFilesSet = new Set(files);
  for (const filePath of files) {
    const relPath = relative(rootDir, filePath);
    let content;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lineCount = content.split('\n').length;
    const layer = classifyLayer(relPath, framework);
    const nodeType = classifyNodeType(relPath, layer, framework);
    const exports = parseExports(content, filePath);

    // Store a snippet for AI description generation
    const snippet = content.split('\n').slice(0, 40).join('\n');

    nodes.push({
      id: relPath,
      label: generateLabel(relPath),
      type: nodeType,
      filePath: relPath,
      layer,
      linesOfCode: lineCount,
      exports: exports.slice(0, 20),
      snippet,
      description: '',
    });

    // Parse imports and create edges (with symbol names)
    const imports = parseImports(content, filePath);
    const symbolMap = parseImportSymbols(content, filePath);
    for (const imp of imports) {
      const { resolved, isExternal, packageName } = resolveImport(imp, filePath, rootDir, allFilesSet);

      if (isExternal) {
        const pkg = packageName || imp;
        if (!externalPackages.has(pkg)) {
          externalPackages.set(pkg, new Set());
        }
        externalPackages.get(pkg).add(relPath);
      } else if (resolved) {
        const targetRel = relative(rootDir, resolved);
        const symbols = symbolMap.get(imp) || [];
        edges.push({
          source: relPath,
          target: targetRel,
          type: 'import',
          symbols,
        });
      }
    }
  }

  // Add external package nodes (only those imported by 2+ files, or key ones)
  const keyPackages = new Set(['express', 'next', 'react', 'vue', 'django', 'fastapi', 'prisma', 'drizzle-orm', 'mongoose', 'typeorm', 'sequelize']);
  for (const [pkg, importers] of externalPackages) {
    if (importers.size >= 2 || keyPackages.has(pkg)) {
      nodes.push({
        id: `ext:${pkg}`,
        label: pkg,
        type: 'external',
        filePath: '',
        layer: 'external',
        linesOfCode: 0,
        exports: [],
      });

      for (const importer of importers) {
        edges.push({
          source: importer,
          target: `ext:${pkg}`,
          type: 'import',
        });
      }
    }
  }

  // Add module nodes
  const modules = groupIntoModules(nodes.filter(n => n.type !== 'external'), rootDir);
  nodes.push(...modules);

  // Disambiguate nodes that ended up with the same label
  deduplicateLabels(nodes.filter(n => n.type !== 'external' && n.type !== 'module'));

  // Deduplicate edges
  const edgeSet = new Set();
  const uniqueEdges = edges.filter(e => {
    const key = `${e.source}→${e.target}`;
    if (edgeSet.has(key)) return false;
    edgeSet.add(key);
    return true;
  });

  const projectName = basename(rootDir);
  const graph = {
    meta: {
      projectName,
      analyzedAt: new Date().toISOString(),
      rootDir: rootDir,
      fileCount: files.length,
      framework,
    },
    nodes,
    edges: uniqueEdges,
  };

  return graph;
}

// --- CLI ---

const isDirectRun = process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  const targetDir = process.argv[2] || '.';

  try {
    await access(targetDir);
  } catch {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }

  const graph = await analyze(targetDir);

  const outputDir = join(dirname(new URL(import.meta.url).pathname), '..', 'data');
  const outputPath = join(outputDir, 'graph.json');
  await writeFile(outputPath, JSON.stringify(graph, null, 2));
  console.log(`\nGraph written to ${outputPath}`);
  console.log(`  Nodes: ${graph.nodes.length}`);
  console.log(`  Edges: ${graph.edges.length}`);
}
