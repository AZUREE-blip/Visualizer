// Shared layer color palette — muted, distinct colors for dark backgrounds

export interface LayerColorSet {
  hue: number;
  primary: string;
  bg: string;
  border: string;
  text: string;
  dot: string;
  edge: string;
  swimlane: string;
  minimap: string;
}

// Only 3 visual categories (Simon Brown: <=3 shape/color types)
// Frontend (blue), Backend (green), Support (gray)
const FRONTEND: LayerColorSet = {
  hue: 210,
  primary: 'hsl(210 55% 55%)',
  bg: 'hsl(210 30% 14%)',
  border: 'hsl(210 30% 28%)',
  text: 'hsl(210 40% 80%)',
  dot: 'hsl(210 55% 55%)',
  edge: 'hsla(210 40% 55% / 0.45)',
  swimlane: 'hsla(210 40% 50% / 0.06)',
  minimap: 'hsl(210 45% 55%)',
};

const BACKEND: LayerColorSet = {
  hue: 150,
  primary: 'hsl(150 45% 48%)',
  bg: 'hsl(150 20% 13%)',
  border: 'hsl(150 20% 26%)',
  text: 'hsl(150 30% 78%)',
  dot: 'hsl(150 45% 48%)',
  edge: 'hsla(150 35% 48% / 0.45)',
  swimlane: 'hsla(150 35% 45% / 0.06)',
  minimap: 'hsl(150 35% 48%)',
};

const SUPPORT: LayerColorSet = {
  hue: 0,
  primary: 'hsl(0 0% 50%)',
  bg: 'hsl(0 0% 13%)',
  border: 'hsl(0 0% 24%)',
  text: 'hsl(0 0% 68%)',
  dot: 'hsl(0 0% 45%)',
  edge: 'hsla(0 0% 45% / 0.3)',
  swimlane: 'hsla(0 0% 40% / 0.04)',
  minimap: 'hsl(0 0% 42%)',
};

export const LAYER_COLORS: Record<string, LayerColorSet> = {
  ui:       FRONTEND,
  api:      BACKEND,
  logic:    BACKEND,
  data:     BACKEND,
  config:   SUPPORT,
  external: SUPPORT,
};

export function getLayerColor(layer: string): LayerColorSet {
  return LAYER_COLORS[layer] || LAYER_COLORS.logic;
}

export const NODE_TYPE_INFO: Record<string, { icon: string; label: string; description: string }> = {
  module:    { icon: '\u25A2', label: 'Module',    description: 'Directory with multiple files' },
  file:      { icon: '\u00B7', label: 'File',      description: 'Source file' },
  component: { icon: '\u25A1', label: 'Component', description: 'UI component' },
  route:     { icon: '\u25C7', label: 'Route',     description: 'API endpoint' },
  database:  { icon: '\u25A3', label: 'Database',  description: 'Schema or model' },
  external:  { icon: '\u2022', label: 'External',  description: 'Third-party package' },
};

export const EDGE_TYPE_INFO: Record<string, { label: string; style: string; description: string }> = {
  import:     { label: 'Import',   style: 'solid',  description: 'Direct import/dependency' },
  route:      { label: 'Route',    style: 'dashed', description: 'Route handler' },
  database:   { label: 'Database', style: 'solid',  description: 'Database access' },
  'api-call': { label: 'API Call', style: 'dashed', description: 'External API call' },
};

export const LAYER_INFO: { key: string; label: string; description: string }[] = [
  { key: 'ui',       label: 'UI',     description: 'Pages & Components' },
  { key: 'api',      label: 'API',    description: 'Routes & Controllers' },
  { key: 'logic',    label: 'Logic',  description: 'Services & Utils' },
  { key: 'data',     label: 'Data',   description: 'Models & Schemas' },
  { key: 'config',   label: 'Config', description: 'Configuration' },
  { key: 'external', label: 'Ext',    description: 'Dependencies' },
];
