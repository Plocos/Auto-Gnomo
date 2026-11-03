import { AppError, ErrorCodes, type Quarter } from '@autonomous/shared';
import ExcelJS from 'exceljs';
import type { AppDb } from '../db/sqlite.js';
import type { MovementRow, TaxProfileRow } from '../db/schema.js';

/**
 * Libro Registro de Facturas Expedidas y de Ventas e Ingresos (AEAT), tipo U (unificado IVA + IRPF).
 * Una línea por movimiento; los números van como texto con coma decimal y las fechas dd/mm/yyyy.
 */

export const LIBRO_COLUMN_COUNT = 36;

export type LibroProfile = {
  nif: string;
  fullName: string;
  epigrafe: string;
  activityCode: string;
  activityType: string;
};

export type LibroMovement = Pick<
  MovementRow,
  | 'id'
  | 'type'
  | 'invoice_date'
  | 'fiscal_date'
  | 'issue_date'
  | 'fiscal_year'
  | 'quarter'
  | 'invoice_number'
  | 'party_name'
  | 'party_nif'
  | 'tax_base_cents'
  | 'vat_rate_bps'
  | 'vat_cents'
  | 'irpf_rate_bps'
  | 'irpf_withheld_cents'
  | 'vat_treatment'
  | 'corrects_movement_id'
> & {
  original_party_name?: string | null;
  original_party_nif?: string | null;
};

const EU_VAT_PREFIXES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'FI', 'FR', 'HR', 'HU', 'IE',
  'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
]);

const SPANISH_NIF = /^([A-Z]\d{8}|\d{8}[A-Z]|[A-Z]\d{7}[A-Z])$/;

/** Céntimos (o bps, que comparten escala ×100) → "66325,12" / "-502,36". */
export function fmtDec(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.round(value));
  const int = Math.floor(abs / 100);
  const dec = String(abs % 100).padStart(2, '0');
  return `${sign}${int},${dec}`;
}

/** "2026-05-02" → "02/05/2026". */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

/** "T1" → "1T". */
export function aeatPeriod(quarter: string): string {
  return `${quarter.replace(/\D/g, '')}T`;
}

/** "653.3 Comercio..." → "6533"; "IAE 763" → "763". */
export function epigrafeCode(epigrafe: string): string {
  const match = epigrafe.match(/\d+(?:[.,]\d+)*/);
  return (match ? match[0].replace(/[.,]/g, '') : epigrafe.replace(/[^A-Za-z0-9]/g, '')).slice(0, 4);
}

export type RecipientId = { type: string; country: string; id: string };

export function recipientId(raw: string | null | undefined): RecipientId | null {
  const nif = (raw ?? '').toUpperCase().replace(/[\s\-./]/g, '');
  if (!nif) return null;
  if (nif.startsWith('ES') && SPANISH_NIF.test(nif.slice(2))) {
    return { type: '', country: '', id: nif.slice(2) };
  }
  if (SPANISH_NIF.test(nif)) return { type: '', country: '', id: nif };
  const prefix = nif.slice(0, 2);
  if (EU_VAT_PREFIXES.has(prefix)) return { type: '02', country: prefix, id: nif.slice(0, 20) };
  return { type: '', country: '', id: nif.slice(0, 20) };
}

export function libroFileName(year: number, nif: string, fullName: string): string {
  const clean = `${year}${nif.toUpperCase().replace(/[\s\-./]/g, '')}U${fullName.trim()}`
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/[. ]+$/g, '');
  return `${clean}.xlsx`;
}

/** Fila de 36 celdas en el orden de columnas del libro AEAT. */
export function movementToLibroRow(m: LibroMovement, profile: LibroProfile): string[] {
  const row = new Array<string>(LIBRO_COLUMN_COUNT).fill('');
  const isRectification = Boolean(m.corrects_movement_id);
  const nif = recipientId(m.party_nif ?? m.original_party_nif);
  const name = (m.party_name ?? m.original_party_name ?? '').trim();

  const invoiceType = isRectification ? 'R1' : nif ? 'F1' : 'F2';
  const issueDate = m.issue_date ?? m.invoice_date;
  const operationDate = m.fiscal_date && m.fiscal_date !== issueDate ? m.fiscal_date : '';

  const treatment = m.vat_treatment ?? 'taxable';
  let qualification = 'S1';
  let exemption = '';
  if (treatment === 'reverse_charge') qualification = 'S2';
  else if (treatment === 'not_subject') qualification = 'N1';
  else if (treatment === 'exempt') {
    qualification = '';
    exemption = 'E1';
  }

  const base = m.tax_base_cents;
  const subjectNotExempt = qualification === 'S1';
  const vatCents = subjectNotExempt ? m.vat_cents : 0;
  const total = base + vatCents;

  row[0] = String(m.fiscal_year);
  row[1] = aeatPeriod(m.quarter);
  row[2] = profile.activityCode;
  row[3] = profile.activityType;
  row[4] = epigrafeCode(profile.epigrafe);
  row[5] = invoiceType;
  row[6] = 'I01';
  row[7] = fmtDec(base);
  row[8] = fmtDate(issueDate);
  row[9] = fmtDate(operationDate);
  row[10] = '';
  row[11] = (m.invoice_number ?? '').slice(0, 20);
  row[12] = '';
  row[13] = nif?.type ?? '';
  row[14] = nif?.country ?? '';
  row[15] = nif?.id ?? '';
  row[16] = (nif ? name : 'VENTAS A CONSUMIDOR FINAL').slice(0, 40);
  row[17] = '01';
  row[18] = qualification;
  row[19] = exemption;
  row[20] = fmtDec(total);
  row[21] = fmtDec(base);
  if (subjectNotExempt) {
    row[22] = fmtDec(m.vat_rate_bps);
    row[23] = fmtDec(m.vat_cents);
  } else if (qualification === 'S2') {
    row[22] = fmtDec(0);
    row[23] = fmtDec(0);
  }
  if (m.irpf_rate_bps > 0 || m.irpf_withheld_cents !== 0) {
    row[30] = fmtDec(m.irpf_rate_bps);
    row[31] = fmtDec(m.irpf_withheld_cents);
  }
  return row;
}

