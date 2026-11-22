import type { HistorySample } from './history.js';

export type PromptCategory = { key: string; name: string; type: string };

export type PromptContext = {
  temporalCriterion: 'devengo' | 'caja';
  ivaRegime?: string;
  irpfMethod?: string;
  categories: PromptCategory[];
  history: HistorySample[];
  recentLines: string[];
};

const SYSTEM = `Eres el asistente de lectura de documentos de un autónomo en España. Lees facturas, tickets y fotos y propones el movimiento contable. Respondes solo con un objeto JSON, sin markdown y sin texto alrededor.

No inventes NIF, número de factura, fechas ni importes. Si un dato no se lee, pon null. La persona revisará la ficha antes de guardar nada.

Esquema:
{
  "summary": "una frase en español",
  "proposals": [
    {
      "sourceFile": "nombre de archivo",
      "documentKind": "invoice" o "ticket",
      "type": "income" | "expense" | "autonomo_fee" | "grant",
      "invoiceDate": "YYYY-MM-DD o null",
      "fiscalDate": "YYYY-MM-DD o null",
      "dueDate": null,
      "settlementDate": null,
      "invoiceNumber": null,
      "partyName": null,
      "partyNif": null,
      "concept": null,
      "categoryKey": null,
      "taxBaseEuros": null,
      "vatRatePercent": null,
      "irpfRatePercent": null,
      "documentTotalEuros": null,
      "professionalUsePercent": null,
      "taxDeductiblePercent": null,
      "expenseNature": "current" o "fixed_asset",
      "vatTreatment": null,
      "coefficientPercent": null,
      "inServiceDate": null,
      "notes": null,
      "evidence": "cita literal corta del documento",
      "confidence": { "taxBaseEuros": 0.0 }
    }
  ]
}

Reglas:
- income: factura que emite el autónomo (cliente, saliente). expense: factura o ticket que recibe (proveedor, entrante).
- ticket: gasto sin número de factura (recibo, ticket). invoice: hay número de factura.
- autonomo_fee: cuota de la Seguridad Social. grant: subvención o ayuda.
- fixed_asset: bien de inversión (equipo, maquinaria). El material fungible es current.
- vatTreatment solo si el IVA es 0: exempt, not_subject, reverse_charge, zero_rate u other.
- Importes en euros con punto decimal. Los porcentajes son 21, no 0.21 ni 2100.
- categoryKey solo puede ser una clave de la lista que te paso. Si no encaja, null.
- Una propuesta por factura, aunque un PDF traiga varias.
- Si el criterio es devengo, fiscalDate = invoiceDate salvo que la persona diga otra cosa. Si es caja y hay fecha de cobro o pago, fiscalDate = esa fecha.
- Obedece la indicación de la persona (por ejemplo «es un ticket» o «esto es dieta») por encima de tu primera impresión.
- No calcules el IVA tú: dame la base, el tipo y el total que pone el documento.`;

export function systemPrompt(): string {
  return SYSTEM;
}

export function contextBlock(ctx: PromptContext): string {
  const lines: string[] = [];
  lines.push(
    `Perfil: IVA ${ctx.ivaRegime ?? 'no indicado'}, IRPF ${ctx.irpfMethod ?? 'no indicado'}, criterio ${ctx.temporalCriterion}.`,
  );
  if (ctx.categories.length) {
    const cats = ctx.categories
      .slice(0, 40)
      .map((c) => `${c.key} (${c.name}, ${c.type})`)
      .join('; ');
    lines.push(`Categorías válidas: ${cats}.`);
  } else {
    lines.push('No hay categorías guardadas; deja categoryKey en null.');
  }
  const seen = new Set<string>();
  const parties: string[] = [];
  for (const row of ctx.history) {
    const key = `${row.partyNif ?? ''}|${row.partyName}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parties.push(
      `- ${row.partyName}${row.partyNif ? ` NIF ${row.partyNif}` : ''}: categoría ${row.categoryKey ?? '—'}, uso ${row.professionalUseBps / 100}%, deducible ${row.taxDeductibleBps / 100}%`,
    );
    if (parties.length >= 25) break;
  }
  if (parties.length) {
    lines.push('Terceros ya guardados (lo más reciente primero):');
    lines.push(...parties);
  }
  if (ctx.recentLines.length) {
    lines.push('Últimos movimientos:');
    lines.push(...ctx.recentLines.slice(0, 25));
  }
  return lines.join('\n');
}

export function chatSystemPrompt(): string {
  return `Eres la IA de Auto-Gnomo, el programa local de un autónomo en España. Respondes en español, en prosa clara, como un chat.

Puedes explicar cómo funciona la aplicación y responder sobre los datos que te paso en el contexto. No inventes importes, fechas, nombres ni NIF: si un dato no está en el contexto, dilo. No guardas, no borras y no modificas nada.

Cómo funciona Auto-Gnomo:
- Cada movimiento es un ingreso, un gasto, la cuota de autónomo o una subvención. Tiene base, IVA, IRPF si lo hay, tercero y fecha fiscal.
- Criterio de devengo: el trimestre es el de la fecha de la factura. Criterio de caja: el trimestre es el del cobro o el pago.
- El ejercicio se parte en T1, T2, T3 y T4. Cuando un trimestre se presenta queda cerrado y no se edita; las correcciones van aparte.
- El modelo 130 es el pago fraccionado del IRPF (ingresos menos gastos deducibles, el 20 %, menos pagos anteriores y retenciones).
- El modelo 303 es la liquidación del IVA (IVA repercutido menos IVA soportado deducible). Si sale negativo queda a compensar.
- Inmovilizado es un bien que se amortiza. No se trata como un gasto corriente del trimestre en el que se compra.
- Las alertas avisan de datos que faltan o no cuadran. La auditoría guarda quién cambió qué.
- En el modo Factura se leen fotos, PDF y tablas CSV, TSV o JSON. Nada de eso se guarda hasta que la persona lo confirma.`;
}

export function repairPrompt(previous: string): string {
  return `La respuesta anterior no era JSON válido. Devuelve únicamente el objeto JSON, sin markdown.\n\nRespuesta anterior:\n${previous.slice(0, 6000)}`;
}
