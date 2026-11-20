import type { AssistantProposal, MovementCreateInput } from '@autonomous/shared';
import type { AppDb } from '../db/sqlite.js';
import { getQuarterStatus, movementMayBeDuplicate } from '../domain/movements.js';
import { isQuarterLocked, normalizeMovement } from '../domain/validation.js';

export function proposalToMovementInput(proposal: AssistantProposal): MovementCreateInput | null {
  if (!proposal.concept || !proposal.invoiceDate || !proposal.fiscalDate || proposal.taxBaseCents == null) {
    return null;
  }
  return {
    type: proposal.type,
    invoiceDate: proposal.invoiceDate,
    fiscalDate: proposal.fiscalDate,
    dueDate: proposal.dueDate,
    settlementDate: proposal.settlementDate,
    invoiceNumber: proposal.invoiceNumber,
    partyName: proposal.partyName,
    partyNif: proposal.partyNif,
    concept: proposal.concept,
    categoryKey: proposal.categoryKey,
    taxBaseCents: proposal.taxBaseCents,
    vatRateBps: proposal.vatRateBps ?? 0,
    vatCents: proposal.vatCents,
    irpfRateBps: proposal.irpfRateBps ?? 0,
    irpfWithheldCents: proposal.irpfWithheldCents,
    totalCents: proposal.totalCents,
    professionalUseBps: proposal.professionalUseBps ?? 10_000,
    taxDeductibleBps: proposal.taxDeductibleBps ?? 10_000,
    expenseNature: proposal.expenseNature ?? 'current',
    vatTreatment: proposal.vatTreatment,
    coefficientBps: proposal.coefficientBps,
    inServiceDate: proposal.inServiceDate,
    notes: proposal.notes,
    status: 'confirmed',
    source: 'assistant',
  };
}

export function reviewProposal(
  db: AppDb,
  proposal: AssistantProposal,
  workingQuarter?: string,
): AssistantProposal {
  const input = proposalToMovementInput(proposal);
  if (!input) return proposal;

  const warnings = [...(proposal.warnings ?? [])];
  const issues: { code: string; severity: 'error' | 'warning' | 'info'; message: string; field?: string }[] = (
    proposal.issues ?? []
  ).map((issue) => ({
    code: issue.code ?? 'ASSISTANT',
    severity: issue.severity,
    message: issue.message,
    field: issue.field,
  }));
  const { movement, issues: normalized } = normalizeMovement(input);
  for (const issue of normalized) {
    issues.push(issue);
    if (!warnings.includes(issue.message)) warnings.push(issue.message);
  }

  const quarterStatus = getQuarterStatus(db, movement.fiscalYear, movement.quarter);
  if (isQuarterLocked(quarterStatus)) {
    const message = `El trimestre ${movement.quarter} ${movement.fiscalYear} está cerrado. No se puede guardar hasta reabrirlo.`;
    issues.push({ code: 'QUARTER_CLOSED', severity: 'error', message, field: 'fiscalDate' });
    if (!warnings.includes(message)) warnings.push(message);
  } else if (workingQuarter && workingQuarter !== movement.quarter) {
    const message = `Esta operación cae en ${movement.quarter}, no en el trimestre de trabajo ${workingQuarter}.`;
    issues.push({ code: 'QUARTER_MISMATCH', severity: 'warning', message, field: 'fiscalDate' });
    if (!warnings.includes(message)) warnings.push(message);
  }

  if (
    movementMayBeDuplicate(db, {
      partyName: movement.partyName,
      invoiceNumber: movement.invoiceNumber,
      fiscalDate: movement.fiscalDate,
      totalCents: movement.totalCents,
    })
  ) {
    const message = 'Posible factura duplicada (proveedor, número, fecha e importe).';
    issues.push({ code: 'DUPLICATE_INVOICE', severity: 'warning', message });
    if (!warnings.includes(message)) warnings.push(message);
  }

  return { ...proposal, warnings, issues };
}
