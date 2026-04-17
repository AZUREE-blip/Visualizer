import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ViewModeProvider } from './hooks/useViewMode'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: e.message + '\n' + e.stack }; }
  render() {
    if (this.state.error) return <pre style={{ color: 'red', padding: 20, whiteSpace: 'pre-wrap' }}>{this.state.error}</pre>;
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ViewModeProvider>
        <App />
      </ViewModeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
