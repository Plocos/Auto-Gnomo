import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../db/migrate.js';
import {
  fileModel,
  getSnapshot,
  listQuarters,
  listSnapshots,
  previousInstallments,
  reopenModel,
} from './quarters.js';

// Vite reescribe `node:sqlite` como `sqlite` y no lo resuelve.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

let db: DatabaseSyncType;
let seq = 0;

function income(quarter: string, date: string, baseCents: number) {
  seq += 1;
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO movements (
      id, type, invoice_date, fiscal_date, fiscal_year, quarter, concept,
      tax_base_cents, vat_rate_bps, vat_cents, total_cents, created_at, updated_at
    ) VALUES (?, 'income', ?, ?, 2026, ?, 'Factura', ?, 2100, ?, ?, ?, ?)`,
  ).run(
    `m${seq}`,
    date,
    date,
    quarter,
    baseCents,
    Math.round(baseCents * 0.21),
    Math.round(baseCents * 1.21),
    now,
    now,
  );
}

const quarterStatus = (quarter: string) =>
  listQuarters(db, 2026).find((q) => q.quarter === quarter)!;

const movementStatuses = () =>
  (db.prepare('SELECT status FROM movements').all() as { status: string }[]).map((m) => m.status);

const file = (model: '130' | '303', filedAt: string, quarter: 'T1' | 'T2' = 'T1') =>
  fileModel(db, { fiscalYear: 2026, quarter, model, filedAt, confirm: true });

const reopen = (model: '130' | '303') =>
  reopenModel(db, {
    fiscalYear: 2026,
    quarter: 'T1',
    model,
    reason: 'Complementaria',
    confirm: true,
  });

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  db = new DatabaseSync(':memory:');
  runMigrations(db);
  income('T1', '2026-02-10', 100_000);
});

describe('presentación por modelo', () => {
  it('cierra el trimestre solo cuando están presentados el 130 y el 303', async () => {
    await file('303', '2026-04-15');
    expect(quarterStatus('T1')).toMatchObject({ status: 'OPEN', filed303At: '2026-04-15' });
    expect(quarterStatus('T1').filed130At).toBeUndefined();
    expect(movementStatuses()).toEqual(['confirmed']);

    const r = await file('130', '2026-04-18');
    expect(r.quarterClosed).toBe(true);
    expect(quarterStatus('T1')).toMatchObject({
      status: 'FILED',
      filed130At: '2026-04-18',
      filed303At: '2026-04-15',
    });
    expect(movementStatuses()).toEqual(['locked']);
  });

  it('guarda las casillas tal como estaban al presentar', async () => {
    await file('303', '2026-04-15');
    income('T1', '2026-03-01', 50_000);
    const snap = getSnapshot(db, 2026, 'T1', '303')!;
    expect(snap.boxes['27'].amountCents).toBe(21_000);
    expect(snap.resultCents).toBe(21_000);
    expect(snap.carryForwardCents).toBe(0);
  });

  it('no deja presentar dos veces el mismo modelo', async () => {
    await file('303', '2026-04-15');
    await expect(file('303', '2026-04-16')).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('reapertura', () => {
  it('conserva la copia en el historial y crea una versión nueva al volver a presentar', async () => {
    await file('303', '2026-04-15');
    await file('130', '2026-04-15');
    const first = getSnapshot(db, 2026, 'T1', '303')!;

    await reopen('303');
    expect(quarterStatus('T1').status).toBe('OPEN');
    expect(quarterStatus('T1').filed303At).toBeUndefined();
    expect(quarterStatus('T1').filed130At).toBe('2026-04-15');
    expect(movementStatuses()).toEqual(['confirmed']);
    expect(getSnapshot(db, 2026, 'T1', '303')).toBeNull();
    expect(listSnapshots(db, 2026, 'T1', '303')).toMatchObject([
      { id: first.id, reopenedAt: expect.any(String) },
    ]);

    income('T1', '2026-03-01', 50_000);
    await file('303', '2026-05-02');
    const history = listSnapshots(db, 2026, 'T1', '303');
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ filedAt: '2026-05-02', reopenedAt: null, resultCents: 31_500 });
    expect(history[1]).toMatchObject({ id: first.id, resultCents: 21_000 });
    expect(quarterStatus('T1').status).toBe('FILED');
  });

  it('rechaza reabrir un modelo sin presentar', async () => {
    await expect(reopen('130')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('migración 005 sobre datos existentes', () => {
  it('pasa al historial las copias de trimestres reabiertos y las sustituidas', () => {
    listQuarters(db, 2026);
    const snap = (id: string, quarter: string, model: string, createdAt: string) =>
      db
        .prepare(
          `INSERT INTO tax_return_snapshots (
            id, fiscal_year, quarter, model, filed_at, result_cents, boxes_json,
            movements_included_json, created_at
          ) VALUES (?, 2026, ?, ?, '2026-04-15', 0, '{}', '[]', ?)`,
        )
        .run(id, quarter, model, createdAt);
    snap('t1-old', 'T1', '303', '2026-04-15T10:00:00Z');
    snap('t1-new', 'T1', '303', '2026-05-01T10:00:00Z');
    snap('t2-reopened', 'T2', '303', '2026-07-15T10:00:00Z');
    db.prepare(`UPDATE quarters SET status = 'FILED' WHERE quarter = 'T1'`).run();
    db.prepare(
      `UPDATE quarters SET status = 'OPEN', reopened_at = '2026-07-20T00:00:00Z' WHERE quarter = 'T2'`,
    ).run();

    db.exec(`
      ALTER TABLE tax_return_snapshots DROP COLUMN reopened_at;
      ALTER TABLE tax_return_snapshots DROP COLUMN extra_json;
      DELETE FROM schema_migrations WHERE id = '005_snapshot_reopen';
    `);
    runMigrations(db);

    const reopened = Object.fromEntries(
      (
        db.prepare('SELECT id, reopened_at FROM tax_return_snapshots').all() as {
          id: string;
          reopened_at: string | null;
        }[]
      ).map((r) => [r.id, r.reopened_at]),
    );
    expect(reopened).toEqual({
      't1-old': '2026-04-15T10:00:00Z',
      't1-new': null,
      't2-reopened': '2026-07-20T00:00:00Z',
    });
  });
});

describe('casilla 05 (pagos fraccionados anteriores)', () => {
  it('cuenta solo la última versión presentada de cada trimestre', async () => {
    await file('130', '2026-04-15');
    const first = getSnapshot(db, 2026, 'T1', '130')!.resultCents;
    expect(first).toBe(20_000);

    await reopen('130');
    expect(previousInstallments(db, 2026, 'T2')).toBe(20_000);

    income('T1', '2026-03-01', 50_000);
    await file('130', '2026-05-02');
    expect(previousInstallments(db, 2026, 'T2')).toBe(30_000);
  });
});
