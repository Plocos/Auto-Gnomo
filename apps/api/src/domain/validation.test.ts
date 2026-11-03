import { describe, expect, it } from 'vitest';
import { normalizeMovement, checkActivityStart } from './validation.js';

describe('normalizeMovement', () => {
  it('computes VAT and total for laptop example', () => {
    const { movement, issues } = normalizeMovement({
      type: 'expense',
      invoiceDate: '2026-06-02',
      fiscalDate: '2026-06-02',
      concept: 'Portátil',
      taxBaseCents: 74298,
      vatRateBps: 2100,
      status: 'confirmed',
      source: 'manual',
      professionalUseBps: 10_000,
      taxDeductibleBps: 10_000,
      expenseNature: 'fixed_asset',
    });
    expect(movement.vatCents).toBe(15603);
    expect(movement.totalCents).toBe(89901);
    expect(movement.quarter).toBe('T2');
    expect(movement.fiscalYear).toBe(2026);
    expect(issues.some((i) => i.code === 'FIXED_ASSET_NO_LINK')).toBe(true);

    const withCoef = normalizeMovement({
      type: 'expense',
      invoiceDate: '2026-06-02',
      fiscalDate: '2026-06-02',
      concept: 'Portátil',
      taxBaseCents: 74298,
      vatRateBps: 2100,
      status: 'confirmed',
      source: 'manual',
      professionalUseBps: 10_000,
      taxDeductibleBps: 10_000,
      expenseNature: 'fixed_asset',
      coefficientBps: 2600,
    });
    expect(withCoef.issues.some((i) => i.code === 'FIXED_ASSET_NO_LINK')).toBe(false);
  });

  it('flags wrong VAT', () => {
    const { issues } = normalizeMovement({
      type: 'expense',
      invoiceDate: '2026-06-02',
      fiscalDate: '2026-06-02',
      concept: 'X',
      taxBaseCents: 10000,
      vatRateBps: 2100,
      vatCents: 1500,
      status: 'draft',
      source: 'manual',
      professionalUseBps: 10_000,
      taxDeductibleBps: 10_000,
      expenseNature: 'current',
    });
    expect(issues.some((i) => i.code === 'INVALID_VAT')).toBe(true);
  });

  it('warns before activity start', () => {
    const issue = checkActivityStart('2026-04-01', '2026-05-08');
    expect(issue?.severity).toBe('warning');
  });
});
