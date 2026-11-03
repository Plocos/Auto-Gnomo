import {
  amountsAgree,
  computeTotal,
  computeVat,
  eurosToCents,
  movementCreateSchema,
  parseEurosToCents,
  type MovementCreateInput,
  type MovementType,
} from '@autonomous/shared';
import type { AppDb } from '../db/sqlite.js';
import { createMovement } from './movements.js';
import { normalizeMovement } from './validation.js';

const HEADER_MAP: Record<string, string> = {
  fecha: 'fiscalDate',
  'fecha fiscal': 'fiscalDate',
  'fecha factura': 'invoiceDate',
  concepto: 'concept',
  base: 'taxBaseCents',
  'base imponible': 'taxBaseCents',
  iva: 'vatRateBps',
  'iva %': 'vatRateBps',
  'iva €': 'vatCents',
  'iva eur': 'vatCents',
  total: 'totalCents',
  tipo: 'type',
  proveedor: 'partyName',
  cliente: 'partyName',
  nif: 'partyNif',
  'nº factura': 'invoiceNumber',
  'num factura': 'invoiceNumber',
  factura: 'invoiceNumber',
  irpf: 'irpfRateBps',
  'irpf %': 'irpfRateBps',
};

function parseDateCell(raw: string): string {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) {
    const d = m[1]!.padStart(2, '0');
    const mo = m[2]!.padStart(2, '0');
    return `${m[3]}-${mo}-${d}`;
  }
  throw new Error(`Fecha inválida: ${raw}`);
}

function parsePercentToBps(raw: string): number {
  const n = Number(raw.replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(n)) throw new Error(`Porcentaje inválido: ${raw}`);
  return Math.round(n * 100);
}

function parseMoneyCell(raw: string): number {
  return parseEurosToCents(raw);
}

export interface PasteRowResult {
  row: number;
  ok: boolean;
  errors: string[];
  warnings: string[];
  data?: MovementCreateInput;
}

export function parseTsvPaste(
  tsv: string,
  defaultType: MovementType = 'expense',
): { headers: string[]; rows: PasteRowResult[] } {
  const lines = tsv
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length);
  if (lines.length < 2) {
    return { headers: [], rows: [{ row: 0, ok: false, errors: ['Se necesita cabecera y al menos una fila'], warnings: [] }] };
  }

  const rawHeaders = lines[0]!.split('\t').map((h) => h.trim().toLowerCase());
  const mapped = rawHeaders.map((h) => HEADER_MAP[h] ?? h);

  const rows: PasteRowResult[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split('\t');
    const errors: string[] = [];
    const warnings: string[] = [];
    const obj: Record<string, unknown> = {
      type: defaultType,
      vatRateBps: 0,
      irpfRateBps: 0,
      professionalUseBps: 10_000,
      taxDeductibleBps: 10_000,
      expenseNature: 'current',
      status: 'confirmed',
      source: 'import',
    };

    mapped.forEach((key, idx) => {
      const val = (cols[idx] ?? '').trim();
      if (!val) return;
      try {
        switch (key) {
          case 'fiscalDate':
          case 'invoiceDate':
            obj[key] = parseDateCell(val);
            break;
          case 'taxBaseCents':
          case 'vatCents':
          case 'totalCents':
            obj[key] = parseMoneyCell(val);
            break;
          case 'vatRateBps':
          case 'irpfRateBps':
            obj[key] = parsePercentToBps(val);
            break;
          case 'type':
            obj.type = val.toLowerCase().includes('ingreso') ? 'income' : defaultType;
            break;
          default:
            obj[key] = val;
        }
      } catch (e) {
        errors.push((e as Error).message);
      }
    });

    if (!obj.invoiceDate && obj.fiscalDate) obj.invoiceDate = obj.fiscalDate;
    if (!obj.fiscalDate && obj.invoiceDate) obj.fiscalDate = obj.invoiceDate;
    if (!obj.concept) errors.push('Falta concepto');
    if (obj.taxBaseCents === undefined) errors.push('Falta base imponible');

    if (typeof obj.taxBaseCents === 'number' && typeof obj.vatRateBps === 'number') {
      const expectedVat = computeVat(obj.taxBaseCents as number, obj.vatRateBps as number);
      if (obj.vatCents !== undefined && !amountsAgree(obj.vatCents as number, expectedVat)) {
        errors.push(`IVA incorrecto: esperado ${expectedVat} céntimos`);
      } else if (obj.vatCents === undefined) {
        obj.vatCents = expectedVat;
      }
      const total = computeTotal(
        obj.taxBaseCents as number,
        obj.vatCents as number,
        (obj.irpfWithheldCents as number) ?? 0,
      );
      if (obj.totalCents !== undefined && !amountsAgree(obj.totalCents as number, total)) {
        errors.push(`Total incorrecto: esperado ${total} céntimos`);
      } else if (obj.totalCents === undefined) {
        obj.totalCents = total;
      }
    }

    if ((obj.vatRateBps as number) === 0) {
      warnings.push('IVA 0%: se sugerirá indicar vatTreatment');
      obj.vatTreatment = 'other';
    }

    const parsed = movementCreateSchema.safeParse(obj);
    if (!parsed.success) {
      for (const e of parsed.error.issues) {
        errors.push(`${e.path.join('.')}: ${e.message}`);
      }
    } else {
      const { issues } = normalizeMovement(parsed.data);
      for (const iss of issues) {
        if (iss.severity === 'error') errors.push(iss.message);
        else warnings.push(iss.message);
      }
    }

    rows.push({
      row: i,
      ok: errors.length === 0,
      errors,
      warnings,
      data: errors.length === 0 ? (parsed.success ? parsed.data : undefined) : undefined,
    });
  }

  return { headers: mapped, rows };
}

