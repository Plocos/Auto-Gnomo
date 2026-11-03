import {
  amountsAgree,
  applyRate,
  computeIrpfWithholding,
  computeTotal,
  computeVat,
  ErrorCodes,
  fiscalYearFromDate,
  parseISODateOnly,
  quarterFromDate,
  type AlertSeverity,
  type MovementCreateInput,
  type Quarter,
  type QuarterStatus,
} from '@autonomous/shared';

export interface ValidationIssue {
  code: string;
  severity: AlertSeverity;
  message: string;
  field?: string;
}

export interface NormalizedMovement {
  type: MovementCreateInput['type'];
  invoiceDate: string;
  fiscalDate: string;
  issueDate?: string;
  dueDate?: string;
  settlementDate?: string;
  invoiceNumber?: string;
  partyName?: string;
  partyNif?: string;
  concept: string;
  categoryKey?: string;
  subcategoryKey?: string;
  taxBaseCents: number;
  vatRateBps: number;
  vatCents: number;
  irpfRateBps: number;
  irpfWithheldCents: number;
  totalCents: number;
  settledCents?: number;
  professionalUseBps: number;
  taxDeductibleBps: number;
  expenseNature: 'current' | 'fixed_asset';
  vatTreatment?: MovementCreateInput['vatTreatment'];
  status: MovementCreateInput['status'];
  source: MovementCreateInput['source'];
  notes?: string;
  professionalJustification?: string;
  correctsMovementId?: string;
  correctionReason?: string;
  assetId?: string;
  documentId?: string;
  accrualStartDate?: string;
  accrualEndDate?: string;
  fiscalYear: number;
  quarter: Quarter;
}

