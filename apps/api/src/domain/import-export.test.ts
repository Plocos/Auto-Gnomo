import { describe, expect, it } from 'vitest';
import { parseImportText, parseTsvPaste } from './import-export.js';

describe('parseTsvPaste', () => {
  it('parses excel-like TSV', () => {
    const tsv = [
      'Fecha\tConcepto\tBase\tIVA\tTotal',
      '01/09/2026\tNetcup\t19.95\t21\t24.14',
      '02/09/2026\tBad\t100\t21\t15',
    ].join('\n');
    const { rows } = parseTsvPaste(tsv, 'expense');
    expect(rows[0]!.ok).toBe(true);
    expect(rows[0]!.data?.taxBaseCents).toBe(1995);
    expect(rows[0]!.data?.vatCents).toBe(419);
    expect(rows[1]!.ok).toBe(false);
  });

  it('parses semicolon csv and quoted commas', () => {
    const csv = [
      'Fecha;Concepto;Base;IVA;Total',
      '01/09/2026;"Netcup, VPS";19,95;21;24,14',
    ].join('\n');
    const { rows } = parseImportText(csv);
    expect(rows[0]!.ok).toBe(true);
    expect(rows[0]!.data?.concept).toBe('Netcup, VPS');
    expect(rows[0]!.data?.taxBaseCents).toBe(1995);
  });

  it('parses a json list with spanish headers', () => {
    const json = JSON.stringify([
      { Fecha: '2026-09-01', Concepto: 'Netcup', Base: '19.95', IVA: '21', Total: '24.14' },
    ]);
    const { rows } = parseImportText(json);
    expect(rows[0]!.ok).toBe(true);
    expect(rows[0]!.data?.fiscalDate).toBe('2026-09-01');
  });

  it('parses json movement fields in cents', () => {
    const json = JSON.stringify([
      { fiscalDate: '2026-09-01', concept: 'Netcup', taxBaseCents: 1995, vatRateBps: 2100, type: 'expense' },
    ]);
    const { rows } = parseImportText(json);
    expect(rows[0]!.ok).toBe(true);
    expect(rows[0]!.data?.taxBaseCents).toBe(1995);
    expect(rows[0]!.data?.vatCents).toBe(419);
  });
});
