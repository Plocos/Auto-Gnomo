import {
  AppError,
  ErrorCodes,
  fileModelSchema,
  fileQuarterSchema,
  movementCreateSchema,
  movementQuerySchema,
  movementUpdateSchema,
  openVaultSchema,
  pasteImportSchema,
  reopenModelSchema,
  reopenQuarterSchema,
  setQuarterStatusSchema,
  taxProfileSchema,
  assetCreateSchema,
  vaultRenameSchema,
  Quarters,
  type Quarter,
} from '@autonomous/shared';
import type { FastifyInstance } from 'fastify';
import { writeFile } from 'node:fs/promises';
import {
  movementToDoc,
  newId,
  nowIso,
  type AlertRow,
  type AppSettingsRow,
  type AuditLogRow,
  type MovementRow,
  type TaxProfileRow,
} from '../db/schema.js';
import { getDataDir, getDb, reopenSqlite } from '../db/sqlite.js';
import { runMigrations } from '../db/migrate.js';
import {
  ensureVaultMeta,
  prepareCreateProfileDir,
  readVaultMeta,
  resolveProfileDir,
  upgradeLegacyVaultMeta,
} from '../db/vault.js';
import {
  createAsset,
  createAssetFromMovement,
  createAccrualSchedule,
  listAssets,
  loadAmortizationEntriesYtd,
} from '../domain/assets.js';
import { writeAudit } from '../domain/audit.js';
import {
  exportLibroExpedidas,
  libroFileName,
  loadLibroProfile,
} from '../domain/aeat-libro-expedidas.js';
import {
  importPaste,
  movementsToMarkdown,
  movementsToTsv,
  toCsv,
} from '../domain/import-export.js';
import {
  createMovement,
  deleteMovement,
  linkMovementToAsset,
  listMovements,
  updateMovement,
} from '../domain/movements.js';
import {
  computeLiveModels,
  fileModel,
  fileQuarter,
  getSnapshot,
  listQuarters,
  listSnapshots,
  nextActionableQuarter,
  reopenModel,
  reopenQuarter,
  setQuarterStatus,
} from '../domain/quarters.js';

function getMainSettings(db: ReturnType<typeof getDb>): AppSettingsRow | undefined {
  return db.prepare(`SELECT * FROM app_settings WHERE key = 'main'`).get() as
    | AppSettingsRow
    | undefined;
}

function parseYearQuarter(params: unknown): { year: number; quarter: Quarter } {
  const { year, quarter } = params as { year: string; quarter: string };
  const y = Number(year);
  if (!Number.isInteger(y) || !(Quarters as readonly string[]).includes(quarter)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Ejercicio o trimestre no válido.', 400);
  }
  return { year: y, quarter: quarter as Quarter };
}

