import { api, ApiClientError, getApiBaseUrl, readErrorResponse } from '../../lib/api';
import { isTauri } from '../../lib/profile';

export type LibroExportResult =
  | { status: 'saved'; path: string; rowCount: number }
  | { status: 'downloaded'; fileName: string }
  | { status: 'cancelled' };

function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded?.[1]) return decodeURIComponent(encoded[1]);
  const plain = header.match(/filename="([^"]+)"/i);
  return plain?.[1] ?? null;
}

async function fetchLibro(year: number, quarter: string): Promise<{ blob: Blob; fileName: string }> {
  const base = await getApiBaseUrl();
  const url = `${base}/api/exports/libro-expedidas/${year}/${quarter}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) {
    const { body, raw } = await readErrorResponse(res);
    throw new ApiClientError(res.status, body, { method: 'GET', url, responseBody: raw });
  }
  const fileName =
    fileNameFromDisposition(res.headers.get('Content-Disposition')) ??
    `libro-registro-${year}-${quarter}.xlsx`;
  return { blob: await res.blob(), fileName };
}

/** Libro Registro AEAT (expedidas + ventas e ingresos, tipo U) del trimestre indicado. */
export async function exportLibroExpedidas(
  year: number,
  quarter: string,
): Promise<LibroExportResult> {
  if (isTauri()) {
    const { fileName } = await api<{ fileName: string }>(
      `/api/exports/libro-expedidas/${year}/${quarter}/name`,
    );
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      title: 'Guardar libro registro AEAT',
      defaultPath: fileName,
      filters: [{ name: 'Excel', extensions: ['xlsx'] }],
    });
    if (!path) return { status: 'cancelled' };
    const res = await api<{ path: string; rowCount: number }>(
      `/api/exports/libro-expedidas/${year}/${quarter}/save`,
      { method: 'POST', json: { path } },
    );
    return { status: 'saved', path: res.path, rowCount: res.rowCount };
  }

  const { blob, fileName } = await fetchLibro(year, quarter);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { status: 'downloaded', fileName };
}
