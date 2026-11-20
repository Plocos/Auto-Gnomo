import {
  bpsToPercent,
  computeIrpfWithholding,
  computeTotal,
  computeVat,
  formatEuros,
  parseEurosToCents,
  percentToBps,
  VatTreatments,
  type AssistantProposal,
  type AssistantProposalType,
  type ExpenseNature,
} from '@autonomous/shared';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/ui/primitives';

const TYPES: { value: AssistantProposalType; label: string }[] = [
  { value: 'expense', label: 'Gasto (entrante)' },
  { value: 'income', label: 'Factura emitida (saliente)' },
  { value: 'autonomo_fee', label: 'Cuota de autónomo' },
  { value: 'grant', label: 'Subvención' },
];

const VAT_REASONS: { value: string; label: string }[] = [
  { value: '', label: 'Elige un motivo' },
  { value: 'exempt', label: 'Exento' },
  { value: 'not_subject', label: 'No sujeto' },
  { value: 'reverse_charge', label: 'Inversión del sujeto pasivo' },
  { value: 'zero_rate', label: 'Tipo cero' },
  { value: 'other', label: 'Otro' },
];

type Category = { key: string; name: string; type: string };

type FormState = {
  documentKind: 'invoice' | 'ticket';
  type: AssistantProposalType;
  invoiceDate: string;
  fiscalDate: string;
  dueDate: string;
  settlementDate: string;
  invoiceNumber: string;
  partyName: string;
  partyNif: string;
  concept: string;
  categoryKey: string;
  taxBase: string;
  vatRate: string;
  irpfRate: string;
  professionalUse: string;
  taxDeductible: string;
  expenseNature: ExpenseNature;
  vatTreatment: string;
  coefficient: string;
  inServiceDate: string;
  notes: string;
};

function moneyInput(cents?: number): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

function percentInput(bps?: number): string {
  if (bps == null) return '';
  const value = bpsToPercent(bps);
  return Number.isInteger(value) ? String(value) : String(value).replace('.', ',');
}

function fromProposal(proposal: AssistantProposal): FormState {
  return {
    documentKind: proposal.documentKind,
    type: proposal.type,
    invoiceDate: proposal.invoiceDate ?? '',
    fiscalDate: proposal.fiscalDate ?? '',
    dueDate: proposal.dueDate ?? '',
    settlementDate: proposal.settlementDate ?? '',
    invoiceNumber: proposal.invoiceNumber ?? '',
    partyName: proposal.partyName ?? '',
    partyNif: proposal.partyNif ?? '',
    concept: proposal.concept ?? '',
    categoryKey: proposal.categoryKey ?? '',
    taxBase: moneyInput(proposal.taxBaseCents),
    vatRate: percentInput(proposal.vatRateBps),
    irpfRate: percentInput(proposal.irpfRateBps ?? 0),
    professionalUse: percentInput(proposal.professionalUseBps ?? 10_000),
    taxDeductible: percentInput(proposal.taxDeductibleBps ?? 10_000),
    expenseNature: proposal.expenseNature ?? 'current',
    vatTreatment: proposal.vatTreatment ?? '',
    coefficient: percentInput(proposal.coefficientBps),
    inServiceDate: proposal.inServiceDate ?? '',
    notes: proposal.notes ?? '',
  };
}

function readPercent(raw: string): number {
  const n = Number(raw.replace('%', '').replace(',', '.').trim());
  if (!Number.isFinite(n)) return 0;
  return percentToBps(n);
}

const fieldClass = 'mt-0.5 w-full border border-surface-border bg-white px-2 py-1 text-ui';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] text-surface-muted">
      {label}
      {children}
    </label>
  );
}

