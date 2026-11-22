import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/primitives';
import type { ModelSnapshots, TaxBox, TaxModel, TaxReturnSnapshot } from './types';

export const LIVE_VIEW = 'live';

export function formatDateEs(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Casillas cuyo importe difiere entre la copia presentada y el cálculo actual. */
export function diffBoxes(
  filed: Record<string, TaxBox>,
  live: Record<string, TaxBox>,
): string[] {
  const codes = new Set([...Object.keys(filed), ...Object.keys(live)]);
  return [...codes]
    .filter((code) => /^\d+$/.test(code))
    .filter((code) => (filed[code]?.amountCents ?? 0) !== (live[code]?.amountCents ?? 0))
    .sort((a, b) => Number(a) - Number(b));
}

/**
 * Qué se está viendo en la página de un modelo: el cálculo actual o una versión presentada.
 * Por defecto, la copia vigente si existe.
 */
export function useFilingView(year: number, quarter: string, snapshots: ModelSnapshots | undefined) {
  const [picked, setPicked] = useState<string | null>(null);
  const currentId = snapshots?.current?.id;

  useEffect(() => {
    setPicked(null);
  }, [year, quarter, currentId]);

  const history = snapshots?.history ?? [];
  const pickedSnapshot = picked && picked !== LIVE_VIEW ? history.find((s) => s.id === picked) : undefined;
  const selected: TaxReturnSnapshot | null =
    picked === LIVE_VIEW ? null : (pickedSnapshot ?? snapshots?.current ?? null);

  return {
    selectedId: selected?.id ?? LIVE_VIEW,
    selected,
    select: setPicked,
  };
}

type FilingView = ReturnType<typeof useFilingView>;

export function FilingBar({
  model,
  year,
  quarter,
  snapshots,
  liveBoxes,
  view,
  onChanged,
}: {
  model: TaxModel;
  year: number;
  quarter: string;
  snapshots: ModelSnapshots | undefined;
  liveBoxes: Record<string, TaxBox>;
  view: FilingView;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [filedAt, setFiledAt] = useState(todayIso);
  const [msg, setMsg] = useState<string | null>(null);

  const current = snapshots?.current ?? null;
  const history = snapshots?.history ?? [];

  const invalidate = () => {
    for (const key of ['tax130', 'tax303', 'quarters', 'dashboard', 'settings', 'movements']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const file = useMutation({
    mutationFn: () =>
      api<{ message: string }>('/api/tax-returns/file', {
        method: 'POST',
        json: { fiscalYear: year, quarter, model, filedAt, confirm: true },
      }),
    onMutate: () => setMsg(null),
    onSuccess: (r) => {
      setMsg(r.message);
      onChanged?.();
      invalidate();
    },
    meta: { errorTitle: `No se pudo marcar el modelo ${model} como presentado` },
  });

  const reopen = useMutation({
    mutationFn: () =>
      api<{ message: string }>('/api/tax-returns/reopen', {
        method: 'POST',
        json: {
          fiscalYear: year,
          quarter,
          model,
          reason: `Reapertura del modelo ${model} desde la UI`,
          confirm: true,
        },
      }),
    onMutate: () => setMsg(null),
    onSuccess: (r) => {
      setMsg(r.message);
      onChanged?.();
      invalidate();
    },
    meta: { errorTitle: `No se pudo reabrir el modelo ${model}` },
  });

  const compareWith = view.selected ?? current;
  const differences = compareWith ? diffBoxes(compareWith.boxes, liveBoxes) : [];

  return (
    <div className="mb-2 border border-surface-border bg-surface-panel px-2 py-1.5 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        {current ? (
          <span className="font-semibold text-surface-ok">
            Presentado el {formatDateEs(current.filedAt)}
          </span>
        ) : (
          <span className="font-semibold text-surface-muted">Sin presentar</span>
        )}

        {!current && (
          <>
            <label className="flex items-center gap-1">
              Fecha
              <input
                type="date"
                className="border border-surface-border bg-surface-field px-1 py-0.5"
                value={filedAt}
                onChange={(e) => setFiledAt(e.target.value)}
              />
            </label>
            <Button
              variant="primary"
              disabled={file.isPending || !filedAt}
              onClick={() => {
                if (
                  !confirm(
                    `¿Marcar el modelo ${model} de ${quarter} ${year} como PRESENTADO el ${formatDateEs(filedAt)}?\nSe guardará una copia exacta de las casillas actuales. Esto NO envía nada a la AEAT.`,
                  )
                )
                  return;
                file.mutate();
              }}
            >
              {file.isPending ? 'Guardando…' : 'Marcar como presentado'}
            </Button>
          </>
        )}

        {current && (
          <Button
            variant="danger"
            disabled={reopen.isPending}
            onClick={() => {
              if (
                !confirm(
                  `¿Reabrir el modelo ${model} de ${quarter} ${year}?\nLa copia presentada se conserva en el historial y el trimestre vuelve a quedar abierto.`,
                )
              )
                return;
              reopen.mutate();
            }}
          >
            Reabrir
          </Button>
        )}

        {history.length > 0 && (
          <label className="ml-auto flex items-center gap-1">
            Ver
            <select
              className="border border-surface-border bg-surface-field px-1 py-0.5"
              value={view.selectedId}
              onChange={(e) => view.select(e.target.value)}
            >
              {history.map((s) => (
                <option key={s.id} value={s.id}>
                  Presentada el {formatDateEs(s.filedAt)}
                  {s.reopenedAt ? ' (reabierta)' : ' (vigente)'}
                </option>
              ))}
              <option value={LIVE_VIEW}>Cálculo actual</option>
            </select>
          </label>
        )}
      </div>

      {view.selected && (
        <div className="mt-1 text-surface-muted">
          Estás viendo la copia guardada el {formatDateEs(view.selected.createdAt)} (reglas{' '}
          {view.selected.rulesVersion ?? '—'}). No cambia aunque edites movimientos.
        </div>
      )}

      {compareWith && differences.length > 0 && (
        <div className="mt-1 text-surface-warn">
          El cálculo actual no coincide con lo presentado (casillas {differences.join(', ')}).
        </div>
      )}

      {msg && <div className="mt-1 text-surface-ok">{msg}</div>}
    </div>
  );
}
