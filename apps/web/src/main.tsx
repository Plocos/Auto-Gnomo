import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { pushError } from './lib/errorStore';
import './index.css';

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** El error lo muestra la propia pantalla; no va al banner global. */
      silentError?: boolean;
      /** Título del error en el banner, p. ej. «No se pudo guardar la configuración». */
      errorTitle?: string;
    };
  }
}

const qc = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1 },
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.meta?.silentError) return;
      pushError(error, mutation.meta?.errorTitle);
    },
  }),
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
