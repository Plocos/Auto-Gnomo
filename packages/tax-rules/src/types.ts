import type { MoneyCents, Quarter, RateBps } from '@autonomous/shared';

export interface TaxRuleSource {
  title: string;
  url: string;
  retrievedAt: string;
  notes?: string;
}

export interface TaxRulesetMeta {
  fiscalYear: number;
  version: string;
  effectiveFrom: string;
  sources: TaxRuleSource[];
}

export interface MovementLike {
  id: string;
  type: string;
  fiscalDate: string;
  fiscalYear: number;
  quarter: Quarter;
  taxBaseCents: MoneyCents;
  vatRateBps: RateBps;
  vatCents: MoneyCents;
  irpfRateBps: RateBps;
  irpfWithheldCents: MoneyCents;
  totalCents: MoneyCents;
  professionalUseBps: RateBps;
  taxDeductibleBps: RateBps;
  vatTreatment?: string;
  status: string;
  concept: string;
  /** current | fixed_asset — la compra de inmovilizado no entra en casilla 02 del 130 */
  expenseNature?: string;
}

/** Cuota de amortización normalizada (no es un movimiento). */
export interface AmortizationLike {
  id: string;
  concept: string;
  fiscalYear: number;
  quarter: Quarter;
  fiscalDate: string;
  amountCents: MoneyCents;
}

export interface BreakdownItem {
  movementId: string;
  concept: string;
  amountCents: MoneyCents;
}

export interface BoxResult {
  box: string;
  label: string;
  amountCents: MoneyCents;
  breakdown: BreakdownItem[];
  uncertain?: boolean;
  warning?: string;
  /** Página del formulario AEAT donde aparece la casilla. */
  page?: BoxPage;
  /** manual: la teclea el usuario · auto: la calcula la Sede · prefilled: la trae la AEAT. */
  entry?: BoxEntry;
  /** percent: `amountCents` expresa puntos básicos (10000 = 100 %). */
  unit?: 'money' | 'percent';
}

export type BoxPage = 'liquidacion' | 'resultado' | 'adicional';
export type BoxEntry = 'manual' | 'auto' | 'prefilled';

export interface Modelo130Input {
  fiscalYear: number;
  quarter: Quarter;
  activityStartDate?: string;
  movements: MovementLike[];
  /** Cuotas posted de inmovilizado (YTD hasta el trimestre). */
  amortizations?: AmortizationLike[];
  /** Positive payment results from previous quarters of the same year (from snapshots). */
  previousInstallmentsCents: MoneyCents;
  /** Manual adjustments (e.g. gastos difícil justificación) — marked uncertain if used. */
  manualAdjustments?: { box: string; amountCents: MoneyCents; note: string }[];
}

export interface Modelo130Result {
  meta: TaxRulesetMeta;
  boxes: Record<string, BoxResult>;
  resultCents: MoneyCents;
}

export interface Modelo303Input {
  fiscalYear: number;
  quarter: Quarter;
  movements: MovementLike[];
  /** Casilla 110: cuotas a compensar pendientes de periodos previos (positivo). */
  pendingFromPreviousCents?: MoneyCents;
}

export interface Modelo303Result {
  meta: TaxRulesetMeta;
  boxes: Record<string, BoxResult>;
  /** Casilla 71. */
  resultCents: MoneyCents;
  /** Pendiente de compensar para el siguiente periodo: 87 + |71| si 71 < 0. */
  carryForwardCents: MoneyCents;
}

export interface TaxRuleset {
  meta: TaxRulesetMeta;
  vatRatesBps: RateBps[];
  modelo130PaymentRateBps: RateBps;
  computeModelo130: (input: Modelo130Input) => Modelo130Result;
  computeModelo303: (input: Modelo303Input) => Modelo303Result;
  annualAmortization: (taxBaseCents: MoneyCents, coefficientBps: RateBps) => MoneyCents;
}
