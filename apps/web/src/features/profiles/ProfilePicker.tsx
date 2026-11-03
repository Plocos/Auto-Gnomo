import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiClientError } from '../../lib/api';
import {
  isTauri,
  joinProfilePath,
  listRecentProfiles,
  openProfile,
  pickFolder,
  removeRecentProfile,
  revealProfileFolder,
} from '../../lib/profile';
import { Button } from '../../components/ui/primitives';

type ProfilePickerProps = {
  variant: 'page' | 'modal';
  onClose?: () => void;
};

export function ProfilePicker({ variant, onClose }: ProfilePickerProps) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'home' | 'create'>('home');
  const [name, setName] = useState('');
  const [parentFolder, setParentFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const finalPath = useMemo(() => {
    if (!parentFolder.trim() || !name.trim()) return '';
    return joinProfilePath(parentFolder.trim(), name.trim());
  }, [parentFolder, name]);

  const recent = useQuery({
    queryKey: ['recent-profiles'],
    queryFn: listRecentProfiles,
  });

  useEffect(() => {
    if (variant !== 'modal' || !onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [variant, onClose, busy]);

  const enterApp = useMutation({
    mutationFn: async (opts: { path: string; name?: string; create?: boolean }) => {
      setBusy(true);
      setError(null);
      return openProfile(opts.path, opts.name, { create: opts.create });
    },
    onSuccess: async () => {
      await qc.clear();
      await qc.invalidateQueries();
      onClose?.();
      nav('/', { replace: true });
    },
    onError: (e) => {
      setError(
        e instanceof ApiClientError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'No se pudo abrir el perfil',
      );
    },
    onSettled: () => setBusy(false),
    meta: { silentError: true },
  });

  async function onOpenExisting() {
    setError(null);
    if (isTauri()) {
      const picked = await pickFolder();
      if (!picked.ok) {
        if (!picked.cancelled) setError(picked.message);
        return;
      }
      enterApp.mutate({ path: picked.path });
      return;
    }
    const path = window.prompt('Ruta de la carpeta del perfil');
    if (!path?.trim()) return;
    enterApp.mutate({ path: path.trim() });
  }

  async function onPickCreateFolder() {
    setError(null);
    if (isTauri()) {
      const picked = await pickFolder();
      if (!picked.ok) {
        if (!picked.cancelled) setError(picked.message);
        return;
      }
      setParentFolder(picked.path);
      return;
    }
    const path = window.prompt('Carpeta padre donde guardar el perfil');
    if (path?.trim()) setParentFolder(path.trim());
  }

  function onContinueCreate() {
    setError(null);
    if (!name.trim()) {
      setError('Indica un nombre');
      return;
    }
    if (!parentFolder.trim()) {
      setError('Elige una carpeta donde guardar el perfil');
      return;
    }
    enterApp.mutate({
      path: parentFolder.trim(),
      name: name.trim(),
      create: true,
    });
  }

  async function onReveal(path: string, e: React.MouseEvent) {
    e.stopPropagation();
    setActionError(null);
    try {
      await revealProfileFolder(path);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo abrir la ubicación');
    }
  }

  async function onRemove(path: string, profileName: string, e: React.MouseEvent) {
    e.stopPropagation();
    setActionError(null);
    const ok = window.confirm(
      `¿Quitar «${profileName}» de la lista?\n\nNo se borran los archivos del disco; solo deja de aparecer aquí.`,
    );
    if (!ok) return;
    try {
      await removeRecentProfile(path);
      await recent.refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'No se pudo quitar de la lista');
    }
  }

  const panel = (
    <div
      className={`w-full max-w-lg rounded-lg border border-surface-border bg-surface-panel p-6 shadow-sm ${
        variant === 'modal' ? 'relative' : ''
      }`}
      role={variant === 'modal' ? 'dialog' : undefined}
      aria-modal={variant === 'modal' ? true : undefined}
      aria-labelledby="profile-picker-title"
      onClick={variant === 'modal' ? (e) => e.stopPropagation() : undefined}
    >
      {variant === 'modal' && onClose && (
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="absolute right-3 top-3 rounded px-2 py-1 text-[12px] text-surface-muted hover:bg-black/5 hover:text-surface-ink disabled:opacity-50"
          aria-label="Cerrar"
        >
          Cerrar
        </button>
      )}

      <h1
        id="profile-picker-title"
        className="pr-16 text-xl font-semibold tracking-tight text-surface-accent"
      >
        Auto-Gnomo
      </h1>
      <p className="mt-1 text-[13px] text-surface-muted">
        Elige un perfil reciente o abre la carpeta que contiene tu contabilidad (
        <code className="text-[11px]">vault.json</code>). Para uno nuevo, indica el nombre y la
        carpeta padre donde guardarlo.
      </p>

      {mode === 'home' && (
        <div className="mt-6 space-y-4">
          {(recent.data?.length ?? 0) > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-surface-muted">
                Perfiles recientes
              </div>
              <ul className="space-y-1">
                {recent.data!.map((p) => (
                  <li key={p.path}>
                    <div className="flex items-stretch gap-1 rounded border border-surface-border">
                      <button
                        type="button"
                        disabled={busy}
                        className="min-w-0 flex-1 px-3 py-2 text-left hover:bg-black/5 disabled:opacity-50"
                        onClick={() => enterApp.mutate({ path: p.path, name: p.name })}
                      >
                        <div className="text-[14px] font-medium">{p.name}</div>
                        <div className="truncate font-mono text-[11px] text-surface-muted">
                          {p.path}
                        </div>
                      </button>
                      {isTauri() && (
                        <div className="flex shrink-0 flex-col justify-center gap-0.5 border-l border-surface-border p-1">
                          <button
                            type="button"
                            disabled={busy}
                            title="Abrir ubicación"
                            className="rounded px-2 py-1 text-[11px] text-surface-accent hover:bg-black/5 disabled:opacity-50"
                            onClick={(e) => void onReveal(p.path, e)}
                          >
                            Ubicación
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            title="Quitar de la lista"
                            className="rounded px-2 py-1 text-[11px] text-surface-danger hover:bg-black/5 disabled:opacity-50"
                            onClick={(e) => void onRemove(p.path, p.name, e)}
                          >
                            Quitar
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void onOpenExisting()}>
              Abrir perfil…
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setName('');
                setParentFolder('');
                setError(null);
                setMode('create');
              }}
            >
              Crear perfil…
            </Button>
          </div>
        </div>
      )}

      {mode === 'create' && (
        <div className="mt-6 grid gap-3">
          <label className="block text-[12px] text-surface-muted">
            Nombre del perfil
            <input
              className="mt-1 w-full border px-2 py-1.5"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Antonio"
              autoFocus
              disabled={busy}
            />
          </label>

          <div>
            <div className="text-[12px] text-surface-muted">
              Carpeta padre (p. ej. Documentos o Auto-Gnomo en Drive). Se creará una subcarpeta con
              el nombre de arriba.
            </div>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full border px-2 py-1.5 font-mono text-[12px]"
                value={parentFolder}
                onChange={(e) => setParentFolder(e.target.value)}
                placeholder={isTauri() ? 'Pulsa «Elegir carpeta…»' : 'C:\\Users\\tu\\Documents'}
                disabled={busy}
                readOnly={isTauri()}
              />
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => void onPickCreateFolder()}
              >
                Elegir carpeta…
              </Button>
            </div>
            {finalPath && (
              <p className="mt-2 text-[12px] text-surface-ink">
                Se creará:{' '}
                <code className="break-all rounded bg-black/5 px-1 font-mono text-[11px]">
                  {finalPath}
                </code>
              </p>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="primary"
              disabled={busy || !name.trim() || !parentFolder.trim()}
              onClick={onContinueCreate}
            >
              Continuar
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setMode('home');
                setError(null);
              }}
            >
              Atrás
            </Button>
          </div>
        </div>
      )}

      {busy && (
        <p className="mt-4 text-[13px] text-surface-muted">Creando / abriendo perfil…</p>
      )}
      {(error || actionError) && (
        <p className="mt-4 whitespace-pre-wrap text-[13px] text-surface-danger">
          {error || actionError}
        </p>
      )}
    </div>
  );

  if (variant === 'modal') {
    return (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-[1px]"
        onClick={() => {
          if (!busy) onClose?.();
        }}
      >
        {panel}
      </div>
    );
  }

  return (
    <div className="grid min-h-full place-items-center bg-surface-bg p-6">{panel}</div>
  );
}
