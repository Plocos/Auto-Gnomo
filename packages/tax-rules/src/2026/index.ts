import type { TaxRuleset } from '../types.js';
import { annualAmortization } from './amortization.js';
import { computeModelo130, META_2026, MODELO_130_RATE_BPS } from './modelo130.js';
import { computeModelo303 } from './vat.js';

export const rules2026: TaxRuleset = {
  meta: META_2026,
  vatRatesBps: [0, 400, 1000, 2100],
  modelo130PaymentRateBps: MODELO_130_RATE_BPS,
  computeModelo130,
  computeModelo303,
  annualAmortization,
};

export { computeModelo130, computeModelo303, annualAmortization, META_2026 };
