import { applyDeductibility, type MoneyCents } from '@autonomous/shared';
import type {
  BoxEntry,
  BoxPage,
  BoxResult,
  BreakdownItem,
  Modelo303Input,
  Modelo303Result,
  MovementLike,
} from '../types.js';
import { META_2026 } from './modelo130.js';

const ACTIVE = new Set(['confirmed', 'locked', 'corrected']);
const SUBJECT_RATES = new Set([0, 400, 1000, 2100]);
/** Porcentaje atribuible a la Administración del Estado (territorio común). */
const STATE_SHARE_BPS = 10_000;

function isActive(m: MovementLike): boolean {
  return ACTIVE.has(m.status);
}

function box(
  code: string,
  label: string,
  amountCents: MoneyCents,
  breakdown: BreakdownItem[],
  extra?: Partial<BoxResult>,
): BoxResult {
  return { box: code, label, amountCents, breakdown, ...extra };
}

function emptyBox(code: string, label: string): BoxResult {
  return box(code, label, 0, []);
}

function formBox(
  page: BoxPage,
  entry: BoxEntry,
  code: string,
  label: string,
  amountCents: MoneyCents,
  breakdown: BreakdownItem[] = [],
  extra?: Partial<BoxResult>,
): BoxResult {
  return box(code, label, amountCents, breakdown, { page, entry, ...extra });
}

function isNonTaxableVat(m: MovementLike): boolean {
  return m.vatTreatment === 'exempt' || m.vatTreatment === 'not_subject';
}

type RateBucket = {
  base: MoneyCents;
  vat: MoneyCents;
  baseItems: BreakdownItem[];
  vatItems: BreakdownItem[];
};

function emptyBucket(): RateBucket {
  return { base: 0, vat: 0, baseItems: [], vatItems: [] };
}

/**
 * Régimen general trimestral — casillas AEAT 2026.
 * Devengado por tipo (solo sujetas y no exentas);
 * deducible: corrientes 28/29, bienes de inversión 30/31;
 * resultado: 64 → 66 → 110/78/87 → 69 → 71.
 */
