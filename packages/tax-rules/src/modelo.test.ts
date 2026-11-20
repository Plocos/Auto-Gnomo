import { describe, expect, it } from 'vitest';
import { computeModelo130 } from '../src/2026/modelo130.js';
import { computeModelo303 } from '../src/2026/vat.js';
import type { MovementLike } from '../src/types.js';

function mov(partial: Partial<MovementLike> & Pick<MovementLike, 'id' | 'type' | 'concept'>): MovementLike {
  return {
    fiscalDate: '2026-06-02',
    fiscalYear: 2026,
    quarter: 'T2',
    taxBaseCents: 0,
    vatRateBps: 0,
    vatCents: 0,
    irpfRateBps: 0,
    irpfWithheldCents: 0,
    totalCents: 0,
    professionalUseBps: 10_000,
    taxDeductibleBps: 10_000,
    status: 'confirmed',
    ...partial,
  };
}

describe('Modelo 130 2026', () => {
  it('computes cumulative boxes', () => {
    const movements = [
      mov({
        id: '1',
        type: 'income',
        concept: 'Servicio',
        taxBaseCents: 100_000,
        vatRateBps: 2100,
        vatCents: 21_000,
        totalCents: 121_000,
        fiscalDate: '2026-03-01',
        quarter: 'T1',
      }),
      mov({
        id: '2',
        type: 'expense',
        concept: 'Hosting',
        taxBaseCents: 20_000,
        vatRateBps: 2100,
        vatCents: 4200,
        totalCents: 24_200,
        fiscalDate: '2026-05-01',
        quarter: 'T2',
      }),
    ];

    const q1 = computeModelo130({
      fiscalYear: 2026,
      quarter: 'T1',
      movements,
      previousInstallmentsCents: 0,
    });
    expect(q1.boxes['01']!.amountCents).toBe(100_000);
    expect(q1.boxes['02']!.amountCents).toBe(0);
    expect(q1.boxes['04']!.amountCents).toBe(20_000);

    const q2 = computeModelo130({
      fiscalYear: 2026,
      quarter: 'T2',
      movements,
      previousInstallmentsCents: 20_000,
    });
    expect(q2.boxes['01']!.amountCents).toBe(100_000);
    expect(q2.boxes['02']!.amountCents).toBe(20_000);
    expect(q2.boxes['03']!.amountCents).toBe(80_000);
    expect(q2.boxes['04']!.amountCents).toBe(16_000);
    expect(q2.boxes['05']!.amountCents).toBe(20_000);
    expect(q2.boxes['07']!.amountCents).toBe(-4_000);
  });
});

describe('Modelo 130 inmovilizado', () => {
  it('excludes fixed_asset purchase and includes amortization entries', () => {
    const movements = [
      mov({
        id: 'buy',
        type: 'expense',
        concept: 'Portátil',
        taxBaseCents: 74_298,
        expenseNature: 'fixed_asset',
        fiscalDate: '2026-06-02',
        quarter: 'T2',
      }),
      mov({
        id: 'host',
        type: 'expense',
        concept: 'Hosting',
        taxBaseCents: 10_000,
        fiscalDate: '2026-05-01',
        quarter: 'T2',
      }),
    ];
    const r = computeModelo130({
      fiscalYear: 2026,
      quarter: 'T2',
      movements,
      amortizations: [
        {
          id: 'am1',
          concept: 'Amortización: Portátil (T2 2026)',
          fiscalYear: 2026,
          quarter: 'T2',
          fiscalDate: '2026-06-30',
          amountCents: 1_535,
        },
      ],
      previousInstallmentsCents: 0,
    });
    expect(r.boxes['02']!.amountCents).toBe(10_000 + 1_535);
    expect(r.boxes['02']!.breakdown.map((b) => b.movementId)).toEqual(['host', 'am1']);
  });
});

