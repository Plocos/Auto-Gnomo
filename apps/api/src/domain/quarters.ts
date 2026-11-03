import {
  AppError,
  ErrorCodes,
  Quarters,
  TaxModels,
  type FileModelInput,
  type FileQuarterInput,
  type Quarter,
  type QuarterStatus,
  type ReopenModelInput,
  type TaxModel,
} from '@autonomous/shared';
import { getTaxRules, type MovementLike } from '@autonomous/tax-rules';
import type { AppDb } from '../db/sqlite.js';
import {
  movementToDoc,
  newId,
  nowIso,
  type MovementRow,
  type QuarterRow,
  type TaxProfileRow,
  type TaxReturnSnapshotRow,
} from '../db/schema.js';
import { writeAudit } from './audit.js';
import { loadAmortizationEntriesYtd } from './assets.js';
import { ensureQuartersForYear, getQuarterStatus } from './movements.js';

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

function syncWorkingQuarter(db: AppDb, fiscalYear: number): Quarter {
  const items = listQuarters(db, fiscalYear);
  const next = nextActionableQuarter(items);
  const now = nowIso();
  const existing = db.prepare(`SELECT key FROM app_settings WHERE key = 'main'`).get();
  if (existing) {
    db.prepare(`UPDATE app_settings SET working_quarter = ?, updated_at = ? WHERE key = 'main'`).run(
      next,
      now,
    );
  } else {
    db.prepare(
      `INSERT INTO app_settings (key, active_fiscal_year, working_quarter, updated_at)
       VALUES ('main', ?, ?, ?)`,
    ).run(fiscalYear, next, now);
  }
  return next;
}

function toMovementLike(doc: Record<string, unknown>): MovementLike {
  return {
    id: String(doc.id),
    type: String(doc.type),
    fiscalDate: String(doc.fiscalDate),
    fiscalYear: Number(doc.fiscalYear),
    quarter: doc.quarter as Quarter,
    taxBaseCents: Number(doc.taxBaseCents),
    vatRateBps: Number(doc.vatRateBps),
    vatCents: Number(doc.vatCents),
    irpfRateBps: Number(doc.irpfRateBps),
    irpfWithheldCents: Number(doc.irpfWithheldCents),
    totalCents: Number(doc.totalCents),
    professionalUseBps: Number(doc.professionalUseBps ?? 10_000),
    taxDeductibleBps: Number(doc.taxDeductibleBps ?? 10_000),
    vatTreatment: doc.vatTreatment as string | undefined,
    status: String(doc.status),
    concept: String(doc.concept),
    expenseNature: doc.expenseNature as string | undefined,
  };
}

function migrateLegacyQuarterStatuses(db: AppDb, fiscalYear: number) {
  db.prepare(
    `UPDATE quarters SET status = 'OPEN', updated_at = ?
     WHERE fiscal_year = ? AND status IN ('REVIEW', 'READY_TO_FILE')`,
  ).run(nowIso(), fiscalYear);
}

export function listQuarters(db: AppDb, fiscalYear: number) {
  ensureQuartersForYear(db, fiscalYear);
  migrateLegacyQuarterStatuses(db, fiscalYear);
  const items = db
    .prepare('SELECT * FROM quarters WHERE fiscal_year = ? ORDER BY quarter ASC')
    .all(fiscalYear) as QuarterRow[];
  const filed = db
    .prepare(
      `SELECT quarter, model, filed_at FROM tax_return_snapshots
       WHERE fiscal_year = ? AND reopened_at IS NULL ORDER BY created_at ASC`,
    )
    .all(fiscalYear) as Pick<TaxReturnSnapshotRow, 'quarter' | 'model' | 'filed_at'>[];
  const filedAt = new Map(filed.map((s) => [`${s.quarter}-${s.model}`, s.filed_at]));
  return items.map((q) => ({
    id: q.id,
    fiscalYear: q.fiscal_year,
    quarter: q.quarter,
    status: q.status,
    filedAt: q.filed_at ?? undefined,
    filed130At: filedAt.get(`${q.quarter}-130`),
    filed303At: filedAt.get(`${q.quarter}-303`),
    observations: q.observations ?? undefined,
    updatedAt: q.updated_at,
  }));
}

