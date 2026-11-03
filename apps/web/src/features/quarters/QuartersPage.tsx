import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { parseISODateOnly, quarterDateRange, type Quarter } from '@autonomous/shared';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, PageHeader, StatusDot, formatMoney } from '../../components/ui/primitives';
import { copyToClipboard } from '../clipboard/copy';
import { formatDateEs } from '../filings/FilingBar';

/** Trimestre completamente anterior al inicio de actividad. */
function isQuarterBeforeActivity(
  fiscalYear: number,
  quarter: Quarter,
  activityStartDate: string | undefined,
): boolean {
  if (!activityStartDate) return false;
  const { to } = quarterDateRange(fiscalYear, quarter);
  const endDay = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const start = parseISODateOnly(activityStartDate);
  return endDay < start;
}

export function QuartersPage() {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<{ activeFiscalYear?: number }>('/api/settings'),
  });
  const year = settings.data?.activeFiscalYear ?? 2026;
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);

  const taxProfile = useQuery({
    queryKey: ['tax-profile', year],
    queryFn: () => api<{ activityStartDate?: string }>(`/api/tax-profiles/${year}`),
  });

  const quarters = useQuery({
    queryKey: ['quarters', year],
    queryFn: () =>
      api<{
        items: {
          quarter: string;
          status: string;
          filedAt?: string;
          filed130At?: string;
          filed303At?: string;
          observations?: string;
        }[];
      }>(`/api/quarters/${year}`),
  });

  const invalidateRelated = () => {
    for (const key of ['quarters', 'dashboard', 'assets', 'tax130', 'tax303', 'settings', 'movements']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const file = useMutation({
    mutationFn: (quarter: string) =>
      api<{ message: string }>('/api/quarters/file', {
        method: 'POST',
        json: {
          fiscalYear: year,
          quarter,
          confirm: true,
          models: ['130', '303'],
          observations: 'Marcado como presentado por el usuario desde la UI',
        },
      }),
    onMutate: () => setMsg(null),
    onSuccess: (r) => {
      setMsg(r.message);
      invalidateRelated();
    },
    meta: { errorTitle: 'No se pudo marcar el trimestre como presentado' },
  });

  const reopen = useMutation({
    mutationFn: (quarter: string) =>
      api<{ message: string }>('/api/quarters/reopen', {
        method: 'POST',
        json: {
          fiscalYear: year,
          quarter,
          reason: 'Reapertura explícita desde UI',
          confirm: true,
        },
      }),
    onMutate: () => setMsg(null),
    onSuccess: (r) => {
      setMsg(r.message);
      invalidateRelated();
    },
    meta: { errorTitle: 'No se pudo reabrir el trimestre' },
  });

  const activityStartDate = taxProfile.data?.activityStartDate;

  return (
    <div>
      <PageHeader
        title="Trimestres"
        subtitle={`${year} — el cierre congela un snapshot; no afirma presentación ante AEAT`}
      />
      {msg && (
        <div className="mb-3 border border-surface-border bg-surface-panel p-2 text-ui">{msg}</div>
      )}
      <table className="dense-table">
        <thead>
          <tr>
            <th>Trimestre</th>
            <th>Estado</th>
            <th>130 presentado</th>
            <th>303 presentado</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {(quarters.data?.items ?? []).map((q) => {
            const beforeActivity = isQuarterBeforeActivity(
              year,
              q.quarter as Quarter,
              activityStartDate,
            );
            const closed = q.status === 'FILED' || q.status === 'AMENDED';
            return (
              <tr key={q.quarter} className={beforeActivity ? 'text-surface-muted' : undefined}>
                <td className="font-medium">{q.quarter}</td>
                <td>
                  {beforeActivity ? (
                    <span className="status-pill text-surface-muted">
                      <span aria-hidden>●</span>
                      <span>Fuera de actividad</span>
                    </span>
                  ) : (
                    <StatusDot status={q.status} />
                  )}
                </td>
                <td>{formatDateEs(q.filed130At)}</td>
                <td>{formatDateEs(q.filed303At)}</td>
                <td className="space-x-1">
                  {!beforeActivity && !closed && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        if (
                          !confirm(
                            `¿Marcar ${q.quarter} ${year} como PRESENTADO POR EL USUARIO?\nEsto NO envía nada a AEAT. Se guardará una copia de los modelos que falten por presentar y se bloquearán los movimientos.`,
                          )
                        )
                          return;
                        file.mutate(q.quarter);
                      }}
                    >
                      Marcar presentado
                    </Button>
                  )}
                  {!beforeActivity && closed && (
                    <Button
                      variant="danger"
                      onClick={() => {
                        if (
                          !confirm(
                            'Reapertura fuerte: la declaración presentada puede quedar desactualizada. ¿Continuar?',
                          )
                        )
                          return;
                        reopen.mutate(q.quarter);
                      }}
                    >
                      Reabrir
                    </Button>
                  )}
                  <Button
                    onClick={async () => {
                      const live = await api<{
                        live: { modelo130: unknown; modelo303: unknown };
                      }>(`/api/tax-returns/${year}/${q.quarter}`);
                      await copyToClipboard(JSON.stringify(live.live, null, 2));
                    }}
                  >
                    Copiar resumen
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[12px] text-surface-muted">
        Resultado estimado (ejemplo Q actual): usa Modelo 130 / 303 para el detalle con
        trazabilidad. Totales de snapshot solo cambian si reabres o corriges.
      </p>
      <p className="text-[12px] text-surface-muted">
        IVA neto orientativo del year: {formatMoney(0)} (ver modelos).
      </p>
    </div>
  );
}
