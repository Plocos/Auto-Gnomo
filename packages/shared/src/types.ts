export const MovementTypes = [
  'income',
  'expense',
  'autonomo_fee',
  'grant',
  'amortization',
  'correction',
] as const;
export type MovementType = (typeof MovementTypes)[number];

export const MovementStatuses = [
  'draft',
  'confirmed',
  'locked',
  'corrected',
  'void',
] as const;
export type MovementStatus = (typeof MovementStatuses)[number];

export const ExpenseNatures = ['current', 'fixed_asset'] as const;
export type ExpenseNature = (typeof ExpenseNatures)[number];

export const VatTreatments = [
  'taxable',
  'exempt',
  'not_subject',
  'reverse_charge',
  'zero_rate',
  'other',
] as const;
export type VatTreatment = (typeof VatTreatments)[number];

export const MovementSources = [
  'manual',
  'import',
  'system_amortization',
  'system_accrual',
  'assistant',
] as const;
export type MovementSource = (typeof MovementSources)[number];

export const AssistantDocumentKinds = ['invoice', 'ticket'] as const;
export type AssistantDocumentKind = (typeof AssistantDocumentKinds)[number];

export const AssistantProposalStatuses = ['pending', 'accepted', 'discarded'] as const;
export type AssistantProposalStatus = (typeof AssistantProposalStatuses)[number];

export const DeductionOrigins = ['model', 'history'] as const;
export type DeductionOrigin = (typeof DeductionOrigins)[number];

export const AssistantProposalTypes = ['income', 'expense', 'autonomo_fee', 'grant'] as const;
export type AssistantProposalType = (typeof AssistantProposalTypes)[number];

export const Quarters = ['T1', 'T2', 'T3', 'T4'] as const;
export type Quarter = (typeof Quarters)[number];

export const QuarterStatuses = [
  'OPEN',
  'REVIEW',
  'READY_TO_FILE',
  'FILED',
  'AMENDED',
] as const;
export type QuarterStatus = (typeof QuarterStatuses)[number];

export const AlertSeverities = ['error', 'warning', 'info'] as const;
export type AlertSeverity = (typeof AlertSeverities)[number];

export const IvaRegimes = ['general', 'recargo', 'exento', 'ree'] as const;
export type IvaRegime = (typeof IvaRegimes)[number];

export const IrpfMethods = ['estimacion_directa_simplificada', 'estimacion_directa_normal'] as const;
export type IrpfMethod = (typeof IrpfMethods)[number];

export const TemporalCriteria = ['devengo', 'caja'] as const;
export type TemporalCriterion = (typeof TemporalCriteria)[number];

export function quarterFromDate(d: Date): Quarter {
  const m = d.getUTCMonth(); // 0-11
  if (m <= 2) return 'T1';
  if (m <= 5) return 'T2';
  if (m <= 8) return 'T3';
  return 'T4';
}

export function fiscalYearFromDate(d: Date): number {
  return d.getUTCFullYear();
}

export function quarterDateRange(year: number, quarter: Quarter): { from: Date; to: Date } {
  const startMonth = { T1: 0, T2: 3, T3: 6, T4: 9 }[quarter];
  const from = new Date(Date.UTC(year, startMonth, 1));
  const to = new Date(Date.UTC(year, startMonth + 3, 0, 23, 59, 59, 999));
  return { from, to };
}

export function ytdRange(year: number, quarter: Quarter, activityStart?: Date): { from: Date; to: Date } {
  const { to } = quarterDateRange(year, quarter);
  let from = new Date(Date.UTC(year, 0, 1));
  if (activityStart && activityStart > from) {
    from = new Date(
      Date.UTC(
        activityStart.getUTCFullYear(),
        activityStart.getUTCMonth(),
        activityStart.getUTCDate(),
      ),
    );
  }
  return { from, to };
}

export function parseISODateOnly(iso: string): Date {
  // Expect YYYY-MM-DD → UTC midnight
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) throw new Error(`Invalid date: ${iso}`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d));
}

export function formatISODateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