export function loadLibroProfile(db: AppDb, year: number): LibroProfile {
  const profile = db
    .prepare('SELECT * FROM tax_profiles WHERE fiscal_year = ?')
    .get(year) as TaxProfileRow | undefined;
  if (!profile?.nif?.trim() || !profile.full_name?.trim()) {
    throw new AppError(
      ErrorCodes.VALIDATION_ERROR,
      'Completa NIF y nombre en Configuración antes de exportar el libro registro.',
      400,
    );
  }
  const activityCode = profile.activity_code || 'A';
  const hasActivityType = activityCode === 'A' || activityCode === 'B';
  return {
    nif: profile.nif.trim().toUpperCase(),
    fullName: profile.full_name.trim(),
    epigrafe: profile.epigrafe ?? '',
    activityCode,
    activityType: hasActivityType ? profile.activity_type || '05' : '',
  };
}

export function loadLibroMovements(db: AppDb, year: number, quarter: Quarter): LibroMovement[] {
  return db
    .prepare(
      `SELECT m.*, o.party_name AS original_party_name, o.party_nif AS original_party_nif
       FROM movements m
       LEFT JOIN movements o ON o.id = m.corrects_movement_id
       WHERE m.fiscal_year = ? AND m.quarter = ?
         AND m.status IN ('confirmed', 'locked', 'corrected')
         AND (m.type = 'income' OR (m.type = 'correction' AND o.type = 'income'))
       ORDER BY COALESCE(m.issue_date, m.invoice_date) ASC, m.invoice_number ASC`,
    )
    .all(year, quarter) as LibroMovement[];
}

const GROUP_HEADERS: { col: number; span: number; label: string }[] = [
  { col: 0, span: 2, label: 'Autoliquidación(11)' },
  { col: 2, span: 3, label: 'Actividad(16)' },
  { col: 5, span: 1, label: 'Tipo de Factura(9)' },
  { col: 6, span: 1, label: 'Concepto de\nIngreso(10) (17)' },
  { col: 7, span: 1, label: 'Ingreso Computable(13) (17)' },
  { col: 8, span: 1, label: 'Fecha\nExpedición(25)' },
  { col: 9, span: 1, label: 'Fecha\nOperación(1)' },
  { col: 10, span: 3, label: 'Identificación de la Factura' },
  { col: 13, span: 3, label: 'NIF Destinatario(2)' },
  { col: 16, span: 1, label: 'Nombre\nDestinatario' },
  { col: 17, span: 1, label: 'Clave de Operación(6)(23)' },
  { col: 18, span: 1, label: 'Calificación de la Operación(19) (21) (22) (23) (24) (30)' },
  { col: 19, span: 1, label: 'Operación\nExenta(20)' },
  { col: 20, span: 1, label: 'Total\nFactura(37)' },
  { col: 21, span: 1, label: 'Base\nImponible' },
  { col: 22, span: 1, label: 'Tipo\nde IVA(39)' },
  { col: 23, span: 1, label: 'Cuota IVA\nRepercutida' },
  { col: 24, span: 1, label: 'Tipo de\nRecargo Eq.' },
  { col: 25, span: 1, label: 'Cuota Recargo Eq.(35)' },
  {
    col: 26,
    span: 4,
    label: 'Cobro (Operación Criterio de Caja de IVA y/o artículo 7.2.1º de Reglamento del IRPF)',
  },
  { col: 30, span: 1, label: 'Tipo Retención\ndel IRPF(15) (17)' },
  { col: 31, span: 1, label: 'Importe Retenido\ndel IRPF(15) (17)' },
  { col: 32, span: 1, label: 'Registro Acuerdo Facturación(18)' },
  { col: 33, span: 2, label: 'Inmueble(40)' },
  { col: 35, span: 1, label: 'Referencia Externa' },
];

