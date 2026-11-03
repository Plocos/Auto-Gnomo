import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { pendingVatFromPrevious } from './quarters.js';

// Vite reescribe `node:sqlite` como `sqlite` y no lo resuelve.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};
type DatabaseSync = DatabaseSyncType;

let db: DatabaseSync;
let seq = 0;

function snap(fiscalYear: number, quarter: string, resultCents: number, boxes: object = {}) {
  seq += 1;
  db.prepare(
    `INSERT INTO tax_return_snapshots (id, fiscal_year, quarter, model, result_cents, boxes_json, created_at)
     VALUES (?, ?, ?, '303', ?, ?, ?)`,
  ).run(`s${seq}`, fiscalYear, quarter, resultCents, JSON.stringify(boxes), `2026-01-01T00:00:${String(seq).padStart(2, '0')}Z`);
}

const carry = (amountCents: number) => ({ carry: { amountCents } });

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE tax_return_snapshots (
    id TEXT PRIMARY KEY, fiscal_year INTEGER, quarter TEXT, model TEXT,
    result_cents INTEGER, boxes_json TEXT, created_at TEXT
  )`);
});

describe('pendingVatFromPrevious (casilla 110)', () => {
  it('is 0 without previous 303', () => {
    expect(pendingVatFromPrevious(db, 2026, 'T1')).toBe(0);
  });

  it('chains carry-forward across quarters', () => {
    snap(2026, 'T1', -10_000, carry(10_000));
    snap(2026, 'T2', -6_974, carry(16_974));
    expect(pendingVatFromPrevious(db, 2026, 'T3')).toBe(16_974);
  });

  it('does not compensate twice when a later quarter absorbed the pending', () => {
    snap(2026, 'T1', -10_000, carry(10_000));
    snap(2026, 'T2', 5_000, carry(0));
    expect(pendingVatFromPrevious(db, 2026, 'T3')).toBe(0);
  });

  it('falls back to |result| for legacy snapshots without carry', () => {
    snap(2026, 'T1', -10_000);
    expect(pendingVatFromPrevious(db, 2026, 'T2')).toBe(10_000);
    snap(2026, 'T2', 5_000);
    expect(pendingVatFromPrevious(db, 2026, 'T3')).toBe(0);
  });

  it('uses the previous year 4T for 1T and the latest refiled snapshot', () => {
    snap(2025, 'T4', -3_000, carry(3_000));
    expect(pendingVatFromPrevious(db, 2026, 'T1')).toBe(3_000);
    snap(2026, 'T1', -1_000, carry(4_000));
    snap(2026, 'T1', -2_000, carry(5_000));
    expect(pendingVatFromPrevious(db, 2026, 'T2')).toBe(5_000);
  });

  it('ignores snapshots of the same or later quarters', () => {
    snap(2026, 'T3', -9_999, carry(9_999));
    expect(pendingVatFromPrevious(db, 2026, 'T3')).toBe(0);
  });
});