export async function setQuarterStatus(
  db: AppDb,
  fiscalYear: number,
  quarter: Quarter,
  status: QuarterStatus,
  userId?: string,
) {
  ensureQuartersForYear(db, fiscalYear);
  if (status === 'REVIEW' || status === 'READY_TO_FILE') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Estado no soportado. Usa presentar o reabrir.',
      400,
    );
  }
  if (status === 'FILED') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Para marcar como presentado usa el flujo de presentación.',
      400,
    );
  }
  const current = getQuarterStatus(db, fiscalYear, quarter);
  if ((current === 'FILED' || current === 'AMENDED') && status !== 'AMENDED') {
    throw new AppError(
      ErrorCodes.QUARTER_CLOSED,
      'Trimestre presentado: usa reapertura o correcciones.',
      409,
    );
  }
  db.prepare(
    'UPDATE quarters SET status = ?, updated_at = ? WHERE fiscal_year = ? AND quarter = ?',
  ).run(status, nowIso(), fiscalYear, quarter);
  writeAudit(db, {
    userId,
    action: 'set_status',
    entity: 'quarter',
    entityId: `${fiscalYear}-${quarter}`,
    before: { status: current },
    after: { status },
  });
}

function loadMovements(db: AppDb, fiscalYear: number): MovementLike[] {
  const docs = db
    .prepare('SELECT * FROM movements WHERE fiscal_year = ?')
    .all(fiscalYear) as MovementRow[];
  return docs.map((d) => toMovementLike(movementToDoc(d)));
}

/**
 * Casilla 05: pagos fraccionados de trimestres anteriores. Por trimestre cuenta solo la última
 * copia presentada (aunque se haya reabierto: es lo que tiene la AEAT hasta la complementaria).
 */
export function previousInstallments(db: AppDb, fiscalYear: number, quarter: Quarter): number {
  const order = { T1: 1, T2: 2, T3: 3, T4: 4 };
  const snaps = db
    .prepare(
      `SELECT * FROM tax_return_snapshots WHERE fiscal_year = ? AND model = '130'
       ORDER BY created_at DESC`,
    )
    .all(fiscalYear) as TaxReturnSnapshotRow[];
  const latestByQuarter = new Map<string, TaxReturnSnapshotRow>();
  for (const s of snaps) {
    if (!latestByQuarter.has(s.quarter)) latestByQuarter.set(s.quarter, s);
  }
  let sum = 0;
  for (const s of latestByQuarter.values()) {
    if (order[s.quarter as Quarter] < order[quarter]) {
      const result = Number(s.result_cents ?? 0);
      if (result > 0) sum += result;
    }
  }
  return sum;
}

function periodKey(fiscalYear: number, quarter: Quarter): number {
  const order = { T1: 1, T2: 2, T3: 3, T4: 4 };
  return fiscalYear * 10 + order[quarter];
}

/** Cuota pendiente de compensar tras un 303 presentado (lo que la AEAT pondrá en la casilla 110 siguiente). */
function carryForwardFromSnapshot(snap: TaxReturnSnapshotRow): number {
  const boxes = JSON.parse(snap.boxes_json || '{}') as Record<string, { amountCents?: number }>;
  if (boxes.carry?.amountCents !== undefined) return Math.max(0, Number(boxes.carry.amountCents));
  if (boxes['87'] && boxes['71']) {
    const r71 = Number(boxes['71'].amountCents ?? 0);
    return Math.max(0, Number(boxes['87'].amountCents ?? 0)) + (r71 < 0 ? -r71 : 0);
  }
  const result = Number(snap.result_cents ?? 0);
  return result < 0 ? -result : 0;
}

/**
 * Casilla 110: se toma el último 303 presentado antes del periodo (incluido el 4T del año anterior),
 * sea cual sea su signo, para no volver a compensar importes ya absorbidos.
 */
export function pendingVatFromPrevious(db: AppDb, fiscalYear: number, quarter: Quarter): number {
  const current = periodKey(fiscalYear, quarter);
  const snaps = db
    .prepare(
      `SELECT * FROM tax_return_snapshots
       WHERE model = '303' AND fiscal_year IN (?, ?)`,
    )
    .all(fiscalYear, fiscalYear - 1) as TaxReturnSnapshotRow[];
  const latest = snaps
    .filter((s) => periodKey(s.fiscal_year, s.quarter as Quarter) < current)
    .sort((a, b) => {
      const diff =
        periodKey(b.fiscal_year, b.quarter as Quarter) -
        periodKey(a.fiscal_year, a.quarter as Quarter);
      return diff !== 0 ? diff : b.created_at.localeCompare(a.created_at);
    })[0];
  return latest ? carryForwardFromSnapshot(latest) : 0;
}

