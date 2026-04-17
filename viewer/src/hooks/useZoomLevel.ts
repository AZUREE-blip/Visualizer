import { useStore } from '@xyflow/react';

export type ZoomTier = 'full' | 'compact' | 'dot' | 'cluster';

const FULL_THRESHOLD = 0.7;
const COMPACT_THRESHOLD = 0.35;
const DOT_THRESHOLD = 0.18;

export function useZoomTier(): ZoomTier {
  const zoom = useStore((s) => s.transform[2]);

  if (zoom >= FULL_THRESHOLD) return 'full';
  if (zoom >= COMPACT_THRESHOLD) return 'compact';
  if (zoom >= DOT_THRESHOLD) return 'dot';
  return 'cluster';
}
