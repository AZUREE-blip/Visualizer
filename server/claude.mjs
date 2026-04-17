import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

let client = null;
let model = 'claude-sonnet-4-6';
let available = false;
let initError = null;

export function initClaude() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    initError = 'ANTHROPIC_API_KEY not set';
    return { available: false, model, error: initError };
  }

  try {
    client = new Anthropic({ apiKey });
    model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';
    available = true;
    return { available: true, model };
  } catch (err) {
    initError = err.message;
    return { available: false, model, error: initError };
  }
}

export function getAiStatus() {
  return { available, model, error: initError };
}

export async function askAboutFile({ question, fileContent, filePath, node, dependencies, dependents, graphMeta, relatedFiles }) {
  if (!available) throw new Error('AI not available: ' + initError);

  const ext = extname(filePath).slice(1) || 'text';
  const frameworkNote = graphMeta.framework ? ` (built with ${graphMeta.framework})` : '';

  const systemPrompt = `You are a friendly guide explaining a codebase called "${graphMeta.projectName}"${frameworkNote} to someone who is not deeply technical. Your audience are vibecoders — they understand what apps do but don't want to read raw code.

Rules:
- Explain in plain, conversational English. Use analogies and everyday comparisons.
- NEVER include code snippets, function signatures, or technical syntax in your answer.
- Instead of showing code, describe what it does in words: "this part grabs data from the server" not "it calls fetch('/api/graph')".
- Use short sentences and bullet points for clarity.
- Keep answers under 150 words.
- When referencing other files, use their human-readable label, not file paths.
- Focus on WHAT things do and WHY they exist, not HOW they're implemented.`;

  let userMessage = `## Question\n${question}\n\n`;
  userMessage += `## File: ${filePath}\n\`\`\`${ext}\n${fileContent}\n\`\`\`\n\n`;
  userMessage += `## File Info\n- Type: ${node.type}, Layer: ${node.layer}\n- Exports: ${(node.exports || []).join(', ') || 'none'}\n- Lines: ${node.linesOfCode}\n`;

  if (dependencies.length > 0) {
    userMessage += `\n## Dependencies (${dependencies.length})\n`;
    userMessage += dependencies.map(d => `- ${d.label}${d.description ? ': ' + d.description : ''}`).join('\n');
  }

  if (dependents.length > 0) {
    userMessage += `\n\n## Used By (${dependents.length})\n`;
    userMessage += dependents.map(d => `- ${d.label}${d.description ? ': ' + d.description : ''}`).join('\n');
  }

  if (relatedFiles && relatedFiles.length > 0) {
    userMessage += '\n\n## Related File Excerpts\n';
    for (const rf of relatedFiles) {
      const rfExt = extname(rf.filePath).slice(1) || 'text';
      userMessage += `### ${rf.filePath} (${rf.relationship})\n\`\`\`${rfExt}\n${rf.content}\n\`\`\`\n\n`;
    }
  }

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return { answer: response.content[0].text };
}

export async function generateDescription({ fileContent, filePath, node, graphMeta }) {
  if (!available) throw new Error('AI not available: ' + initError);

  const ext = extname(filePath).slice(1) || 'text';
  const frameworkNote = graphMeta.framework ? ` ${graphMeta.framework}` : '';

  const response = await client.messages.create({
    model,
    max_tokens: 100,
    system: `You write concise one-sentence descriptions of source files for a${frameworkNote} project called "${graphMeta.projectName}". Each description should explain what the file does in plain English (max 15 words). Do not start with "This file". Focus on the file's role in the project.`,
    messages: [{
      role: 'user',
      content: `File: ${filePath}\n\`\`\`${ext}\n${fileContent}\n\`\`\``,
    }],
  });

  return { description: response.content[0].text.trim() };
}

export async function generateBrief({ fileContent, filePath, node, dependencies, dependents, graphMeta }) {
  if (!available) throw new Error('AI not available: ' + initError);

  const ext = extname(filePath).slice(1) || 'text';
  const frameworkNote = graphMeta.framework ? ` (built with ${graphMeta.framework})` : '';

  const depList = dependencies.map(d => `- ${d.label} (${d.layer})${d.description ? ': ' + d.description : ''}`).join('\n') || 'None';
  const usedByList = dependents.map(d => `- ${d.label} (${d.layer})${d.description ? ': ' + d.description : ''}`).join('\n') || 'None';

  const response = await client.messages.create({
    model,
    max_tokens: 600,
    system: `You analyze source files in a codebase called "${graphMeta.projectName}"${frameworkNote}. Generate a structured file brief in the EXACT format below. Be specific and reference actual code. No markdown headers — just the labeled sections.

Format:
PURPOSE: <1-2 sentences explaining what this file does and why it exists>
ROLE: <1 sentence on where this fits in the architecture — which layer, what it connects>
KEY EXPORTS: <bullet list of the most important exports and what each does — max 5>
CONTEXT: <1-2 sentences on what someone modifying this file should know — gotchas, patterns, conventions>`,
    messages: [{
      role: 'user',
      content: `File: ${filePath}
Type: ${node.type}, Layer: ${node.layer}
Exports: ${(node.exports || []).join(', ') || 'none'}
Lines: ${node.linesOfCode}

Dependencies:
${depList}

Used by:
${usedByList}

\`\`\`${ext}
${fileContent}
\`\`\``,
    }],
  });

  return { brief: response.content[0].text.trim() };
}

// Read excerpts from related files for context
export async function buildRelatedContext(graph, nodeId, rootDir) {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return [];

  const depIds = graph.edges
    .filter(e => e.source === nodeId)
    .map(e => e.target)
    .slice(0, 3);

  const depByIds = graph.edges
    .filter(e => e.target === nodeId)
    .map(e => e.source)
    .slice(0, 2);

  const related = [];

  for (const id of depIds) {
    const n = graph.nodes.find(x => x.id === id);
    if (!n || !n.filePath || n.type === 'external') continue;
    try {
      const content = await readFile(join(rootDir, n.filePath), 'utf-8');
      related.push({
        filePath: n.filePath,
        content: content.split('\n').slice(0, 80).join('\n'),
        relationship: 'dependency',
      });
    } catch (err) {
      console.warn(`Could not read dependency ${n.filePath}:`, err.message);
    }
  }

  for (const id of depByIds) {
    const n = graph.nodes.find(x => x.id === id);
    if (!n || !n.filePath || n.type === 'external') continue;
    try {
      const content = await readFile(join(rootDir, n.filePath), 'utf-8');
      related.push({
        filePath: n.filePath,
        content: content.split('\n').slice(0, 80).join('\n'),
        relationship: 'dependent',
      });
    } catch (err) {
      console.warn(`Could not read dependent ${n.filePath}:`, err.message);
    }
  }

  return related;
}
