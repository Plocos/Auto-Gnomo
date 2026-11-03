import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button, PageHeader, formatMoney } from '../../components/ui/primitives';

type AmortEntry = {
  id: string;
  fiscalYear: number;
  quarter: string;
  fiscalDate?: string;
  amountCents: number;
  status: string;
  presented?: boolean;
};

type Asset = {
  id: string;
  name: string;
  acquisitionDate: string;
  inServiceDate: string;
  taxBaseCents: number;
  coefficientBps: number;
  accumulatedCents: number;
  pendingCents: number;
  totalQuarters: number;
  quartersDone: number;
  quartersRemaining: number;
  monthsTotal: number;
  monthsRemaining: number;
  movementId?: string;
  entries: AmortEntry[];
};

export function AssetsPage() {
  const assets = useQuery({
    queryKey: ['assets'],
    queryFn: () => api<{ items: Asset[] }>('/api/assets'),
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const items = assets.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Inmovilizado"
        subtitle="Activos nacidos desde Movimientos (naturaleza Inmovilizado) y su plan de amortización"
        actions={
          <Link to="/movimientos">
            <Button variant="primary">Alta en Movimientos</Button>
          </Link>
        }
      />

      {!items.length && (
        <p className="mb-3 text-[13px] text-surface-muted">
          Aún no hay activos. Da de alta un gasto con naturaleza «Inmovilizado» en{' '}
          <Link className="text-surface-accent underline" to="/movimientos">
            Movimientos
          </Link>{' '}
          e indica el coeficiente de amortización.
        </p>
      )}

      <div className="space-y-4">
        {items.map((a) => {
          const open = Boolean(expanded[a.id]);
          return (
            <article
              key={a.id}
              className="border border-surface-border bg-surface-panel p-3"
            >
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[14px] font-semibold">{a.name}</h2>
                <span className="text-[11px] text-surface-muted">
                  Adquisición {a.acquisitionDate} · Puesta en marcha {a.inServiceDate}
                </span>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
                <Metric label="Precio (base)" value={formatMoney(a.taxBaseCents)} />
                <Metric label="Coeficiente" value={`${a.coefficientBps / 100} %`} />
                <Metric label="Amortizado" value={formatMoney(a.accumulatedCents)} />
                <Metric label="Pendiente" value={formatMoney(a.pendingCents)} />
                <Metric
                  label="Trimestres"
                  value={`${a.quartersDone} / ${a.totalQuarters} (${a.quartersRemaining} rest.)`}
                />
                <Metric
                  label="Meses (est.)"
                  value={`${a.monthsTotal - a.monthsRemaining} / ${a.monthsTotal}`}
                />
              </div>

              <button
                type="button"
                className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-surface-muted hover:text-surface-fg"
                onClick={() => setExpanded((prev) => ({ ...prev, [a.id]: !prev[a.id] }))}
                aria-expanded={open}
              >
                <span aria-hidden>{open ? '▾' : '▸'}</span>
                Plan de cuotas ({a.entries.length})
              </button>

              {open && (
                <table className="dense-table">
                  <thead>
                    <tr>
                      <th>Periodo</th>
                      <th>Fecha fiscal</th>
                      <th>Importe</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.entries.map((e) => (
                      <tr
                        key={e.id}
                        className={e.presented ? '' : 'text-surface-muted'}
                      >
                        <td>
                          {e.quarter} {e.fiscalYear}
                        </td>
                        <td>{e.fiscalDate ?? '—'}</td>
                        <td className="money">{formatMoney(e.amountCents)}</td>
                        <td>
                          {e.status === 'skipped_closed'
                            ? 'Omitida (trimestre cerrado)'
                            : e.presented
                              ? 'Presentada'
                              : 'Pendiente'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-surface-muted">{label}</div>
      <div className="text-[13px] font-medium tabular-nums">{value}</div>
    </div>
  );
}
