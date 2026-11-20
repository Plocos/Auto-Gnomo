import { describe, expect, it } from 'vitest';
import { assistantAcceptSchema } from '@autonomous/shared';
import { applyPartyHistory, type HistorySample } from './history.js';
import {
  asDate,
  asEurosToCents,
  constrainCategory,
  extractJsonObject,
  normalizeModelOutput,
  type SourceFileMeta,
} from './parse.js';

const files: SourceFileMeta[] = [{ id: 'f1', filename: 'factura.pdf' }];

describe('extractJsonObject', () => {
  it('lee un objeto entre texto y una cerca markdown', () => {
    const value = extractJsonObject('Aquí va:\n```json\n{"summary":"ok","proposals":[]}\n```\nfin');
    expect(value).toEqual({ summary: 'ok', proposals: [] });
  });

  it('rechaza texto sin objeto', () => {
    expect(() => extractJsonObject('no hay datos')).toThrow(/JSON/);
  });
});

describe('normalizeModelOutput', () => {
  it('recalcula IVA y total y no se inventa el NIF', () => {
    const { proposals } = normalizeModelOutput(
      {
        summary: 'Una factura',
        proposals: [
          {
            sourceFile: 'factura.pdf',
            documentKind: 'invoice',
            type: 'expense',
            invoiceDate: '12/03/2026',
            invoiceNumber: 'A-9',
            partyName: 'Papelería Norte',
            partyNif: null,
            concept: 'Folios',
            taxBaseEuros: 10,
            vatRatePercent: 21,
            irpfRatePercent: 0,
            documentTotalEuros: 12.1,
          },
        ],
      },
      { files },
    );
    const proposal = proposals[0];
    expect(proposal?.invoiceDate).toBe('2026-03-12');
    expect(proposal?.fiscalDate).toBe('2026-03-12');
    expect(proposal?.taxBaseCents).toBe(1000);
    expect(proposal?.vatRateBps).toBe(2100);
    expect(proposal?.vatCents).toBe(210);
    expect(proposal?.totalCents).toBe(1210);
    expect(proposal?.totalMismatch).toBe(false);
    expect(proposal?.partyNif).toBeUndefined();
    expect(proposal?.fileId).toBe('f1');
    expect(proposal?.deductionOrigin).toBe('model');
  });

  it('marca el descuadre y deja vacíos los datos que no vienen', () => {
    const { proposals } = normalizeModelOutput({
      proposals: [
        {
          type: 'expense',
          documentKind: 'ticket',
          concept: 'Café',
          taxBaseEuros: '10,00',
          vatRatePercent: 10,
          documentTotalEuros: 20,
        },
      ],
    });
    const proposal = proposals[0];
    expect(proposal?.documentKind).toBe('ticket');
    expect(proposal?.taxBaseCents).toBe(1000);
    expect(proposal?.vatCents).toBe(100);
    expect(proposal?.totalMismatch).toBe(true);
    expect(proposal?.missingFields).toContain('invoiceDate');
    expect(proposal?.partyNif).toBeUndefined();
  });

  it('ajusta un 21,1% al 21 y exige coeficiente en inmovilizado', () => {
    const { proposals } = normalizeModelOutput({
      proposals: [
        {
          type: 'expense',
          expenseNature: 'fixed_asset',
          concept: 'Portátil',
          invoiceDate: '2026-01-02',
          taxBaseEuros: 1000,
          vatRatePercent: 21.1,
          documentTotalEuros: 1210,
        },
      ],
    });
    const proposal = proposals[0];
    expect(proposal?.vatRateBps).toBe(2100);
    expect(proposal?.expenseNature).toBe('fixed_asset');
    expect(proposal?.missingFields).toContain('coefficientBps');
  });

  it('con criterio de caja usa la fecha de pago como fecha fiscal', () => {
    const { proposals } = normalizeModelOutput(
      {
        proposals: [
          {
            type: 'income',
            concept: 'Proyecto',
            invoiceDate: '2026-01-10',
            settlementDate: '2026-02-02',
            taxBaseEuros: 100,
            vatRatePercent: 21,
          },
        ],
      },
      { temporalCriterion: 'caja' },
    );
    expect(proposals[0]?.fiscalDate).toBe('2026-02-02');
    expect(proposals[0]?.documentKind).toBe('invoice');
  });
});

