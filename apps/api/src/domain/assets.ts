import {
  AppError,
  ErrorCodes,
  Quarters,
  parseISODateOnly,
  type Quarter,
  type RateBps,
} from '@autonomous/shared';
import { quarterlyAmortizationScheduleByDays } from '@autonomous/tax-rules';
import type { AppDb } from '../db/sqlite.js';
import {
  newId,
  nowIso,
  type AmortizationEntryRow,
  type AssetRow,
  type MovementRow,
} from '../db/schema.js';
import { writeAudit } from './audit.js';
import { ensureQuartersForYear, getQuarterStatus } from './movements.js';
import { isQuarterLocked } from './validation.js';

function quarterOrder(q: Quarter): number {
  return { T1: 1, T2: 2, T3: 3, T4: 4 }[q];
}

function isQuarterPresented(db: AppDb, fiscalYear: number, quarter: Quarter): boolean {
  return isQuarterLocked(getQuarterStatus(db, fiscalYear, quarter));
}

export type CreateAssetFromMovementOpts = {
  coefficientBps: RateBps;
  inServiceDate?: string;
  userId?: string;
};

export async function createAssetFromMovement(
  db: AppDb,
  movementId: string,
  opts: CreateAssetFromMovementOpts,
) {
  const movement = db.prepare('SELECT * FROM movements WHERE id = ?').get(movementId) as
    | MovementRow
    | undefined;
  if (!movement) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Movimiento no encontrado', 404);
  }
  if (movement.expense_nature !== 'fixed_asset') {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Solo se puede crear un activo desde un gasto de naturaleza Inmovilizado.',
      400,
    );
  }
  if (movement.asset_id) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Este movimiento ya tiene un activo vinculado.',
      400,
    );
  }
  if (!opts.coefficientBps || opts.coefficientBps <= 0) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Indica el coeficiente de amortización (%).',
      400,
    );
  }

  const inServiceDate = opts.inServiceDate ?? String(movement.fiscal_date);
  const acquisitionDate = String(movement.fiscal_date);
  const taxBaseCents = Number(movement.tax_base_cents);
  const name = String(movement.concept);
  const now = nowIso();
  const assetId = newId();

  db.prepare(
    `INSERT INTO assets (
      id, name, acquisition_date, in_service_date, tax_base_cents, coefficient_bps,
      method, movement_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'linear', ?, ?, ?)`,
  ).run(
    assetId,
    name,
    acquisitionDate,
    inServiceDate,
    taxBaseCents,
    opts.coefficientBps,
    movementId,
    now,
    now,
  );

  db.prepare(
    `UPDATE movements SET asset_id = ?, expense_nature = 'fixed_asset', updated_at = ? WHERE id = ?`,
  ).run(assetId, now, movementId);

  db.prepare(`DELETE FROM alerts WHERE movement_id = ? AND code = 'FIXED_ASSET_NO_LINK'`).run(
    movementId,
  );

  const schedule = quarterlyAmortizationScheduleByDays({
    taxBaseCents,
    coefficientBps: opts.coefficientBps,
    inServiceDate: parseISODateOnly(inServiceDate),
  });

  const yearsNeeded = new Set(schedule.map((r) => r.year));
  for (const y of yearsNeeded) {
    ensureQuartersForYear(db, y);
  }

  const insertEntry = db.prepare(
    `INSERT INTO amortization_entries (
      id, asset_id, fiscal_year, quarter, fiscal_date, amount_cents, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const entries = [];
  for (const row of schedule) {
    const status = getQuarterStatus(db, row.year, row.quarter);
    const entryStatus = isQuarterLocked(status) ? 'skipped_closed' : 'posted';
    const entryId = newId();
    insertEntry.run(
      entryId,
      assetId,
      row.year,
      row.quarter,
      row.fiscalDate,
      row.amountCents,
      entryStatus,
      now,
    );
    entries.push({
      id: entryId,
      assetId,
      fiscalYear: row.year,
      quarter: row.quarter,
      fiscalDate: row.fiscalDate,
      amountCents: row.amountCents,
      status: entryStatus,
      createdAt: now,
    });
  }

  const doc = {
    name,
    acquisitionDate,
    inServiceDate,
    taxBaseCents,
    coefficientBps: opts.coefficientBps,
    method: 'linear' as const,
    movementId,
    createdAt: now,
    updatedAt: now,
  };

  writeAudit(db, {
    userId: opts.userId,
    action: 'create',
    entity: 'asset',
    entityId: assetId,
    after: doc,
  });

  return {
    id: assetId,
    ...doc,
    entriesCount: entries.length,
    entries,
  };
}

export async function createAsset(
  db: AppDb,
  input: {
    name: string;
    acquisitionDate: string;
    inServiceDate: string;
    taxBaseCents: number;
    coefficientBps: number;
    method?: 'linear';
    movementId?: string;
    notes?: string;
  },
  userId?: string,
) {
  if (!input.movementId) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'El activo debe crearse desde un movimiento de inmovilizado (movementId obligatorio).',
      400,
    );
  }
  return createAssetFromMovement(db, input.movementId, {
    coefficientBps: input.coefficientBps,
    inServiceDate: input.inServiceDate,
    userId,
  });
}

export async function listAssets(db: AppDb) {
  const assets = db
    .prepare('SELECT * FROM assets ORDER BY acquisition_date DESC')
    .all() as AssetRow[];
  const result = [];
  for (const a of assets) {
    const entries = db
      .prepare(
        'SELECT * FROM amortization_entries WHERE asset_id = ? ORDER BY fiscal_year ASC, quarter ASC',
      )
      .all(a.id) as AmortizationEntryRow[];

    const taxBaseCents = Number(a.tax_base_cents);
    const presented = entries.filter(
      (e) =>
        e.status === 'posted' &&
        isQuarterPresented(db, Number(e.fiscal_year), e.quarter as Quarter),
    );
    const accumulatedCents = presented.reduce((s, e) => s + Number(e.amount_cents), 0);
    const pendingCents = taxBaseCents - accumulatedCents;
    const totalQuarters = entries.length;
    const quartersDone = presented.length;
    const quartersRemaining = Math.max(0, totalQuarters - quartersDone);

    result.push({
      id: a.id,
      name: a.name,
      acquisitionDate: a.acquisition_date,
      inServiceDate: a.in_service_date,
      taxBaseCents,
      coefficientBps: Number(a.coefficient_bps),
      method: a.method ?? 'linear',
      movementId: a.movement_id ?? undefined,
      notes: a.notes ?? undefined,
      accumulatedCents,
      pendingCents,
      totalQuarters,
      quartersDone,
      quartersRemaining,
      monthsTotal: totalQuarters * 3,
      monthsRemaining: quartersRemaining * 3,
      entries: entries.map((e) => ({
        id: e.id,
        fiscalYear: e.fiscal_year,
        quarter: e.quarter as Quarter,
        fiscalDate: e.fiscal_date ?? undefined,
        amountCents: Number(e.amount_cents),
        status: e.status,
        presented: isQuarterPresented(db, Number(e.fiscal_year), e.quarter as Quarter),
      })),
    });
  }
  return result;
}

export async function loadAmortizationEntriesYtd(
  db: AppDb,
  fiscalYear: number,
  throughQuarter: Quarter,
): Promise<
  {
    id: string;
    assetId: string;
    concept: string;
    fiscalYear: number;
    quarter: Quarter;
    fiscalDate: string;
    amountCents: number;
  }[]
> {
  const maxOrder = quarterOrder(throughQuarter);
  const allowed = Quarters.filter((q) => quarterOrder(q) <= maxOrder);
  const placeholders = allowed.map(() => '?').join(',');
  const entries = db
    .prepare(
      `SELECT * FROM amortization_entries
       WHERE fiscal_year = ? AND status = 'posted' AND quarter IN (${placeholders})`,
    )
    .all(fiscalYear, ...allowed) as AmortizationEntryRow[];

  const assetIds = [...new Set(entries.map((e) => e.asset_id))];
  const assetsById = new Map<string, AssetRow>();
  for (const aid of assetIds) {
    const a = db.prepare('SELECT * FROM assets WHERE id = ?').get(aid) as AssetRow | undefined;
    if (a) assetsById.set(aid, a);
  }

  return entries.map((e) => {
    const asset = assetsById.get(e.asset_id);
    return {
      id: e.id,
      assetId: e.asset_id,
      concept: `Amortización: ${asset?.name ?? 'activo'} (${e.quarter} ${e.fiscal_year})`,
      fiscalYear: Number(e.fiscal_year),
      quarter: e.quarter as Quarter,
      fiscalDate: String(e.fiscal_date ?? `${e.fiscal_year}-01-01`),
      amountCents: Number(e.amount_cents),
    };
  });
}

export async function createAccrualSchedule(
  db: AppDb,
  params: {
    movementId: string;
    startDate: string;
    endDate: string;
    totalCents: number;
    userId?: string;
  },
) {
  const movement = db.prepare('SELECT id FROM movements WHERE id = ?').get(params.movementId);
  if (!movement) {
    throw new AppError(ErrorCodes.NOT_FOUND, 'Movimiento no encontrado', 404);
  }
  const start = parseISODateOnly(params.startDate);
  const end = parseISODateOnly(params.endDate);
  if (end <= start) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Fecha fin debe ser posterior a inicio', 400);
  }

  const days = Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1;
  const daily = Math.floor(params.totalCents / days);
  let allocated = 0;

  const byYear = new Map<number, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const y = d.getUTCFullYear();
    const amt = i === days - 1 ? params.totalCents - allocated : daily;
    allocated += amt;
    byYear.set(y, (byYear.get(y) ?? 0) + amt);
  }

  const allocations = [...byYear.entries()].map(([fiscalYear, amountCents]) => ({
    fiscalYear,
    amountCents,
  }));
  const id = newId();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO accrual_schedules (
      id, source_movement_id, start_date, end_date, total_cents, allocations_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.movementId,
    params.startDate,
    params.endDate,
    params.totalCents,
    JSON.stringify(allocations),
    createdAt,
  );

  const schedule = {
    sourceMovementId: params.movementId,
    startDate: params.startDate,
    endDate: params.endDate,
    totalCents: params.totalCents,
    allocations,
    createdAt,
  };

  writeAudit(db, {
    userId: params.userId,
    action: 'create',
    entity: 'accrual_schedule',
    entityId: id,
    after: schedule,
  });

  return { id, ...schedule };
}
