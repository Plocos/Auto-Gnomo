export function formatMoney(cents: number | undefined | null): string {
  if (cents === undefined || cents === null || Number.isNaN(cents)) return '—';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${whole.toLocaleString('es-ES')},${frac} €`;
}

export function StatusDot({
  status,
}: {
  status: string;
}) {
  const map: Record<string, { label: string; color: string }> = {
    OPEN: { label: 'Abierto', color: 'text-surface-muted' },
    ACTUAL: { label: 'Actual', color: 'text-surface-accent' },
    UPCOMING: { label: 'Pendiente', color: 'text-surface-muted' },
    OVERDUE: { label: 'Vencido', color: 'text-surface-danger' },
    FILED: { label: 'Presentado (usuario)', color: 'text-surface-ok' },
    AMENDED: { label: 'Corregido', color: 'text-surface-warn' },
    error: { label: 'Error', color: 'text-surface-danger' },
    warning: { label: 'Advertencia', color: 'text-surface-warn' },
    info: { label: 'Info', color: 'text-surface-muted' },
    ok: { label: 'Correcto', color: 'text-surface-ok' },
    locked: { label: 'Bloqueado', color: 'text-surface-muted' },
  };
  const m = map[status] ?? { label: status, color: 'text-surface-muted' };
  return (
    <span className={`status-pill ${m.color}`}>
      <span aria-hidden>●</span>
      <span>{m.label}</span>
    </span>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-surface-border pb-2">
      <div>
        <h1 className="text-[16px] font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-[12px] text-surface-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'default',
  type = 'button',
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  type?: 'button' | 'submit';
  disabled?: boolean;
}) {
  const styles = {
    default: 'border border-surface-border bg-white hover:bg-black/5',
    primary: 'bg-surface-accent text-white hover:opacity-90',
    danger: 'bg-surface-danger text-white hover:opacity-90',
    ghost: 'hover:bg-black/5',
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`px-2.5 py-1 text-ui disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}
