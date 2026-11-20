import { isTauri } from './profile';

export type DesktopUpdateInfo = {
  version: string;
  notes: string | null;
  date: string | null;
};

export type DownloadProgress = {
  downloaded: number;
  contentLength: number | null;
};

async function loadUpdater() {
  const { check } = await import('@tauri-apps/plugin-updater');
  return check;
}

async function loadRelaunch() {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  return relaunch;
}

export async function checkDesktopUpdate(): Promise<DesktopUpdateInfo | null> {
  if (!isTauri()) return null;
  const check = await loadUpdater();
  const update = await check();
  if (!update) return null;
  const info: DesktopUpdateInfo = {
    version: update.version,
    notes: update.body ?? null,
    date: update.date ?? null,
  };
  // Liberar el recurso Rust si solo consultamos metadatos (sin instalar).
  await update.close();
  return info;
}

export async function installDesktopUpdate(
  onProgress?: (p: DownloadProgress) => void,
): Promise<void> {
  if (!isTauri()) {
    throw new Error('Las actualizaciones solo están en la app de escritorio');
  }
  const check = await loadUpdater();
  const update = await check();
  if (!update) {
    throw new Error('No hay actualización disponible');
  }

  let downloaded = 0;
  let contentLength: number | null = null;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case 'Started':
        contentLength = event.data.contentLength ?? null;
        downloaded = 0;
        onProgress?.({ downloaded, contentLength });
        break;
      case 'Progress':
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, contentLength });
        break;
      case 'Finished':
        onProgress?.({ downloaded, contentLength });
        break;
    }
  });

  const relaunch = await loadRelaunch();
  await relaunch();
}
