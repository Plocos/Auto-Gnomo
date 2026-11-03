import { useSyncExternalStore } from 'react';
import { ApiClientError } from './api';

export interface FieldIssue {
  field: string;
  path: string;
  message: string;
}

export interface AppErrorEntry {
  id: string;
  /** Qué estaba haciendo el usuario, p. ej. «No se pudo guardar la configuración». */
  title?: string;
  message: string;
  timestamp: string;
  status?: number;
  code?: string;
  method?: string;
  url?: string;
  requestId?: string;
  issues: FieldIssue[];
  requestBody?: unknown;
  responseBody?: string;
  details?: Record<string, unknown>;
  stack?: string;
}

const MAX_ENTRIES = 20;
let entries: AppErrorEntry[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function parseIssues(details?: Record<string, unknown>): FieldIssue[] {
  const raw = details?.issues;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((i): i is Record<string, unknown> => typeof i === 'object' && i !== null)
    .map((i) => ({
      field: String(i.field ?? i.path ?? ''),
      path: String(i.path ?? ''),
      message: String(i.message ?? ''),
    }));
}

export function toErrorEntry(error: unknown, title?: string): AppErrorEntry {
  const base = {
    id: crypto.randomUUID(),
    title,
    timestamp: new Date().toISOString(),
  };
  if (error instanceof ApiClientError) {
    return {
      ...base,
      timestamp: error.timestamp,
      message: error.message,
      status: error.status,
      code: error.code,
      method: error.method,
      url: error.url,
      requestId: error.requestId,
      issues: parseIssues(error.details),
      requestBody: error.requestBody,
      responseBody: error.responseBody,
      details: error.details,
      stack: error.stack,
    };
  }
  if (error instanceof Error) {
    return { ...base, message: error.message, issues: [], stack: error.stack };
  }
  return {
    ...base,
    message: typeof error === 'string' ? error : JSON.stringify(error),
    issues: [],
  };
}

export function pushError(error: unknown, title?: string): void {
  entries = [toErrorEntry(error, title), ...entries].slice(0, MAX_ENTRIES);
  emit();
}

export function dismissError(id: string): void {
  entries = entries.filter((e) => e.id !== id);
  emit();
}

export function clearErrors(): void {
  entries = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useErrors(): AppErrorEntry[] {
  return useSyncExternalStore(subscribe, () => entries);
}

export function errorReport(entry: AppErrorEntry): string {
  return JSON.stringify(
    {
      ...entry,
      app: 'Auto-Gnomo',
      userAgent: navigator.userAgent,
      location: window.location.href,
    },
    null,
    2,
  );
}
