import { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { createElement } from 'react';

interface ViewMode {
  isPreview: boolean;
  isCompact: boolean;
  containerWidth: number;
  containerHeight: number;
}

const COMPACT_BREAKPOINT = 700;

const ViewModeContext = createContext<ViewMode>({
  isPreview: false,
  isCompact: false,
  containerWidth: 1024,
  containerHeight: 768,
});

export function useViewMode(): ViewMode {
  return useContext(ViewModeContext);
}

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [isPreview] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'preview';
  });

  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });

    observer.observe(root);
    // Get initial measurement
    const rect = root.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });

    return () => observer.disconnect();
  }, []);

  const value: ViewMode = {
    isPreview,
    isCompact: isPreview || dimensions.width < COMPACT_BREAKPOINT,
    containerWidth: dimensions.width,
    containerHeight: dimensions.height,
  };

  return createElement(ViewModeContext.Provider, { value }, children);
}
