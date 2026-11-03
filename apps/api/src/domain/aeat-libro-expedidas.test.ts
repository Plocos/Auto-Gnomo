import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  aeatPeriod,
  buildLibroExpedidasXlsx,
  epigrafeCode,
  fmtDate,
  fmtDec,
  LIBRO_COLUMN_COUNT,
  libroFileName,
  movementToLibroRow,
  recipientId,
  type LibroMovement,
  type LibroProfile,
} from './aeat-libro-expedidas.js';

const profile: LibroProfile = {
  nif: '99999999R',
  fullName: 'español español, juan',
  epigrafe: '763 Programadores',
  activityCode: 'A',
  activityType: '05',
};

function income(overrides: Partial<LibroMovement> = {}): LibroMovement {
  return {
    id: 'm1',
    type: 'income',
    invoice_date: '2026-05-02',
    fiscal_date: '2026-05-02',
    issue_date: null,
    fiscal_year: 2026,
    quarter: 'T2',
    invoice_number: '2026-001',
    party_name: 'Cliente SL',
    party_nif: 'B-12345678',
    tax_base_cents: 100_000,
    vat_rate_bps: 2100,
    vat_cents: 21_000,
    irpf_rate_bps: 1500,
    irpf_withheld_cents: 15_000,
    vat_treatment: 'taxable',
    corrects_movement_id: null,
    ...overrides,
  };
}

describe('formatters', () => {
  it('formats decimals with comma and minus sign', () => {
    expect(fmtDec(6_632_512)).toBe('66325,12');
    expect(fmtDec(13_500)).toBe('135,00');
    expect(fmtDec(1050)).toBe('10,50');
    expect(fmtDec(-50_236)).toBe('-502,36');
    expect(fmtDec(0)).toBe('0,00');
  });

  it('formats dates as dd/mm/yyyy', () => {
    expect(fmtDate('2018-05-02')).toBe('02/05/2018');
    expect(fmtDate(null)).toBe('');
  });

  it('maps quarters and epígrafes', () => {
    expect(aeatPeriod('T1')).toBe('1T');
    expect(aeatPeriod('T4')).toBe('4T');
    expect(epigrafeCode('653.3 comercio menor')).toBe('6533');
    expect(epigrafeCode('IAE 763')).toBe('763');
  });

  it('builds the AEAT file name', () => {
    expect(libroFileName(2026, '99999999R', 'español español, juan')).toBe(
      '202699999999RUespañol español, juan.xlsx',
    );
  });

  it('normalizes recipient ids', () => {
    expect(recipientId('A-12345678')).toEqual({ type: '', country: '', id: 'A12345678' });
    expect(recipientId('ESB12345678')).toEqual({ type: '', country: '', id: 'B12345678' });
    expect(recipientId('DE123456789')).toEqual({ type: '02', country: 'DE', id: 'DE123456789' });
    expect(recipientId('  ')).toBeNull();
  });
});

describe('movementToLibroRow', () => {
  it('maps a standard F1 invoice', () => {
    const row = movementToLibroRow(income(), profile);
    expect(row).toHaveLength(LIBRO_COLUMN_COUNT);
    expect(row.slice(0, 9)).toEqual([
      '2026',
      '2T',
      'A',
      '05',
      '763',
      'F1',
      'I01',
      '1000,00',
      '02/05/2026',
    ]);
    expect(row[9]).toBe('');
    expect(row[11]).toBe('2026-001');
    expect(row[15]).toBe('B12345678');
    expect(row[16]).toBe('Cliente SL');
    expect(row[17]).toBe('01');
    expect(row[18]).toBe('S1');
    expect(row[19]).toBe('');
    expect(row[20]).toBe('1210,00');
    expect(row[21]).toBe('1000,00');
    expect(row[22]).toBe('21,00');
    expect(row[23]).toBe('210,00');
    expect(row[30]).toBe('15,00');
    expect(row[31]).toBe('150,00');
  });

  it('uses F2 and VENTAS A CONSUMIDOR FINAL without recipient NIF', () => {
    const row = movementToLibroRow(income({ party_nif: null, party_name: 'Cliente SL' }), profile);
    expect(row[5]).toBe('F2');
    expect(row[15]).toBe('');
    expect(row[16]).toBe('VENTAS A CONSUMIDOR FINAL');
  });

  it('uses R1 for rectifications and inherits the original recipient', () => {
    const row = movementToLibroRow(
      income({
        type: 'correction',
        corrects_movement_id: 'orig',
        party_nif: null,
        party_name: null,
        original_party_nif: '12345678Z',
        original_party_name: 'Cliente original',
        tax_base_cents: -20_000,
        vat_cents: -4200,
        irpf_rate_bps: 0,
        irpf_withheld_cents: 0,
      }),
      profile,
    );
    expect(row[5]).toBe('R1');
    expect(row[15]).toBe('12345678Z');
    expect(row[16]).toBe('Cliente original');
    expect(row[20]).toBe('-242,00');
    expect(row[30]).toBe('');
    expect(row[31]).toBe('');
  });

  it('fills operation date only when it differs from issue date', () => {
    const row = movementToLibroRow(
      income({ invoice_date: '2026-04-03', fiscal_date: '2026-03-30' }),
      profile,
    );
    expect(row[8]).toBe('03/04/2026');
    expect(row[9]).toBe('30/03/2026');
  });

  it('maps vat treatments to calificación / exención', () => {
    const exempt = movementToLibroRow(income({ vat_treatment: 'exempt', vat_cents: 0 }), profile);
    expect(exempt[18]).toBe('');
    expect(exempt[19]).toBe('E1');
    expect(exempt[20]).toBe('1000,00');
    expect(exempt[22]).toBe('');

    const notSubject = movementToLibroRow(income({ vat_treatment: 'not_subject' }), profile);
    expect(notSubject[18]).toBe('N1');
    expect(notSubject[20]).toBe('1000,00');

    const isp = movementToLibroRow(income({ vat_treatment: 'reverse_charge' }), profile);
    expect(isp[18]).toBe('S2');
    expect(isp[22]).toBe('0,00');
    expect(isp[23]).toBe('0,00');
    expect(isp[20]).toBe('1000,00');
  });
});

describe('buildLibroExpedidasXlsx', () => {
  it('writes header block and data rows as text', async () => {
    const rows = [movementToLibroRow(income(), profile)];
    const buffer = await buildLibroExpedidasXlsx(profile, 2026, rows);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getCell(1, 1).value)).toContain('202699999999RUespañol español, juan');
    expect(ws.getCell(3, 1).value).toBe('NIF: 99999999R');
    expect(ws.getCell(7, 1).value).toBe('Autoliquidación(11)');
    expect(ws.getCell(8, 11).value).toBe('Serie');
    expect(ws.getCell(9, 36).value).toBe('Alfanumérico (40)');
    expect(ws.getCell(11, 1).value).toBe('2026');
    expect(ws.getCell(11, 21).value).toBe('1210,00');
  });
});
