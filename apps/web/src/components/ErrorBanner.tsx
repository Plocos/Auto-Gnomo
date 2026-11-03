import { useState } from 'react';
import {
  clearErrors,
  dismissError,
  errorReport,
  useErrors,
  type AppErrorEntry,
} from '../lib/errorStore';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES');
}

function headline(entry: AppErrorEntry): string {
  return entry.title ? `${entry.title}: ${entry.message}` : entry.message;
}

function formatJson(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

export function ErrorBanner() {
  const errors = useErrors();
  const [expanded, setExpanded] = useState(false);
  const latest = errors[0];
  if (!latest) return null;

  return (
    <div className="error-banner" role="alert">
      <div className="error-banner-bar">
        <button
          type="button"
          className="error-banner-summary"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? 'Ocultar detalles' : 'Ver detalles para depurar'}
        >
          <span aria-hidden>{expanded ? '▾' : '▸'}</span>
          <span className="error-banner-text">{headline(latest)}</span>
          {errors.length > 1 && <span className="opacity-75">(+{errors.length - 1} más)</span>}
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] opacity-75">{formatTime(latest.timestamp)}</span>
          {errors.length > 1 && (
            <button type="button" className="error-banner-link" onClick={clearErrors}>
              Descartar todos
            </button>
          )}
          <button
            type="button"
            className="error-banner-close"
            onClick={() => dismissError(latest.id)}
            aria-label="Descartar error"
            title="Descartar"
          >
            ×
          </button>
        </div>
      </div>
      {expanded && (
        <div className="error-banner-panel">
          {errors.map((entry, i) => (
            <ErrorDetails key={entry.id} entry={entry} defaultOpen={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorDetails({ entry, defaultOpen }: { entry: AppErrorEntry; defaultOpen: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(errorReport(entry));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const allRows: [string, string | number | undefined][] = [
    ['Hora', new Date(entry.timestamp).toLocaleString('es-ES')],
    ['Petición', entry.method && entry.url ? `${entry.method} ${entry.url}` : undefined],
    [
      'Estado HTTP',
      entry.status === undefined
        ? undefined
        : entry.status === 0
          ? '0 (sin respuesta de la API)'
          : entry.status,
    ],
    ['Código', entry.code],
    ['Request ID', entry.requestId],
  ];
  const rows = allRows.filter((r) => r[1] !== undefined && r[1] !== '');

  return (
    <details className="error-details" open={defaultOpen}>
      <summary>
        <span className="font-medium">{headline(entry)}</span>
        <span className="ml-2 opacity-60">{formatTime(entry.timestamp)}</span>
      </summary>
      <div className="mt-2 grid gap-2">
        <dl className="error-details-grid">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt>{k}</dt>
              <dd className="font-mono">{v}</dd>
            </div>
          ))}
        </dl>
        {entry.issues.length > 0 && (
          <div>
            <div className="error-details-label">Campos no válidos</div>
            <ul className="ml-4 list-disc">
              {entry.issues.map((issue, idx) => (
                <li key={idx}>
                  <strong>{issue.field}</strong> {issue.message}
                  {issue.path && issue.path !== issue.field && (
                    <span className="ml-1 font-mono opacity-60">({issue.path})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {entry.requestBody !== undefined && (
          <div>
            <div className="error-details-label">Datos enviados</div>
            <pre>{formatJson(entry.requestBody)}</pre>
          </div>
        )}
        {entry.responseBody && (
          <div>
            <div className="error-details-label">Respuesta de la API</div>
            <pre>{formatJson(entry.responseBody)}</pre>
          </div>
        )}
        {entry.stack && (
          <div>
            <div className="error-details-label">Stack</div>
            <pre>{entry.stack}</pre>
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" className="error-banner-button" onClick={() => void copy()}>
            {copied ? 'Copiado' : 'Copiar detalles'}
          </button>
          <button
            type="button"
            className="error-banner-button"
            onClick={() => dismissError(entry.id)}
          >
            Descartar
          </button>
        </div>
      </div>
    </details>
  );
}
