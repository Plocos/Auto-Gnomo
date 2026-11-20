import {
  amountsAgree,
  computeIrpfWithholding,
  computeTotal,
  computeVat,
  eurosToCents,
  percentToBps,
  type AssistantProposal,
  type AssistantProposalType,
  type VatTreatment,
} from '@autonomous/shared';
import { randomUUID } from 'node:crypto';

const VAT_SNAP = [0, 400, 1000, 2100];

const FIELD_LABELS: Record<string, string> = {
  concept: 'concepto',
  taxBaseCents: 'base imponible',
  invoiceDate: 'fecha',
  fiscalDate: 'fecha fiscal',
  vatRateBps: 'IVA',
  coefficientBps: 'coeficiente de amortización',
};

export type SourceFileMeta = {
  id: string;
  filename: string;
  truncated?: boolean;
};

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const body = (fenced?.[1] ?? trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('La respuesta no contiene JSON.');
  }
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    throw new Error('La respuesta no es un JSON válido.');
  }
}

export function normalizePartyName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeNif(nif: string): string {
  return nif.replace(/[\s-]/g, '').toUpperCase();
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function asType(value: unknown): AssistantProposalType {
  const v = String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (v === 'income' || v === 'ingreso' || v.includes('emitid')) return 'income';
  if (v === 'autonomo_fee' || v.includes('autonomo') || v.includes('cuota')) return 'autonomo_fee';
  if (v === 'grant' || v.includes('subvencion') || v.includes('ayuda')) return 'grant';
  return 'expense';
}

function asKind(value: unknown, invoiceNumber: string | undefined, type: AssistantProposalType): 'invoice' | 'ticket' {
  if (type === 'income' || type === 'grant') return 'invoice';
  const v = String(value ?? '').toLowerCase();
  if (v === 'ticket' || v === 'recibo' || v.includes('gasto')) return 'ticket';
  if (v === 'invoice' || v.includes('factura')) return 'invoice';
  return invoiceNumber ? 'invoice' : 'ticket';
}

export function asDate(value: unknown): string | undefined {
  const s = asString(value);
  if (!s) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso?.[1] && iso[2] && iso[3]) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const es = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/.exec(s);
  if (!es?.[1] || !es[2] || !es[3]) return undefined;
  const day = es[1].padStart(2, '0');
  const month = es[2].padStart(2, '0');
  return `${es[3]}-${month}-${day}`;
}

export function asEurosToCents(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return eurosToCents(value);
  const raw = asString(value);
  if (!raw) return undefined;
  let s = raw.replace(/€/g, '').replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  return eurosToCents(n);
}

function asPercentBps(value: unknown, snapVat = false): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return snap(percentOrBps(value), snapVat);
  const raw = asString(value);
  if (!raw) return undefined;
  const n = Number(raw.replace('%', '').replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  return snap(percentOrBps(n), snapVat);
}

function percentOrBps(n: number): number {
  if (n > 100 && n <= 10_000 && Number.isInteger(n)) return n;
  return percentToBps(n);
}

function snap(bps: number, snapVat: boolean): number | undefined {
  if (bps < 0 || bps > 100_000) return undefined;
  if (!snapVat) return Math.min(bps, 10_000);
  for (const standard of VAT_SNAP) {
    if (Math.abs(bps - standard) <= 50) return standard;
  }
  return bps;
}

function asNature(value: unknown): 'current' | 'fixed_asset' {
  const v = String(value ?? '').toLowerCase();
  if (v === 'fixed_asset' || v.includes('inmov') || v.includes('inversion')) return 'fixed_asset';
  return 'current';
}

