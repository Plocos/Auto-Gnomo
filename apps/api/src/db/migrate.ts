import type { AppDb } from './sqlite.js';

type Migration = {
  id: string;
  up: (db: AppDb) => void;
};

const migrations: Migration[] = [
  {
    id: '001_initial_schema',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tax_profiles (
          id TEXT PRIMARY KEY NOT NULL,
          fiscal_year INTEGER NOT NULL UNIQUE,
          activity_start_date TEXT NOT NULL,
          nif TEXT NOT NULL,
          full_name TEXT NOT NULL,
          epigrafe TEXT NOT NULL,
          iva_regime TEXT NOT NULL,
          irpf_method TEXT NOT NULL,
          temporal_criterion TEXT NOT NULL,
          address TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS parties (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          nif TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_parties_name_nif ON parties(name, IFNULL(nif, ''));

        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY NOT NULL,
          key TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          system INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS movements (
          id TEXT PRIMARY KEY NOT NULL,
          type TEXT NOT NULL,
          invoice_date TEXT NOT NULL,
          fiscal_date TEXT NOT NULL,
          issue_date TEXT,
          due_date TEXT,
          settlement_date TEXT,
          fiscal_year INTEGER NOT NULL,
          quarter TEXT NOT NULL,
          invoice_number TEXT,
          party_id TEXT,
          party_name TEXT,
          party_nif TEXT,
          concept TEXT NOT NULL,
          category_key TEXT,
          subcategory_key TEXT,
          tax_base_cents INTEGER NOT NULL,
          vat_rate_bps INTEGER NOT NULL DEFAULT 0,
          vat_cents INTEGER NOT NULL DEFAULT 0,
          irpf_rate_bps INTEGER NOT NULL DEFAULT 0,
          irpf_withheld_cents INTEGER NOT NULL DEFAULT 0,
          total_cents INTEGER NOT NULL DEFAULT 0,
          settled_cents INTEGER,
          professional_use_bps INTEGER NOT NULL DEFAULT 10000,
          tax_deductible_bps INTEGER NOT NULL DEFAULT 10000,
          expense_nature TEXT NOT NULL DEFAULT 'current',
          vat_treatment TEXT,
          status TEXT NOT NULL DEFAULT 'confirmed',
          source TEXT NOT NULL DEFAULT 'manual',
          notes TEXT,
          professional_justification TEXT,
          corrects_movement_id TEXT,
          correction_reason TEXT,
          asset_id TEXT,
          document_id TEXT,
          accrual_start_date TEXT,
          accrual_end_date TEXT,
          created_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_movements_fy_q_date ON movements(fiscal_year, quarter, fiscal_date);
        CREATE INDEX IF NOT EXISTS idx_movements_type_fy ON movements(type, fiscal_year);
        CREATE INDEX IF NOT EXISTS idx_movements_status ON movements(status);
        CREATE INDEX IF NOT EXISTS idx_movements_party_inv ON movements(party_name, invoice_number, fiscal_date);

        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          acquisition_date TEXT NOT NULL,
          in_service_date TEXT NOT NULL,
          tax_base_cents INTEGER NOT NULL,
          coefficient_bps INTEGER NOT NULL,
          method TEXT NOT NULL DEFAULT 'linear',
          movement_id TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assets_in_service ON assets(in_service_date);

        CREATE TABLE IF NOT EXISTS amortization_entries (
          id TEXT PRIMARY KEY NOT NULL,
          asset_id TEXT NOT NULL,
          fiscal_year INTEGER NOT NULL,
          quarter TEXT NOT NULL,
          fiscal_date TEXT,
          amount_cents INTEGER NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_amort_asset ON amortization_entries(asset_id);
        CREATE INDEX IF NOT EXISTS idx_amort_fy_q ON amortization_entries(fiscal_year, quarter);

        CREATE TABLE IF NOT EXISTS accrual_schedules (
          id TEXT PRIMARY KEY NOT NULL,
          source_movement_id TEXT NOT NULL,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          total_cents INTEGER NOT NULL,
          allocations_json TEXT NOT NULL,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS quarters (
          id TEXT PRIMARY KEY NOT NULL,
          fiscal_year INTEGER NOT NULL,
          quarter TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN',
          filed_at TEXT,
          observations TEXT,
          amount_paid_cents INTEGER,
          reopened_at TEXT,
          reopen_reason TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(fiscal_year, quarter)
        );

        CREATE TABLE IF NOT EXISTS tax_return_snapshots (
          id TEXT PRIMARY KEY NOT NULL,
          fiscal_year INTEGER NOT NULL,
          quarter TEXT NOT NULL,
          model TEXT NOT NULL,
          filed_at TEXT NOT NULL,
          filed_by TEXT,
          observations TEXT,
          amount_paid_cents INTEGER,
          result_cents INTEGER NOT NULL,
          boxes_json TEXT NOT NULL,
          rules_version TEXT,
          rules_meta_json TEXT,
          movements_included_json TEXT NOT NULL,
          immutable INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_snapshots_fy_model ON tax_return_snapshots(fiscal_year, model, quarter);

        CREATE TABLE IF NOT EXISTS alerts (
          id TEXT PRIMARY KEY NOT NULL,
          movement_id TEXT,
          code TEXT NOT NULL,
          severity TEXT NOT NULL,
          message TEXT NOT NULL,
          field TEXT,
          resolved INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_alerts_sev ON alerts(severity, resolved);

        CREATE TABLE IF NOT EXISTS audit_logs (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT,
          action TEXT NOT NULL,
          entity TEXT NOT NULL,
          entity_id TEXT,
          before_json TEXT,
          after_json TEXT,
          reason TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY NOT NULL,
          filename TEXT NOT NULL,
          path TEXT NOT NULL,
          mime_type TEXT,
          movement_id TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY NOT NULL,
          active_fiscal_year INTEGER,
          working_quarter TEXT,
          data_json TEXT,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    id: '002_drop_users',
    up: (db) => {
      db.exec('DROP TABLE IF EXISTS users');
    },
  },
  {
    id: '003_tax_profile_activity',
    up: (db) => {
      db.exec(`
        ALTER TABLE tax_profiles ADD COLUMN activity_code TEXT NOT NULL DEFAULT 'A';
        ALTER TABLE tax_profiles ADD COLUMN activity_type TEXT NOT NULL DEFAULT '05';
      `);
    },
  },
  {
    id: '004_tax_profile_names',
    up: (db) => {
      db.exec(`
        ALTER TABLE tax_profiles ADD COLUMN first_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE tax_profiles ADD COLUMN last_name TEXT NOT NULL DEFAULT '';
      `);
    },
  },
  {
    id: '005_snapshot_reopen',
    up: (db) => {
      db.exec(`
        ALTER TABLE tax_return_snapshots ADD COLUMN reopened_at TEXT;
        ALTER TABLE tax_return_snapshots ADD COLUMN extra_json TEXT;

        UPDATE tax_return_snapshots AS s
        SET reopened_at = COALESCE(
          (SELECT q.reopened_at FROM quarters q
           WHERE q.fiscal_year = s.fiscal_year AND q.quarter = s.quarter),
          s.created_at
        )
        WHERE EXISTS (
          SELECT 1 FROM quarters q
          WHERE q.fiscal_year = s.fiscal_year AND q.quarter = s.quarter AND q.status = 'OPEN'
        )
        OR EXISTS (
          SELECT 1 FROM tax_return_snapshots n
          WHERE n.fiscal_year = s.fiscal_year AND n.quarter = s.quarter
            AND n.model = s.model AND n.created_at > s.created_at
        );
      `);
    },
  },
  {
    id: '006_assistant',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS assistant_threads (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS assistant_messages (
          id TEXT PRIMARY KEY NOT NULL,
          thread_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          files_json TEXT NOT NULL DEFAULT '[]',
          proposals_json TEXT NOT NULL DEFAULT '[]',
          summary TEXT,
          warnings_json TEXT NOT NULL DEFAULT '[]',
          reply_to_id TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_assistant_messages_thread
          ON assistant_messages(thread_id, created_at);
      `);
    },
  },
];

export function runMigrations(db: AppDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  for (const migration of migrations) {
    const existing = db
      .prepare('SELECT id FROM schema_migrations WHERE id = ?')
      .get(migration.id) as { id: string } | undefined;
    if (existing) {
      console.log('Migration already applied:', migration.id);
      continue;
    }
    migration.up(db);
    db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
      migration.id,
      new Date().toISOString(),
    );
    console.log('Migration', migration.id, 'applied');
  }
}