export function normalizeMovement(input: MovementCreateInput): {
  movement: NormalizedMovement;
  issues: ValidationIssue[];
} {
  const issues: ValidationIssue[] = [];
  const fiscalDate = parseISODateOnly(input.fiscalDate);
  const fiscalYear = fiscalYearFromDate(fiscalDate);
  const quarter = quarterFromDate(fiscalDate);

  const vatRateBps = input.vatRateBps ?? 0;
  const irpfRateBps = input.irpfRateBps ?? 0;
  const expectedVat = computeVat(input.taxBaseCents, vatRateBps);
  const vatCents = input.vatCents ?? expectedVat;
  const expectedIrpf = computeIrpfWithholding(input.taxBaseCents, irpfRateBps);
  const irpfWithheldCents = input.irpfWithheldCents ?? expectedIrpf;
  const expectedTotal = computeTotal(input.taxBaseCents, vatCents, irpfWithheldCents);
  const totalCents = input.totalCents ?? expectedTotal;

  if (!amountsAgree(vatCents, expectedVat)) {
    issues.push({
      code: ErrorCodes.INVALID_VAT,
      severity: 'error',
      field: 'vatCents',
      message: `IVA incorrecto: esperado ${expectedVat} céntimos (base × ${vatRateBps / 100}%), recibido ${vatCents}.`,
    });
  }

  if (irpfRateBps > 0 && !amountsAgree(irpfWithheldCents, expectedIrpf)) {
    issues.push({
      code: ErrorCodes.INVALID_IRPF,
      severity: 'error',
      field: 'irpfWithheldCents',
      message: `Retención IRPF incoherente: esperado ${expectedIrpf} céntimos.`,
    });
  }

  if (!amountsAgree(totalCents, expectedTotal)) {
    issues.push({
      code: ErrorCodes.INVALID_TOTAL,
      severity: 'error',
      field: 'totalCents',
      message: `Total incorrecto: esperado base + IVA − IRPF = ${expectedTotal} céntimos.`,
    });
  }

  if (vatRateBps === 0 && vatCents === 0 && !input.vatTreatment && input.type !== 'autonomo_fee') {
    issues.push({
      code: ErrorCodes.VAT_ZERO_NEEDS_TREATMENT,
      severity: 'warning',
      field: 'vatTreatment',
      message:
        'IVA 0%: indica motivo (exento, no sujeto, inversión del sujeto pasivo, tipo 0 u otro).',
    });
  }

  const professionalUseBps = input.professionalUseBps ?? 10_000;
  const taxDeductibleBps = input.taxDeductibleBps ?? 10_000;
  if (
    professionalUseBps < 0 ||
    professionalUseBps > 10_000 ||
    taxDeductibleBps < 0 ||
    taxDeductibleBps > 10_000
  ) {
    issues.push({
      code: ErrorCodes.VALIDATION_ERROR,
      severity: 'error',
      message: 'Porcentajes de uso profesional / deducible fuera de 0–100%.',
    });
  }

  if (input.type === 'autonomo_fee' && vatRateBps !== 0) {
    issues.push({
      code: ErrorCodes.VALIDATION_ERROR,
      severity: 'warning',
      field: 'vatRateBps',
      message: 'La cuota de autónomo normalmente no lleva IVA.',
    });
  }

  if (input.type === 'grant') {
    const expectedNet = input.taxBaseCents - irpfWithheldCents;
    if (input.settledCents !== undefined && !amountsAgree(input.settledCents, expectedNet)) {
      issues.push({
        code: ErrorCodes.VALIDATION_ERROR,
        severity: 'warning',
        field: 'settledCents',
        message: 'En ayudas, neto cobrado debería ser bruto − retención IRPF.',
      });
    }
  }

  if (input.type === 'correction' && !input.correctionReason) {
    issues.push({
      code: ErrorCodes.VALIDATION_ERROR,
      severity: 'error',
      field: 'correctionReason',
      message: 'Una corrección requiere motivo.',
    });
  }

  if (
    input.expenseNature === 'fixed_asset' &&
    !input.assetId &&
    input.coefficientBps == null
  ) {
    issues.push({
      code: 'FIXED_ASSET_NO_LINK',
      severity: 'warning',
      message: 'Gasto de inmovilizado sin activo vinculado.',
    });
  }

  if (input.accrualStartDate && input.accrualEndDate) {
    if (input.accrualEndDate.slice(0, 4) !== input.accrualStartDate.slice(0, 4)) {
      issues.push({
        code: 'ACCRUAL_CROSS_YEAR',
        severity: 'info',
        message: 'El periodo de periodificación atraviesa ejercicios; se generará calendario.',
      });
    }
  }

  const movement: NormalizedMovement = {
    type: input.type,
    invoiceDate: input.invoiceDate,
    fiscalDate: input.fiscalDate,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    settlementDate: input.settlementDate,
    invoiceNumber: input.invoiceNumber,
    partyName: input.partyName,
    partyNif: input.partyNif,
    concept: input.concept,
    categoryKey: input.categoryKey,
    subcategoryKey: input.subcategoryKey,
    taxBaseCents: input.taxBaseCents,
    vatRateBps,
    vatCents,
    irpfRateBps,
    irpfWithheldCents,
    totalCents,
    settledCents: input.settledCents,
    professionalUseBps: input.professionalUseBps ?? 10_000,
    taxDeductibleBps: input.taxDeductibleBps ?? 10_000,
    expenseNature: input.expenseNature ?? 'current',
    vatTreatment: input.vatTreatment,
    status: input.status ?? 'confirmed',
    source: input.source ?? 'manual',
    notes: input.notes,
    professionalJustification: input.professionalJustification,
    correctsMovementId: input.correctsMovementId,
    correctionReason: input.correctionReason,
    assetId: input.assetId,
    documentId: input.documentId,
    accrualStartDate: input.accrualStartDate,
    accrualEndDate: input.accrualEndDate,
    fiscalYear,
    quarter,
  };

  return { movement, issues };
}

export function checkActivityStart(
  fiscalDate: string,
  activityStartDate: string | undefined,
): ValidationIssue | null {
  if (!activityStartDate) return null;
  if (fiscalDate < activityStartDate) {
    return {
      code: ErrorCodes.BEFORE_ACTIVITY_START,
      severity: 'warning',
      field: 'fiscalDate',
      message: `La fecha de esta operación (${fiscalDate}) es anterior al inicio de actividad configurado (${activityStartDate}). Revisa que sea correcto.`,
    };
  }
  return null;
}

export function checkWorkingQuarterMismatch(
  fiscalQuarter: Quarter,
  workingQuarter: Quarter | undefined,
): ValidationIssue | null {
  if (!workingQuarter) return null;
  if (fiscalQuarter !== workingQuarter) {
    return {
      code: 'QUARTER_MISMATCH',
      severity: 'warning',
      field: 'fiscalDate',
      message: `Esta operación corresponde a ${fiscalQuarter}, no al trimestre de trabajo ${workingQuarter}.`,
    };
  }
  return null;
}

export function isQuarterLocked(status: QuarterStatus): boolean {
  return status === 'FILED' || status === 'AMENDED';
}

/** Simple Spanish NIF/CIF format check (not full checksum). */
export function looksLikeNif(nif: string): boolean {
  return /^[0-9A-Z][\dA-Z]{7,10}$/i.test(nif.replace(/[\s-]/g, ''));
}

export function expectedVatCents(base: number, rateBps: number): number {
  return applyRate(base, rateBps);
}
