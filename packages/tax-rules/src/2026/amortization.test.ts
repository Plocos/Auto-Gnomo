import { describe, expect, it } from 'vitest';
import { parseISODateOnly } from '@autonomous/shared';
import {
  annualAmortization,
  quarterlyAmortizationScheduleByDays,
} from './amortization.js';

describe('amortization day-proration', () => {
  it('portátil: T2 2026 = 15,35 € y pendiente 727,63 €', () => {
    const taxBaseCents = 74_298;
    const coefficientBps = 2_600;
    const annual = annualAmortization(taxBaseCents, coefficientBps);
    expect(annual).toBe(19_317);

    const schedule = quarterlyAmortizationScheduleByDays({
      taxBaseCents,
      coefficientBps,
      inServiceDate: parseISODateOnly('2026-06-02'),
    });

    const t2 = schedule.find((r) => r.year === 2026 && r.quarter === 'T2');
    expect(t2?.amountCents).toBe(1_535);
    expect(t2?.fiscalDate).toBe('2026-06-30');

    const pendingAfterT2 = taxBaseCents - (t2?.amountCents ?? 0);
    expect(pendingAfterT2).toBe(72_763);

    const total = schedule.reduce((s, r) => s + r.amountCents, 0);
    expect(total).toBe(taxBaseCents);
  });

  it('schedule exhausts the tax base exactly', () => {
    const taxBaseCents = 100_000;
    const coefficientBps = 2_500; // 25%
    const schedule = quarterlyAmortizationScheduleByDays({
      taxBaseCents,
      coefficientBps,
      inServiceDate: parseISODateOnly('2026-01-01'),
    });
    expect(schedule.reduce((s, r) => s + r.amountCents, 0)).toBe(taxBaseCents);
    expect(schedule[0]?.quarter).toBe('T1');
    expect(schedule[0]?.amountCents).toBeGreaterThan(0);
  });
});

