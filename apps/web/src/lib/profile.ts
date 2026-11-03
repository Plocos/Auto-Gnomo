import { api, getApiBaseUrl } from './api';

export type RecentProfile = { name: string; path: string };

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function sanitizeProfileFolderName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/g, '')
    .trim();
  return cleaned || 'Perfil';
}

export function joinProfilePath(parent: string, name: string): string {
  const base = parent.replace(/[\\/]+$/, '');
  const folder = sanitizeProfileFolderName(name);
  const sep = parent.includes('/') && !parent.includes('\\') ? '/' : '\\';
  return `${base}${sep}${folder}`;
}

function invokeErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const o = e as { message?: string; error?: string };
    if (o.message) return o.message;
    if (o.error) return o.error;
    try {
      return JSON.stringify(e);
    } catch {
      /* ignore */
    }
  }
  return 'Error desconocido';
}

export async function listRecentProfiles(): Promise<RecentProfile[]> {
  if (!isTauri()) return [];
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<RecentProfile[]>('list_recent_profiles');
  } catch {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<RecentProfile[]>('list_recent_vaults');
    } catch {
      return [];
    }
  }
}

/** Quita de la lista de recientes; no borra archivos. Solo escritorio. */
export async function removeRecentProfile(path: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('Quitar de recientes solo está disponible en la app de escritorio');
  }
  const { invoke } = await import('@tauri-apps/api/core');
  try {
    await invoke('remove_recent_profile', { path });
  } catch (e) {
    throw new Error(invokeErrorMessage(e));
  }
}

/** Abre la carpeta del perfil en el explorador de archivos. */
export async function revealProfileFolder(path: string): Promise<void> {
  if (!isTauri()) {
    throw new Error('Abrir ubicación solo está disponible en la app de escritorio');
  }
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(path);
  } catch {
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      await openPath(path);
    } catch (e) {
      throw new Error(invokeErrorMessage(e));
    }
  }
}

export type PickFolderResult =
  | { ok: true; path: string }
  | { ok: false; cancelled: boolean; message: string };

/** Solo elige carpeta; no reinicia la API. */
export async function pickFolder(): Promise<PickFolderResult> {
  if (!isTauri()) {
    return { ok: false, cancelled: false, message: 'El diálogo nativo solo está en la app de escritorio' };
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const res = await invoke<{ path: string }>('pick_folder');
    if (!res?.path?.trim()) {
      return { ok: false, cancelled: false, message: 'La carpeta elegida no devolvió una ruta válida' };
    }
    return { ok: true, path: res.path.trim() };
  } catch (e) {
    const msg = invokeErrorMessage(e);
    if (msg === 'CANCELLED' || /cancel/i.test(msg)) {
      return { ok: false, cancelled: true, message: 'CANCELLED' };
    }
    return { ok: false, cancelled: false, message: msg };
  }
}

export async function openProfile(
  path: string,
  name?: string,
  opts: { create?: boolean } = {},
): Promise<{ path: string; name: string }> {
  const create = opts.create === true;
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      const res = await invoke<{ path: string; name: string }>('open_profile', {
        path,
        name: name ?? null,
        create,
      });
      await waitForApi();
      return res;
    } catch (e) {
      throw new Error(invokeErrorMessage(e));
    }
  }
  const res = await api<{ ok: boolean; dataDir: string; name: string }>('/api/data-dir', {
    method: 'POST',
    json: { dataDir: path, name, create },
  });
  return { path: res.dataDir, name: res.name };
}

export async function waitForApi(timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  const base = await getApiBaseUrl();
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`, { credentials: 'include' });
      if (res.ok) return;
      lastErr = new Error(`health ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('La API no respondió a tiempo');
}

export async function isApiReady(): Promise<boolean> {
  try {
    const base = await getApiBaseUrl();
    const res = await fetch(`${base}/health`, { credentials: 'include' });
    return res.ok;
  } catch {
    return false;
  }
}
