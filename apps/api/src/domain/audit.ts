import type { AppDb } from '../db/sqlite.js';
import { newId, nowIso } from '../db/schema.js';

export function writeAudit(
  db: AppDb,
  entry: {
    userId?: string;
    action: string;
    entity: string;
    entityId?: string;
    before?: unknown;
    after?: unknown;
    reason?: string;
  },
): void {
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, before_json, after_json, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    entry.userId ?? null,
    entry.action,
    entry.entity,
    entry.entityId ?? null,
    entry.before !== undefined ? JSON.stringify(entry.before) : null,
    entry.after !== undefined ? JSON.stringify(entry.after) : null,
    entry.reason ?? null,
    nowIso(),
  );
}
