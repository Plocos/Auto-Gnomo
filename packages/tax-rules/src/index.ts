import { rules2026 } from './2026/index.js';
import type { TaxRuleset } from './types.js';

const registry: Record<number, TaxRuleset> = {
  2026: rules2026,
};

export function getTaxRules(fiscalYear: number): TaxRuleset {
  const rules = registry[fiscalYear];
  if (!rules) {
    // Fallback al año más cercano inferior, o 2026
    const years = Object.keys(registry)
      .map(Number)
      .sort((a, b) => b - a);
    const fallback = years.find((y) => y <= fiscalYear) ?? 2026;
    return registry[fallback]!;
  }
  return rules;
}

export * from './types.js';
export { rules2026 } from './2026/index.js';
export {
  annualAmortization,
  monthlyAmortizationSchedule,
  quarterlyAmortization,
  quarterlyAmortizationScheduleByDays,
} from './2026/amortization.js';
export type { QuarterlyAmortizationRow } from './2026/amortization.js';