describe('dinero y fechas sueltas', () => {
  it('entiende miles europeos', () => {
    expect(asEurosToCents('1.234,50')).toBe(123450);
    expect(asDate('2-1-2026')).toBe('2026-01-02');
  });
});

describe('categorías', () => {
  it('quita una categoría que no existe', () => {
    const { proposals } = normalizeModelOutput({
      proposals: [{ type: 'expense', concept: 'X', categoryKey: 'inventada', invoiceDate: '2026-01-01', taxBaseEuros: 1, vatRatePercent: 21 }],
    });
    const proposal = proposals[0];
    if (!proposal) throw new Error('sin propuesta');
    const next = constrainCategory(proposal, new Set(['software']));
    expect(next.categoryKey).toBeUndefined();
    expect(next.warnings?.some((w) => w.includes('inventada'))).toBe(true);
  });
});

describe('histórico del tercero', () => {
  const base = normalizeModelOutput({
    proposals: [
      {
        type: 'expense',
        concept: 'Licencia',
        partyName: 'Adobe',
        invoiceDate: '2026-04-01',
        taxBaseEuros: 50,
        vatRatePercent: 21,
        professionalUsePercent: 100,
        taxDeductiblePercent: 100,
        categoryKey: 'services',
      },
    ],
  }).proposals[0];

  const history: HistorySample[] = [
    { partyName: 'ADOBE', partyNif: null, categoryKey: 'software', professionalUseBps: 10_000, taxDeductibleBps: 5_000 },
    { partyName: 'Adobe', partyNif: null, categoryKey: 'software', professionalUseBps: 10_000, taxDeductibleBps: 5_000 },
  ];

  it('copia categoría y porcentajes cuando los últimos coinciden', () => {
    if (!base) throw new Error('sin propuesta');
    const next = applyPartyHistory(base, history);
    expect(next.deductionOrigin).toBe('history');
    expect(next.categoryKey).toBe('software');
    expect(next.taxDeductibleBps).toBe(5_000);
    expect(next.taxBaseCents).toBe(5000);
  });

  it('no pisa los porcentajes si los movimientos del tercero no coinciden', () => {
    if (!base) throw new Error('sin propuesta');
    const mixed: HistorySample[] = [
      history[0]!,
      { ...history[1]!, taxDeductibleBps: 10_000, categoryKey: 'services' },
    ];
    const next = applyPartyHistory(base, mixed);
    expect(next.deductionOrigin).toBe('model');
    expect(next.taxDeductibleBps).toBe(10_000);
  });
});

describe('assistantAcceptSchema', () => {
  it('rechaza una propuesta sin concepto', () => {
    const result = assistantAcceptSchema.safeParse({
      documentKind: 'invoice',
      type: 'expense',
      invoiceDate: '2026-01-01',
      fiscalDate: '2026-01-01',
      concept: '',
      taxBaseCents: 100,
      vatRateBps: 2100,
    });
    expect(result.success).toBe(false);
  });

  it('acepta un gasto con base y deja el origen para el servidor', () => {
    const result = assistantAcceptSchema.safeParse({
      documentKind: 'ticket',
      type: 'expense',
      invoiceDate: '2026-01-01',
      fiscalDate: '2026-01-01',
      concept: 'Ticket',
      taxBaseCents: 100,
      vatRateBps: 2100,
      expenseNature: 'fixed_asset',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.coefficientBps).toBeUndefined();
  });
});
