/** Column shapes for SQLite rows (dates as ISO strings). */

export type TaxProfileRow = {
  id: string;
  fiscal_year: number;
  activity_start_date: string;
  nif: string;
  full_name: string;
  first_name: string;
  last_name: string;
  epigrafe: string;
  activity_code: string;
  activity_type: string;
  iva_regime: string;
  irpf_method: string;
  temporal_criterion: string;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PartyRow = {
  id: string;
  name: string;
  nif: string | null;
  created_at: string;
  updated_at: string;
};

export type CategoryRow = {
  id: string;
  key: string;
  name: string;
  type: string;
  system: number;
};

export type MovementRow = {
  id: string;
  type: string;
  invoice_date: string;
  fiscal_date: string;
  issue_date: string | null;
  due_date: string | null;
  settlement_date: string | null;
  fiscal_year: number;
  quarter: string;
  invoice_number: string | null;
  party_id: string | null;
  party_name: string | null;
  party_nif: string | null;
  concept: string;
  category_key: string | null;
  subcategory_key: string | null;
  tax_base_cents: number;
  vat_rate_bps: number;
  vat_cents: number;
  irpf_rate_bps: number;
  irpf_withheld_cents: number;
  total_cents: number;
  settled_cents: number | null;
  professional_use_bps: number;
  tax_deductible_bps: number;
  expense_nature: string;
  vat_treatment: string | null;
  status: string;
  source: string;
  notes: string | null;
  professional_justification: string | null;
  corrects_movement_id: string | null;
  correction_reason: string | null;
  asset_id: string | null;
  document_id: string | null;
  accrual_start_date: string | null;
  accrual_end_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetRow = {
  id: string;
  name: string;
  acquisition_date: string;
  in_service_date: string;
  tax_base_cents: number;
  coefficient_bps: number;
  method: string;
  movement_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AmortizationEntryRow = {
  id: string;
  asset_id: string;
  fiscal_year: number;
  quarter: string;
  fiscal_date: string | null;
  amount_cents: number;
  status: string;
  created_at: string;
};

export type AccrualScheduleRow = {
  id: string;
  source_movement_id: string;
  start_date: string;
  end_date: string;
  total_cents: number;
  allocations_json: string;
  created_at: string;
};

export type QuarterRow = {
  id: string;
  fiscal_year: number;
  quarter: string;
  status: string;
  filed_at: string | null;
  observations: string | null;
  amount_paid_cents: number | null;
  reopened_at: string | null;
  reopen_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type TaxReturnSnapshotRow = {
  id: string;
  fiscal_year: number;
  quarter: string;
  model: string;
  filed_at: string;
  filed_by: string | null;
  observations: string | null;
  amount_paid_cents: number | null;
  result_cents: number;
  boxes_json: string;
  rules_version: string | null;
  rules_meta_json: string | null;
  movements_included_json: string;
  immutable: number;
  reopened_at: string | null;
  extra_json: string | null;
  created_at: string;
};

export type AlertRow = {
  id: string;
  movement_id: string | null;
  code: string;
  severity: string;
  message: string;
  field: string | null;
  resolved: number;
  created_at: string;
};

export type AuditLogRow = {
  id: string;
  user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  created_at: string;
};

export type DocumentRow = {
  id: string;
  filename: string;
  path: string;
  mime_type: string | null;
  movement_id: string | null;
  created_at: string;
};

export type AppSettingsRow = {
  key: string;
  active_fiscal_year: number | null;
  working_quarter: string | null;
  data_json: string | null;
  updated_at: string;
};

export type SchemaMigrationRow = {
  id: string;
  applied_at: string;
};

/** Map snake_case movement row → API camelCase document. */
export function movementToDoc(row: MovementRow): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    invoiceDate: row.invoice_date,
    fiscalDate: row.fiscal_date,
    issueDate: row.issue_date ?? undefined,
    dueDate: row.due_date ?? undefined,
    settlementDate: row.settlement_date ?? undefined,
    fiscalYear: row.fiscal_year,
    quarter: row.quarter,
    invoiceNumber: row.invoice_number ?? undefined,
    partyId: row.party_id ?? undefined,
    partyName: row.party_name ?? undefined,
    partyNif: row.party_nif ?? undefined,
    concept: row.concept,
    categoryKey: row.category_key ?? undefined,
    subcategoryKey: row.subcategory_key ?? undefined,
    taxBaseCents: row.tax_base_cents,
    vatRateBps: row.vat_rate_bps,
    vatCents: row.vat_cents,
    irpfRateBps: row.irpf_rate_bps,
    irpfWithheldCents: row.irpf_withheld_cents,
    totalCents: row.total_cents,
    settledCents: row.settled_cents ?? undefined,
    professionalUseBps: row.professional_use_bps,
    taxDeductibleBps: row.tax_deductible_bps,
    expenseNature: row.expense_nature,
    vatTreatment: row.vat_treatment ?? undefined,
    status: row.status,
    source: row.source,
    notes: row.notes ?? undefined,
    professionalJustification: row.professional_justification ?? undefined,
    correctsMovementId: row.corrects_movement_id ?? undefined,
    correctionReason: row.correction_reason ?? undefined,
    assetId: row.asset_id ?? undefined,
    documentId: row.document_id ?? undefined,
    accrualStartDate: row.accrual_start_date ?? undefined,
    accrualEndDate: row.accrual_end_date ?? undefined,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}
