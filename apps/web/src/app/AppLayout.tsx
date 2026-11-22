import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ErrorBanner } from '../components/ErrorBanner';
import { UpdateBanner } from '../components/UpdateBanner';
import { api } from '../lib/api';
import { ThemeToggle } from '../components/ThemeToggle';
import { useProfileModal } from '../features/profiles/ProfileModalContext';

function NavGlyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

const links: { to: string; label: string; end?: boolean; icon: ReactNode }[] = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    icon: (
      <NavGlyph>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </NavGlyph>
    ),
  },
  {
    to: '/movimientos',
    label: 'Movimientos',
    icon: (
      <NavGlyph>
        <path d="M8 6h13M8 12h13M8 18h13" />
        <path d="M3 6h.01M3 12h.01M3 18h.01" />
      </NavGlyph>
    ),
  },
  {
    to: '/ingresos',
    label: 'Ingresos',
    icon: (
      <NavGlyph>
        <path d="M12 19V5" />
        <path d="M6 11l6-6 6 6" />
      </NavGlyph>
    ),
  },
  {
    to: '/gastos',
    label: 'Gastos',
    icon: (
      <NavGlyph>
        <path d="M12 5v14" />
        <path d="M6 13l6 6 6-6" />
      </NavGlyph>
    ),
  },
  {
    to: '/inmovilizado',
    label: 'Inmovilizado',
    icon: (
      <NavGlyph>
        <path d="M3 21h18" />
        <path d="M5 21V8l7-4 7 4v13" />
        <path d="M9 21v-6h6v6" />
      </NavGlyph>
    ),
  },
  {
    to: '/trimestres',
    label: 'Trimestres',
    icon: (
      <NavGlyph>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </NavGlyph>
    ),
  },
  {
    to: '/modelo-130',
    label: 'Modelo 130',
    icon: (
      <NavGlyph>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M8 13h8M8 17h5" />
      </NavGlyph>
    ),
  },
  {
    to: '/modelo-303',
    label: 'Modelo 303',
    icon: (
      <NavGlyph>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M8 13h8M8 17h8" />
      </NavGlyph>
    ),
  },
  {
    to: '/alertas',
    label: 'Alertas',
    icon: (
      <NavGlyph>
        <path d="M12 3 2.5 19h19L12 3z" />
        <path d="M12 10v4M12 17h.01" />
      </NavGlyph>
    ),
  },
  {
    to: '/asistente',
    label: 'IA',
    icon: (
      <NavGlyph>
        <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
        <path d="M18 14l.7 1.8L20.5 16.5 18.7 17.2 18 19l-.7-1.8L15.5 16.5l1.8-.7L18 14z" />
      </NavGlyph>
    ),
  },
  {
    to: '/auditoria',
    label: 'Auditoría',
    icon: (
      <NavGlyph>
        <path d="M9 4h6a2 2 0 0 1 2 2v14l-5-2-5 2V6a2 2 0 0 1 2-2z" />
        <path d="M9 9h6M9 13h4" />
      </NavGlyph>
    ),
  },
  {
    to: '/configuracion',
    label: 'Configuración',
    icon: (
      <NavGlyph>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" />
      </NavGlyph>
    ),
  },
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
      <aside className="flex flex-col border-r border-surface-border bg-surface-panel">
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
                `mb-0.5 flex items-center gap-2 rounded px-2 py-1.5 text-ui ${
                  isActive
                    ? 'bg-surface-accent-soft font-medium text-surface-accent'
                    : 'text-surface-ink hover:bg-surface-hover'
                }`
              }
            >
              {l.icon}
              <span>
              {l.label}
              {l.to === '/alertas' && (alerts.data?.counts.error ?? 0) > 0 && (
                <span className="ml-1 text-surface-danger">
                  ({alerts.data?.counts.error})
                </span>
              )}
              </span>
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-surface-border p-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={openProfileModal}
            className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-surface-accent hover:bg-surface-hover"
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
