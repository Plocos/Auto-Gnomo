import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, PageHeader, StatusDot } from '../../components/ui/primitives';
import { getAlertCatalog } from './alertCatalog';

type AlertItem = {
  id: string;
  severity: string;
  message: string;
  movementId?: string;
  code: string;
};

export function AlertsPage() {
  const qc = useQueryClient();
  const [active, setActive] = useState<AlertItem | null>(null);

  const alerts = useQuery({
    queryKey: ['alerts'],
    queryFn: () =>
      api<{
        counts: { error: number; warning: number; info: number };
        items: AlertItem[];
      }>('/api/alerts'),
  });

  const c = alerts.data?.counts;

  return (
    <div>
      <PageHeader
        title="Alertas"
        subtitle={`${c?.error ?? 0} errores · ${c?.warning ?? 0} advertencias · ${c?.info ?? 0} info`}
      />
      <div className="mb-3 flex gap-3 text-ui">
        <StatusDot status="error" /> {c?.error ?? 0}
        <StatusDot status="warning" /> {c?.warning ?? 0}
        <StatusDot status="info" /> {c?.info ?? 0}
      </div>
      <table className="dense-table">
        <thead>
          <tr>
            <th>Severidad</th>
            <th>Código</th>
            <th>Mensaje</th>
            <th>Movimiento</th>
          </tr>
        </thead>
        <tbody>
          {(alerts.data?.items ?? []).map((a) => (
            <tr key={a.id}>
              <td>
                <StatusDot status={a.severity} />
              </td>
              <td className="font-mono text-[11px]">
                <button
                  type="button"
                  className="text-surface-accent underline"
                  onClick={() => setActive(a)}
                >
                  {a.code}
                </button>
              </td>
              <td>
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => setActive(a)}
                >
                  {a.message}
                </button>
              </td>
              <td>
                {a.movementId ? (
                  <Link
                    className="text-surface-accent underline"
                    to={`/movimientos?highlight=${a.movementId}&alert=${a.code}`}
                  >
                    {a.movementId.slice(-6)}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {active && (
        <AlertResolveModal
          alert={active}
          onClose={() => setActive(null)}
          onResolved={() => {
            setActive(null);
            void qc.invalidateQueries({ queryKey: ['alerts'] });
            void qc.invalidateQueries({ queryKey: ['movements'] });
            void qc.invalidateQueries({ queryKey: ['dashboard'] });
            void qc.invalidateQueries({ queryKey: ['assets'] });
          }}
        />
      )}
    </div>
  );
}

function AlertResolveModal({
  alert,
  onClose,
  onResolved,
}: {
  alert: AlertItem;
  onClose: () => void;
  onResolved: () => void;
}) {
  const catalog = getAlertCatalog(alert.code);
  const [coefficient, setCoefficient] = useState('26');
  const movement = useQuery({
    queryKey: ['movement-brief', alert.movementId],
    queryFn: async () => {
      const res = await api<{
        items: {
          id: string;
          concept: string;
          fiscalDate: string;
          taxBaseCents: number;
          partyName?: string;
        }[];
      }>(`/api/movements?pageSize=500`);
      return res.items.find((m) => m.id === alert.movementId) ?? null;
    },
    enabled: Boolean(alert.movementId) && catalog.action === 'link_asset',
  });

  const createFromMovement = useMutation({
    mutationFn: async () => {
      if (!movement.data || !alert.movementId) throw new Error('Movimiento no encontrado');
      const m = movement.data;
      await api('/api/assets', {
        method: 'POST',
        json: {
          name: m.concept,
          acquisitionDate: m.fiscalDate,
          inServiceDate: m.fiscalDate,
          taxBaseCents: m.taxBaseCents,
          coefficientBps: Math.round(Number(coefficient.replace(',', '.')) * 100),
          method: 'linear',
          movementId: alert.movementId,
        },
      });
    },
    onSuccess: onResolved,
    meta: { errorTitle: 'No se pudo crear el activo' },
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="w-full max-w-lg border border-surface-border bg-surface-panel p-4">
        <h2 className="mb-1 text-[14px] font-semibold">{catalog.title}</h2>
        <p className="mb-2 font-mono text-[11px] text-surface-muted">{alert.code}</p>
        <p className="mb-2 text-[13px]">{catalog.explanation}</p>
        <p className="mb-3 text-[12px] text-surface-muted">
          <strong>Solución:</strong> {catalog.solutionHint}
        </p>
        <p className="mb-3 text-[12px]">
          Alerta: <em>{alert.message}</em>
        </p>

        {catalog.action === 'link_asset' && alert.movementId && (
          <div className="mb-3 space-y-2 border border-surface-border bg-surface-field p-2">
            <p className="text-[12px] text-surface-muted">
              Generar activo y plan desde «{movement.data?.concept ?? '…'}».
            </p>
            <label className="block text-[11px]">
              Coeficiente amortización %
              <input
                className="mt-0.5 w-full border border-surface-border px-2 py-1 text-ui"
                value={coefficient}
                onChange={(e) => setCoefficient(e.target.value)}
              />
            </label>
            <Button
              variant="primary"
              disabled={createFromMovement.isPending || !movement.data}
              onClick={() => createFromMovement.mutate()}
            >
              Crear activo y plan
            </Button>
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {alert.movementId && (
            <Link
              className="inline-flex items-center border border-surface-border px-3 py-1 text-ui hover:bg-surface-hover"
              to={`/movimientos?highlight=${alert.movementId}&alert=${alert.code}`}
              onClick={onClose}
            >
              Ir al movimiento
            </Link>
          )}
          <Button type="button" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
}