export async function importPaste(
  db: AppDb,
  tsv: string,
  defaultType: MovementType,
  dryRun: boolean,
  userId?: string,
) {
  const parsed = parseTsvPaste(tsv, defaultType);
  const okRows = parsed.rows.filter((r) => r.ok && r.data);
  const summary = {
    total: parsed.rows.length,
    ok: okRows.length,
    errors: parsed.rows.filter((r) => !r.ok).length,
    warnings: parsed.rows.filter((r) => r.warnings.length).length,
  };

  if (dryRun) {
    return { dryRun: true, summary, rows: parsed.rows };
  }

  const created = [];
  for (const row of okRows) {
    const result = await createMovement(db, row.data!, { userId });
    created.push(result.movement.id);
  }

  return { dryRun: false, summary, createdIds: created, rows: parsed.rows };
}

export function movementsToTsv(
  movements: Record<string, unknown>[],
  _columns?: string[],
): string {
  const header = [
    'Fecha',
    'Concepto',
    'Base',
    'IVA %',
    'IVA €',
    'Total',
    'Tipo',
    'Trimestre',
  ].join('\t');

  const lines = movements.map((m) => {
    const base = Number(m.taxBaseCents ?? 0) / 100;
    const vat = Number(m.vatCents ?? 0) / 100;
    const total = Number(m.totalCents ?? 0) / 100;
    const rate = Number(m.vatRateBps ?? 0) / 100;
    return [
      m.fiscalDate,
      m.concept,
      base.toFixed(2),
      rate,
      vat.toFixed(2),
      total.toFixed(2),
      m.type,
      m.quarter,
    ].join('\t');
  });
  return [header, ...lines].join('\n');
}

export function movementsToMarkdown(movements: Record<string, unknown>[]): string {
  const lines = [
    '| Fecha | Concepto | Base | IVA % | IVA € | Total | Tipo | Trimestre |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const m of movements) {
    lines.push(
      `| ${m.fiscalDate} | ${m.concept} | ${(Number(m.taxBaseCents) / 100).toFixed(2)} | ${Number(m.vatRateBps) / 100} | ${(Number(m.vatCents) / 100).toFixed(2)} | ${(Number(m.totalCents) / 100).toFixed(2)} | ${m.type} | ${m.quarter} |`,
    );
  }
  return lines.join('\n');
}

export function toCsv(movements: Record<string, unknown>[]): string {
  return movementsToTsv(movements).replace(/\t/g, ',');
}

// silence unused
void eurosToCents;