function asTreatment(value: unknown): VatTreatment | undefined {
  const v = String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\s-]+/g, '_');
  const map: Record<string, VatTreatment> = {
    exempt: 'exempt',
    exento: 'exempt',
    not_subject: 'not_subject',
    no_sujeto: 'not_subject',
    nosujeto: 'not_subject',
    reverse_charge: 'reverse_charge',
    inversion_sujeto_pasivo: 'reverse_charge',
    inversion: 'reverse_charge',
    isp: 'reverse_charge',
    zero_rate: 'zero_rate',
    tipo_cero: 'zero_rate',
    tipo_0: 'zero_rate',
    other: 'other',
    otro: 'other',
    taxable: 'taxable',
  };
  return map[v];
}

function asConfidence(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) out[key] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

function baseFromTotal(totalCents: number, vatBps: number, irpfBps: number): number | undefined {
  const denom = 10_000 + vatBps - irpfBps;
  if (denom <= 0) return undefined;
  return Math.round((totalCents * 10_000) / denom);
}

function matchFile(sourceFile: string | undefined, files: SourceFileMeta[]): SourceFileMeta | undefined {
  if (files.length === 1) return files[0];
  if (!sourceFile) return undefined;
  const wanted = sourceFile.toLowerCase();
  return files.find((file) => file.filename.toLowerCase() === wanted)
    ?? files.find((file) => wanted.includes(file.filename.toLowerCase()) || file.filename.toLowerCase().includes(wanted));
}

function readEnvelope(value: unknown): { summary: string; items: unknown[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('El JSON no es un objeto.');
  }
  const obj = value as Record<string, unknown>;
  const summary = typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 500) : '';
  if (Array.isArray(obj.proposals)) return { summary, items: obj.proposals };
  if (obj.type || obj.concept || obj.taxBaseEuros || obj.partyName) return { summary, items: [obj] };
  return { summary, items: [] };
}

export function normalizeModelOutput(
  value: unknown,
  opts: {
    files?: SourceFileMeta[];
    temporalCriterion?: 'devengo' | 'caja';
  } = {},
): { summary: string; proposals: AssistantProposal[] } {
  const { summary, items } = readEnvelope(value);
  const files = opts.files ?? [];
  const proposals = items
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((item) => toProposal(item, files, opts.temporalCriterion ?? 'devengo'));
  return { summary, proposals };
}

