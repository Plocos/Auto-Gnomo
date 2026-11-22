import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './app/App';
import { pushError } from './lib/errorStore';
import { isTauri } from './lib/profile';
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

function DesktopOnlyNotice() {
  return (
    <main className="flex h-full items-center justify-center p-8">
      <div className="max-w-md rounded-lg border border-surface-border bg-surface-panel p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-surface-accent">Auto-Gnomo</h1>
        <p className="mt-2 text-surface-ink">
          Esta aplicación solo se abre como programa de escritorio.
        </p>
        <p className="mt-2 text-surface-ink">
          En la raíz del proyecto ejecuta <code className="font-mono">pnpm dev</code>.
        </p>
      </div>
    </main>
  );
}

const root = document.getElementById('root')!;

if (isTauri()) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <DesktopOnlyNotice />
    </StrictMode>,
  );
}