export function computeModelo303(input: Modelo303Input): Modelo303Result {
  const { fiscalYear, quarter, movements, pendingFromPreviousCents = 0 } = input;

  const qMov = movements.filter(
    (m) => isActive(m) && m.fiscalYear === fiscalYear && m.quarter === quarter,
  );

  const byRate: Record<number, RateBucket> = {
    0: emptyBucket(),
    400: emptyBucket(),
    1000: emptyBucket(),
    2100: emptyBucket(),
  };

  const currentBaseItems: BreakdownItem[] = [];
  const currentVatItems: BreakdownItem[] = [];
  const investmentBaseItems: BreakdownItem[] = [];
  const investmentVatItems: BreakdownItem[] = [];
  let currentBase = 0;
  let currentVat = 0;
  let investmentBase = 0;
  let investmentVat = 0;
  const unsupported: BreakdownItem[] = [];
  const notSubjectItems: BreakdownItem[] = [];
  let notSubjectBase = 0;
  let zeroRateUnconfirmed = 0;

  const addDeductible = (m: MovementLike) => {
    const dedBase = applyDeductibility(m.taxBaseCents, m.professionalUseBps, m.taxDeductibleBps);
    const dedVat = applyDeductibility(m.vatCents, m.professionalUseBps, m.taxDeductibleBps);
    if (m.expenseNature === 'fixed_asset') {
      investmentBase += dedBase;
      investmentVat += dedVat;
      investmentBaseItems.push({ movementId: m.id, concept: m.concept, amountCents: dedBase });
      investmentVatItems.push({ movementId: m.id, concept: m.concept, amountCents: dedVat });
    } else {
      currentBase += dedBase;
      currentVat += dedVat;
      currentBaseItems.push({ movementId: m.id, concept: m.concept, amountCents: dedBase });
      currentVatItems.push({ movementId: m.id, concept: m.concept, amountCents: dedVat });
    }
  };

  for (const m of qMov) {
    if (m.vatTreatment === 'reverse_charge') {
      unsupported.push({
        movementId: m.id,
        concept: `${m.concept} (ISP — no soportado MVP)`,
        amountCents: m.vatCents,
      });
      continue;
    }

    if (m.type === 'income' || m.type === 'grant') {
      if (m.type === 'income' && m.vatTreatment === 'not_subject') {
        notSubjectBase += m.taxBaseCents;
        notSubjectItems.push({ movementId: m.id, concept: m.concept, amountCents: m.taxBaseCents });
        continue;
      }
      // Casillas 150–09: solo operaciones sujetas y no exentas
      if (isNonTaxableVat(m)) continue;

      const rate = m.vatRateBps;
      if (!SUBJECT_RATES.has(rate)) {
        unsupported.push({
          movementId: m.id,
          concept: `${m.concept} (tipo IVA ${rate / 100}% no mapeado)`,
          amountCents: m.vatCents,
        });
        continue;
      }
      const target = byRate[rate]!;
      target.base += m.taxBaseCents;
      target.vat += m.vatCents;
      target.baseItems.push({ movementId: m.id, concept: m.concept, amountCents: m.taxBaseCents });
      target.vatItems.push({ movementId: m.id, concept: m.concept, amountCents: m.vatCents });
      if (rate === 0 && m.vatTreatment !== 'zero_rate') zeroRateUnconfirmed += 1;
    }

    if (m.type === 'expense' || m.type === 'autonomo_fee' || m.type === 'amortization') {
      if (m.vatCents === 0) continue;
      if (isNonTaxableVat(m)) continue;
      addDeductible(m);
    }

    if (m.type === 'correction') {
      if (m.vatCents !== 0 && (m.taxBaseCents < 0 || m.vatCents < 0)) {
        if (isNonTaxableVat(m)) continue;
        addDeductible(m);
      }
    }
  }

  const r0 = byRate[0]!;
  const r4 = byRate[400]!;
  const r10 = byRate[1000]!;
  const r21 = byRate[2100]!;

  const totalDeductibleVat = currentVat + investmentVat;
  const repercutido = r0.vat + r4.vat + r10.vat + r21.vat;
  const resultadoRegimen = repercutido - totalDeductibleVat;

  const sumaResultados = resultadoRegimen;
  const atribuibleEstado = Math.round((sumaResultados * STATE_SHARE_BPS) / 10_000);
  const pending = Math.max(0, pendingFromPreviousCents);
  const aplicado = Math.min(pending, Math.max(0, atribuibleEstado));
  const pendientePosterior = pending - aplicado;
  const resultado69 = atribuibleEstado - aplicado;
  const resultado71 = resultado69;
  const carryForward = pendientePosterior + (resultado71 < 0 ? -resultado71 : 0);

  const zeroRateWarning =
    zeroRateUnconfirmed > 0
      ? {
          uncertain: true,
          warning:
            '¿Es realmente tipo 0 %? Si es exento o a un cliente extranjero, no va en la 150. Marca el movimiento como "tipo 0 %", "exento" o "no sujeto".',
        }
      : undefined;

  const liq = (
    entry: BoxEntry,
    code: string,
    label: string,
    amount: MoneyCents,
    items: BreakdownItem[] = [],
    extra?: Partial<BoxResult>,
  ) => formBox('liquidacion', entry, code, label, amount, items, extra);
  const res = (
    entry: BoxEntry,
    code: string,
    label: string,
    amount: MoneyCents,
    extra?: Partial<BoxResult>,
  ) => formBox('resultado', entry, code, label, amount, [], extra);

  const boxes: Record<string, BoxResult> = {
    '150': liq('manual', '150', 'Base imponible tipo 0 %', r0.base, r0.baseItems, zeroRateWarning),
    '151': emptyBox('151', 'Tipo 0%'),
    '152': liq('auto', '152', 'Cuota tipo 0 %', r0.vat, r0.vatItems),
    '01': liq('manual', '01', 'Base imponible tipo 4 %', r4.base, r4.baseItems),
    '02': emptyBox('02', 'Tipo 4%'),
    '03': liq('auto', '03', 'Cuota tipo 4 %', r4.vat, r4.vatItems),
    '04': liq('manual', '04', 'Base imponible tipo 10 %', r10.base, r10.baseItems),
    '05': emptyBox('05', 'Tipo 10%'),
    '06': liq('auto', '06', 'Cuota tipo 10 %', r10.vat, r10.vatItems),
    '07': liq('manual', '07', 'Base imponible tipo 21 %', r21.base, r21.baseItems),
    '08': emptyBox('08', 'Tipo 21%'),
    '09': liq('auto', '09', 'Cuota tipo 21 %', r21.vat, r21.vatItems),
    '27': liq('auto', '27', 'Total cuota devengada', repercutido),
    '28': liq(
      'manual',
      '28',
      'IVA deducible — operaciones interiores corrientes (base)',
      currentBase,
      currentBaseItems,
    ),
    '29': liq(
      'manual',
      '29',
      'IVA deducible — operaciones interiores corrientes (cuota)',
      currentVat,
      currentVatItems,
    ),
    '30': liq(
      'manual',
      '30',
      'IVA deducible — bienes de inversión (base)',
      investmentBase,
      investmentBaseItems,
    ),
    '31': liq(
      'manual',
      '31',
      'IVA deducible — bienes de inversión (cuota)',
      investmentVat,
      investmentVatItems,
    ),
    '45': liq('auto', '45', 'Total a deducir', totalDeductibleVat),
    '46': liq('auto', '46', 'Resultado régimen general (27 − 45)', resultadoRegimen),
    '64': res('auto', '64', 'Suma de resultados (46 + 58 + 76)', sumaResultados),
    '65': res('auto', '65', '% atribuible a la Administración del Estado', STATE_SHARE_BPS, {
      unit: 'percent',
    }),
    '66': res('auto', '66', 'Atribuible a la Administración del Estado (64 × 65)', atribuibleEstado),
    '110': res(
      'prefilled',
      '110',
      'Cuotas a compensar pendientes de periodos previos',
      pending,
    ),
    '78': res(
      'manual',
      '78',
      'Cuotas a compensar de periodos previos aplicadas en este periodo',
      aplicado,
      atribuibleEstado <= 0 && pending > 0
        ? { warning: 'Pon 0: este trimestre no sale a pagar, no hay nada que compensar.' }
        : undefined,
    ),
    '87': res(
      'auto',
      '87',
      'Cuotas a compensar de periodos previos pendientes para periodos posteriores (110 − 78)',
      pendientePosterior,
    ),
    '69': res('auto', '69', 'Resultado (66 + 77 − 78 + 68)', resultado69),
    '71': res(
      'auto',
      '71',
      'Resultado de la liquidación (69 − 70 + 109)',
      resultado71,
      quarter === 'T4' && resultado71 < 0
        ? { warning: 'En 4T puedes pedir devolución o compensar; la app asume compensar.' }
        : undefined,
    ),
    carry: box('carry', 'Pendiente de compensar para el siguiente periodo', carryForward, []),
  };

  if (notSubjectItems.length) {
    boxes['120'] = formBox(
      'adicional',
      'manual',
      '120',
      'Operaciones no sujetas por reglas de localización (excepto las de la casilla 123)',
      notSubjectBase,
      notSubjectItems,
      {
        uncertain: true,
        warning:
          'Solo si son servicios a clientes fuera del territorio de aplicación del IVA (extranjero, Canarias, Ceuta, Melilla).',
      },
    );
  }

  if (unsupported.length) {
    boxes.unsupported = box(
      'unsupported',
      'Operaciones no soportadas / Revisar fiscalmente',
      unsupported.reduce((s, i) => s + i.amountCents, 0),
      unsupported,
      { uncertain: true, warning: '⚠️ Revisar fiscalmente — fuera del alcance MVP' },
    );
  }

  return { meta: META_2026, boxes, resultCents: resultado71, carryForwardCents: carryForward };
}