function toProposal(
  item: Record<string, unknown>,
  files: SourceFileMeta[],
  temporalCriterion: 'devengo' | 'caja',
): AssistantProposal {
  const warnings: string[] = [];
  const missingFields: string[] = [];
  const invoiceNumber = asString(item.invoiceNumber)?.slice(0, 100);
  const type = asType(item.type);
  const documentKind = asKind(item.documentKind, invoiceNumber, type);
  const invoiceDate = asDate(item.invoiceDate);
  const settlementDate = asDate(item.settlementDate);
  let fiscalDate = asDate(item.fiscalDate);
  if (!fiscalDate && temporalCriterion === 'caja' && settlementDate) fiscalDate = settlementDate;
  if (!fiscalDate) fiscalDate = invoiceDate;

  let taxBaseCents = asEurosToCents(item.taxBaseEuros ?? item.taxBaseCents);
  const vatRateBps = asPercentBps(item.vatRatePercent ?? item.vatRateBps, true);
  const irpfRateBps = asPercentBps(item.irpfRatePercent ?? item.irpfRateBps) ?? 0;
  const documentTotalCents = asEurosToCents(item.documentTotalEuros ?? item.totalEuros ?? item.totalCents);
  const usedVat = vatRateBps ?? 0;

  if (taxBaseCents == null && documentTotalCents != null) {
    taxBaseCents = baseFromTotal(documentTotalCents, usedVat, irpfRateBps);
  }

  if (item.vatRatePercent == null && item.vatRateBps == null && type !== 'autonomo_fee') {
    missingFields.push('vatRateBps');
    warnings.push('No se leyó el IVA; se dejó en 0% para que lo confirmes.');
  }

  const vatCents = taxBaseCents == null ? undefined : computeVat(taxBaseCents, usedVat);
  const irpfWithheldCents = taxBaseCents == null ? undefined : computeIrpfWithholding(taxBaseCents, irpfRateBps);
  const totalCents =
    taxBaseCents == null || vatCents == null || irpfWithheldCents == null
      ? undefined
      : computeTotal(taxBaseCents, vatCents, irpfWithheldCents);
  const totalMismatch =
    totalCents != null && documentTotalCents != null && !amountsAgree(totalCents, documentTotalCents, 2);

  if (totalMismatch && documentTotalCents != null) {
    warnings.push(
      `El total del documento (${(documentTotalCents / 100).toFixed(2)} €) no cuadra con base + IVA − IRPF (${((totalCents ?? 0) / 100).toFixed(2)} €).`,
    );
  }

  if (!asString(item.concept)) missingFields.push('concept');
  if (taxBaseCents == null) missingFields.push('taxBaseCents');
  if (!invoiceDate) missingFields.push('invoiceDate');
  if (!fiscalDate) missingFields.push('fiscalDate');

  const expenseNature = type === 'income' || type === 'grant' ? 'current' : asNature(item.expenseNature);
  const coefficientBps = asPercentBps(item.coefficientPercent ?? item.coefficientBps);
  if (expenseNature === 'fixed_asset' && (coefficientBps == null || coefficientBps <= 0)) {
    missingFields.push('coefficientBps');
    warnings.push('Parece un bien de inversión. Indica el coeficiente de amortización antes de aceptar.');
  }

  const file = matchFile(asString(item.sourceFile), files);
  if (file?.truncated) {
    warnings.push('Solo se leyeron las 3 primeras páginas de este documento.');
  }

  const partyNif = asString(item.partyNif)?.replace(/\s/g, '').toUpperCase().slice(0, 20);
  const evidence = asString(item.evidence)?.slice(0, 400);

  return {
    id: randomUUID(),
    status: 'pending',
    documentKind: documentKind === 'ticket' ? 'ticket' : 'invoice',
    type,
    invoiceDate,
    fiscalDate,
    dueDate: asDate(item.dueDate),
    settlementDate,
    invoiceNumber,
    partyName: asString(item.partyName)?.slice(0, 200),
    partyNif,
    concept: asString(item.concept)?.slice(0, 500),
    categoryKey: asString(item.categoryKey)?.slice(0, 80),
    taxBaseCents,
    vatRateBps: usedVat,
    vatCents,
    irpfRateBps,
    irpfWithheldCents,
    totalCents,
    documentTotalCents,
    totalMismatch,
    professionalUseBps: asPercentBps(item.professionalUsePercent ?? item.professionalUseBps) ?? 10_000,
    taxDeductibleBps: asPercentBps(item.taxDeductiblePercent ?? item.taxDeductibleBps) ?? 10_000,
    deductionOrigin: 'model',
    expenseNature,
    vatTreatment: asTreatment(item.vatTreatment),
    coefficientBps,
    inServiceDate: asDate(item.inServiceDate) ?? (expenseNature === 'fixed_asset' ? fiscalDate : undefined),
    notes: asString(item.notes)?.slice(0, 2000),
    evidence,
    confidence: asConfidence(item.confidence),
    missingFields,
    warnings,
    fileId: file?.id,
    pagesTruncated: file?.truncated,
  };
}

export function constrainCategory(proposal: AssistantProposal, keys: Set<string>): AssistantProposal {
  if (!proposal.categoryKey || keys.size === 0 || keys.has(proposal.categoryKey)) return proposal;
  const dropped = proposal.categoryKey;
  return {
    ...proposal,
    categoryKey: undefined,
    warnings: [
      ...(proposal.warnings ?? []),
      `La categoría «${dropped}» no está en tus categorías y se dejó vacía.`,
    ],
  };
}

export function missingFieldLabels(fields: string[] | undefined): string[] {
  return (fields ?? []).map((field) => FIELD_LABELS[field] ?? field);
}
