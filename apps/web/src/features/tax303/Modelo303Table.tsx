import { useState } from 'react';
import { formatMoney } from '../../components/ui/primitives';
import { formatAmountForCopy } from '../clipboard/copy';
import { CopyValue } from '../clipboard/CopyValue';
import type { TaxBox } from '../filings/types';

type BoxPage = NonNullable<TaxBox['page']>;
type BoxEntry = NonNullable<TaxBox['entry']>;

const SECTIONS: { page: BoxPage; title: string; codes: string[] }[] = [
  {
    page: 'liquidacion',
    title: 'Liquidación — Régimen general (IVA devengado e IVA deducible)',
    codes: ['150', '152', '01', '03', '04', '06', '07', '09', '27', '28', '29', '30', '31', '45', '46'],
  },
  {
    page: 'resultado',
    title: 'Resultado',
    codes: ['64', '65', '66', '110', '78', '87', '69', '71'],
  },
  {
    page: 'adicional',
    title: 'Información adicional',
    codes: ['120'],
  },
];

const ALWAYS_SHOWN = new Set(['27', '45', '46', '110', '78', '87', '71']);

const ENTRY_LABEL: Record<BoxEntry, string> = {
  manual: 'Escribir',
  auto: 'Se calcula sola',
  prefilled: 'Prerrellenada AEAT',
};

const ENTRY_CLASS: Record<BoxEntry, string> = {
  manual: 'font-semibold text-surface-accent',
  auto: 'text-surface-muted',
  prefilled: 'text-surface-warn',
};

function formatBoxValue(box: TaxBox): string {
  if (box.unit === 'percent') return `${(box.amountCents / 100).toFixed(2).replace('.', ',')} %`;
  return formatMoney(box.amountCents);
}

function copyBoxValue(box: TaxBox): string {
  if (box.unit === 'percent') return (box.amountCents / 100).toFixed(2).replace('.', ',');
  return formatAmountForCopy(box.amountCents);
}

function isVisible(box: TaxBox, showAll: boolean): boolean {
  return showAll || box.amountCents !== 0 || ALWAYS_SHOWN.has(box.box) || Boolean(box.uncertain);
}

function resultText(resultCents: number, quarter: string): string {
  const amount = formatMoney(Math.abs(resultCents));
  if (resultCents > 0) return `A ingresar: ${amount}`;
  if (resultCents < 0) {
    return quarter === 'T4' ? `A compensar (o a devolver): ${amount}` : `A compensar: ${amount}`;
  }
  return 'Resultado cero / sin actividad';
}

function buildSections(boxes: Record<string, TaxBox>, showAll: boolean) {
  return SECTIONS.map((s) => ({
    ...s,
    rows: s.codes
      .map((code) => boxes[code])
      .filter((b): b is TaxBox => Boolean(b) && isVisible(b!, showAll)),
  })).filter((s) => s.rows.length > 0);
}

export function modelo303ToTsv(boxes: Record<string, TaxBox>, showAll: boolean): string {
  const lines = buildSections(boxes, showAll).flatMap((s) => [
    s.title,
    ...s.rows.map(
      (b) => `${b.box}\t${b.label}\t${copyBoxValue(b)}\t${b.entry ? ENTRY_LABEL[b.entry] : ''}`,
    ),
  ]);
  return ['Casilla\tConcepto\tImporte\tQué hacer', ...lines].join('\n');
}

export function Modelo303Table({
  boxes,
  resultCents,
  carryForwardCents,
  quarter,
  showAll,
}: {
  boxes: Record<string, TaxBox>;
  resultCents: number | undefined;
  carryForwardCents: number | undefined;
  quarter: string;
  showAll: boolean;
}) {
  const [openBox, setOpenBox] = useState<string | null>(null);
  const sections = buildSections(boxes, showAll);
  const unsupported = boxes.unsupported;

  return (
    <>
      {unsupported && (
        <div className="mb-2 border border-surface-border bg-surface-panel px-2 py-1.5 text-[12px] text-surface-warn">
          {unsupported.warning ?? unsupported.label}:{' '}
          {unsupported.breakdown.map((b) => b.concept).join(' · ')}
        </div>
      )}

      {sections.map((section) => (
        <section key={section.page} className="mb-3">
          <h2 className="mb-1 text-[13px] font-semibold">{section.title}</h2>
          <table className="dense-table">
            <thead>
              <tr>
                <th>Casilla</th>
                <th>Concepto</th>
                <th>Importe</th>
                <th>Qué hacer</th>
                <th>Origen</th>
              </tr>
            </thead>
            <tbody>
              {section.rows.map((box) => (
                <tr key={box.box}>
                  <td className="font-mono">{box.box}</td>
                  <td>
                    {box.label}
                    {box.uncertain && (
                      <span className="ml-1 text-surface-warn">⚠️ Revisar fiscalmente</span>
                    )}
                    {box.warning && (
                      <div className="text-[11px] text-surface-warn">{box.warning}</div>
                    )}
                  </td>
                  <td className="money">
                    <CopyValue display={formatBoxValue(box)} value={copyBoxValue(box)} />
                  </td>
                  <td className={box.entry ? ENTRY_CLASS[box.entry] : ''}>
                    {box.entry ? ENTRY_LABEL[box.entry] : ''}
                  </td>
                  <td>
                    {box.breakdown.length > 0 ? (
                      <button
                        type="button"
                        className="text-surface-accent underline"
                        onClick={() => setOpenBox(openBox === box.box ? null : box.box)}
                      >
                        {box.breakdown.length} mov.
                      </button>
                    ) : (
                      <span className="text-surface-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {resultCents !== undefined && (
        <div className="mb-3 border border-surface-border bg-surface-panel px-2 py-2">
          <div className="text-[15px] font-semibold">
            Casilla 71 · {resultText(resultCents, quarter)}
          </div>
          {(carryForwardCents ?? 0) > 0 && (
            <div className="text-[12px] text-surface-muted">
              Quedará pendiente de compensar para el próximo trimestre:{' '}
              {formatMoney(carryForwardCents)}
            </div>
          )}
        </div>
      )}

      {openBox && boxes[openBox] && (
        <div className="mt-3 border border-surface-border bg-surface-panel p-2">
          <div className="mb-1 text-[12px] font-medium">
            Desglose casilla {openBox}: {boxes[openBox].label}
          </div>
          <ul className="text-[12px]">
            {boxes[openBox].breakdown.map((b) => (
              <li key={b.movementId + b.concept}>
                ├─ {b.concept} —{' '}
                <CopyValue
                  display={formatMoney(b.amountCents)}
                  value={formatAmountForCopy(b.amountCents)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