export function ProposalCard({
  proposal,
  categories,
  previewUrl,
  previewMime,
  busy,
  onAccept,
  onDiscard,
  onRetry,
}: {
  proposal: AssistantProposal;
  categories: Category[];
  previewUrl?: string;
  previewMime?: string;
  busy: boolean;
  onAccept: (body: Record<string, unknown>) => Promise<void>;
  onDiscard: () => Promise<void>;
  onRetry: (note: string) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => fromProposal(proposal));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pdfOpen, setPdfOpen] = useState(false);
  const pdfPreview = Boolean(previewUrl && previewMime === 'application/pdf');

  useEffect(() => {
    setForm(fromProposal(proposal));
    setError(null);
    setPdfOpen(false);
  }, [proposal]);

  useEffect(() => {
    if (!pdfOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPdfOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pdfOpen]);

  const computed = useMemo(() => {
    try {
      if (!form.taxBase.trim()) return null;
      const base = parseEurosToCents(form.taxBase);
      const vatRate = readPercent(form.vatRate);
      const irpfRate = readPercent(form.irpfRate);
      const vat = computeVat(base, vatRate);
      const irpf = computeIrpfWithholding(base, irpfRate);
      return { base, vatRate, irpfRate, vat, irpf, total: computeTotal(base, vat, irpf) };
    } catch {
      return null;
    }
  }, [form.taxBase, form.vatRate, form.irpfRate]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const blockers: string[] = [];
  if (!form.concept.trim()) blockers.push('concepto');
  if (!form.invoiceDate) blockers.push('fecha');
  if (!form.fiscalDate) blockers.push('fecha fiscal');
  if (!computed) blockers.push('base imponible');
  if (form.expenseNature === 'fixed_asset' && readPercent(form.coefficient) <= 0) {
    blockers.push('coeficiente de amortización');
  }

  const accept = async () => {
    if (!computed || blockers.length) return;
    setError(null);
    const vatTreatment =
      computed.vatRate === 0 && form.vatTreatment && (VatTreatments as readonly string[]).includes(form.vatTreatment)
        ? form.vatTreatment
        : undefined;
    try {
      await onAccept({
        documentKind: form.documentKind,
        type: form.type,
        invoiceDate: form.invoiceDate,
        fiscalDate: form.fiscalDate,
        dueDate: form.dueDate,
        settlementDate: form.settlementDate,
        invoiceNumber: form.invoiceNumber,
        partyName: form.partyName,
        partyNif: form.partyNif,
        concept: form.concept.trim(),
        categoryKey: form.categoryKey,
        taxBaseCents: computed.base,
        vatRateBps: computed.vatRate,
        irpfRateBps: computed.irpfRate,
        professionalUseBps: readPercent(form.professionalUse),
        taxDeductibleBps: readPercent(form.taxDeductible),
        expenseNature: form.expenseNature,
        vatTreatment,
        coefficientBps: form.expenseNature === 'fixed_asset' ? readPercent(form.coefficient) : undefined,
        inServiceDate: form.inServiceDate,
        notes: form.notes,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    }
  };

  return (
    <article className="border border-surface-border bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold text-surface-ink">Movimiento propuesto</h3>
      </div>
      <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
        <div className="min-h-24 border border-surface-border bg-surface p-2">
          {previewUrl && previewMime?.startsWith('image/') && (
            <img src={previewUrl} alt="Documento adjunto" className="max-h-64 w-full object-contain" />
          )}
          {pdfPreview && (
            <iframe title="Miniatura del PDF" src={previewUrl} className="pointer-events-none h-64 w-full" />
          )}
          {pdfPreview && (
            <div className="mt-2">
              <Button onClick={() => setPdfOpen(true)}>Ver a tamaño normal</Button>
            </div>
          )}
          {!previewUrl && <p className="text-[12px] text-surface-muted">Sin vista previa.</p>}
          {proposal.evidence && (
            <p className="mt-2 text-[11px] text-surface-muted">«{proposal.evidence}»</p>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Documento">
            <select className={fieldClass} value={form.documentKind} onChange={(e) => set('documentKind', e.target.value as FormState['documentKind'])}>
              <option value="invoice">Factura</option>
              <option value="ticket">Ticket o gasto sin factura</option>
            </select>
          </Field>
          <Field label="Tipo">
            <select className={fieldClass} value={form.type} onChange={(e) => set('type', e.target.value as AssistantProposalType)}>
              {TYPES.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Fecha de factura">
            <input type="date" className={fieldClass} value={form.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} />
          </Field>
          <Field label="Fecha fiscal">
            <input type="date" className={fieldClass} value={form.fiscalDate} onChange={(e) => set('fiscalDate', e.target.value)} />
          </Field>
          <Field label="Vencimiento">
            <input type="date" className={fieldClass} value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
          </Field>
          <Field label="Cobro o pago">
            <input type="date" className={fieldClass} value={form.settlementDate} onChange={(e) => set('settlementDate', e.target.value)} />
          </Field>
          <Field label="Número">
            <input className={fieldClass} value={form.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} />
          </Field>
          <Field label="Tercero">
            <input className={fieldClass} value={form.partyName} onChange={(e) => set('partyName', e.target.value)} />
          </Field>
          <Field label="NIF">
            <input className={fieldClass} value={form.partyNif} onChange={(e) => set('partyNif', e.target.value)} />
          </Field>
          <Field label="Concepto">
            <input className={fieldClass} value={form.concept} onChange={(e) => set('concept', e.target.value)} />
          </Field>
          <Field label="Categoría">
            <input className={fieldClass} list={`assistant-categories-${proposal.id}`} value={form.categoryKey} onChange={(e) => set('categoryKey', e.target.value)} />
          </Field>
          <Field label="Naturaleza">
            <select className={fieldClass} value={form.expenseNature} onChange={(e) => set('expenseNature', e.target.value as ExpenseNature)}>
              <option value="current">Corriente</option>
              <option value="fixed_asset">Inmovilizado</option>
            </select>
          </Field>
          <Field label="Base (€)">
            <input className={fieldClass} inputMode="decimal" value={form.taxBase} onChange={(e) => set('taxBase', e.target.value)} />
          </Field>
          <Field label="IVA %">
            <input className={fieldClass} inputMode="decimal" value={form.vatRate} onChange={(e) => set('vatRate', e.target.value)} />
          </Field>
          <Field label="IRPF %">
            <input className={fieldClass} inputMode="decimal" value={form.irpfRate} onChange={(e) => set('irpfRate', e.target.value)} />
          </Field>
          <Field label="Uso profesional %">
            <input className={fieldClass} inputMode="decimal" value={form.professionalUse} onChange={(e) => set('professionalUse', e.target.value)} />
          </Field>
          <Field label="Deducible %">
            <input className={fieldClass} inputMode="decimal" value={form.taxDeductible} onChange={(e) => set('taxDeductible', e.target.value)} />
          </Field>
          {computed?.vatRate === 0 && (
            <Field label="Motivo de IVA 0%">
              <select className={fieldClass} value={form.vatTreatment} onChange={(e) => set('vatTreatment', e.target.value)}>
                {VAT_REASONS.map((item) => (
                  <option key={item.value} value={item.value}>{item.label}</option>
                ))}
              </select>
            </Field>
          )}
          {form.expenseNature === 'fixed_asset' && (
            <>
              <Field label="Coeficiente de amortización %">
                <input className={fieldClass} inputMode="decimal" value={form.coefficient} onChange={(e) => set('coefficient', e.target.value)} />
              </Field>
              <Field label="Puesta en marcha">
                <input type="date" className={fieldClass} value={form.inServiceDate} onChange={(e) => set('inServiceDate', e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Notas">
            <input className={fieldClass} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
      </div>
      <datalist id={`assistant-categories-${proposal.id}`}>
        {categories.map((category) => (
          <option key={category.key} value={category.key}>{category.name}</option>
        ))}
      </datalist>
      <p className="mt-2 text-[12px] text-surface-ink">
        {computed
          ? `Se guardará IVA ${formatEuros(computed.vat)}, IRPF ${formatEuros(computed.irpf)} y total ${formatEuros(computed.total)}.`
          : 'Falta una base válida.'}
        {proposal.documentTotalCents != null && computed && proposal.documentTotalCents !== computed.total
          ? ` El documento parecía totalizar ${formatEuros(proposal.documentTotalCents)}.`
          : ''}
      </p>
      {(proposal.warnings ?? []).length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[12px] text-surface-warn">
          {proposal.warnings?.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {blockers.length > 0 && (
        <p className="mt-1 text-[12px] text-surface-muted">Antes de aceptar: {blockers.join(', ')}.</p>
      )}
      {error && <p className="mt-1 text-[12px] text-surface-danger" role="alert">{error}</p>}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Button variant="primary" disabled={busy || blockers.length > 0} onClick={() => void accept()}>
          Aceptar
        </Button>
        <Button variant="default" disabled={busy} onClick={() => void onDiscard().catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo descartar.'))}>
          Descartar
        </Button>
        <label className="min-w-48 flex-1 text-[11px] text-surface-muted">
          Corrección para volver a leer
          <input className={fieldClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Es un ticket, no una factura" />
        </label>
        <Button
          variant="default"
          disabled={busy}
          onClick={() => void onRetry(note).catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo volver a leer.'))}
        >
          Volver a reconocer
        </Button>
      </div>
      {pdfOpen && previewUrl && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Documento PDF"
          onClick={() => setPdfOpen(false)}
        >
          <div
            className="flex min-h-0 flex-1 flex-col border border-surface-border bg-white"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-surface-border px-3 py-2">
              <p className="text-[13px] font-semibold text-surface-ink">Documento</p>
              <Button onClick={() => setPdfOpen(false)}>Cerrar</Button>
            </div>
            <iframe title="Documento PDF" src={previewUrl} className="min-h-0 w-full flex-1 bg-white" />
          </div>
        </div>
      )}
    </article>
  );
}