function upsertWorkingQuarter(
  db: ReturnType<typeof getDb>,
  workingQuarter: string,
  activeFiscalYear?: number,
): void {
  const now = nowIso();
  const settings = getMainSettings(db);
  if (settings) {
    db.prepare(
      `UPDATE app_settings SET working_quarter = ?, active_fiscal_year = COALESCE(?, active_fiscal_year), updated_at = ?
       WHERE key = 'main'`,
    ).run(workingQuarter, activeFiscalYear ?? null, now);
  } else {
    db.prepare(
      `INSERT INTO app_settings (key, active_fiscal_year, working_quarter, updated_at)
       VALUES ('main', ?, ?, ?)`,
    ).run(activeFiscalYear ?? new Date().getFullYear(), workingQuarter, now);
  }
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    let dataDir: string | null = null;
    let vaultName: string | null = null;
    try {
      dataDir = getDataDir();
      vaultName = readVaultMeta(dataDir)?.name ?? null;
    } catch {
      /* no vault open yet */
    }
    return { ok: true, service: 'autonomous-api', dataDir, vaultName };
  });

  app.get('/api/vault', async () => {
    const dataDir = getDataDir();
    const meta =
      upgradeLegacyVaultMeta(dataDir) ??
      (() => {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          'No hay un perfil Auto-Gnomo abierto en esta carpeta.',
          400,
        );
      })();
    return {
      name: meta.name,
      dataDir,
      createdAt: meta.createdAt,
      kind: meta.kind,
      formatVersion: meta.formatVersion,
    };
  });

  app.put('/api/vault', async (req) => {
    const body = vaultRenameSchema.parse(req.body);
    const dataDir = getDataDir();
    const meta = ensureVaultMeta(dataDir, { name: body.name });
    return {
      name: meta.name,
      dataDir,
      createdAt: meta.createdAt,
      kind: meta.kind,
      formatVersion: meta.formatVersion,
    };
  });

  app.get('/api/data-dir', async () => ({
    dataDir: getDataDir(),
    name: readVaultMeta(getDataDir())?.name ?? null,
  }));

  app.post('/api/data-dir', async (req) => {
    const body = openVaultSchema.parse(req.body);
    const resolved = body.create
      ? prepareCreateProfileDir(body.dataDir, body.name)
      : resolveProfileDir(body.dataDir);

    if (!resolved.ok) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, resolved.message, 400);
    }

    const db = reopenSqlite(resolved.dataDir);
    runMigrations(db);
    const meta =
      upgradeLegacyVaultMeta(resolved.dataDir, { name: body.name }) ?? resolved.meta;

    return { ok: true, dataDir: getDataDir(), name: meta.name };
  });

  app.get('/api/settings', async () => {
    const db = getDb();
    const settings = getMainSettings(db);
    const year = Number(settings?.active_fiscal_year) || new Date().getFullYear();
    const quarters = listQuarters(db, year);
    const workingQuarter = nextActionableQuarter(quarters);
    if (settings?.working_quarter !== workingQuarter) {
      upsertWorkingQuarter(db, workingQuarter, year);
    }
    const dataDir = getDataDir();
    const vault = upgradeLegacyVaultMeta(dataDir);
    return {
      key: 'main',
      activeFiscalYear: year,
      workingQuarter,
      dataDir,
      vaultName: vault?.name ?? null,
      updatedAt: settings?.updated_at,
    };
  });

  app.put('/api/settings', async (req) => {
    const db = getDb();
    const body = req.body as Record<string, unknown>;
    const now = nowIso();
    const settings = getMainSettings(db);
    const activeFiscalYear =
      body.activeFiscalYear !== undefined
        ? Number(body.activeFiscalYear)
        : (settings?.active_fiscal_year ?? new Date().getFullYear());
    const workingQuarter =
      (body.workingQuarter as string | undefined) ?? settings?.working_quarter ?? 'T1';
    if (settings) {
      db.prepare(
        `UPDATE app_settings SET active_fiscal_year = ?, working_quarter = ?, updated_at = ?
         WHERE key = 'main'`,
      ).run(activeFiscalYear, workingQuarter, now);
    } else {
      db.prepare(
        `INSERT INTO app_settings (key, active_fiscal_year, working_quarter, updated_at)
         VALUES ('main', ?, ?, ?)`,
      ).run(activeFiscalYear, workingQuarter, now);
    }
    return { ok: true };
  });

  app.get('/api/tax-profiles/:year', async (req) => {
    const year = Number((req.params as { year: string }).year);
    const db = getDb();
    const profile = db
      .prepare('SELECT * FROM tax_profiles WHERE fiscal_year = ?')
      .get(year) as TaxProfileRow | undefined;
    if (!profile) throw new AppError(ErrorCodes.NOT_FOUND, 'Perfil fiscal no encontrado', 404);
    return {
      id: profile.id,
      fiscalYear: profile.fiscal_year,
      activityStartDate: profile.activity_start_date,
      nif: profile.nif,
      fullName: profile.full_name,
      firstName: profile.first_name,
      lastName: profile.last_name,
      epigrafe: profile.epigrafe,
      activityCode: profile.activity_code,
      activityType: profile.activity_type,
      ivaRegime: profile.iva_regime,
      irpfMethod: profile.irpf_method,
      temporalCriterion: profile.temporal_criterion,
      address: profile.address ?? undefined,
      notes: profile.notes ?? undefined,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
    };
  });

  app.put('/api/tax-profiles/:year', async (req) => {
    const year = Number((req.params as { year: string }).year);
    const body = taxProfileSchema.parse({ ...(req.body as object), fiscalYear: year });
    const fullName = `${body.lastName} ${body.firstName}`;
    const db = getDb();
    const now = nowIso();
    const existing = db
      .prepare('SELECT id FROM tax_profiles WHERE fiscal_year = ?')
      .get(year) as { id: string } | undefined;
    if (existing) {
      db.prepare(
        `UPDATE tax_profiles SET
          activity_start_date = ?, nif = ?, full_name = ?, first_name = ?, last_name = ?,
          epigrafe = ?, activity_code = ?, activity_type = ?,
          iva_regime = ?, irpf_method = ?, temporal_criterion = ?,
          address = ?, notes = ?, updated_at = ?
         WHERE fiscal_year = ?`,
      ).run(
        body.activityStartDate,
        body.nif,
        fullName,
        body.firstName,
        body.lastName,
        body.epigrafe,
        body.activityCode,
        body.activityType,
        body.ivaRegime,
        body.irpfMethod,
        body.temporalCriterion,
        body.address ?? null,
        body.notes ?? null,
        now,
        year,
      );
    } else {
      db.prepare(
        `INSERT INTO tax_profiles (
          id, fiscal_year, activity_start_date, nif, full_name, first_name, last_name, epigrafe,
          activity_code, activity_type,
          iva_regime, irpf_method, temporal_criterion, address, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        newId(),
        year,
        body.activityStartDate,
        body.nif,
        fullName,
        body.firstName,
        body.lastName,
        body.epigrafe,
        body.activityCode,
        body.activityType,
        body.ivaRegime,
        body.irpfMethod,
        body.temporalCriterion,
        body.address ?? null,
        body.notes ?? null,
        now,
        now,
      );
    }
    writeAudit(db, {
      userId: undefined,
      action: 'upsert',
      entity: 'tax_profile',
      entityId: String(year),
      after: body,
    });
    return body;
  });

  app.get('/api/movements', async (req) => {
    const query = movementQuerySchema.parse(req.query);
    return listMovements(getDb(), query);
  });

  app.post('/api/movements', async (req) => {
    const body = movementCreateSchema.parse(req.body);
    const settings = getMainSettings(getDb());
    const db = getDb();
    const result = await createMovement(db, body, {
      userId: undefined,
      workingQuarter: settings?.working_quarter ?? undefined,
      allowCorrection: body.type === 'correction',
    });

    if (body.expenseNature === 'fixed_asset' && !body.assetId && result.movement.id) {
      if (!body.coefficientBps) {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          'Para inmovilizado indica el coeficiente de amortización (%).',
          400,
        );
      }
      const asset = await createAssetFromMovement(db, String(result.movement.id), {
        coefficientBps: body.coefficientBps,
        inServiceDate: body.inServiceDate ?? body.fiscalDate,
        userId: undefined,
      });
      return {
        ...result,
        movement: { ...result.movement, assetId: asset.id },
        asset,
      };
    }

    return result;
  });

  app.patch('/api/movements/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    const body = movementUpdateSchema.parse(req.body);
    const db = getDb();
    const result = await updateMovement(db, id, body, { userId: undefined });

    const nature = (result.movement.expenseNature as string) ?? body.expenseNature;
    const hasAsset = Boolean(result.movement.assetId);
    if (nature === 'fixed_asset' && !hasAsset) {
      if (!body.coefficientBps) {
        throw new AppError(
          ErrorCodes.VALIDATION_ERROR,
          'Para inmovilizado indica el coeficiente de amortización (%).',
          400,
        );
      }
      const asset = await createAssetFromMovement(db, id, {
        coefficientBps: body.coefficientBps,
        inServiceDate: body.inServiceDate ?? String(result.movement.fiscalDate),
        userId: undefined,
      });
      return {
        ...result,
        movement: { ...result.movement, assetId: asset.id },
        asset,
      };
    }

    return result;
  });

  app.post('/api/movements/:id/link-asset', async (req) => {
    const id = (req.params as { id: string }).id;
    const body = req.body as { assetId?: string | null };
    return linkMovementToAsset(getDb(), id, body.assetId ?? null, {
      userId: undefined,
    });
  });

  app.delete('/api/movements/:id', async (req) => {
    const id = (req.params as { id: string }).id;
    await deleteMovement(getDb(), id, { userId: undefined });
    return { ok: true };
  });

  app.get('/api/quarters/:year', async (req) => {
    const year = Number((req.params as { year: string }).year);
    return { items: listQuarters(getDb(), year) };
  });

  app.post('/api/quarters/status', async (req) => {
    const body = setQuarterStatusSchema.parse(req.body);
    await setQuarterStatus(
      getDb(),
      body.fiscalYear,
      body.quarter,
      body.status,
      undefined,
    );
    return { ok: true };
  });

  app.post('/api/quarters/file', async (req) => {
    const body = fileQuarterSchema.parse(req.body);
    return fileQuarter(getDb(), body, undefined);
  });

  app.post('/api/quarters/reopen', async (req) => {
    const body = reopenQuarterSchema.parse(req.body);
    return reopenQuarter(getDb(), body, undefined);
  });

  app.get('/api/tax-returns/:year/:quarter', async (req) => {
    const { year, quarter } = parseYearQuarter(req.params);
    const db = getDb();
    const live = await computeLiveModels(db, year, quarter);
    const forModel = (model: '130' | '303') => ({
      current: getSnapshot(db, year, quarter, model),
      history: listSnapshots(db, year, quarter, model),
    });
    return {
      live,
      snapshots: {
        '130': forModel('130'),
        '303': forModel('303'),
      },
    };
  });

  app.post('/api/tax-returns/file', async (req) => {
    const body = fileModelSchema.parse(req.body);
    return fileModel(getDb(), body, undefined);
  });

  app.post('/api/tax-returns/reopen', async (req) => {
    const body = reopenModelSchema.parse(req.body);
    return reopenModel(getDb(), body, undefined);
  });

  app.get('/api/assets', async () => ({
    items: await listAssets(getDb()),
  }));

  app.post('/api/assets', async (req) => {
    const body = assetCreateSchema.parse(req.body);
    return createAsset(getDb(), body, undefined);
  });

  app.post('/api/accruals', async (req) => {
    const body = req.body as {
      movementId: string;
      startDate: string;
      endDate: string;
      totalCents: number;
    };
    return createAccrualSchedule(getDb(), {
      ...body,
      userId: undefined,
    });
  });

  app.get('/api/alerts', async (req) => {
    const q = req.query as { severity?: string };
    const db = getDb();
    let items: AlertRow[];
    if (q.severity) {
      items = db
        .prepare(
          `SELECT * FROM alerts WHERE resolved = 0 AND severity = ?
           ORDER BY severity ASC, created_at DESC LIMIT 500`,
        )
        .all(q.severity) as AlertRow[];
    } else {
      items = db
        .prepare(
          `SELECT * FROM alerts WHERE resolved = 0
           ORDER BY severity ASC, created_at DESC LIMIT 500`,
        )
        .all() as AlertRow[];
    }
    const count = (severity: string) =>
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM alerts WHERE resolved = 0 AND severity = ?`,
          )
          .get(severity) as { c: number }
      ).c;
    return {
      counts: {
        error: count('error'),
        warning: count('warning'),
        info: count('info'),
      },
      items: items.map((a) => ({
        id: a.id,
        movementId: a.movement_id,
        code: a.code,
        severity: a.severity,
        message: a.message,
        field: a.field,
        resolved: Boolean(a.resolved),
        createdAt: a.created_at,
      })),
    };
  });

  app.get('/api/audit-log', async (req) => {
    const q = req.query as { page?: string; pageSize?: string };
    const page = Number(q.page ?? 1);
    const pageSize = Number(q.pageSize ?? 50);
    const db = getDb();
    const total = (db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get() as { c: number }).c;
    const items = db
      .prepare(
        `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(pageSize, (page - 1) * pageSize) as AuditLogRow[];
    return {
      total,
      page,
      pageSize,
      items: items.map((a) => ({
        id: a.id,
        userId: a.user_id,
        action: a.action,
        entity: a.entity,
        entityId: a.entity_id,
        before: a.before_json ? JSON.parse(a.before_json) : null,
        after: a.after_json ? JSON.parse(a.after_json) : null,
        reason: a.reason,
        createdAt: a.created_at,
      })),
    };
  });

  app.post('/api/imports/paste', async (req) => {
    const body = pasteImportSchema.parse(req.body);
    return importPaste(
      getDb(),
      body.tsv,
      body.defaultType,
      body.dryRun,
      undefined,
    );
  });

  app.get('/api/exports/movements', async (req, reply) => {
    const query = movementQuerySchema.parse(req.query);
    const format = ((req.query as { format?: string }).format ?? 'tsv') as string;
    const { items } = await listMovements(getDb(), { ...query, pageSize: 5000 });
    const rows = items as Record<string, unknown>[];

    if (format === 'json') {
      return rows;
    }
    if (format === 'markdown') {
      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      return movementsToMarkdown(rows);
    }
    if (format === 'csv') {
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      return toCsv(rows);
    }
    reply.header('Content-Type', 'text/tab-separated-values; charset=utf-8');
    return movementsToTsv(rows);
  });

  app.get('/api/exports/libro-expedidas/:year/:quarter', async (req, reply) => {
    const { year, quarter } = parseYearQuarter(req.params);
    const { buffer, fileName } = await exportLibroExpedidas(getDb(), year, quarter);
    reply.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    reply.header(
      'Content-Disposition',
      `attachment; filename="libro-registro.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    reply.header('Access-Control-Expose-Headers', 'Content-Disposition');
    return reply.send(buffer);
  });

  app.get('/api/exports/libro-expedidas/:year/:quarter/name', async (req) => {
    const { year } = parseYearQuarter(req.params);
    const profile = loadLibroProfile(getDb(), year);
    return { fileName: libroFileName(year, profile.nif, profile.fullName) };
  });

  app.post('/api/exports/libro-expedidas/:year/:quarter/save', async (req) => {
    const { year, quarter } = parseYearQuarter(req.params);
    const path = String((req.body as { path?: unknown } | undefined)?.path ?? '').trim();
    if (!path) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Falta la ruta de destino del fichero.', 400);
    }
    const target = /\.xlsx$/i.test(path) ? path : `${path}.xlsx`;
    const { buffer, fileName, rowCount } = await exportLibroExpedidas(getDb(), year, quarter);
    await writeFile(target, buffer);
    return { ok: true, path: target, fileName, rowCount };
  });

  app.post('/api/copy/selection', async (req) => {
    const body = req.body as {
      ids: string[];
      format?: 'tsv' | 'markdown' | 'json';
    };
    const ids = body.ids ?? [];
    if (!ids.length) return { content: '', format: body.format ?? 'tsv' };
    const placeholders = ids.map(() => '?').join(',');
    const items = getDb()
      .prepare(`SELECT * FROM movements WHERE id IN (${placeholders})`)
      .all(...ids) as MovementRow[];
    const rows = items.map(movementToDoc) as Record<string, unknown>[];
    const format = body.format ?? 'tsv';
    if (format === 'json') return { content: JSON.stringify(rows, null, 2), format };
    if (format === 'markdown') return { content: movementsToMarkdown(rows), format };
    return { content: movementsToTsv(rows), format };
  });

  app.get('/api/dashboard/:year', async (req) => {
    const year = Number((req.params as { year: string }).year);
    const db = getDb();
    const quarters = listQuarters(db, year);
    const settings = getMainSettings(db);
    const workingQuarter = nextActionableQuarter(quarters);
    const movements = db
      .prepare('SELECT * FROM movements WHERE fiscal_year = ?')
      .all(year) as MovementRow[];
    let income = 0;
    let expense = 0;
    let vatRepercutido = 0;
    let vatSoportado = 0;
    for (const m of movements) {
      if (m.status === 'void') continue;
      if (m.type === 'income' || m.type === 'grant') {
        income += Number(m.tax_base_cents);
        vatRepercutido += Number(m.vat_cents);
      }
      if (m.type === 'expense' || m.type === 'autonomo_fee') {
        if (m.expense_nature !== 'fixed_asset') {
          expense += Number(m.tax_base_cents);
        }
        vatSoportado += Number(m.vat_cents);
      }
    }
    const amortYtd = await loadAmortizationEntriesYtd(db, year, workingQuarter);
    expense += amortYtd.reduce((s, a) => s + a.amountCents, 0);
    if (settings?.working_quarter !== workingQuarter) {
      upsertWorkingQuarter(db, workingQuarter, year);
    }
    let live = null;
    try {
      live = await computeLiveModels(db, year, workingQuarter);
    } catch {
      live = null;
    }
    const count = (severity: string) =>
      (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM alerts WHERE resolved = 0 AND severity = ?`,
          )
          .get(severity) as { c: number }
      ).c;
    return {
      fiscalYear: year,
      workingQuarter,
      quarters,
      totals: {
        incomeCents: income,
        expenseCents: expense,
        profitCents: income - expense,
        vatRepercutidoCents: vatRepercutido,
        vatSoportadoCents: vatSoportado,
      },
      live,
      alerts: {
        error: count('error'),
        warning: count('warning'),
      },
    };
  });

}
