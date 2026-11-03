import {
  AppError,
  ErrorCodes,
  Quarters,
  type MovementCreateInput,
  type MovementQuery,
  type MovementUpdateInput,
  type QuarterStatus,
} from '@autonomous/shared';
import type { AppDb } from '../db/sqlite.js';
import {
  movementToDoc,
  newId,
  nowIso,
  type MovementRow,
  type PartyRow,
  type QuarterRow,
  type TaxProfileRow,
} from '../db/schema.js';
import { writeAudit } from './audit.js';
import {
  checkActivityStart,
  checkWorkingQuarterMismatch,
  isQuarterLocked,
  looksLikeNif,
  normalizeMovement,
  type ValidationIssue,
} from './validation.js';

export function getQuarterStatus(
  db: AppDb,
  fiscalYear: number,
  quarter: string,
): QuarterStatus {
  const q = db
    .prepare('SELECT status FROM quarters WHERE fiscal_year = ? AND quarter = ?')
    .get(fiscalYear, quarter) as Pick<QuarterRow, 'status'> | undefined;
  return (q?.status as QuarterStatus) ?? 'OPEN';
}

export function ensureQuartersForYear(db: AppDb, fiscalYear: number): void {
  const now = nowIso();
  for (const quarter of Quarters) {
    const existing = db
      .prepare('SELECT id FROM quarters WHERE fiscal_year = ? AND quarter = ?')
      .get(fiscalYear, quarter) as { id: string } | undefined;
    if (!existing) {
      db.prepare(
        `INSERT INTO quarters (id, fiscal_year, quarter, status, created_at, updated_at)
         VALUES (?, ?, ?, 'OPEN', ?, ?)`,
      ).run(newId(), fiscalYear, quarter, now, now);
    }
  }
}

function getTaxProfile(db: AppDb, fiscalYear: number) {
  return db
    .prepare('SELECT * FROM tax_profiles WHERE fiscal_year = ?')
    .get(fiscalYear) as TaxProfileRow | undefined;
}

function findDuplicate(
  db: AppDb,
  movement: {
    partyName?: string;
    invoiceNumber?: string;
    fiscalDate: string;
    totalCents: number;
    excludeId?: string;
  },
): boolean {
  if (!movement.invoiceNumber && !movement.partyName) return false;

  const d = new Date(movement.fiscalDate + 'T00:00:00.000Z');
  const before = new Date(d);
  before.setUTCDate(before.getUTCDate() - 1);
  const after = new Date(d);
  after.setUTCDate(after.getUTCDate() + 1);
  const from = before.toISOString().slice(0, 10);
  const to = after.toISOString().slice(0, 10);

  let sql = `SELECT id FROM movements WHERE total_cents = ? AND invoice_number IS ?
    AND fiscal_date >= ? AND fiscal_date <= ?`;
  const params: (string | number | null)[] = [
    movement.totalCents,
    movement.invoiceNumber ?? null,
    from,
    to,
  ];
  if (movement.partyName) {
    sql += ' AND party_name = ?';
    params.push(movement.partyName);
  }
  if (movement.excludeId) {
    sql += ' AND id != ?';
    params.push(movement.excludeId);
  }
  const found = db.prepare(sql).get(...params);
  return Boolean(found);
}

