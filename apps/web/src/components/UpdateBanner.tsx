import { useEffect, useState } from 'react';
import {
  checkDesktopUpdate,
  installDesktopUpdate,
  type DesktopUpdateInfo,
  type DownloadProgress,
} from '../lib/desktopUpdater';
import { isTauri } from '../lib/profile';
import { Button } from './ui/primitives';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateBanner() {
  const [info, setInfo] = useState<DesktopUpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void (async () => {
      try {
        const update = await checkDesktopUpdate();
        if (!cancelled && update) setInfo(update);
      } catch {
        /* check silencioso al arrancar */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isTauri() || !info || dismissed) return null;

  const onInstall = async () => {
    setInstalling(true);
    setError(null);
    setProgress(null);
    try {
      await installDesktopUpdate(setProgress);
    } catch (e) {
      setInstalling(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pct =
    progress?.contentLength && progress.contentLength > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.contentLength) * 100))
      : null;

  return (
    <div className="alerts-banner alerts-banner-info flex flex-wrap items-center gap-2">
      <span className="flex-1">
        {installing
          ? pct != null
            ? `Descargando actualización… ${pct}% (${formatBytes(progress!.downloaded)} / ${formatBytes(progress!.contentLength!)})`
            : progress
              ? `Descargando actualización… ${formatBytes(progress.downloaded)}`
              : 'Preparando actualización…'
          : `Hay una actualización disponible (v${info.version}).`}
        {error ? ` Error: ${error}` : ''}
      </span>
      {!installing && (
        <>
          <Button variant="primary" onClick={() => void onInstall()}>
            Actualizar e instalar
          </Button>
          <button
            type="button"
            className="text-[12px] text-surface-muted hover:underline"
            onClick={() => setDismissed(true)}
          >
            Más tarde
          </button>
        </>
      )}
    </div>
  );
}
