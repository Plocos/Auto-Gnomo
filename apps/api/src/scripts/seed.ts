import { env } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { newId, nowIso } from '../db/schema.js';
import { closeSqlite, connectSqlite } from '../db/sqlite.js';
import { createProfileMeta, isProfileDir, upgradeLegacyVaultMeta } from '../db/vault.js';
import { createAssetFromMovement } from '../domain/assets.js';
import { createMovement, ensureQuartersForYear } from '../domain/movements.js';
import { fileQuarter } from '../domain/quarters.js';

const FULL = {
  professionalUseBps: 10_000,
  taxDeductibleBps: 10_000,
  status: 'confirmed' as const,
  source: 'manual' as const,
};

async function main() {
  const db = connectSqlite(env.dataDir);
  runMigrations(db);
  if (isProfileDir(env.dataDir)) {
    upgradeLegacyVaultMeta(env.dataDir, { name: 'Antonio' });
  } else {
    createProfileMeta(env.dataDir, 'Antonio');
  }

  if (env.nodeEnv === 'production') {
    console.error('Seed blocked in production');
    process.exit(1);
  }

  const tables = [
    'tax_profiles',
    'movements',
    'parties',
    'categories',
    'assets',
    'amortization_entries',
    'accrual_schedules',
    'quarters',
    'tax_return_snapshots',
    'alerts',
    'audit_logs',
    'app_settings',
  ];
  for (const t of tables) {
    db.exec(`DELETE FROM ${t}`);
  }
  db.exec('DROP TABLE IF EXISTS users');

  const now = nowIso();
  db.prepare(
    `INSERT INTO tax_profiles (
      id, fiscal_year, activity_start_date, nif, full_name, first_name, last_name, epigrafe,
      iva_regime, irpf_method, temporal_criterion, created_at, updated_at
    ) VALUES (?, 2026, '2026-05-01', '77487492D', 'Rodríguez Ferrón Antonio Miguel',
      'Antonio Miguel', 'Rodríguez Ferrón', '763',
      'general', 'estimacion_directa_simplificada', 'devengo', ?, ?)`,
  ).run(newId(), now, now);

  db.prepare(
    `INSERT INTO app_settings (key, active_fiscal_year, working_quarter, updated_at)
     VALUES ('main', 2026, 'T3', ?)`,
  ).run(now);

  const cats = [
    ['software', 'Software / Hosting', 'expense', 0],
    ['equipment', 'Equipamiento', 'expense', 0],
    ['autonomo_fee', 'Cuota autónomo', 'autonomo_fee', 1],
    ['services', 'Servicios profesionales', 'income', 0],
    ['grant', 'Ayudas / subvenciones', 'grant', 1],
    ['amortization', 'Amortizaciones', 'amortization', 1],
  ] as const;
  const insertCat = db.prepare(
    `INSERT INTO categories (id, key, name, type, system) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const [key, name, type, system] of cats) {
    insertCat.run(newId(), key, name, type, system);
  }

  ensureQuartersForYear(db, 2026);

  await createMovement(db, {
    type: 'autonomo_fee',
    invoiceDate: '2026-05-29',
    fiscalDate: '2026-05-29',
    settlementDate: '2026-05-29',
    concept: 'Cuota autónomo 005 R.e.autonomos',
    partyName: 'TGSS',
    taxBaseCents: 7085,
    vatRateBps: 0,
    vatCents: 0,
    vatTreatment: 'not_subject',
    categoryKey: 'autonomo_fee',
    expenseNature: 'current',
    ...FULL,
  });

  const laptop = await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-06-02',
    fiscalDate: '2026-06-02',
    settlementDate: '2026-06-02',
    concept: 'Portatil ASUS F1607CA-MB119W',
    partyName: 'MediaMarkt',
    invoiceNumber: 'E230-A001260000009546',
    taxBaseCents: 74_298,
    vatRateBps: 2100,
    vatCents: 15_603,
    totalCents: 89_900,
    expenseNature: 'fixed_asset',
    categoryKey: 'equipment',
    ...FULL,
  });

  await createAssetFromMovement(db, laptop.movement.id as string, {
    coefficientBps: 2600,
    inServiceDate: '2026-06-02',
  });

  await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-06-02',
    fiscalDate: '2026-06-02',
    settlementDate: '2026-06-02',
    concept: 'Cargador ASUS CARGADOR OFICIAL ASUS 65W USBC',
    partyName: 'MediaMarkt',
    invoiceNumber: 'E253-A001260000008085',
    taxBaseCents: 2809,
    vatRateBps: 2100,
    vatCents: 590,
    totalCents: 3398,
    categoryKey: 'equipment',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-06-03',
    fiscalDate: '2026-06-03',
    settlementDate: '2026-06-03',
    concept: 'Maletín funda protectora portátil TOMTOC 360° 15,6-16,2 pulgadas',
    partyName: 'Amazon EU S.à r.l.',
    invoiceNumber: 'ES611AX05AEUD',
    taxBaseCents: 3717,
    vatRateBps: 2100,
    vatCents: 781,
    totalCents: 4498,
    categoryKey: 'equipment',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'income',
    invoiceDate: '2026-06-08',
    fiscalDate: '2026-06-08',
    settlementDate: '2026-06-08',
    concept: 'Talleres Vodafone 5G Curso IA, Big Data, Python',
    partyName: 'Soluciones GMAR SLU',
    invoiceNumber: 'TAL-2026-1',
    taxBaseCents: 55_500,
    vatRateBps: 0,
    vatCents: 0,
    vatTreatment: 'exempt',
    categoryKey: 'services',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'income',
    invoiceDate: '2026-06-08',
    fiscalDate: '2026-06-08',
    settlementDate: '2026-06-08',
    concept: 'Talleres Vodafone 5G Curso edición gráfica e IA',
    partyName: 'Soluciones GMAR SLU',
    invoiceNumber: 'TAL-2026-2',
    taxBaseCents: 11_250,
    vatRateBps: 0,
    vatCents: 0,
    vatTreatment: 'exempt',
    categoryKey: 'services',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'autonomo_fee',
    invoiceDate: '2026-06-30',
    fiscalDate: '2026-06-30',
    settlementDate: '2026-06-30',
    concept: 'Cuota autónomo 005 R.e.autonomos',
    partyName: 'TGSS',
    taxBaseCents: 8856,
    vatRateBps: 0,
    vatCents: 0,
    vatTreatment: 'not_subject',
    categoryKey: 'autonomo_fee',
    expenseNature: 'current',
    ...FULL,
  });

  db.prepare(`DELETE FROM alerts WHERE severity = 'error'`).run();

  await fileQuarter(db, {
    fiscalYear: 2026,
    quarter: 'T2',
    confirm: true,
    models: ['130', '303'],
    observations: 'T2 2026 presentado (05/07/2026)',
    filedAt: '2026-07-05',
  });

  await createMovement(db, {
    type: 'grant',
    invoiceDate: '2026-07-14',
    fiscalDate: '2026-07-14',
    settlementDate: '2026-07-14',
    concept: 'Ayuda Acción Contra el Hambre',
    partyName: 'Fundación Acción Contra El Hambre',
    taxBaseCents: 141_177,
    vatRateBps: 0,
    vatCents: 0,
    vatTreatment: 'not_subject',
    irpfRateBps: 1500,
    irpfWithheldCents: 21_177,
    settledCents: 120_000,
    totalCents: 120_000,
    categoryKey: 'grant',
    expenseNature: 'current',
    notes: 'Sin factura',
    ...FULL,
  });

  await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-07-16',
    fiscalDate: '2026-07-16',
    settlementDate: '2026-07-16',
    concept: 'Ratón Logitech G G203 LIGHTSYNC',
    partyName: 'Amazon EU S.à r.l.',
    invoiceNumber: 'ESW0184081H',
    taxBaseCents: 1814,
    vatRateBps: 2100,
    vatCents: 381,
    totalCents: 2195,
    categoryKey: 'equipment',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-07-16',
    fiscalDate: '2026-07-16',
    settlementDate: '2026-07-16',
    concept: 'Hub 5 en 1 USB-C UGREEN Revodok 105',
    partyName: 'Amazon EU S.à r.l.',
    invoiceNumber: 'ESW0184081H',
    taxBaseCents: 1321,
    vatRateBps: 2100,
    vatCents: 278,
    totalCents: 1599,
    categoryKey: 'equipment',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-07-16',
    fiscalDate: '2026-07-16',
    settlementDate: '2026-07-16',
    concept: 'Alfombrilla Logitech Mouse Pad',
    partyName: 'Amazon EU S.à r.l.',
    invoiceNumber: 'ESW0184081H',
    taxBaseCents: 826,
    vatRateBps: 2100,
    vatCents: 173,
    totalCents: 999,
    categoryKey: 'equipment',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-07-18',
    fiscalDate: '2026-07-18',
    settlementDate: '2026-07-18',
    concept: 'Teléfono móvil Motorola Moto G56',
    partyName: 'Aliexpress',
    invoiceNumber: '20260732-2',
    taxBaseCents: 14_221,
    vatRateBps: 2100,
    vatCents: 2986,
    totalCents: 17_207,
    categoryKey: 'equipment',
    expenseNature: 'current',
    notes: 'Sin factura formal',
    ...FULL,
  });

  await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-07-28',
    fiscalDate: '2026-07-28',
    settlementDate: '2026-07-28',
    concept: 'Webcam EMEET C960 FullHD',
    partyName: 'Amazon EU S.à r.l.',
    invoiceNumber: 'ES61G92F7AEUD',
    taxBaseCents: 1789,
    vatRateBps: 2100,
    vatCents: 376,
    totalCents: 2165,
    categoryKey: 'equipment',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'autonomo_fee',
    invoiceDate: '2026-07-31',
    fiscalDate: '2026-07-31',
    settlementDate: '2026-07-31',
    concept: 'Cuota autónomo 005 R.e.autonomos',
    partyName: 'TGSS',
    taxBaseCents: 8856,
    vatRateBps: 0,
    vatCents: 0,
    vatTreatment: 'not_subject',
    categoryKey: 'autonomo_fee',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-08-09',
    fiscalDate: '2026-08-09',
    settlementDate: '2026-08-09',
    concept: 'Cursor Pro 1 año',
    partyName: 'Cursor',
    invoiceNumber: 'WC1AHUUL-0008',
    taxBaseCents: 17_200,
    vatRateBps: 2100,
    vatCents: 3612,
    totalCents: 20_812,
    categoryKey: 'software',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'autonomo_fee',
    invoiceDate: '2026-08-31',
    fiscalDate: '2026-08-31',
    settlementDate: '2026-08-31',
    concept: 'Cuota autónomo 005 R.e.autonomos',
    partyName: 'TGSS',
    taxBaseCents: 8856,
    vatRateBps: 0,
    vatCents: 0,
    vatTreatment: 'not_subject',
    categoryKey: 'autonomo_fee',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'expense',
    invoiceDate: '2026-09-07',
    fiscalDate: '2026-09-07',
    settlementDate: '2026-09-07',
    concept: 'Netcup',
    partyName: 'netcup GmbH',
    invoiceNumber: 'nc-5552470',
    taxBaseCents: 1995,
    vatRateBps: 2100,
    vatCents: 419,
    totalCents: 2414,
    categoryKey: 'software',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'autonomo_fee',
    invoiceDate: '2026-09-30',
    fiscalDate: '2026-09-30',
    settlementDate: '2026-09-30',
    concept: 'Cuota autónomo 005 R.e.autonomos',
    partyName: 'TGSS',
    taxBaseCents: 8856,
    vatRateBps: 0,
    vatCents: 0,
    vatTreatment: 'not_subject',
    categoryKey: 'autonomo_fee',
    expenseNature: 'current',
    ...FULL,
  });

  await createMovement(db, {
    type: 'income',
    invoiceDate: '2026-10-02',
    fiscalDate: '2026-10-02',
    settlementDate: '2026-10-02',
    concept: 'Talleres Vodafone 5G IoT + IA',
    partyName: 'Soluciones GMAR SLU',
    invoiceNumber: 'TAL-2026-3',
    taxBaseCents: 13_500,
    vatRateBps: 0,
    vatCents: 0,
    vatTreatment: 'exempt',
    categoryKey: 'services',
    expenseNature: 'current',
    ...FULL,
  });

  db.prepare(`DELETE FROM movements WHERE type = 'amortization'`).run();

  const realMovements = (
    db.prepare('SELECT COUNT(*) AS c FROM movements').get() as { c: number }
  ).c;

  console.log('Seed completed');
  console.log(`Vault: ${env.dataDir}`);
  console.log(`Movimientos: ${realMovements}`);
  console.log('T2 2026: PRESENTADO');
  closeSqlite();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