function upsertParty(
  db: AppDb,
  name: string,
  nif: string | null | undefined,
): string {
  const now = nowIso();
  const existing = db
    .prepare('SELECT * FROM parties WHERE name = ? AND IFNULL(nif, \'\') = IFNULL(?, \'\')')
    .get(name, nif ?? null) as PartyRow | undefined;
  if (existing) {
    db.prepare('UPDATE parties SET name = ?, nif = ?, updated_at = ? WHERE id = ?').run(
      name,
      nif ?? null,
      now,
      existing.id,
    );
    return existing.id;
  }
  const id = newId();
  db.prepare(
    'INSERT INTO parties (id, name, nif, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, name, nif ?? null, now, now);
  return id;
}

function insertMovementRow(
  db: AppDb,
  id: string,
  movement: ReturnType<typeof normalizeMovement>['movement'],
  partyId: string | null,
  createdBy: string | null,
): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO movements (
      id, type, invoice_date, fiscal_date, issue_date, due_date, settlement_date,
      fiscal_year, quarter, invoice_number, party_id, party_name, party_nif, concept,
      category_key, subcategory_key, tax_base_cents, vat_rate_bps, vat_cents,
      irpf_rate_bps, irpf_withheld_cents, total_cents, settled_cents,
      professional_use_bps, tax_deductible_bps, expense_nature, vat_treatment,
      status, source, notes, professional_justification, corrects_movement_id,
      correction_reason, asset_id, document_id, accrual_start_date, accrual_end_date,
      created_by, created_at, updated_at
    ) VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )`,
  ).run(
    id,
    movement.type,
    movement.invoiceDate,
    movement.fiscalDate,
    movement.issueDate ?? null,
    movement.dueDate ?? null,
    movement.settlementDate ?? null,
    movement.fiscalYear,
    movement.quarter,
    movement.invoiceNumber ?? null,
    partyId,
    movement.partyName ?? null,
    movement.partyNif ?? null,
    movement.concept,
    movement.categoryKey ?? null,
    movement.subcategoryKey ?? null,
    movement.taxBaseCents,
    movement.vatRateBps,
    movement.vatCents,
    movement.irpfRateBps,
    movement.irpfWithheldCents,
    movement.totalCents,
    movement.settledCents ?? null,
    movement.professionalUseBps,
    movement.taxDeductibleBps,
    movement.expenseNature,
    movement.vatTreatment ?? null,
    movement.status ?? 'confirmed',
    movement.source ?? 'manual',
    movement.notes ?? null,
    movement.professionalJustification ?? null,
    movement.correctsMovementId ?? null,
    movement.correctionReason ?? null,
    movement.assetId ?? null,
    movement.documentId ?? null,
    movement.accrualStartDate ?? null,
    movement.accrualEndDate ?? null,
    createdBy,
    now,
    now,
  );
}

export async function createMovement(
  db: AppDb,
  input: MovementCreateInput,
  opts: { userId?: string; workingQuarter?: string; allowCorrection?: boolean } = {},
): Promise<{ movement: Record<string, unknown>; issues: ValidationIssue[] }> {
  const { movement, issues } = normalizeMovement(input);
  ensureQuartersForYear(db, movement.fiscalYear);

  const profile = getTaxProfile(db, movement.fiscalYear);
  const activityIssue = checkActivityStart(
    movement.fiscalDate,
    profile?.activity_start_date,
  );
  if (activityIssue) issues.push(activityIssue);

  const mismatch = checkWorkingQuarterMismatch(
    movement.quarter,
    opts.workingQuarter as import('@autonomous/shared').Quarter | undefined,
  );
  if (mismatch) issues.push(mismatch);

  if (movement.partyNif && !looksLikeNif(movement.partyNif)) {
    issues.push({
      code: 'INVALID_NIF',
      severity: 'warning',
      field: 'partyNif',
      message: 'El NIF/CIF no tiene un formato reconocible.',
    });
  }

  const status = getQuarterStatus(db, movement.fiscalYear, movement.quarter);
  if (isQuarterLocked(status)) {
    if (!(opts.allowCorrection || movement.type === 'correction')) {
      throw new AppError(
        ErrorCodes.QUARTER_CLOSED,
        `El movimiento pertenece a un trimestre cerrado (${movement.quarter} ${movement.fiscalYear}). Cancela, crea una corrección o reabre el periodo explícitamente.`,
        409,
        { fiscalYear: movement.fiscalYear, quarter: movement.quarter, status },
      );
    }
  }

  if (findDuplicate(db, movement)) {
    issues.push({
      code: ErrorCodes.DUPLICATE_INVOICE,
      severity: 'warning',
      message: 'Posible factura duplicada (proveedor/nº/fecha/importe).',
    });
  }

  const critical = issues.filter((i) => i.severity === 'error');
  if (critical.length && movement.status !== 'draft') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, critical[0]!.message, 400, {
      issues,
    });
  }

  const id = newId();
  let partyId: string | null = null;
  if (movement.partyName) {
    partyId = upsertParty(db, movement.partyName, movement.partyNif);
  }

  insertMovementRow(db, id, movement, partyId, opts.userId ?? null);
  const now = nowIso();

  if (movement.type === 'correction' && movement.correctsMovementId) {
    db.prepare('UPDATE movements SET status = ?, updated_at = ? WHERE id = ?').run(
      'corrected',
      now,
      movement.correctsMovementId,
    );
    if (isQuarterLocked(status)) {
      db.prepare(
        'UPDATE quarters SET status = ?, updated_at = ? WHERE fiscal_year = ? AND quarter = ?',
      ).run('AMENDED', now, movement.fiscalYear, movement.quarter);
    }
  }

  persistAlerts(db, id, issues);
  writeAudit(db, {
    userId: opts.userId,
    action: 'create',
    entity: 'movement',
    entityId: id,
    after: { id, ...movement, partyId },
    reason: movement.correctionReason,
  });

  return { movement: { id, ...movement, partyId, createdAt: now, updatedAt: now }, issues };
}

export async function updateMovement(
  db: AppDb,
  id: string,
  input: MovementUpdateInput,
  opts: { userId?: string } = {},
): Promise<{ movement: Record<string, unknown>; issues: ValidationIssue[] }> {
  const existing = db.prepare('SELECT * FROM movements WHERE id = ?').get(id) as
    | MovementRow
    | undefined;
  if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Movimiento no encontrado', 404);

  if (existing.status === 'locked') {
    throw new AppError(
      ErrorCodes.LOCKED_MOVEMENT,
      'Movimiento bloqueado. Usa el flujo de corrección.',
      409,
    );
  }

  const status = getQuarterStatus(db, existing.fiscal_year, existing.quarter);
  if (isQuarterLocked(status)) {
    throw new AppError(
      ErrorCodes.QUARTER_CLOSED,
      'Este movimiento pertenece a un periodo cerrado. Crea una corrección o reabre el periodo.',
      409,
      { status },
    );
  }

  const merged = { ...movementToDoc(existing), ...input } as MovementCreateInput;
  const { movement, issues } = normalizeMovement(merged);

  const critical = issues.filter((i) => i.severity === 'error');
  if (critical.length && movement.status !== 'draft') {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, critical[0]!.message, 400, { issues });
  }

  const now = nowIso();
  db.prepare(
    `UPDATE movements SET
      type = ?, invoice_date = ?, fiscal_date = ?, issue_date = ?, due_date = ?, settlement_date = ?,
      fiscal_year = ?, quarter = ?, invoice_number = ?, party_name = ?, party_nif = ?, concept = ?,
      category_key = ?, subcategory_key = ?, tax_base_cents = ?, vat_rate_bps = ?, vat_cents = ?,
      irpf_rate_bps = ?, irpf_withheld_cents = ?, total_cents = ?, settled_cents = ?,
      professional_use_bps = ?, tax_deductible_bps = ?, expense_nature = ?, vat_treatment = ?,
      status = ?, source = ?, notes = ?, professional_justification = ?, corrects_movement_id = ?,
      correction_reason = ?, asset_id = ?, document_id = ?, accrual_start_date = ?, accrual_end_date = ?,
      updated_at = ?
     WHERE id = ?`,
  ).run(
    movement.type,
    movement.invoiceDate,
    movement.fiscalDate,
    movement.issueDate ?? null,
    movement.dueDate ?? null,
    movement.settlementDate ?? null,
    movement.fiscalYear,
    movement.quarter,
    movement.invoiceNumber ?? null,
    movement.partyName ?? null,
    movement.partyNif ?? null,
    movement.concept,
    movement.categoryKey ?? null,
    movement.subcategoryKey ?? null,
    movement.taxBaseCents,
    movement.vatRateBps,
    movement.vatCents,
    movement.irpfRateBps,
    movement.irpfWithheldCents,
    movement.totalCents,
    movement.settledCents ?? null,
    movement.professionalUseBps,
    movement.taxDeductibleBps,
    movement.expenseNature,
    movement.vatTreatment ?? null,
    movement.status ?? 'confirmed',
    movement.source ?? 'manual',
    movement.notes ?? null,
    movement.professionalJustification ?? null,
    movement.correctsMovementId ?? null,
    movement.correctionReason ?? null,
    movement.assetId ?? null,
    movement.documentId ?? null,
    movement.accrualStartDate ?? null,
    movement.accrualEndDate ?? null,
    now,
    id,
  );

  persistAlerts(db, id, issues);
  writeAudit(db, {
    userId: opts.userId,
    action: 'update',
    entity: 'movement',
    entityId: id,
    before: movementToDoc(existing),
    after: movement,
  });

  return { movement: { id, ...movement }, issues };
}

export async function linkMovementToAsset(
  db: AppDb,
  movementId: string,
  assetId: string | null,
  opts: { userId?: string } = {},
): Promise<{ movement: Record<string, unknown>; issues: ValidationIssue[] }> {
  const existing = db.prepare('SELECT * FROM movements WHERE id = ?').get(movementId) as
    | MovementRow
    | undefined;
  if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Movimiento no encontrado', 404);

  if (assetId) {
    const asset = db.prepare('SELECT id FROM assets WHERE id = ?').get(assetId);
    if (!asset) throw new AppError(ErrorCodes.NOT_FOUND, 'Activo no encontrado', 404);
  }

  const merged = {
    ...movementToDoc(existing),
    assetId: assetId ?? undefined,
    expenseNature: existing.expense_nature ?? 'fixed_asset',
  } as unknown as MovementCreateInput;
  const { movement, issues } = normalizeMovement(merged);
  const now = nowIso();

  db.prepare(
    'UPDATE movements SET asset_id = ?, expense_nature = ?, updated_at = ? WHERE id = ?',
  ).run(assetId, movement.expenseNature, now, movementId);

  persistAlerts(db, movementId, issues);
  writeAudit(db, {
    userId: opts.userId,
    action: 'link_asset',
    entity: 'movement',
    entityId: movementId,
    before: { assetId: existing.asset_id },
    after: { assetId },
  });

  return {
    movement: { id: movementId, ...movementToDoc(existing), assetId, ...movement },
    issues,
  };
}

export async function deleteMovement(
  db: AppDb,
  id: string,
  opts: { userId?: string } = {},
): Promise<void> {
  const existing = db.prepare('SELECT * FROM movements WHERE id = ?').get(id) as
    | MovementRow
    | undefined;
  if (!existing) throw new AppError(ErrorCodes.NOT_FOUND, 'Movimiento no encontrado', 404);

  const status = getQuarterStatus(db, existing.fiscal_year, existing.quarter);
  if (isQuarterLocked(status) || existing.status === 'locked') {
    throw new AppError(
      ErrorCodes.QUARTER_CLOSED,
      'No se puede eliminar un movimiento de un periodo cerrado.',
      409,
    );
  }

  db.prepare('DELETE FROM movements WHERE id = ?').run(id);
  db.prepare('DELETE FROM alerts WHERE movement_id = ?').run(id);
  writeAudit(db, {
    userId: opts.userId,
    action: 'delete',
    entity: 'movement',
    entityId: id,
    before: movementToDoc(existing),
  });
}

const SORTABLE: Record<string, string> = {
  fiscalDate: 'fiscal_date',
  invoiceDate: 'invoice_date',
  concept: 'concept',
  totalCents: 'total_cents',
  taxBaseCents: 'tax_base_cents',
  type: 'type',
  status: 'status',
  quarter: 'quarter',
  createdAt: 'created_at',
};

export async function listMovements(db: AppDb, query: MovementQuery) {
  const where: string[] = [];
  const params: (string | number | null)[] = [];

  if (query.fiscalYear) {
    where.push('fiscal_year = ?');
    params.push(query.fiscalYear);
  }
  if (query.quarter) {
    where.push('quarter = ?');
    params.push(query.quarter);
  }
  if (query.type) {
    where.push('type = ?');
    params.push(query.type);
  } else {
    where.push("type != 'amortization'");
  }
  if (query.status) {
    where.push('status = ?');
    params.push(query.status);
  }
  if (query.categoryKey) {
    where.push('category_key = ?');
    params.push(query.categoryKey);
  }
  if (query.search) {
    where.push('(concept LIKE ? OR party_name LIKE ? OR invoice_number LIKE ?)');
    const s = `%${query.search}%`;
    params.push(s, s, s);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sortCol = SORTABLE[query.sortBy] ?? 'fiscal_date';
  const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM movements ${whereSql}`).get(...params) as {
      c: number;
    }
  ).c;

  const items = db
    .prepare(
      `SELECT * FROM movements ${whereSql} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as MovementRow[];

  return {
    total,
    page: query.page,
    pageSize: query.pageSize,
    items: items.map(movementToDoc),
  };
}

function persistAlerts(db: AppDb, movementId: string, issues: ValidationIssue[]): void {
  db.prepare('DELETE FROM alerts WHERE movement_id = ?').run(movementId);
  if (!issues.length) return;
  const stmt = db.prepare(
    `INSERT INTO alerts (id, movement_id, code, severity, message, field, resolved, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
  );
  const created = nowIso();
  for (const i of issues) {
    stmt.run(newId(), movementId, i.code, i.severity, i.message, i.field ?? null, created);
  }
}
