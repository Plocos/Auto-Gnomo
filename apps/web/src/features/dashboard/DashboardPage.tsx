import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { PageHeader, StatusDot, formatMoney } from '../../components/ui/primitives';
import { buildFilingCalendar } from '../../lib/quarters';

export function DashboardPage() {
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api<{ activeFiscalYear?: number; vaultName?: string }>('/api/settings'),
  });
  const year = settings.data?.activeFiscalYear ?? 2026;
  const dash = useQuery({
    queryKey: ['dashboard', year],
    queryFn: async () => {
      const data = await api<{
        workingQuarter: string;
        quarters: { quarter: string; status: string }[];
        totals: {
          incomeCents: number;
          expenseCents: number;
          profitCents: number;
          vatRepercutidoCents: number;
          vatSoportadoCents: number;
        };
        live: {
          modelo130: { resultCents: number };
          modelo303: { resultCents: number };
        } | null;
        alerts: { error: number; warning: number };
      }>(`/api/dashboard/${year}`);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      return data;
    },
    enabled: !!settings.data || settings.isSuccess,
  });

  const d = dash.data;
  const calendar = d
    ? buildFilingCalendar(year, d.quarters, d.workingQuarter)
    : [];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${settings.data?.vaultName ?? 'Perfil'} · Ejercicio ${year} · ${d?.workingQuarter ?? '—'}`}
      />

      <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-surface-muted">
        Calendario de declaraciones (130 / 303)
      </h3>
      <div className="filing-cal">
        {calendar.map((item) => (
          <Link
            key={item.quarter}
            to="/trimestres"
            className={[
              'filing-cal-card',
              item.isWorking ? 'is-working' : '',
              item.status === 'overdue' ? 'is-overdue' : '',
              item.status === 'open' ? 'is-open' : '',
              item.status === 'filed' ? 'is-filed' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[14px] font-semibold">{item.quarter}</span>
              <StatusDot status={item.displayStatus} />
            </div>
            <div className="mt-1 text-[11px] text-surface-muted">Plazo AEAT: {item.windowLabel}</div>
            <div className="mt-2 text-[12px] font-medium">{item.countdown}</div>
            {item.isWorking && item.status !== 'filed' && (
              <div className="mt-1 text-[11px] text-surface-accent">Trimestre de trabajo</div>
            )}
          </Link>
        ))}
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <Stat label="Ingresos" value={formatMoney(d?.totals.incomeCents)} />
        <Stat label="Gastos" value={formatMoney(d?.totals.expenseCents)} />
        <Stat label="Beneficio (base)" value={formatMoney(d?.totals.profitCents)} />
        <Stat label="IVA repercutido" value={formatMoney(d?.totals.vatRepercutidoCents)} />
        <Stat label="IVA soportado" value={formatMoney(d?.totals.vatSoportadoCents)} />
        <Stat
          label="Alertas"
          value={`${d?.alerts.error ?? 0} errores · ${d?.alerts.warning ?? 0} avisos`}
        />
        <Stat
          label="Modelo 130 (est.)"
          value={formatMoney(d?.live?.modelo130.resultCents)}
        />
        <Stat
          label="Modelo 303 (est.)"
          value={formatMoney(d?.live?.modelo303.resultCents)}
        />
      </div>

      <p className="mt-4 max-w-2xl text-[12px] text-surface-muted">
        Los importes de modelos son estimaciones live a partir de movimientos. “Presentado”
        significa marcado por ti en Auto-Gnomo, no envío a AEAT. Los plazos del calendario son
        orientativos (ventanas habituales de presentación trimestral).
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div className="border border-surface-border bg-surface-panel px-3 py-2">
      <div className="text-[11px] text-surface-muted">{label}</div>
      <div className="mt-0.5 text-[15px] font-medium tabular-nums">{value ?? '—'}</div>
    </div>
  );
}