export async function computeLiveModels(db: AppDb, fiscalYear: number, quarter: Quarter) {
  const rules = getTaxRules(fiscalYear);
  const movements = loadMovements(db, fiscalYear);
  const profile = db
    .prepare('SELECT * FROM tax_profiles WHERE fiscal_year = ?')
    .get(fiscalYear) as TaxProfileRow | undefined;
  const prev = previousInstallments(db, fiscalYear, quarter);

  const amortizations = await loadAmortizationEntriesYtd(db, fiscalYear, quarter);

  const modelo130 = rules.computeModelo130({
    fiscalYear,
    quarter,
    activityStartDate: profile?.activity_start_date,
    movements,
    amortizations,
    previousInstallmentsCents: prev,
  });

  const modelo303 = rules.computeModelo303({
    fiscalYear,
    quarter,
    movements: movements.filter((m) => m.quarter === quarter),
    pendingFromPreviousCents: pendingVatFromPrevious(db, fiscalYear, quarter),
  });

  return { modelo130, modelo303, rulesVersion: rules.meta.version };
}

function assertNoCriticalAlerts(db: AppDb, fiscalYear: number, quarter: Quarter): void {
  const movementIds = (
    db
      .prepare('SELECT id FROM movements WHERE fiscal_year = ? AND quarter = ?')
      .all(fiscalYear, quarter) as { id: string }[]
  ).map((m) => m.id);

  let critical = 0;
  if (movementIds.length) {
    const placeholders = movementIds.map(() => '?').join(',');
    critical = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM alerts
           WHERE severity = 'error' AND resolved = 0 AND movement_id IN (${placeholders})`,
        )
        .get(...movementIds) as { c: number }
    ).c;
  }

  if (critical > 0) {
    throw new AppError(
      ErrorCodes.CRITICAL_ALERTS,
      `Hay ${critical} errores críticos. Corrígelos antes de marcar como presentado.`,
      400,
      { critical },
    );
  }
}

function activeSnapshotRow(
  db: AppDb,
  fiscalYear: number,
  quarter: Quarter,
  model: TaxModel,
): TaxReturnSnapshotRow | undefined {
  return db
    .prepare(
      `SELECT * FROM tax_return_snapshots
       WHERE fiscal_year = ? AND quarter = ? AND model = ? AND reopened_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(fiscalYear, quarter, model) as TaxReturnSnapshotRow | undefined;
}

type LiveModels = Awaited<ReturnType<typeof computeLiveModels>>;

function insertSnapshot(
  db: AppDb,
  live: LiveModels,
  input: {
    fiscalYear: number;
    quarter: Quarter;
    model: TaxModel;
    filedAt: string;
    observations?: string;
    amountPaidCents?: number;
  },
  userId?: string,
): string {
  const calc = input.model === '130' ? live.modelo130 : live.modelo303;
  const extra =
    input.model === '303' ? { carryForwardCents: live.modelo303.carryForwardCents } : {};
  const movements = db
    .prepare('SELECT * FROM movements WHERE fiscal_year = ? AND quarter = ?')
    .all(input.fiscalYear, input.quarter) as MovementRow[];
  const id = newId();
  db.prepare(
    `INSERT INTO tax_return_snapshots (
      id, fiscal_year, quarter, model, filed_at, filed_by, observations, amount_paid_cents,
      result_cents, boxes_json, rules_version, rules_meta_json, movements_included_json,
      immutable, extra_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(
    id,
    input.fiscalYear,
    input.quarter,
    input.model,
    input.filedAt,
    userId ?? null,
    input.observations ?? null,
    input.amountPaidCents ?? null,
    calc.resultCents,
    JSON.stringify(calc.boxes),
    live.rulesVersion,
    JSON.stringify(calc.meta),
    JSON.stringify(movements.map((m) => movementToDoc(m))),
    JSON.stringify(extra),
    nowIso(),
  );
  return id;
}

function closeQuarter(
  db: AppDb,
  input: {
    fiscalYear: number;
    quarter: Quarter;
    filedAt: string;
    observations?: string;
    amountPaidCents?: number;
  },
): void {
  ensureQuartersForYear(db, input.fiscalYear);
  const now = nowIso();
  db.prepare(
    `UPDATE movements SET status = 'locked', updated_at = ?
     WHERE fiscal_year = ? AND quarter = ? AND status != 'void'`,
  ).run(now, input.fiscalYear, input.quarter);
  db.prepare(
    `UPDATE quarters SET status = 'FILED', filed_at = ?, observations = ?,
     amount_paid_cents = ?, updated_at = ? WHERE fiscal_year = ? AND quarter = ?`,
  ).run(
    input.filedAt,
    input.observations ?? null,
    input.amountPaidCents ?? null,
    now,
    input.fiscalYear,
    input.quarter,
  );
}

function openQuarter(db: AppDb, fiscalYear: number, quarter: Quarter, reason: string): void {
  const now = nowIso();
  db.prepare(
    `UPDATE quarters SET status = 'OPEN', filed_at = NULL, observations = NULL,
       amount_paid_cents = NULL, reopened_at = ?, reopen_reason = ?, updated_at = ?
     WHERE fiscal_year = ? AND quarter = ?`,
  ).run(now, reason, now, fiscalYear, quarter);
  db.prepare(
    `UPDATE movements SET status = 'confirmed', updated_at = ?
     WHERE fiscal_year = ? AND quarter = ? AND status = 'locked'`,
  ).run(now, fiscalYear, quarter);
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Marca un único modelo como presentado; el trimestre se cierra cuando lo están los dos. */
export async function fileModel(db: AppDb, input: FileModelInput, userId?: string) {
  if (!input.confirm) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Se requiere confirmación explícita.', 400);
  }
  assertNoCriticalAlerts(db, input.fiscalYear, input.quarter);
  if (activeSnapshotRow(db, input.fiscalYear, input.quarter, input.model)) {
    throw new AppError(
      ErrorCodes.CONFLICT,
      `El modelo ${input.model} de ${input.quarter} ${input.fiscalYear} ya está marcado como presentado.`,
      409,
    );
  }

  const filedAt = input.filedAt ?? todayIso();
  const live = await computeLiveModels(db, input.fiscalYear, input.quarter);
  const id = insertSnapshot(db, live, { ...input, filedAt }, userId);

  writeAudit(db, {
    userId,
    action: 'file',
    entity: 'tax_return',
    entityId: `${input.fiscalYear}-${input.quarter}-${input.model}`,
    after: { filedAt, snapshotId: id },
  });

  const allFiled = TaxModels.every((m) =>
    activeSnapshotRow(db, input.fiscalYear, input.quarter, m),
  );
  const status = getQuarterStatus(db, input.fiscalYear, input.quarter);
  const quarterClosed = allFiled && status !== 'FILED' && status !== 'AMENDED';
  if (quarterClosed) {
    closeQuarter(db, { fiscalYear: input.fiscalYear, quarter: input.quarter, filedAt });
    writeAudit(db, {
      userId,
      action: 'file',
      entity: 'quarter',
      entityId: `${input.fiscalYear}-${input.quarter}`,
      before: { status },
      after: { status: 'FILED', filedAt },
    });
  }

  return {
    message: quarterClosed
      ? `Modelo ${input.model} marcado como presentado. Los dos modelos del trimestre están presentados: movimientos bloqueados.`
      : `Modelo ${input.model} marcado como presentado. Esto NO implica presentación ante AEAT.`,
    snapshot: getSnapshot(db, input.fiscalYear, input.quarter, input.model),
    quarterClosed,
    workingQuarter: syncWorkingQuarter(db, input.fiscalYear),
  };
}

/** Cierra el trimestre entero, guardando copia de los modelos indicados que falten. */
export async function fileQuarter(db: AppDb, input: FileQuarterInput, userId?: string) {
  if (!input.confirm) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Se requiere confirmación explícita.', 400);
  }
  assertNoCriticalAlerts(db, input.fiscalYear, input.quarter);

  const status = getQuarterStatus(db, input.fiscalYear, input.quarter);
  if (status === 'FILED') {
    throw new AppError(ErrorCodes.CONFLICT, 'El trimestre ya está marcado como presentado.', 409);
  }

  const live = await computeLiveModels(db, input.fiscalYear, input.quarter);
  const filedAt = input.filedAt ?? todayIso();
  const snapshots: { id: string; model: TaxModel }[] = [];

  for (const model of input.models) {
    if (activeSnapshotRow(db, input.fiscalYear, input.quarter, model)) continue;
    const id = insertSnapshot(
      db,
      live,
      {
        fiscalYear: input.fiscalYear,
        quarter: input.quarter,
        model,
        filedAt,
        observations: input.observations,
        amountPaidCents: input.amountPaidCents,
      },
      userId,
    );
    snapshots.push({ id, model });
  }

  closeQuarter(db, {
    fiscalYear: input.fiscalYear,
    quarter: input.quarter,
    filedAt,
    observations: input.observations,
    amountPaidCents: input.amountPaidCents,
  });

  writeAudit(db, {
    userId,
    action: 'file',
    entity: 'quarter',
    entityId: `${input.fiscalYear}-${input.quarter}`,
    after: { filedAt, models: input.models, snapshots },
    reason: input.observations,
  });

  const workingQuarter = syncWorkingQuarter(db, input.fiscalYear);

  return {
    message:
      'Trimestre marcado como presentado por el usuario. Esto NO implica presentación ante AEAT.',
    snapshots,
    live,
    workingQuarter,
  };
}

/** Reabre un modelo: su copia pasa al historial y el trimestre vuelve a quedar abierto. */
export async function reopenModel(db: AppDb, input: ReopenModelInput, userId?: string) {
  if (!input.confirm) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Se requiere confirmación explícita.', 400);
  }
  const active = activeSnapshotRow(db, input.fiscalYear, input.quarter, input.model);
  if (!active) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      `El modelo ${input.model} de ${input.quarter} ${input.fiscalYear} no está marcado como presentado.`,
      400,
    );
  }

  db.prepare('UPDATE tax_return_snapshots SET reopened_at = ? WHERE id = ?').run(
    nowIso(),
    active.id,
  );

  const status = getQuarterStatus(db, input.fiscalYear, input.quarter);
  if (status === 'FILED' || status === 'AMENDED') {
    openQuarter(db, input.fiscalYear, input.quarter, input.reason);
  }

  writeAudit(db, {
    userId,
    action: 'reopen',
    entity: 'tax_return',
    entityId: `${input.fiscalYear}-${input.quarter}-${input.model}`,
    reason: input.reason,
    before: { snapshotId: active.id, quarterStatus: status },
    after: { quarterStatus: getQuarterStatus(db, input.fiscalYear, input.quarter) },
  });

  return {
    message: `Modelo ${input.model} reabierto. La copia presentada se conserva en el historial de versiones.`,
    workingQuarter: syncWorkingQuarter(db, input.fiscalYear),
  };
}

export async function reopenQuarter(
  db: AppDb,
  input: { fiscalYear: number; quarter: Quarter; reason: string; confirm: true },
  userId?: string,
) {
  if (!input.confirm) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Se requiere confirmación explícita.', 400);
  }
  const status = getQuarterStatus(db, input.fiscalYear, input.quarter);
  if (status !== 'FILED' && status !== 'AMENDED') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Solo se pueden reabrir trimestres presentados.',
      400,
    );
  }

  openQuarter(db, input.fiscalYear, input.quarter, input.reason);
  db.prepare(
    `UPDATE tax_return_snapshots SET reopened_at = ?
     WHERE fiscal_year = ? AND quarter = ? AND reopened_at IS NULL`,
  ).run(nowIso(), input.fiscalYear, input.quarter);

  writeAudit(db, {
    userId,
    action: 'reopen',
    entity: 'quarter',
    entityId: `${input.fiscalYear}-${input.quarter}`,
    reason: input.reason,
    before: { status },
    after: { status: 'OPEN' },
  });

  return {
    message:
      'Trimestre reabierto. La declaración marcada como presentada puede quedar desactualizada respecto a los datos actuales. Los snapshots históricos se conservan.',
    workingQuarter: syncWorkingQuarter(db, input.fiscalYear),
  };
}

function snapshotToDoc(row: TaxReturnSnapshotRow) {
  const extra = row.extra_json
    ? (JSON.parse(row.extra_json) as { carryForwardCents?: number })
    : {};
  return {
    id: row.id,
    fiscalYear: row.fiscal_year,
    quarter: row.quarter,
    model: row.model,
    filedAt: row.filed_at,
    filedBy: row.filed_by,
    observations: row.observations,
    amountPaidCents: row.amount_paid_cents,
    resultCents: row.result_cents,
    carryForwardCents: extra.carryForwardCents,
    boxes: JSON.parse(row.boxes_json),
    rulesVersion: row.rules_version,
    rulesMeta: row.rules_meta_json ? JSON.parse(row.rules_meta_json) : null,
    movementsIncluded: JSON.parse(row.movements_included_json),
    immutable: Boolean(row.immutable),
    reopenedAt: row.reopened_at ?? null,
    createdAt: row.created_at,
  };
}

/** Copia vigente (presentada y no reabierta) de un modelo. */
export function getSnapshot(db: AppDb, fiscalYear: number, quarter: Quarter, model: TaxModel) {
  const row = activeSnapshotRow(db, fiscalYear, quarter, model);
  return row ? snapshotToDoc(row) : null;
}

/** Todas las versiones guardadas de un modelo, de la más reciente a la más antigua. */
export function listSnapshots(db: AppDb, fiscalYear: number, quarter: Quarter, model: TaxModel) {
  const rows = db
    .prepare(
      `SELECT * FROM tax_return_snapshots
       WHERE fiscal_year = ? AND quarter = ? AND model = ?
       ORDER BY created_at DESC`,
    )
    .all(fiscalYear, quarter, model) as TaxReturnSnapshotRow[];
  return rows.map(snapshotToDoc);
}
