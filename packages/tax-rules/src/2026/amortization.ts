import {
  Quarters,
  formatISODateOnly,
  quarterDateRange,
  roundHalfUp,
  type MoneyCents,
  type Quarter,
  type RateBps,
  applyRate,
} from '@autonomous/shared';

/** Amortización anual lineal: base × coeficiente. */
export function annualAmortization(taxBaseCents: MoneyCents, coefficientBps: RateBps): MoneyCents {
  return applyRate(taxBaseCents, coefficientBps);
}

/** Prorrateo trimestral uniforme (aprox. 1/4 del anual). */
export function quarterlyAmortization(
  taxBaseCents: MoneyCents,
  coefficientBps: RateBps,
): MoneyCents {
  const annual = annualAmortization(taxBaseCents, coefficientBps);
  return Math.floor(annual / 4);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Días inclusive entre dos fechas UTC (solo fecha). */
function daysInclusive(from: Date, to: Date): number {
  const a = startOfUtcDay(from).getTime();
  const b = startOfUtcDay(to).getTime();
  if (b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

export type QuarterlyAmortizationRow = {
  year: number;
  quarter: Quarter;
  amountCents: MoneyCents;
  /** Último día del trimestre (fecha fiscal de la cuota). */
  fiscalDate: string;
};

/**
 * Plan de amortización lineal prorrateado por días del año civil.
 * Cuota trimestre = roundHalfUp(anual × días_en_servicio_en_T / días_del_año),
 * con ajuste en la última cuota para agotar exactamente la base.
 */
export function quarterlyAmortizationScheduleByDays(params: {
  taxBaseCents: MoneyCents;
  coefficientBps: RateBps;
  inServiceDate: Date;
  /** Años máximos de vida útil; por defecto ceil(100%/coef). */
  maxYears?: number;
}): QuarterlyAmortizationRow[] {
  const annual = annualAmortization(params.taxBaseCents, params.coefficientBps);
  if (annual <= 0 || params.taxBaseCents <= 0) return [];

  const maxYears =
    params.maxYears ?? Math.ceil(10_000 / Math.max(params.coefficientBps, 1));
  const inService = startOfUtcDay(params.inServiceDate);
  const startYear = inService.getUTCFullYear();

  const out: QuarterlyAmortizationRow[] = [];
  let remaining = params.taxBaseCents;

  for (let y = startYear; y < startYear + maxYears + 1 && remaining > 0; y++) {
    const yearDays = daysInYear(y);
    for (const quarter of Quarters) {
      if (remaining <= 0) break;
      const { from } = quarterDateRange(y, quarter);
      const qStart = startOfUtcDay(from);
      const qEnd = new Date(Date.UTC(y, qStart.getUTCMonth() + 3, 0)); // último día del trimestre

      const serviceStart = inService > qStart ? inService : qStart;
      if (serviceStart > qEnd) continue;

      const days = daysInclusive(serviceStart, qEnd);
      if (days <= 0) continue;

      let amt = roundHalfUp((annual * days) / yearDays);
      if (amt > remaining) amt = remaining;
      if (amt <= 0) continue;

      out.push({
        year: y,
        quarter,
        amountCents: amt,
        fiscalDate: formatISODateOnly(qEnd),
      });
      remaining -= amt;
    }
  }

  // Si por redondeo queda residual dentro de la vida útil, súmalo a la última cuota
  if (remaining > 0 && out.length > 0) {
    const last = out[out.length - 1]!;
    last.amountCents += remaining;
  }

  return out;
}

/**
 * @deprecated Preferir quarterlyAmortizationScheduleByDays (prorrateo por días).
 * Se mantiene como adaptador mensual aproximado para compatibilidad de imports.
 */
export function monthlyAmortizationSchedule(params: {
  taxBaseCents: MoneyCents;
  coefficientBps: RateBps;
  inServiceDate: Date;
  months?: number;
}): { year: number; month: number; amountCents: MoneyCents }[] {
  const quarterly = quarterlyAmortizationScheduleByDays({
    taxBaseCents: params.taxBaseCents,
    coefficientBps: params.coefficientBps,
    inServiceDate: params.inServiceDate,
    maxYears: params.months ? Math.ceil(params.months / 12) : undefined,
  });
  // Expande a un único mes representativo por trimestre (mes final del T)
  return quarterly.map((row) => {
    const endMonth = { T1: 3, T2: 6, T3: 9, T4: 12 }[row.quarter];
    return { year: row.year, month: endMonth, amountCents: row.amountCents };
  });
}
