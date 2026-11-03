const ENV_API_URL = import.meta.env.VITE_API_URL ?? '';

let cachedBaseUrl: string | null = null;
let resolving: Promise<string> | null = null;

function inTauriShell(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Base URL de la API (vacía en Vite dev → proxy relativo). */
export async function getApiBaseUrl(): Promise<string> {
  if (cachedBaseUrl !== null) return cachedBaseUrl;
  if (resolving) return resolving;
  resolving = (async () => {
    if (inTauriShell()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const url = await invoke<string>('get_api_url');
        if (url?.trim()) {
          cachedBaseUrl = url.trim().replace(/\/$/, '');
          return cachedBaseUrl;
        }
      } catch {
        /* fallback abajo */
      }
      cachedBaseUrl = ENV_API_URL || 'http://127.0.0.1:3001';
      return cachedBaseUrl;
    }
    cachedBaseUrl = ENV_API_URL;
    return cachedBaseUrl;
  })();
  try {
    return await resolving;
  } finally {
    resolving = null;
  }
}

/** Sync helper for callers that already awaited getApiBaseUrl once. */
export function peekApiBaseUrl(): string {
  return cachedBaseUrl ?? ENV_API_URL;
}

export interface ApiErrorResponseBody {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export interface ApiRequestInfo {
  method: string;
  url: string;
  requestBody?: unknown;
  responseBody?: string;
}

export class ApiClientError extends Error {
  code: string;
  details?: Record<string, unknown>;
  /** 0 = sin respuesta (red caída, API parada, CORS…). */
  status: number;
  method?: string;
  url?: string;
  requestBody?: unknown;
  responseBody?: string;
  requestId?: string;
  timestamp: string;

  constructor(status: number, body: ApiErrorResponseBody, request?: ApiRequestInfo) {
    super(body.message ?? 'Error de API');
    this.name = 'ApiClientError';
    this.status = status;
    this.code = body.code ?? 'INTERNAL';
    this.details = body.details;
    this.method = request?.method;
    this.url = request?.url;
    this.requestBody = request?.requestBody;
    this.responseBody = request?.responseBody;
    const requestId = body.details?.requestId;
    this.requestId = typeof requestId === 'string' ? requestId : undefined;
    this.timestamp = new Date().toISOString();
  }
}

export async function readErrorResponse(
  res: Response,
): Promise<{ body: ApiErrorResponseBody; raw: string }> {
  const raw = await res.text().catch(() => '');
  try {
    return { body: JSON.parse(raw) as ApiErrorResponseBody, raw };
  } catch {
    return { body: { message: raw.trim() || `${res.status} ${res.statusText}` }, raw };
  }
}

export async function api<T>(
  path: string,
  options: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const method = (options.method ?? 'GET').toUpperCase();
  const base = await getApiBaseUrl();
  const url = `${base}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
      body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
    });
  } catch (err) {
    throw new ApiClientError(
      0,
      {
        code: 'NETWORK_ERROR',
        message: `No se pudo contactar con la API (${err instanceof Error ? err.message : String(err)}). ¿Está el perfil abierto?`,
      },
      { method, url, requestBody: options.json },
    );
  }
  if (!res.ok) {
    const { body, raw } = await readErrorResponse(res);
    throw new ApiClientError(res.status, body, {
      method,
      url,
      requestBody: options.json,
      responseBody: raw,
    });
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return res.json() as Promise<T>;
  return (await res.text()) as T;
}
