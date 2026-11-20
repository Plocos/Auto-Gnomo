/**
 * Precisión monetaria: enteros en céntimos (EUR minor units).
 * Tasas en basis points (1% = 100 bps, 21% = 2100 bps).
 * Redondeo half-up a céntimo.
 */

export type MoneyCents = number;
export type RateBps = number;

const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export function assertMoney(cents: number, label = 'amount'): asserts cents is MoneyCents {
  if (!Number.isInteger(cents)) {
    throw new Error(`${label} must be an integer number of cents, got ${cents}`);
  }
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`${label} exceeds safe integer range`);
  }
}

export function assertRateBps(bps: number, label = 'rate'): asserts bps is RateBps {
  if (!Number.isInteger(bps)) {
    throw new Error(`${label} must be integer basis points`);
  }
  if (bps < 0 || bps > 100_000) {
    throw new Error(`${label} out of range: ${bps}`);
  }
}

/** Half-up rounding to nearest integer (céntimo). */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Cannot round non-finite value');
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

export function addCents(...amounts: MoneyCents[]): MoneyCents {
  let sum = 0;
  for (const a of amounts) {
    assertMoney(a);
    sum += a;
    if (!Number.isSafeInteger(sum)) throw new Error('Sum overflow');
  }
  return sum;
}

export function subCents(a: MoneyCents, b: MoneyCents): MoneyCents {
  assertMoney(a);
  assertMoney(b);
  const r = a - b;
  if (!Number.isSafeInteger(r)) throw new Error('Subtraction overflow');
  return r;
}

/** Apply rate in bps to an amount: amount * bps / 10000, half-up. */
export function applyRate(amountCents: MoneyCents, rateBps: RateBps): MoneyCents {
  assertMoney(amountCents);
  assertRateBps(rateBps);
  // Use integer math where possible: (amount * bps + 5000) / 10000 with sign-aware half-up
  const product = amountCents * rateBps;
  if (!Number.isSafeInteger(product) && Math.abs(product) > MAX_SAFE_CENTS) {
    // Fallback via Number with half-up — still deterministic for typical invoice sizes
    return roundHalfUp(amountCents * (rateBps / 10_000));
  }
  if (product >= 0) {
    return Math.floor((product + 5_000) / 10_000);
  }
  return Math.ceil((product - 5_000) / 10_000);
}

export function computeVat(taxBaseCents: MoneyCents, vatRateBps: RateBps): MoneyCents {
  return applyRate(taxBaseCents, vatRateBps);
}

export function computeIrpfWithholding(taxBaseCents: MoneyCents, irpfRateBps: RateBps): MoneyCents {
  return applyRate(taxBaseCents, irpfRateBps);
}

/**
 * total = base + vat - irpf (when IRPF is withholding on the invoice).
 */
export function computeTotal(
  taxBaseCents: MoneyCents,
  vatCents: MoneyCents,
  irpfWithheldCents: MoneyCents = 0,
): MoneyCents {
  return subCents(addCents(taxBaseCents, vatCents), irpfWithheldCents);
}

/** Apply professional use and tax deductible percentages (bps of 10000 = 100%). */
export function applyDeductibility(
  amountCents: MoneyCents,
  professionalUseBps: RateBps,
  taxDeductibleBps: RateBps,
): MoneyCents {
  const professional = applyRate(amountCents, professionalUseBps);
  return applyRate(professional, taxDeductibleBps);
}

export function eurosToCents(euros: number): MoneyCents {
  if (!Number.isFinite(euros)) throw new Error('Invalid euros');
  return roundHalfUp(euros * 100);
}

export function centsToEurosNumber(cents: MoneyCents): number {
  assertMoney(cents);
  return cents / 100;
}

/** Format for Spanish locale display: 74298 → "742,98 €" */
export function formatEuros(cents: MoneyCents, withSymbol = true): string {
  assertMoney(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const body = `${sign}${whole.toLocaleString('es-ES')},${frac}`;
  return withSymbol ? `${body} €` : body;
}

/** Parse "742,98" or "742.98" or "742,98 €" to cents. */
export function parseEurosToCents(input: string): MoneyCents {
  const cleaned = input
    .replace(/\s/g, '')
    .replace(/€/g, '')
    .replace(/\.(?=.*[,.])/g, '') // thousand sep dots
    .replace(',', '.');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) throw new Error(`Invalid money string: ${input}`);
  return eurosToCents(n);
}

export function percentToBps(percent: number): RateBps {
  return roundHalfUp(percent * 100);
}

export function bpsToPercent(bps: RateBps): number {
  return bps / 100;
}

/** Within 1 céntimo tolerance (typical invoice rounding). */
export function amountsAgree(a: MoneyCents, b: MoneyCents, toleranceCents = 1): boolean {
  return Math.abs(a - b) <= toleranceCents;
}