describe('Modelo 303 2026', () => {
  it('separates repercutido and soportado', () => {
    const movements = [
      mov({
        id: 'i',
        type: 'income',
        concept: 'Factura',
        taxBaseCents: 100_000,
        vatRateBps: 2100,
        vatCents: 21_000,
        totalCents: 121_000,
      }),
      mov({
        id: 'e',
        type: 'expense',
        concept: 'Compra',
        taxBaseCents: 10_000,
        vatRateBps: 2100,
        vatCents: 2_100,
        totalCents: 12_100,
        expenseNature: 'current',
      }),
    ];
    const r = computeModelo303({ fiscalYear: 2026, quarter: 'T2', movements });
    expect(r.boxes['07']!.amountCents).toBe(100_000);
    expect(r.boxes['09']!.amountCents).toBe(21_000);
    expect(r.boxes['28']!.amountCents).toBe(10_000);
    expect(r.boxes['29']!.amountCents).toBe(2_100);
    expect(r.boxes['30']!.amountCents).toBe(0);
    expect(r.boxes['31']!.amountCents).toBe(0);
    expect(r.boxes['45']!.amountCents).toBe(2_100);
    expect(r.boxes['46']!.amountCents).toBe(18_900);
    expect(r.resultCents).toBe(18_900);
  });

  it('excludes exempt and not_subject income from casilla 150', () => {
    const movements = [
      mov({
        id: 'ex',
        type: 'income',
        concept: 'Taller exento',
        taxBaseCents: 66_750,
        vatRateBps: 0,
        vatCents: 0,
        vatTreatment: 'exempt',
        totalCents: 66_750,
      }),
      mov({
        id: 'ns',
        type: 'grant',
        concept: 'Ayuda no sujeta',
        taxBaseCents: 10_000,
        vatRateBps: 0,
        vatCents: 0,
        vatTreatment: 'not_subject',
        totalCents: 10_000,
      }),
      mov({
        id: 'zero',
        type: 'income',
        concept: 'Sujeta tipo 0%',
        taxBaseCents: 5_000,
        vatRateBps: 0,
        vatCents: 0,
        totalCents: 5_000,
      }),
    ];
    const r = computeModelo303({ fiscalYear: 2026, quarter: 'T2', movements });
    expect(r.boxes['150']!.amountCents).toBe(5_000);
    expect(r.boxes['152']!.amountCents).toBe(0);
    expect(r.resultCents).toBe(0);
  });

  it('splits current vs investment deductible VAT (T2 fixture)', () => {
    const movements = [
      mov({
        id: 'laptop',
        type: 'expense',
        concept: 'Portátil',
        taxBaseCents: 74_298,
        vatRateBps: 2100,
        vatCents: 15_603,
        totalCents: 89_900,
        expenseNature: 'fixed_asset',
      }),
      mov({
        id: 'charger',
        type: 'expense',
        concept: 'Cargador',
        taxBaseCents: 2_809,
        vatRateBps: 2100,
        vatCents: 590,
        totalCents: 3_398,
        expenseNature: 'current',
      }),
      mov({
        id: 'case',
        type: 'expense',
        concept: 'Maletín',
        taxBaseCents: 3_717,
        vatRateBps: 2100,
        vatCents: 781,
        totalCents: 4_498,
        expenseNature: 'current',
      }),
      mov({
        id: 'income',
        type: 'income',
        concept: 'Talleres',
        taxBaseCents: 66_750,
        vatRateBps: 0,
        vatCents: 0,
        vatTreatment: 'exempt',
        totalCents: 66_750,
      }),
    ];
    const r = computeModelo303({ fiscalYear: 2026, quarter: 'T2', movements });
    expect(r.boxes['150']!.amountCents).toBe(0);
    expect(r.boxes['28']!.amountCents).toBe(2_809 + 3_717);
    expect(r.boxes['29']!.amountCents).toBe(590 + 781);
    expect(r.boxes['30']!.amountCents).toBe(74_298);
    expect(r.boxes['31']!.amountCents).toBe(15_603);
    expect(r.boxes['45']!.amountCents).toBe(16_974);
    expect(r.boxes['46']!.amountCents).toBe(-16_974);
    expect(r.resultCents).toBe(-16_974);
  });

  const income21 = (base: number) =>
    mov({
      id: `i${base}`,
      type: 'income',
      concept: 'Factura',
      taxBaseCents: base,
      vatRateBps: 2100,
      vatCents: Math.round(base * 0.21),
      totalCents: base + Math.round(base * 0.21),
    });
  const expense = (vat: number) =>
    mov({
      id: `e${vat}`,
      type: 'expense',
      concept: 'Gasto',
      taxBaseCents: vat * 5,
      vatRateBps: 2100,
      vatCents: vat,
      totalCents: vat * 6,
    });

  it('does not apply previous pending when the quarter is negative (78 = 0)', () => {
    const r = computeModelo303({
      fiscalYear: 2026,
      quarter: 'T3',
      movements: [expense(8_225)].map((m) => ({ ...m, quarter: 'T3' as const })),
      pendingFromPreviousCents: 16_974,
    });
    expect(r.boxes['46']!.amountCents).toBe(-8_225);
    expect(r.boxes['66']!.amountCents).toBe(-8_225);
    expect(r.boxes['110']!.amountCents).toBe(16_974);
    expect(r.boxes['78']!.amountCents).toBe(0);
    expect(r.boxes['87']!.amountCents).toBe(16_974);
    expect(r.boxes['71']!.amountCents).toBe(-8_225);
    expect(r.resultCents).toBe(-8_225);
    expect(r.carryForwardCents).toBe(16_974 + 8_225);
    expect(r.boxes.comp).toBeUndefined();
    expect(r.boxes.result).toBeUndefined();
  });

  it('applies the whole pending when the quarter result is larger (78 = 110)', () => {
    const r = computeModelo303({
      fiscalYear: 2026,
      quarter: 'T2',
      movements: [income21(100_000)],
      pendingFromPreviousCents: 5_000,
    });
    expect(r.boxes['66']!.amountCents).toBe(21_000);
    expect(r.boxes['78']!.amountCents).toBe(5_000);
    expect(r.boxes['87']!.amountCents).toBe(0);
    expect(r.resultCents).toBe(16_000);
    expect(r.carryForwardCents).toBe(0);
  });

  it('applies only up to the quarter result when pending is larger (78 = 66)', () => {
    const r = computeModelo303({
      fiscalYear: 2026,
      quarter: 'T2',
      movements: [income21(10_000)],
      pendingFromPreviousCents: 5_000,
    });
    expect(r.boxes['66']!.amountCents).toBe(2_100);
    expect(r.boxes['78']!.amountCents).toBe(2_100);
    expect(r.boxes['87']!.amountCents).toBe(2_900);
    expect(r.resultCents).toBe(0);
    expect(r.carryForwardCents).toBe(2_900);
  });

  it('tags boxes with AEAT page and entry type', () => {
    const r = computeModelo303({ fiscalYear: 2026, quarter: 'T2', movements: [] });
    expect(r.boxes['29']).toMatchObject({ page: 'liquidacion', entry: 'manual' });
    expect(r.boxes['46']).toMatchObject({ page: 'liquidacion', entry: 'auto' });
    expect(r.boxes['110']).toMatchObject({ page: 'resultado', entry: 'prefilled' });
    expect(r.boxes['65']).toMatchObject({ unit: 'percent', amountCents: 10_000 });
  });

  it('warns on 0 % income without explicit zero_rate and maps not_subject income to 120', () => {
    const r = computeModelo303({
      fiscalYear: 2026,
      quarter: 'T2',
      movements: [
        mov({ id: 'z', type: 'income', concept: 'Sin IVA', taxBaseCents: 141_177, totalCents: 141_177 }),
        mov({
          id: 'z2',
          type: 'income',
          concept: 'Tipo 0 confirmado',
          taxBaseCents: 1_000,
          totalCents: 1_000,
          vatTreatment: 'zero_rate',
        }),
        mov({
          id: 'ext',
          type: 'income',
          concept: 'Cliente extranjero',
          taxBaseCents: 50_000,
          totalCents: 50_000,
          vatTreatment: 'not_subject',
        }),
      ],
    });
    expect(r.boxes['150']!.amountCents).toBe(142_177);
    expect(r.boxes['150']!.uncertain).toBe(true);
    expect(r.boxes['120']).toMatchObject({ page: 'adicional', amountCents: 50_000, uncertain: true });

    const confirmed = computeModelo303({
      fiscalYear: 2026,
      quarter: 'T2',
      movements: [
        mov({
          id: 'z2',
          type: 'income',
          concept: 'Tipo 0 confirmado',
          taxBaseCents: 1_000,
          totalCents: 1_000,
          vatTreatment: 'zero_rate',
        }),
      ],
    });
    expect(confirmed.boxes['150']!.uncertain).toBeUndefined();
    expect(confirmed.boxes['120']).toBeUndefined();
  });

  it('adds a refund note on negative 4T results', () => {
    const r = computeModelo303({
      fiscalYear: 2026,
      quarter: 'T4',
      movements: [{ ...expense(1_000), quarter: 'T4' }],
    });
    expect(r.boxes['71']!.warning).toMatch(/devolución/);
  });
});
