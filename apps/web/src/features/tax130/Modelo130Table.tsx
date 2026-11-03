import { useState } from 'react';
import { formatMoney } from '../../components/ui/primitives';
import { formatAmountForCopy } from '../clipboard/copy';
import { CopyValue } from '../clipboard/CopyValue';
import type { TaxBox } from '../filings/types';

export const MODELO130_ORDER = ['01', '02', '03', '04', '05', '06', '07'];

export function modelo130ToTsv(boxes: Record<string, TaxBox>): string {
  const lines = MODELO130_ORDER.map((b) => {
    const box = boxes[b];
    return `${b}\t${box?.label ?? ''}\t${((box?.amountCents ?? 0) / 100).toFixed(2)}`;
  });
  return ['Casilla\tConcepto\tImporte', ...lines].join('\n');
}

export function Modelo130Table({ boxes }: { boxes: Record<string, TaxBox> }) {
  const [openBox, setOpenBox] = useState<string | null>(null);

  return (
    <>
      <table className="dense-table">
        <thead>
          <tr>
            <th>Casilla</th>
            <th>Concepto</th>
            <th>Importe</th>
            <th>Origen</th>
          </tr>
        </thead>
        <tbody>
          {MODELO130_ORDER.map((code) => {
            const box = boxes[code];
            if (!box) return null;
            return (
              <tr key={code}>
                <td className="font-mono">{code}</td>
                <td>
                  {box.label}
                  {box.uncertain && (
                    <span className="ml-1 text-surface-warn">⚠️ Revisar fiscalmente</span>
                  )}
                </td>
                <td className="money">
                  <CopyValue
                    display={formatMoney(box.amountCents)}
                    value={formatAmountForCopy(box.amountCents)}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="text-surface-accent underline"
                    onClick={() => setOpenBox(openBox === code ? null : code)}
                  >
                    {box.breakdown.length} mov.
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {openBox && boxes[openBox] && (
        <div className="mt-3 border border-surface-border bg-surface-panel p-2">
          <div className="mb-1 text-[12px] font-medium">
            Desglose casilla {openBox}: {boxes[openBox].label}
          </div>
          <ul className="text-[12px]">
            {boxes[openBox].breakdown.map((b) => (
              <li key={b.movementId + b.concept}>
                {b.concept} —{' '}
                <CopyValue
                  display={formatMoney(b.amountCents)}
                  value={formatAmountForCopy(b.amountCents)}
                />
              </li>
            ))}
            {!boxes[openBox].breakdown.length && (
              <li className="text-surface-muted">Calculado (sin desglose de movimientos)</li>
            )}
          </ul>
        </div>
      )}
    </>
  );
}
