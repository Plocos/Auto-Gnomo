import { describe, expect, it } from 'vitest';
import { parseTsvPaste } from './import-export.js';

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
});
