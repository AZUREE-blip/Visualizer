import type { GraphNode } from './types';

export const LAYER_SHADES: Record<string, string> = {
  ui: 'rgba(255,255,255,0.85)',
  api: 'rgba(255,255,255,0.70)',
  logic: 'rgba(255,255,255,0.60)',
  data: 'rgba(255,255,255,0.50)',
  external: 'rgba(255,255,255,0.25)',
  config: 'rgba(255,255,255,0.40)',
};

export function dominantLayer(children: Pick<GraphNode, 'layer'>[]): string {
  const counts: Record<string, number> = {};
  for (const c of children) counts[c.layer] = (counts[c.layer] || 0) + 1;
  let max = 0, best = 'logic';
  for (const [layer, count] of Object.entries(counts)) {
    if (count > max) { max = count; best = layer; }
  }
  return best;
}
