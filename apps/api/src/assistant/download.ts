import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const STALL_MS = 20_000;
const RESPONSE_MS = 45_000;
const MAX_ATTEMPTS = 8;

export type DownloadProgressFn = (received: number, total: number | null, note?: string) => void;

export class DownloadHttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`La descarga falló (${status}).`);
    this.name = 'DownloadHttpError';
    this.status = status;
  }
}

export function isRetryableDownloadError(err: unknown): boolean {
  if (err instanceof DownloadHttpError) {
    return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
  }
  if (!(err instanceof Error)) return false;
  if (err.name === 'StalledDownload') return true;
  return /fetch failed|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|terminated|premature close|UND_ERR/i.test(
    err.message,
  );
}

function stalled(): Error {
  const err = new Error('La descarga dejó de recibir datos.');
  err.name = 'StalledDownload';
  return err;
}

function contentTotal(status: number, contentLength: string | null, contentRange: string | null, offset: number): number | null {
  const match = contentRange?.match(/\/(\d+)\s*$/);
  if (match) return Number(match[1]);
  const len = Number(contentLength);
  if (!Number.isFinite(len) || len <= 0) return null;
  return status === 206 ? offset + len : len;
}

function rangeStart(contentRange: string | null): number | null {
  const match = contentRange?.match(/bytes\s+(\d+)-/i);
  return match ? Number(match[1]) : null;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

async function transfer(
  url: string,
  tmp: string,
  onChunk: DownloadProgressFn,
  fetchImpl: typeof fetch,
  stallMs: number,
  responseMs: number,
): Promise<void> {
  const offset = await fileSize(tmp);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let didStall = false;
  const arm = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      didStall = true;
      controller.abort();
    }, ms);
  };

  arm(responseMs);
  try {
    const headers: Record<string, string> = { 'User-Agent': 'Auto-Gnomo' };
    if (offset > 0) headers.Range = `bytes=${offset}-`;
    const res = await fetchImpl(url, { redirect: 'follow', headers, signal: controller.signal });
    if (res.status === 416 && offset > 0) {
      onChunk(offset, offset);
      return;
    }
    if (!res.ok || !res.body) throw new DownloadHttpError(res.status);

    const appending = res.status === 206 && offset > 0;
    if (appending && rangeStart(res.headers.get('content-range')) !== offset) {
      throw stalled();
    }
    const total = contentTotal(res.status, res.headers.get('content-length'), res.headers.get('content-range'), offset);
    let received = appending ? offset : 0;
    onChunk(received, total);
    arm(stallMs);

    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        arm(stallMs);
        onChunk(received, total);
        cb(null, chunk);
      },
    });
    const webStream = res.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>;
    await pipeline(
      Readable.fromWeb(webStream),
      counter,
      createWriteStream(tmp, { flags: appending ? 'a' : 'w' }),
    );
  } catch (err) {
    if (didStall) throw stalled();
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Descarga url a dest. Si se corta, conserva dest.part y sigue con Range, sin dejar el proceso colgado. */
export async function downloadToFile(
  url: string,
  dest: string,
  onChunk: DownloadProgressFn,
  options?: { stallMs?: number; responseMs?: number; maxAttempts?: number; fetch?: typeof fetch },
): Promise<void> {
  const tmp = `${dest}.part`;
  const stallMs = options?.stallMs ?? STALL_MS;
  const responseMs = options?.responseMs ?? RESPONSE_MS;
  const maxAttempts = options?.maxAttempts ?? MAX_ATTEMPTS;
  const fetchImpl = options?.fetch ?? fetch;
  await mkdir(dirname(dest), { recursive: true });

  let knownTotal: number | null = null;
  const report: DownloadProgressFn = (received, total, note) => {
    if (total != null && total > 0) knownTotal = total;
    onChunk(received, total ?? knownTotal, note);
  };

  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await transfer(url, tmp, report, fetchImpl, stallMs, responseMs);
      await rename(tmp, dest);
      return;
    } catch (err) {
      last = err;
      if (!isRetryableDownloadError(err) || attempt === maxAttempts) break;
      const kept = await fileSize(tmp);
      onChunk(kept, knownTotal, 'Conexión cortada. Reanudando…');
      await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 500 * 2 ** (attempt - 1))));
    }
  }

  if (last instanceof DownloadHttpError || (last instanceof Error && !isRetryableDownloadError(last))) {
    throw last;
  }
  throw new Error('La descarga se cortó. Pulsa descargar para continuar desde donde se quedó.');
}
