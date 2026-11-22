import { formatEuros, Quarters, type Quarter } from '@autonomous/shared';
import type { BoxResult } from '@autonomous/tax-rules';
import type { AppDb } from '../db/sqlite.js';
import { computeLiveModels } from '../domain/quarters.js';
import { chatSystemPrompt } from './prompt.js';

function asQuarter(value: string | undefined): Quarter {
  return (Quarters as readonly string[]).includes(value ?? '') ? (value as Quarter) : 'T1';
}

function notableBoxes(boxes: Record<string, BoxResult>): string {
  return Object.values(boxes)
    .filter((box) => box.unit !== 'percent' && box.amountCents !== 0)
    .slice(0, 8)
    .map((box) => `${box.box} ${box.label}: ${formatEuros(box.amountCents)}`)
    .join('; ');
}

const STOP = new Set([
  'como', 'cómo', 'cual', 'cuál', 'cuanto', 'cuánto', 'cuantos', 'cuántos',
  'este', 'esta', 'estos', 'estas', 'para', 'porque', 'porqué', 'sobre',
  'tengo', 'tiene', 'hay', 'del', 'los', 'las', 'una', 'uno', 'que', 'qué',
  'trimestre', 'modelo', 'factura', 'movimiento', 'movimientos',
]);

function searchTokens(question: string): string[] {
  const tokens = question
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9áéíóúñ]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOP.has(token));
  return [...new Set(tokens)].slice(0, 4);
}

