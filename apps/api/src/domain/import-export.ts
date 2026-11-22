import {
  amountsAgree,
  computeTotal,
  computeVat,
  eurosToCents,
  movementCreateSchema,
  parseEurosToCents,
  MovementTypes,
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

const SCHEMA_FIELDS = new Set([
  'type',
  'invoiceDate',
  'fiscalDate',
  'dueDate',
  'settlementDate',
  'invoiceNumber',
  'partyName',
  'partyNif',
  'concept',
  'categoryKey',
  'taxBaseCents',
  'vatRateBps',
  'vatCents',
  'irpfRateBps',
  'irpfWithheldCents',
  'totalCents',
  'professionalUseBps',
  'taxDeductibleBps',
  'expenseNature',
  'vatTreatment',
  'coefficientBps',
  'inServiceDate',
  'notes',
]);

const MONEY_FIELDS = new Set(['taxBaseCents', 'vatCents', 'totalCents', 'irpfWithheldCents']);
const RATE_FIELDS = new Set(['vatRateBps', 'irpfRateBps', 'professionalUseBps', 'taxDeductibleBps', 'coefficientBps']);

function blankRecord(defaultType: MovementType): Record<string, unknown> {
  return {
    type: defaultType,
    vatRateBps: 0,
    irpfRateBps: 0,
    professionalUseBps: 10_000,
    taxDeductibleBps: 10_000,
    expenseNature: 'current',
    status: 'confirmed',
    source: 'import',
  };
}

function applyHeaderCell(obj: Record<string, unknown>, key: string, raw: string, defaultType: MovementType): void {
  switch (key) {
    case 'fiscalDate':
    case 'invoiceDate':
      obj[key] = parseDateCell(raw);
      break;
    case 'taxBaseCents':
    case 'vatCents':
    case 'totalCents':
    case 'irpfWithheldCents':
      obj[key] = parseMoneyCell(raw);
      break;
    case 'vatRateBps':
    case 'irpfRateBps':
    case 'professionalUseBps':
    case 'taxDeductibleBps':
    case 'coefficientBps':
      obj[key] = parsePercentToBps(raw);
      break;
    case 'type':
      obj.type = raw.toLowerCase().includes('ingreso') ? 'income' : defaultType;
      break;
    default:
      obj[key] = raw;
  }
}

function applySchemaField(obj: Record<string, unknown>, key: string, value: unknown): void {
  if (value == null || value === '') return;
  if (key === 'type') {
    const type = String(value);
    if ((MovementTypes as readonly string[]).includes(type)) obj.type = type;
    else if (type.toLowerCase().includes('ingreso')) obj.type = 'income';
    return;
  }
  if ((key === 'fiscalDate' || key === 'invoiceDate' || key === 'dueDate' || key === 'settlementDate' || key === 'inServiceDate') && typeof value === 'string') {
    obj[key] = parseDateCell(value);
    return;
  }
  if (MONEY_FIELDS.has(key) || RATE_FIELDS.has(key)) {
    const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n)) throw new Error(`Número inválido en ${key}`);
    obj[key] = Math.round(n);
    return;
  }
  obj[key] = typeof value === 'string' ? value.trim() : value;
}

