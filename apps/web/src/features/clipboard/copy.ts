export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

/** Importe listo para pegar en la Sede AEAT: `-1234,56` (sin miles ni €). */
export function formatAmountForCopy(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

export function selectionToMarkdown(rows: Record<string, unknown>[]): string {
  const lines = [
    '| Fecha | Concepto | Base | IVA | Total | Tipo |',
    '|---|---|---|---|---|---|',
  ];
  for (const m of rows) {
    lines.push(
      `| ${m.fiscalDate} | ${m.concept} | ${Number(m.taxBaseCents) / 100} | ${Number(m.vatCents) / 100} | ${Number(m.totalCents) / 100} | ${m.type} |`,
    );
  }
  return lines.join('\n');
}
