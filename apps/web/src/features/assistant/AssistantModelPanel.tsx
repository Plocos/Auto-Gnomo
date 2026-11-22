import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { AssistantStatus } from '@autonomous/shared';
import { api, getApiBaseUrl, ApiClientError } from '../../lib/api';
import { Button } from '../../components/ui/primitives';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatEta(seconds: number): string {
  if (seconds < 45) return 'queda menos de un minuto';
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return minutes === 1 ? 'queda cerca de 1 min' : `quedan unos ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return hours === 1 ? 'queda cerca de 1 h' : `quedan unas ${hours} h`;
  return `quedan unas ${hours} h ${rest} min`;
}

function useDownloadEta(data: AssistantStatus | undefined): string | null {
  const samples = useRef<{ t: number; received: number; fileIndex: number }[]>([]);
  const [label, setLabel] = useState<string | null>(null);
  const progress = data?.downloading ? data.progress : null;

  useEffect(() => {
    if (!progress?.total || progress.total <= 0) {
      samples.current = [];
      setLabel(null);
      return;
    }
    const now = Date.now();
    const prev = samples.current[samples.current.length - 1];
    if (!prev || prev.fileIndex !== progress.fileIndex || progress.received < prev.received) {
      samples.current = [];
    }
    const last = samples.current[samples.current.length - 1];
    if (!last || progress.received !== last.received) {
      samples.current.push({ t: now, received: progress.received, fileIndex: progress.fileIndex });
    }
    samples.current = samples.current.filter((sample) => now - sample.t <= 20_000);
    const first = samples.current[0];
    const latest = samples.current[samples.current.length - 1];
    if (!first || !latest || latest.t - first.t < 3000) {
      setLabel(null);
      return;
    }
    const bytes = latest.received - first.received;
    const seconds = (latest.t - first.t) / 1000;
    if (bytes <= 0 || seconds <= 0) {
      setLabel(null);
      return;
    }
    const remaining = Math.max(0, Math.round((progress.total - progress.received) / (bytes / seconds)));
    setLabel(formatEta(remaining));
  }, [progress?.received, progress?.total, progress?.fileIndex]);

  return label;
}

function useAssistantModel(warm: boolean) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['assistant-status'],
    queryFn: () => api<AssistantStatus>('/api/assistant/status'),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.downloading || data?.loading) return 1000;
      return false;
    },
  });
  const [localError, setLocalError] = useState<string | null>(null);
  const warmed = useRef(false);

  useEffect(() => {
    const data = status.data;
    if (!data?.downloading) return;
    let closed = false;
    let source: EventSource | null = null;
    void getApiBaseUrl().then((base) => {
      if (closed) return;
      source = new EventSource(`${base}/api/assistant/install/events`);
      source.onmessage = (event) => {
        try {
          const next = JSON.parse(event.data) as AssistantStatus;
          qc.setQueryData(['assistant-status'], (prev: AssistantStatus | undefined) => ({
            ...(prev ?? next),
            ...next,
            bytesOnDisk: prev?.bytesOnDisk ?? next.bytesOnDisk,
            dir: prev?.dir || next.dir,
          }));
          if (!next.downloading) void qc.invalidateQueries({ queryKey: ['assistant-status'] });
        } catch {
          /* evento de ping */
        }
      };
    });
    return () => {
      closed = true;
      source?.close();
    };
  }, [status.data?.downloading, qc]);

  useEffect(() => {
    if (!warm || warmed.current) return;
    const data = status.data;
    if (!data?.installed || data.ready || data.loading || data.downloading) return;
    warmed.current = true;
    void api('/api/assistant/warmup', { method: 'POST' })
      .then(() => qc.invalidateQueries({ queryKey: ['assistant-status'] }))
      .catch((err: unknown) => {
        setLocalError(err instanceof ApiClientError ? err.message : 'No se pudo cargar el modelo.');
        void qc.invalidateQueries({ queryKey: ['assistant-status'] });
      });
  }, [warm, status.data?.installed, status.data?.ready, status.data?.loading, status.data?.downloading, qc]);

  const start = async (force: boolean) => {
    setLocalError(null);
    try {
      await api('/api/assistant/install', { method: 'POST', json: { force } });
      await qc.invalidateQueries({ queryKey: ['assistant-status'] });
    } catch (err) {
      setLocalError(err instanceof ApiClientError ? err.message : 'No se pudo iniciar la descarga.');
    }
  };

  const remove = async () => {
    setLocalError(null);
    try {
      await api('/api/assistant/model', { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['assistant-status'] });
    } catch (err) {
      setLocalError(err instanceof ApiClientError ? err.message : 'No se pudo borrar el modelo.');
    }
  };

  return { data: status.data, localError, start, remove };
}

function DownloadProgress({ data }: { data: AssistantStatus }) {
  const progress = data.progress;
  const pct = progress?.percent;
  const eta = useDownloadEta(data);
  if (!data.downloading) return null;
  return (
    <div className="mt-2">
      <div className="h-2 w-full bg-surface-border" role="progressbar" aria-valuenow={pct ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-2 bg-surface-accent" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-1 text-[12px] text-surface-muted">
        {pct != null ? `${pct}%` : 'Descargando'}
        {progress?.total
          ? ` (${formatBytes(progress.received)} / ${formatBytes(progress.total)})`
          : progress
            ? ` (${formatBytes(progress.received)})`
            : ''}
        {eta ? ` · ${eta}` : ''}
      </p>
    </div>
  );
}

export function AssistantSetup() {
  const { data, localError, start } = useAssistantModel(false);
  const name = data?.modelLabel ?? 'Qwen3-VL 8B Instruct';
  return (
    <section className="border border-surface-border bg-surface-panel p-3" aria-labelledby="assistant-setup-title">
      <h2 id="assistant-setup-title" className="text-[13px] font-semibold text-surface-ink">
        Hace falta un modelo para el chat y para leer facturas
      </h2>
      <p className="mt-1 text-[13px] text-surface-muted">
        La IA no puede responder ni leer fotos o PDF hasta que {name} esté en este PC.
        Las tablas CSV, TSV y JSON se importan sin el modelo.
        La descarga son unos 6 GB, se hace una vez y no sale del ordenador.
      </p>
      <div className="mt-3">
        <Button variant="primary" onClick={() => void start(false)} disabled={data?.downloading}>
          {data?.downloading ? 'Descargando…' : 'Descargar modelo'}
        </Button>
      </div>
      {data && <DownloadProgress data={data} />}
      {(localError || data?.error) && (
        <p className="mt-2 text-[12px] text-surface-danger" role="alert">
          {localError || data?.error}
        </p>
      )}
    </section>
  );
}

export function AssistantModelBanner({ warm = false }: { warm?: boolean }) {
  const { data } = useAssistantModel(warm);
  const name = data?.modelLabel ?? 'Qwen3-VL 8B Instruct';
  return (
    <p className="mb-2 border border-surface-border bg-surface-panel px-2 py-1 text-[12px] text-surface-ink" role="status">
      {name}
    </p>
  );
}

export function AssistantModelSettings() {
  const { data, localError, start, remove } = useAssistantModel(false);
  const name = data?.modelLabel ?? 'Qwen3-VL 8B Instruct';
  const installed = Boolean(data?.installed);
  const busy = Boolean(data?.downloading || data?.loading);

  const redownload = () => {
    if (!window.confirm('Se borrará el modelo actual y se descargará de nuevo. Son unos 6 GB.')) return;
    void start(true);
  };

  const erase = () => {
    if (!window.confirm(`Se borrará ${name} de este PC. La IA no podrá responder ni leer documentos hasta que lo descargues otra vez.`)) return;
    void remove();
  };

  return (
    <section className="mt-4 border border-surface-border bg-surface-panel p-3" aria-labelledby="assistant-model-settings">
      <h3 id="assistant-model-settings" className="text-[12px] font-semibold uppercase tracking-wide text-surface-muted">
        Modelo de la IA
      </h3>
      <p className="mt-1 text-[12px] text-surface-ink">
        {installed
          ? `${name}. Ocupa ${formatBytes(data?.bytesOnDisk ?? 0)} en este PC.`
          : `${name} no está descargado. Hace falta para el chat y para leer facturas. Unos 6 GB.`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!installed && (
          <Button variant="primary" onClick={() => void start(false)} disabled={busy}>
            {data?.downloading ? 'Descargando…' : 'Descargar'}
          </Button>
        )}
        {installed && (
          <Button variant="default" onClick={redownload} disabled={busy}>
            Volver a descargar
          </Button>
        )}
        {installed && (
          <Button variant="danger" onClick={erase} disabled={busy}>
            Borrar
          </Button>
        )}
      </div>
      {data && <DownloadProgress data={data} />}
      {(localError || data?.error) && (
        <p className="mt-2 text-[12px] text-surface-danger" role="alert">
          {localError || data?.error}
        </p>
      )}
    </section>
  );
}
