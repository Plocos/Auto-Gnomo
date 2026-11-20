import { describe, expect, it } from 'vitest';
import {
  amountsAgree,
  applyRate,
  computeTotal,
  computeVat,
  eurosToCents,
  formatEuros,
  parseEurosToCents,
  roundHalfUp,
} from '../src/money.js';

describe('money', () => {
  it('avoids float errors for VAT 21% on 742.98', () => {
    const base = eurosToCents(742.98);
    expect(base).toBe(74298);
    const vat = computeVat(base, 2100);
    expect(vat).toBe(15603); // 156.03
    expect(computeTotal(base, vat, 0)).toBe(89901);
  });

  it('0.1 + 0.2 style amounts stay exact in cents', () => {
    expect(eurosToCents(0.1) + eurosToCents(0.2)).toBe(30);
  });

  it('half-up rounding', () => {
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(1.4)).toBe(1);
    expect(applyRate(10000, 1050)).toBe(1050); // 10.50% of 100.00
  });

  it('formats and parses Spanish euros', () => {
    expect(formatEuros(74298)).toBe('742,98 €');
    expect(parseEurosToCents('742,98')).toBe(74298);
    expect(parseEurosToCents('1.234,56')).toBe(123456);
  });

  it('amountsAgree with 1 cent tolerance', () => {
    expect(amountsAgree(100, 101)).toBe(true);
    expect(amountsAgree(100, 102)).toBe(false);
  });
});
