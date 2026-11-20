import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ErrorBanner } from '../components/ErrorBanner';
import { UpdateBanner } from '../components/UpdateBanner';
import { api } from '../lib/api';
import { useProfileModal } from '../features/profiles/ProfileModalContext';

const links = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/movimientos', label: 'Movimientos' },
  { to: '/ingresos', label: 'Ingresos' },
  { to: '/gastos', label: 'Gastos' },
  { to: '/inmovilizado', label: 'Inmovilizado' },
  { to: '/trimestres', label: 'Trimestres' },
  { to: '/modelo-130', label: 'Modelo 130' },
  { to: '/modelo-303', label: 'Modelo 303' },
  { to: '/alertas', label: 'Alertas' },
  { to: '/importar', label: 'Importar' },
  { to: '/asistente', label: 'Asistente' },
  { to: '/auditoria', label: 'Auditoría' },
  { to: '/configuracion', label: 'Configuración' },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { openProfileModal } = useProfileModal();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api<{
        activeFiscalYear?: number;
        workingQuarter?: string;
        vaultName?: string;
        dataDir?: string;
      }>('/api/settings'),
  });
  const alerts = useQuery({
    queryKey: ['alerts'],
    queryFn: () =>
      api<{
        counts: { error: number; warning: number; info: number };
        items: { id: string; severity: string; message: string; movementId?: string; code: string }[];
      }>('/api/alerts'),
  });

  const year = settings.data?.activeFiscalYear ?? 2026;
  const q = settings.data?.workingQuarter ?? 'T1';
  const counts = alerts.data?.counts;
  const topSeverity =
    (counts?.error ?? 0) > 0
      ? 'error'
      : (counts?.warning ?? 0) > 0
        ? 'warning'
        : (counts?.info ?? 0) > 0
          ? 'info'
          : null;
  const totalAlerts =
    (counts?.error ?? 0) + (counts?.warning ?? 0) + (counts?.info ?? 0);
  const firstAlert = alerts.data?.items?.[0];

  return (
    <div className="app-shell">
      <aside className="flex flex-col border-r border-surface-border bg-surface-panel/90 backdrop-blur-sm">
        <div className="border-b border-surface-border px-3 py-3">
          <div className="text-[15px] font-semibold tracking-tight text-surface-accent">
            Auto-Gnomo
          </div>
          <div className="mt-1 text-[12px] font-medium text-surface-ink">
            {settings.data?.vaultName ?? '…'}
          </div>
          <div className="mt-0.5 text-[11px] text-surface-muted">
            Ejercicio {year} · {q}
          </div>
        </div>
        <nav className="flex-1 overflow-auto p-2">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `mb-0.5 block rounded px-2 py-1.5 text-ui ${
                  isActive
                    ? 'bg-surface-accent/10 font-medium text-surface-accent'
                    : 'text-surface-ink/80 hover:bg-black/5'
                }`
              }
            >
              {l.label}
              {l.to === '/alertas' && (alerts.data?.counts.error ?? 0) > 0 && (
                <span className="ml-1 text-surface-danger">
                  ({alerts.data?.counts.error})
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-surface-border p-2">
          <button
            type="button"
            onClick={openProfileModal}
            className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-surface-accent hover:bg-black/5"
          >
            Cambiar perfil
          </button>
          <div className="mt-1 px-2 text-[11px] text-surface-muted">Datos locales · SQLite</div>
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <ErrorBanner />
        <UpdateBanner />
        {topSeverity && (
          <div className={`alerts-banner alerts-banner-${topSeverity}`}>
            <span>
              {topSeverity === 'error' &&
                `${counts?.error ?? 0} error(es) crítico(s)`}
              {topSeverity === 'warning' &&
                `${counts?.warning ?? 0} advertencia(s)`}
              {topSeverity === 'info' && `${counts?.info ?? 0} aviso(s) informativos`}
              {firstAlert ? ` — ${firstAlert.message}` : ''}
              {totalAlerts > 1 ? ` (+${totalAlerts - 1} más)` : ''}
            </span>
            <NavLink to="/alertas">Gestionar alertas</NavLink>
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-auto p-3">{children}</main>
      </div>
    </div>
  );
}