const SUB_HEADERS: Record<number, string> = {
  0: 'Ejercicio',
  1: 'Periodo',
  2: 'Código',
  3: 'Tipo',
  4: 'Grupo o Epígrafe del IAE',
  10: 'Serie',
  11: 'Número',
  12: 'Número-Final',
  13: 'Tipo',
  14: 'Código País',
  15: 'Identificación',
  26: 'Fecha',
  27: 'Importe',
  28: 'Medio Utilizado',
  29: 'Identificación Medio Utilizado',
  33: 'Situación',
  34: 'Referencia Catastral',
};

const DATA_TYPES = [
  'Decimal (4,0)', 'Alfanumérico (2)', 'Alfanumérico (1)', 'Alfanumérico (2)', 'Alfanumérico (4)',
  'Alfanumérico (2)', 'Alfanumérico (3)', 'Decimal(12,2)', 'Fecha(dd/mm/yyyy)', 'Fecha(dd/mm/yyyy)',
  'Alfanumérico (20)', 'Alfanumérico (20)', 'Alfanumérico (20)', 'Alfanumérico (2)', 'Alfanumérico (2)',
  'Alfanumérico (20)', 'Alfanumérico (40)', 'Alfanumérico (2)', 'Alfanumérico (2)', 'Alfanumérico (2)',
  'Decimal(12,2)', 'Decimal(12,2)', 'Decimal(4,2)', 'Decimal(12,2)', 'Decimal(4,2)', 'Decimal(12,2)',
  'Fecha(dd/mm/yyyy)', 'Decimal(12,2)', 'Alfanumérico (2)', 'Alfanumérico (34)', 'Decimal(4,2)',
  'Decimal(12,2)', 'Alfanumérico (15)', 'Alfanumérico (1)', 'Alfanumérico (20)', 'Alfanumérico (40)',
];

const TAX_SCOPE: Record<number, string> = {
  6: 'IRPF',
  7: 'IRPF',
  17: 'IVA',
  18: 'IVA',
  19: 'IVA',
  30: 'IRPF',
  31: 'IRPF',
  32: 'IVA',
};

export async function buildLibroExpedidasXlsx(
  profile: LibroProfile,
  year: number,
  rows: string[][],
): Promise<Buffer> {
  const fileBase = libroFileName(year, profile.nif, profile.fullName).replace(/\.xlsx$/, '');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Libro Registro');

  ws.getCell(1, 1).value =
    `LIBRO REGISTRO FACTURAS EXPEDIDAS Y LIBRO REGISTRO DE VENTAS E INGRESOS (Nombre del fichero: ${fileBase})`;
  ws.getCell(1, 1).font = { bold: true };
  ws.getCell(2, 1).value = `Ejercicio: ${year}`;
  ws.getCell(3, 1).value = `NIF: ${profile.nif}`;
  ws.getCell(4, 1).value =
    '@ (Tipo de Libro Registro): U (Unificado de Facturas Emitidas -IVA- y de Ventas e Ingresos -IRPF-)';
  ws.getCell(5, 1).value = `NOMBRE O RAZÓN SOCIAL: ${profile.fullName}`;

  const groupRow = 7;
  const subRow = 8;
  const typeRow = 9;
  const scopeRow = 10;
  const headerStyle: Partial<ExcelJS.Style> = {
    font: { bold: true },
    alignment: { wrapText: true, vertical: 'middle', horizontal: 'center' },
    border: {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    },
  };

  for (const g of GROUP_HEADERS) {
    const first = g.col + 1;
    const last = g.col + g.span;
    ws.getCell(groupRow, first).value = g.label;
    if (g.span > 1) ws.mergeCells(groupRow, first, groupRow, last);
    else ws.mergeCells(groupRow, first, subRow, first);
  }
  for (const [col, label] of Object.entries(SUB_HEADERS)) {
    ws.getCell(subRow, Number(col) + 1).value = label;
  }
  DATA_TYPES.forEach((t, i) => {
    ws.getCell(typeRow, i + 1).value = t;
  });
  for (const [col, scope] of Object.entries(TAX_SCOPE)) {
    ws.getCell(scopeRow, Number(col) + 1).value = scope;
  }
  for (const r of [groupRow, subRow, typeRow, scopeRow]) {
    for (let c = 1; c <= LIBRO_COLUMN_COUNT; c++) ws.getCell(r, c).style = headerStyle;
  }
  ws.getRow(groupRow).height = 45;

  rows.forEach((values, i) => {
    const row = ws.getRow(scopeRow + 1 + i);
    values.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v;
      cell.numFmt = '@';
    });
  });

  for (let c = 1; c <= LIBRO_COLUMN_COUNT; c++) {
    ws.getColumn(c).width = c === 17 ? 32 : 14;
  }

  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

export async function exportLibroExpedidas(db: AppDb, year: number, quarter: Quarter) {
  const profile = loadLibroProfile(db, year);
  const rows = loadLibroMovements(db, year, quarter).map((m) => movementToLibroRow(m, profile));
  const buffer = await buildLibroExpedidasXlsx(profile, year, rows);
  return {
    buffer,
    fileName: libroFileName(year, profile.nif, profile.fullName),
    rowCount: rows.length,
  };
}