function finalizeRow(obj: Record<string, unknown>, errors: string[], warnings: string[], row: number): PasteRowResult {
  if (!obj.invoiceDate && obj.fiscalDate) obj.invoiceDate = obj.fiscalDate;
  if (!obj.fiscalDate && obj.invoiceDate) obj.fiscalDate = obj.invoiceDate;
  if (!obj.concept) errors.push('Falta concepto');
  if (obj.taxBaseCents === undefined) errors.push('Falta base imponible');

  if (typeof obj.taxBaseCents === 'number' && typeof obj.vatRateBps === 'number') {
    const expectedVat = computeVat(obj.taxBaseCents, obj.vatRateBps);
    if (obj.vatCents !== undefined && !amountsAgree(obj.vatCents as number, expectedVat)) {
      errors.push(`IVA incorrecto: esperado ${expectedVat} céntimos`);
    } else if (obj.vatCents === undefined) {
      obj.vatCents = expectedVat;
    }
    const total = computeTotal(
      obj.taxBaseCents,
      obj.vatCents as number,
      (obj.irpfWithheldCents as number) ?? 0,
    );
    if (obj.totalCents !== undefined && !amountsAgree(obj.totalCents as number, total)) {
      errors.push(`Total incorrecto: esperado ${total} céntimos`);
    } else if (obj.totalCents === undefined) {
      obj.totalCents = total;
    }
  }

  if ((obj.vatRateBps as number) === 0 && !obj.vatTreatment) {
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

  return {
    row,
    ok: errors.length === 0,
    errors,
    warnings,
    data: errors.length === 0 && parsed.success ? parsed.data : undefined,
  };
}

function detectDelimiter(header: string): '\t' | ';' | ',' {
  const tabs = header.split('\t').length;
  const semis = header.split(';').length;
  const commas = header.split(',').length;
  if (tabs > 1 && tabs >= semis && tabs >= commas) return '\t';
  if (semis > 1 && semis >= commas) return ';';
  return ',';
}

function splitDelimited(line: string, delimiter: string): string[] {
  if (delimiter === '\t') return line.split('\t');
  const out: string[] = [];
  let cur = '';
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quote = false;
      } else cur += ch;
    } else if (ch === '"') {
      quote = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseDelimited(text: string, defaultType: MovementType): { headers: string[]; rows: PasteRowResult[] } {
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length);
  if (lines.length < 2) {
    return { headers: [], rows: [{ row: 0, ok: false, errors: ['Se necesita cabecera y al menos una fila'], warnings: [] }] };
  }

  const delimiter = detectDelimiter(lines[0]!);
  const rawHeaders = splitDelimited(lines[0]!, delimiter).map((h) => h.trim().toLowerCase());
  const mapped = rawHeaders.map((h) => HEADER_MAP[h] ?? h);
  const rows: PasteRowResult[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitDelimited(lines[i]!, delimiter);
    const errors: string[] = [];
    const warnings: string[] = [];
    const obj = blankRecord(defaultType);
    mapped.forEach((key, idx) => {
      const val = (cols[idx] ?? '').trim();
      if (!val) return;
      try {
        applyHeaderCell(obj, key, val, defaultType);
      } catch (e) {
        errors.push((e as Error).message);
      }
    });
    rows.push(finalizeRow(obj, errors, warnings, i));
  }
  return { headers: mapped, rows };
}

function parseJsonImport(text: string, defaultType: MovementType): { headers: string[]; rows: PasteRowResult[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { headers: [], rows: [{ row: 0, ok: false, errors: ['El JSON no se puede leer'], warnings: [] }] };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { movements?: unknown }).movements)
      ? (parsed as { movements: unknown[] }).movements
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { rows?: unknown }).rows)
        ? (parsed as { rows: unknown[] }).rows
        : null;
  if (!list) {
    return {
      headers: [],
      rows: [{ row: 0, ok: false, errors: ['El JSON tiene que ser una lista de movimientos'], warnings: [] }],
    };
  }
  const rows: PasteRowResult[] = [];
  list.forEach((item, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      rows.push({ row: index + 1, ok: false, errors: ['La fila no es un objeto'], warnings: [] });
      return;
    }
    const obj = blankRecord(defaultType);
    for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
      const header = HEADER_MAP[key.trim().toLowerCase()];
      try {
        if (header) {
          const raw = value == null ? '' : String(value).trim();
          if (raw) applyHeaderCell(obj, header, raw, defaultType);
        } else if (SCHEMA_FIELDS.has(key)) {
          applySchemaField(obj, key, value);
        }
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    rows.push(finalizeRow(obj, errors, warnings, index + 1));
  });
  return { headers: [], rows };
}

export function parseTsvPaste(
  tsv: string,
  defaultType: MovementType = 'expense',
): { headers: string[]; rows: PasteRowResult[] } {
  return parseDelimited(tsv, defaultType);
}

export function parseImportText(
  text: string,
  defaultType: MovementType = 'expense',
): { headers: string[]; rows: PasteRowResult[] } {
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) return parseJsonImport(trimmed, defaultType);
  return parseDelimited(text, defaultType);
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
