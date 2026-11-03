import { Quarters, type Quarter } from '@autonomous/shared';

/** Primer trimestre del ejercicio que aún no está presentado (FILED/AMENDED). */
export function nextActionableQuarter(
  quarters: { quarter: string; status: string }[],
): Quarter {
  const byQ = new Map(quarters.map((q) => [q.quarter, q.status]));
  for (const q of Quarters) {
    const status = byQ.get(q) ?? 'OPEN';
    if (status !== 'FILED' && status !== 'AMENDED') return q;
  }
  return 'T4';
}

/** Plazos habituales AEAT para modelos 130/303 (calendario trimestral). */
export function filingWindow(
  fiscalYear: number,
  quarter: Quarter,
): { start: Date; end: Date } {
  switch (quarter) {
    case 'T1':
      return {
        start: new Date(Date.UTC(fiscalYear, 3, 1)),
        end: new Date(Date.UTC(fiscalYear, 3, 20)),
      };
    case 'T2':
      return {
        start: new Date(Date.UTC(fiscalYear, 6, 1)),
        end: new Date(Date.UTC(fiscalYear, 6, 20)),
      };
    case 'T3':
      return {
        start: new Date(Date.UTC(fiscalYear, 9, 1)),
        end: new Date(Date.UTC(fiscalYear, 9, 20)),
      };
    case 'T4':
      return {
        start: new Date(Date.UTC(fiscalYear + 1, 0, 1)),
        end: new Date(Date.UTC(fiscalYear + 1, 0, 30)),
      };
  }
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export type FilingCalendarStatus =
  | 'filed'
  | 'upcoming'
  | 'open'
  | 'overdue';

export type FilingCalendarItem = {
  quarter: Quarter;
  status: FilingCalendarStatus;
  quarterStatus: string;
  /** Etiqueta para StatusDot: Abierto solo en ventana AEAT; Actual si es el de trabajo. */
  displayStatus: string;
  windowLabel: string;
  countdown: string;
  isWorking: boolean;
};

/**
 * Estado visual del calendario:
 * - Abierto: solo dentro de la ventana AEAT (p. ej. 1–20 del mes de plazo)
 * - Actual: trimestre de trabajo fuera de esa ventana
 */
export function filingDisplayStatus(
  item: Pick<FilingCalendarItem, 'status' | 'quarterStatus' | 'isWorking'>,
): string {
  if (item.quarterStatus === 'FILED' || item.quarterStatus === 'AMENDED') {
    return item.quarterStatus;
  }
  if (item.status === 'open') return 'OPEN';
  if (item.isWorking) return 'ACTUAL';
  if (item.status === 'overdue') return 'OVERDUE';
  if (item.status === 'upcoming') return 'UPCOMING';
  return item.quarterStatus;
}

export function buildFilingCalendar(
  fiscalYear: number,
  quarters: { quarter: string; status: string }[],
  workingQuarter: string,
  today = new Date(),
): FilingCalendarItem[] {
  const todayUtc = startOfUtcDay(today);
  const byQ = new Map(quarters.map((q) => [q.quarter, q.status]));

  return Quarters.map((quarter) => {
    const quarterStatus = byQ.get(quarter) ?? 'OPEN';
    const filed = quarterStatus === 'FILED' || quarterStatus === 'AMENDED';
    const { start, end } = filingWindow(fiscalYear, quarter);
    const isWorking = workingQuarter === quarter;

    let status: FilingCalendarStatus;
    let countdown: string;

    if (filed) {
      status = 'filed';
      countdown = 'Presentado (usuario)';
    } else if (todayUtc < start) {
      status = 'upcoming';
      const d = daysBetween(todayUtc, start);
      countdown = d === 0 ? 'El plazo abre hoy' : `Faltan ${d} día${d === 1 ? '' : 's'} para abrir el plazo`;
    } else if (todayUtc <= end) {
      status = 'open';
      const d = daysBetween(todayUtc, end);
      countdown =
        d === 0 ? 'Último día de plazo' : `Quedan ${d} día${d === 1 ? '' : 's'} de plazo`;
    } else {
      status = 'overdue';
      const d = daysBetween(end, todayUtc);
      countdown = `Vencido hace ${d} día${d === 1 ? '' : 's'}`;
    }

    const windowLabel =
      quarter === 'T4'
        ? `1–30 ene ${fiscalYear + 1}`
        : quarter === 'T1'
          ? `1–20 abr ${fiscalYear}`
          : quarter === 'T2'
            ? `1–20 jul ${fiscalYear}`
            : `1–20 oct ${fiscalYear}`;

    return {
      quarter,
      status,
      quarterStatus,
      windowLabel,
      countdown,
      isWorking,
      displayStatus: filingDisplayStatus({ status, quarterStatus, isWorking }),
    };
  });
}
