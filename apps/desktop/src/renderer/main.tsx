import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAppStore } from './stores/app-store';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: false,
    },
  },
});

// E2E mode: publish the Zustand store and TanStack QueryClient so Playwright
// can read/drive view state and inject query cache data deterministically.
// The preload bridge sets window.__SHIPCODE_E2E__ only when SHIPCODE_E2E_MODE=1.
if ((window as unknown as { __SHIPCODE_E2E__?: boolean }).__SHIPCODE_E2E__) {
  (window as unknown as { __APP_STORE__?: typeof useAppStore }).__APP_STORE__ = useAppStore;
  (window as unknown as { __QUERY_CLIENT__?: typeof queryClient }).__QUERY_CLIENT__ = queryClient;
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
);
