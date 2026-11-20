import { applyDeductibility, applyRate, type MoneyCents, type Quarter } from '@autonomous/shared';
import type {
  AmortizationLike,
  BoxResult,
  BreakdownItem,
  Modelo130Input,
  Modelo130Result,
  MovementLike,
  TaxRulesetMeta,
} from '../types.js';

export const META_2026: TaxRulesetMeta = {
  fiscalYear: 2026,
  version: '2026.1.0',
  effectiveFrom: '2026-01-01',
  sources: [
    {
      title: 'AEAT — Instrucciones Modelo 130',
      url: 'https://sede.agenciatributaria.gob.es/Sede/impuestos-tasas/impuesto-sobre-renta-personas-fisicas/modelo-130-irpf______esionales-estimacion-directa-fraccionado_/instrucciones.html',
      retrievedAt: '2026-10-06',
    },
  ],
};

/** 20% pago fraccionado (casilla 04). */
export const MODELO_130_RATE_BPS = 2000;

const ACTIVE = new Set(['confirmed', 'locked', 'corrected']);

function isActive(m: MovementLike): boolean {
  return ACTIVE.has(m.status) && m.status !== 'void';
}

function quarterOrder(q: Quarter): number {
  return { T1: 1, T2: 2, T3: 3, T4: 4 }[q];
}

function inYtd(
  m: Pick<MovementLike, 'fiscalYear' | 'quarter' | 'fiscalDate'>,
  year: number,
  quarter: Quarter,
  activityStart?: string,
): boolean {
  if (m.fiscalYear !== year) return false;
  if (quarterOrder(m.quarter) > quarterOrder(quarter)) return false;
  if (activityStart && m.fiscalDate < activityStart) return false;
  return true;
}

function deductibleBase(m: MovementLike): MoneyCents {
  return applyDeductibility(m.taxBaseCents, m.professionalUseBps, m.taxDeductibleBps);
}

function box(
  code: string,
  label: string,
  amountCents: MoneyCents,
  breakdown: BreakdownItem[],
  extra?: Partial<BoxResult>,
): BoxResult {
  return { box: code, label, amountCents, breakdown, ...extra };
}

export function computeModelo130(input: Modelo130Input): Modelo130Result {
  const { fiscalYear, quarter, activityStartDate, movements, previousInstallmentsCents } = input;

  const ytd = movements.filter(
    (m) => isActive(m) && inYtd(m, fiscalYear, quarter, activityStartDate),
  );

  const incomeBreakdown: BreakdownItem[] = [];
  let ingresos = 0;
  for (const m of ytd) {
    if (m.type === 'income' || m.type === 'grant') {
      const amt = m.taxBaseCents;
      ingresos += amt;
      incomeBreakdown.push({ movementId: m.id, concept: m.concept, amountCents: amt });
    }
  }

  const expenseBreakdown: BreakdownItem[] = [];
  let gastos = 0;
  for (const m of ytd) {
    // Compra de inmovilizado: no deducible de golpe; entra por cuotas de amortización
    if (m.type === 'expense' && m.expenseNature === 'fixed_asset') continue;
    // Legado: movimientos type=amortization ya no se usan
    if (m.type === 'amortization') continue;
    if (m.type === 'expense' || m.type === 'autonomo_fee') {
      const amt = deductibleBase(m);
      gastos += amt;
      expenseBreakdown.push({ movementId: m.id, concept: m.concept, amountCents: amt });
    }
    if (m.type === 'correction') {
      const amt = deductibleBase(m);
      gastos += amt;
      expenseBreakdown.push({ movementId: m.id, concept: m.concept, amountCents: amt });
    }
  }

  const amortYtd = (input.amortizations ?? []).filter((a: AmortizationLike) =>
    inYtd(a, fiscalYear, quarter, activityStartDate),
  );
  for (const a of amortYtd) {
    gastos += a.amountCents;
    expenseBreakdown.push({
      movementId: a.id,
      concept: a.concept,
      amountCents: a.amountCents,
    });
  }

  for (const adj of input.manualAdjustments ?? []) {
    if (adj.box === '02') {
      gastos += adj.amountCents;
      expenseBreakdown.push({
        movementId: 'manual',
        concept: adj.note,
        amountCents: adj.amountCents,
      });
    }
  }

  const rendimiento = ingresos - gastos;
  const pago20 = rendimiento > 0 ? applyRate(rendimiento, MODELO_130_RATE_BPS) : 0;

  const retentionBreakdown: BreakdownItem[] = [];
  let retenciones = 0;
  for (const m of ytd) {
    if ((m.type === 'income' || m.type === 'grant') && m.irpfWithheldCents) {
      retenciones += m.irpfWithheldCents;
      retentionBreakdown.push({
        movementId: m.id,
        concept: m.concept,
        amountCents: m.irpfWithheldCents,
      });
    }
  }

  const resultado = pago20 - previousInstallmentsCents - retenciones;

  const boxes: Record<string, BoxResult> = {
    '01': box('01', 'Ingresos íntegros computables (YTD)', ingresos, incomeBreakdown),
    '02': box('02', 'Gastos deducibles (YTD)', gastos, expenseBreakdown, {
      uncertain: (input.manualAdjustments ?? []).some((a) => a.box === '02'),
      warning: (input.manualAdjustments ?? []).some((a) => a.box === '02')
        ? 'Incluye ajustes manuales — Revisar fiscalmente'
        : undefined,
    }),
    '03': box('03', 'Rendimiento neto', rendimiento, []),
    '04': box('04', '20% del rendimiento neto (si positivo)', pago20, []),
    '05': box('05', 'Pagos fraccionados anteriores', previousInstallmentsCents, []),
    '06': box('06', 'Retenciones e ingresos a cuenta (YTD)', retenciones, retentionBreakdown),
    '07': box('07', 'Resultado a ingresar / devolver', resultado, []),
  };

  return { meta: META_2026, boxes, resultCents: resultado };
}