export async function buildChatContext(db: AppDb, question: string): Promise<string> {
  const settings = db.prepare(`SELECT active_fiscal_year, working_quarter FROM app_settings WHERE key = 'main'`).get() as
    | { active_fiscal_year: number | null; working_quarter: string | null }
    | undefined;
  const year = settings?.active_fiscal_year ?? new Date().getUTCFullYear();
  const quarter = asQuarter(settings?.working_quarter ?? undefined);

  const profile = db
    .prepare(
      `SELECT full_name, nif, epigrafe, iva_regime, irpf_method, temporal_criterion
       FROM tax_profiles WHERE fiscal_year = ?`,
    )
    .get(year) as
    | {
        full_name: string;
        nif: string;
        epigrafe: string;
        iva_regime: string;
        irpf_method: string;
        temporal_criterion: string;
      }
    | undefined;

  const lines: string[] = [];
  lines.push(`Ejercicio activo: ${year}. Trimestre de trabajo: ${quarter}.`);
  if (profile) {
    lines.push(
      `Perfil: ${profile.full_name}, NIF ${profile.nif}, epígrafe ${profile.epigrafe}, IVA ${profile.iva_regime}, IRPF ${profile.irpf_method}, criterio ${profile.temporal_criterion}.`,
    );
  } else {
    lines.push('No hay perfil fiscal guardado para este ejercicio.');
  }

  const totals = db
    .prepare(
      `SELECT type, COUNT(*) AS c, COALESCE(SUM(tax_base_cents), 0) AS base, COALESCE(SUM(vat_cents), 0) AS vat
       FROM movements WHERE fiscal_year = ? GROUP BY type`,
    )
    .all(year) as { type: string; c: number; base: number; vat: number }[];
  if (totals.length) {
    lines.push('Totales del ejercicio (base y IVA):');
    for (const row of totals) {
      lines.push(`- ${row.type}: ${row.c} movimientos, base ${formatEuros(row.base)}, IVA ${formatEuros(row.vat)}`);
    }
  } else {
    lines.push('No hay movimientos en este ejercicio.');
  }

  const quarters = db
    .prepare(`SELECT quarter, status FROM quarters WHERE fiscal_year = ? ORDER BY quarter ASC`)
    .all(year) as { quarter: string; status: string }[];
  const filed = db
    .prepare(
      `SELECT quarter, model FROM tax_return_snapshots
       WHERE fiscal_year = ? AND reopened_at IS NULL`,
    )
    .all(year) as { quarter: string; model: string }[];
  const filedKey = new Set(filed.map((row) => `${row.quarter}-${row.model}`));
  if (quarters.length) {
    lines.push('Trimestres:');
    for (const item of quarters) {
      lines.push(
        `- ${item.quarter} ${item.status}; 130 ${filedKey.has(`${item.quarter}-130`) ? 'presentado' : 'sin presentar'}; 303 ${filedKey.has(`${item.quarter}-303`) ? 'presentado' : 'sin presentar'}`,
      );
    }
  } else {
    lines.push('Todavía no hay trimestres guardados para este ejercicio.');
  }

  try {
    const live = await computeLiveModels(db, year, quarter);
    lines.push(
      `Modelo 130 del trimestre de trabajo: resultado ${formatEuros(live.modelo130.resultCents)}. ${notableBoxes(live.modelo130.boxes)}`,
    );
    lines.push(
      `Modelo 303 del trimestre de trabajo: resultado ${formatEuros(live.modelo303.resultCents)}, a compensar ${formatEuros(live.modelo303.carryForwardCents)}. ${notableBoxes(live.modelo303.boxes)}`,
    );
  } catch {
    lines.push('No se han podido calcular los modelos de este trimestre.');
  }

  const tokens = searchTokens(question);
  if (tokens.length) {
    const clauses = tokens.map(() => `(concept LIKE ? OR IFNULL(party_name, '') LIKE ? OR IFNULL(invoice_number, '') LIKE ?)`).join(' OR ');
    const params: string[] = [];
    for (const token of tokens) {
      const like = `%${token}%`;
      params.push(like, like, like);
    }
    const found = db
      .prepare(
        `SELECT fiscal_date, type, concept, IFNULL(party_name, '') AS party, tax_base_cents, vat_cents, quarter
         FROM movements WHERE fiscal_year = ? AND (${clauses})
         ORDER BY fiscal_date DESC LIMIT 15`,
      )
      .all(year, ...params) as {
      fiscal_date: string;
      type: string;
      concept: string;
      party: string;
      tax_base_cents: number;
      vat_cents: number;
      quarter: string;
    }[];
    if (found.length) {
      lines.push('Movimientos que encajan con la pregunta:');
      for (const row of found) {
        lines.push(
          `- ${row.fiscal_date} ${row.quarter} ${row.type} ${row.party} «${row.concept}» base ${formatEuros(row.tax_base_cents)} IVA ${formatEuros(row.vat_cents)}`,
        );
      }
    }
  }

  const recent = db
    .prepare(
      `SELECT fiscal_date, type, concept, IFNULL(party_name, '') AS party, tax_base_cents, quarter
       FROM movements WHERE fiscal_year = ?
       ORDER BY fiscal_date DESC, created_at DESC LIMIT 20`,
    )
    .all(year) as {
    fiscal_date: string;
    type: string;
    concept: string;
    party: string;
    tax_base_cents: number;
    quarter: string;
  }[];
  if (recent.length) {
    lines.push('Últimos movimientos del ejercicio:');
    for (const row of recent) {
      lines.push(`- ${row.fiscal_date} ${row.quarter} ${row.type} ${row.party} «${row.concept}» base ${formatEuros(row.tax_base_cents)}`);
    }
  }

  const assets = db
    .prepare(`SELECT name, in_service_date, tax_base_cents FROM assets ORDER BY in_service_date DESC LIMIT 8`)
    .all() as { name: string; in_service_date: string; tax_base_cents: number }[];
  if (assets.length) {
    lines.push('Inmovilizado:');
    for (const asset of assets) {
      lines.push(`- ${asset.name}, en servicio ${asset.in_service_date}, base ${formatEuros(asset.tax_base_cents)}`);
    }
  }

  const alerts = db
    .prepare(`SELECT severity, message FROM alerts WHERE resolved = 0 ORDER BY created_at DESC LIMIT 12`)
    .all() as { severity: string; message: string }[];
  if (alerts.length) {
    lines.push('Alertas abiertas:');
    for (const alert of alerts) lines.push(`- ${alert.severity}: ${alert.message}`);
  } else {
    lines.push('No hay alertas abiertas.');
  }

  const text = lines.join('\n');
  return text.length > 7000 ? `${text.slice(0, 7000)}\n…` : text;
}

export function chatPrompt(context: string): string {
  return `${chatSystemPrompt()}\n\nContexto actual, calculado por la aplicación. Úsalo como única fuente de cifras:\n${context}`;
}
