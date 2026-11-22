import { Quarters } from '@autonomous/shared';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button, PageHeader, formatMoney } from '../../components/ui/primitives';
import { ColumnHeader } from '../../components/ui/ColumnHeader';
import {
  expenseNatureLabel,
  movementStatusLabel,
  movementTypeLabel,
} from '../../lib/labels';
import { copyToClipboard } from '../clipboard/copy';

type Movement = {
  id: string;
  type: string;
  fiscalDate: string;
  invoiceDate?: string;
  concept: string;
  partyName?: string;
  invoiceNumber?: string;
  taxBaseCents: number;
  vatRateBps: number;
  vatCents: number;
  irpfRateBps?: number;
  irpfWithheldCents: number;
  totalCents: number;
  quarter: string;
  fiscalYear: number;
  status: string;
  professionalUseBps: number;
  taxDeductibleBps: number;
  expenseNature?: string;
  vatTreatment?: string;
  notes?: string;
  assetId?: string;
  source?: string;
};


type CellRange = {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
} | null;

const INCOME_TYPES = new Set(['income', 'grant']);
const EXPENSE_TYPES = new Set(['expense', 'autonomo_fee', 'amortization']);

/** Column ids that participate in spreadsheet-style selection (order = col index). */
const SELECTABLE_COL_IDS = [
  'fiscalDate',
  'type',
  'concept',
  'partyName',
  'invoiceNumber',
  'taxBaseCents',
  'vatRateBps',
  'vatCents',
  'totalCents',
  'quarter',
  'expenseNature',
  'status',
  'ded',
] as const;

const EMPTY_ITEMS: Movement[] = [];

const CLIP_COLS = new Set(['concept', 'partyName', 'invoiceNumber']);

function rowTypeClass(type: string): string {
  if (type === 'amortization') return 'row-amortization';
  if (INCOME_TYPES.has(type)) return 'row-income';
  if (EXPENSE_TYPES.has(type)) return 'row-expense';
  return '';
}

function cellDisplayValue(m: Movement, colId: string): string {
  switch (colId) {
    case 'fiscalDate':
      return m.fiscalDate;
    case 'type':
      return movementTypeLabel(m.type);
    case 'concept':
      return m.concept;
    case 'partyName':
      return m.partyName ?? '';
    case 'invoiceNumber':
      return m.invoiceNumber ?? '';
    case 'taxBaseCents':
      return (m.taxBaseCents / 100).toFixed(2);
    case 'vatRateBps':
      return String(m.vatRateBps / 100);
    case 'vatCents':
      return (m.vatCents / 100).toFixed(2);
    case 'totalCents':
      return (m.totalCents / 100).toFixed(2);
    case 'quarter':
      return m.quarter;
    case 'expenseNature':
      return expenseNatureLabel(m.expenseNature);
    case 'status':
      return movementStatusLabel(m.status);
    case 'ded':
      return `${m.professionalUseBps / 100}% / ${m.taxDeductibleBps / 100}%`;
    default:
      return '';
  }
}

function formFromMovement(m: Movement) {
  return {
    type: m.type,
    fiscalDate: m.fiscalDate,
    invoiceDate: m.invoiceDate ?? m.fiscalDate,
    concept: m.concept,
    partyName: m.partyName ?? '',
    invoiceNumber: m.invoiceNumber ?? '',
    taxBaseEuros: (m.taxBaseCents / 100).toFixed(2).replace('.', ','),
    vatPercent: String(m.vatRateBps / 100),
    irpfPercent: String((m.irpfRateBps ?? 0) / 100),
    professionalUse: String(m.professionalUseBps / 100),
    taxDeductible: String(m.taxDeductibleBps / 100),
    expenseNature: m.expenseNature ?? 'current',
    vatTreatment: m.vatTreatment ?? '',
    notes: m.notes ?? '',
    assetId: m.assetId ?? '',
    coefficient: '26',
    inServiceDate: m.fiscalDate,
  };
}

function emptyForm(defaultType: string) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    type: defaultType,
    fiscalDate: today,
    invoiceDate: today,
    concept: '',
    partyName: '',
    invoiceNumber: '',
    taxBaseEuros: '',
    vatPercent: '21',
    irpfPercent: '0',
    professionalUse: '100',
    taxDeductible: '100',
    expenseNature: 'current',
    vatTreatment: '',
    notes: '',
    assetId: '',
    coefficient: '26',
    inServiceDate: today,
  };
}

function ClipCell({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    const td = el?.closest('td');
    if (!el || !td) return;
    // One-shot measure: ResizeObserver on table cells caused UI freezes
    // when the virtualized grid remounted after filter changes.
    const id = requestAnimationFrame(() => {
      const truncated = el.scrollWidth > el.clientWidth + 1;
      td.classList.toggle('is-truncated', truncated);
    });
    return () => {
      cancelAnimationFrame(id);
      td.classList.remove('is-truncated');
    };
  }, [text]);

  return (
    <>
      <span ref={ref} className="cell-text">
        {text}
      </span>
      <span className="cell-expand" aria-hidden>
        {text}
      </span>
    </>
  );
}

export function MovementsPage({ forcedType }: { forcedType?: string }) {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api<{ activeFiscalYear?: number; workingQuarter?: string }>('/api/settings'),
  });
  const year = settings.data?.activeFiscalYear ?? 2026;
  const [search, setSearch] = useState('');
  const [quarter, setQuarter] = useState<string>('');
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Movement | null>(null);
  const [cellRange, setCellRange] = useState<CellRange>(null);
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const dragging = useRef(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const params = new URLSearchParams({
    fiscalYear: String(year),
    pageSize: '500',
    sortBy: 'fiscalDate',
    sortDir: 'desc',
  });
  if (forcedType) params.set('type', forcedType);
  if (quarter) params.set('quarter', quarter);
  if (search) params.set('search', search);

  const list = useQuery({
    queryKey: ['movements', year, forcedType, quarter, search],
    queryFn: () =>
      api<{ items: Movement[]; total: number }>(`/api/movements?${params.toString()}`),
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    setCellRange(null);
    setAnchor(null);
    setRowSelection({});
  }, [quarter, search, forcedType, year]);

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/movements/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRowSelection({});
      void qc.invalidateQueries({ queryKey: ['movements'] });
      void qc.invalidateQueries({ queryKey: ['alerts'] });
    },
    meta: { errorTitle: 'No se pudo eliminar el movimiento' },
  });

  const openEdit = useCallback((m: Movement) => {
    setEditing(m);
    setShowForm(true);
  }, []);

  const columns = useMemo<ColumnDef<Movement>[]>(
    () => [
      {
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            aria-label="Seleccionar todo"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            onClick={(e) => e.stopPropagation()}
            aria-label="Seleccionar fila"
          />
        ),
        size: 32,
      },
      {
        id: 'edit',
        header: () => (
          <span title="Editar movimiento" aria-label="Editar">
            <PencilIcon />
          </span>
        ),
        cell: ({ row }) => {
          const locked = row.original.status === 'locked';
          return (
            <button
              type="button"
              className="icon-btn"
              disabled={locked}
              title={locked ? 'Bloqueado' : 'Editar'}
              aria-label="Editar"
              onClick={(e) => {
                e.stopPropagation();
                if (!locked) openEdit(row.original);
              }}
            >
              <PencilIcon />
            </button>
          );
        },
        size: 36,
      },
      {
        accessorKey: 'fiscalDate',
        id: 'fiscalDate',
        header: () => (
          <ColumnHeader label="Fecha fiscal" tip="Fecha de devengo / imputación fiscal" />
        ),
        size: 96,
      },
      {
        accessorKey: 'type',
        id: 'type',
        header: () => <ColumnHeader label="Tipo" tip="Tipo de movimiento" />,
        cell: ({ getValue }) => movementTypeLabel(getValue<string>()),
        size: 100,
      },
      {
        accessorKey: 'concept',
        id: 'concept',
        header: () => <ColumnHeader label="Concepto" tip="Descripción del movimiento" />,
        cell: ({ getValue }) => <ClipCell text={getValue<string>() ?? ''} />,
        size: 220,
      },
      {
        accessorKey: 'partyName',
        id: 'partyName',
        header: () => <ColumnHeader label="Tercero" tip="Proveedor o cliente" />,
        cell: ({ getValue }) => <ClipCell text={getValue<string>() ?? ''} />,
        size: 120,
      },
      {
        accessorKey: 'invoiceNumber',
        id: 'invoiceNumber',
        header: () => <ColumnHeader label="Nº fact." tip="Número de factura" />,
        cell: ({ getValue }) => <ClipCell text={getValue<string>() ?? ''} />,
        size: 90,
      },
      {
        accessorKey: 'taxBaseCents',
        id: 'taxBaseCents',
        header: () => <ColumnHeader label="Base" tip="Base imponible en euros" />,
        cell: ({ getValue }) => (
          <span className="money">{formatMoney(getValue<number>())}</span>
        ),
        size: 100,
      },
      {
        accessorKey: 'vatRateBps',
        id: 'vatRateBps',
        header: () => <ColumnHeader label="IVA %" tip="Tipo de IVA aplicado" />,
        cell: ({ getValue }) => (
          <span className="money">{(getValue<number>() / 100).toFixed(0)}%</span>
        ),
        size: 56,
      },
      {
        accessorKey: 'vatCents',
        id: 'vatCents',
        header: () => <ColumnHeader label="IVA €" tip="Cuota de IVA en euros" />,
        cell: ({ getValue }) => (
          <span className="money">{formatMoney(getValue<number>())}</span>
        ),
        size: 90,
      },
      {
        accessorKey: 'totalCents',
        id: 'totalCents',
        header: () => <ColumnHeader label="Total" tip="Total factura (base + IVA)" />,
        cell: ({ getValue }) => (
          <span className="money">{formatMoney(getValue<number>())}</span>
        ),
        size: 100,
      },
      {
        accessorKey: 'quarter',
        id: 'quarter',
        header: () => <ColumnHeader label="T" tip="Trimestre fiscal (T1–T4)" />,
        size: 40,
      },
      {
        accessorKey: 'expenseNature',
        id: 'expenseNature',
        header: () => (
          <ColumnHeader label="Naturaleza" tip="Corriente o inmovilizado (gastos)" />
        ),
        cell: ({ getValue }) => expenseNatureLabel(getValue<string | undefined>()),
        size: 100,
      },
      {
        accessorKey: 'status',
        id: 'status',
        header: () => <ColumnHeader label="Estado" tip="Estado del movimiento" />,
        cell: ({ getValue }) => movementStatusLabel(getValue<string>()),
        size: 90,
      },
      {
        id: 'ded',
        header: () => (
          <ColumnHeader
            label="Prof/Ded"
            tip="Uso profesional % / Deducible fiscal % (sobre la parte profesional)"
          />
        ),
        cell: ({ row }) => (
          <span className="money text-[11px]">
            {row.original.professionalUseBps / 100}% / {row.original.taxDeductibleBps / 100}%
          </span>
        ),
        size: 80,
      },
    ],
    [openEdit],
  );

  const data = list.data?.items ?? EMPTY_ITEMS;
  const table = useReactTable({
    data,
    columns,
    state: { rowSelection },
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    enableRowSelection: true,
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const estimateSize = useCallback(() => 28, []);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize,
    overscan: 20,
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);

  const highlightIdParam = searchParams.get('highlight');
  useEffect(() => {
    if (!highlightIdParam || !data.length) return;
    const idx = data.findIndex((m) => m.id === highlightIdParam);
    if (idx < 0) return;
    setHighlightId(highlightIdParam);
    virtualizer.scrollToIndex(idx, { align: 'center' });
    const t = window.setTimeout(() => {
      setHighlightId(null);
      const next = new URLSearchParams(searchParams);
      next.delete('highlight');
      next.delete('alert');
      setSearchParams(next, { replace: true });
    }, 2800);
    return () => window.clearTimeout(t);
    // Intentionally omit virtualizer: its identity churn retriggers this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, highlightIdParam, searchParams, setSearchParams]);

  const isCellSelected = (rowIndex: number, colId: string) => {
    if (!cellRange) return false;
    const c = SELECTABLE_COL_IDS.indexOf(colId as (typeof SELECTABLE_COL_IDS)[number]);
    if (c < 0) return false;
    const { r0, r1, c0, c1 } = cellRange;
    return rowIndex >= r0 && rowIndex <= r1 && c >= c0 && c <= c1;
  };

  const beginSelect = (rowIndex: number, colId: string, shift: boolean) => {
    const c = SELECTABLE_COL_IDS.indexOf(colId as (typeof SELECTABLE_COL_IDS)[number]);
    if (c < 0) return;
    if (shift && anchor) {
      setCellRange({
        r0: Math.min(anchor.r, rowIndex),
        r1: Math.max(anchor.r, rowIndex),
        c0: Math.min(anchor.c, c),
        c1: Math.max(anchor.c, c),
      });
      return;
    }
    setAnchor({ r: rowIndex, c });
    setCellRange({ r0: rowIndex, r1: rowIndex, c0: c, c1: c });
    dragging.current = true;
  };

  const extendSelect = (rowIndex: number, colId: string) => {
    if (!dragging.current || !anchor) return;
    const c = SELECTABLE_COL_IDS.indexOf(colId as (typeof SELECTABLE_COL_IDS)[number]);
    if (c < 0) return;
    setCellRange({
      r0: Math.min(anchor.r, rowIndex),
      r1: Math.max(anchor.r, rowIndex),
      c0: Math.min(anchor.c, c),
      c1: Math.max(anchor.c, c),
    });
  };

  useEffect(() => {
    const up = () => {
      dragging.current = false;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const copyCellRange = useCallback(async () => {
    if (!cellRange) return;
    const { r0, r1, c0, c1 } = cellRange;
    const lines: string[] = [];
    for (let r = r0; r <= r1; r++) {
      const m = data[r];
      if (!m) continue;
      const cells: string[] = [];
      for (let c = c0; c <= c1; c++) {
        const colId = SELECTABLE_COL_IDS[c];
        if (!colId) continue;
        cells.push(cellDisplayValue(m, colId));
      }
      lines.push(cells.join('\t'));
    }
    if (lines.length) await copyToClipboard(lines.join('\n'));
  }, [cellRange, data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && cellRange) {
        e.preventDefault();
        void copyCellRange();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cellRange, copyCellRange]);

  const title =
    forcedType === 'income' ? 'Ingresos' : forcedType === 'expense' ? 'Gastos' : 'Movimientos';

  const closeForm = () => {
    setShowForm(false);
    setEditing(null);
  };

  const onSaved = () => {
    closeForm();
    void qc.invalidateQueries({ queryKey: ['movements'] });
    void qc.invalidateQueries({ queryKey: ['dashboard'] });
    void qc.invalidateQueries({ queryKey: ['alerts'] });
    void qc.invalidateQueries({ queryKey: ['assets'] });
  };

  return (
    <div className="flex h-[calc(100%-0px)] flex-col">
      <PageHeader
        title={title}
        subtitle={`${list.data?.total ?? 0} registros · ${year}`}
        actions={
          <>
            <Button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
            >
              Nuevo
            </Button>
            <Button
              onClick={async () => {
                if (cellRange) {
                  await copyCellRange();
                  return;
                }
                const ids = selected.map((s) => s.id);
                if (!ids.length) {
                  await copyToClipboard(buildLocalTsv(data));
                  return;
                }
                const res = await api<{ content: string }>('/api/copy/selection', {
                  method: 'POST',
                  json: { ids, format: 'tsv' },
                });
                await copyToClipboard(res.content);
              }}
            >
              Copiar para IA
            </Button>
            <Button
              variant="danger"
              disabled={!selected.length}
              onClick={() => {
                if (!confirm(`Eliminar ${selected.length} movimiento(s)?`)) return;
                selected.forEach((s) => remove.mutate(s.id));
              }}
            >
              Eliminar
            </Button>
          </>
        }
      />

      <div className="mb-2 flex flex-wrap gap-2">
        <input
          className="border border-surface-border bg-surface-field px-2 py-1 text-ui"
          placeholder="Buscar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="border border-surface-border bg-surface-field px-2 py-1 text-ui"
          value={quarter}
          onChange={(e) => setQuarter(e.target.value)}
        >
          <option value="">Todos los trimestres</option>
          {Quarters.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </div>

      <div
        ref={parentRef}
        className="min-h-0 flex-1 overflow-auto border border-surface-border bg-surface-panel"
        style={{ maxHeight: 'calc(100vh - 160px)' }}
        onMouseLeave={() => {
          dragging.current = false;
        }}
      >
        <table className="dense-table" style={{ width: table.getTotalSize(), minWidth: '100%' }}>
          <colgroup>
            {table.getAllLeafColumns().map((col) => (
              <col key={col.id} style={{ width: col.getSize() }} />
            ))}
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    style={{ width: h.getSize(), minWidth: h.getSize(), maxWidth: h.getSize() }}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const row = rows[vRow.index]!;
              const m = row.original;
              const locked = m.status === 'locked';
              const classes = [
                rowTypeClass(m.type),
                locked ? 'row-locked' : 'row-editable',
                row.getIsSelected() ? 'selected' : '',
                highlightId === m.id ? 'row-highlight' : '',
              ]
                .filter(Boolean)
                .join(' ');
              return (
                <tr
                  key={row.id}
                  className={classes}
                  style={{
                    position: 'absolute',
                    top: 0,
                    transform: `translateY(${vRow.start}px)`,
                    width: table.getTotalSize(),
                    minWidth: '100%',
                    display: 'table',
                    tableLayout: 'fixed',
                  }}
                >
                  {row.getVisibleCells().map((cell) => {
                    const colId = cell.column.id;
                    const selectable = SELECTABLE_COL_IDS.includes(
                      colId as (typeof SELECTABLE_COL_IDS)[number],
                    );
                    const clip = CLIP_COLS.has(colId);
                    const size = cell.column.getSize();
                    const tdClass = [
                      selectable && isCellSelected(vRow.index, colId) ? 'cell-selected' : '',
                      clip ? 'cell-clip' : '',
                      !selectable ? 'cell-no-select' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <td
                        key={cell.id}
                        className={tdClass}
                        style={{ width: size, minWidth: size, maxWidth: size }}
                        onMouseDown={(e) => {
                          if (!selectable) return;
                          if ((e.target as HTMLElement).closest('input,button,a')) return;
                          e.preventDefault();
                          beginSelect(vRow.index, colId, e.shiftKey);
                        }}
                        onMouseEnter={() => {
                          if (selectable) extendSelect(vRow.index, colId);
                        }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.length && (
          <div className="p-4 text-surface-muted">Sin movimientos. Usa Nuevo o la IA, en modo Factura.</div>
        )}
      </div>

      {showForm && (
        <MovementFormModal
          defaultType={forcedType === 'income' ? 'income' : 'expense'}
          movement={editing}
          onClose={closeForm}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M12.5 7l4.5 4.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function buildLocalTsv(data: Movement[]): string {
  const header = 'Fecha\tConcepto\tBase\tIVA %\tIVA €\tTotal\tTipo\tTrimestre';
  const lines = data.map(
    (m) =>
      `${m.fiscalDate}\t${m.concept}\t${(m.taxBaseCents / 100).toFixed(2)}\t${m.vatRateBps / 100}\t${(m.vatCents / 100).toFixed(2)}\t${(m.totalCents / 100).toFixed(2)}\t${movementTypeLabel(m.type)}\t${m.quarter}`,
  );
  return [header, ...lines].join('\n');
}

function MovementFormModal({
  defaultType,
  movement,
  onClose,
  onSaved,
}: {
  defaultType: string;
  movement: Movement | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(movement);
  const [form, setForm] = useState(() =>
    movement ? formFromMovement(movement) : emptyForm(defaultType),
  );
  const save = useMutation({
    mutationFn: async () => {
      const taxBaseCents = Math.round(Number(form.taxBaseEuros.replace(',', '.')) * 100);
      const vatRateBps = Math.round(Number(form.vatPercent) * 100);
      const irpfRateBps = Math.round(Number(form.irpfPercent) * 100);
      const body: Record<string, unknown> = {
        type: form.type,
        fiscalDate: form.fiscalDate,
        invoiceDate: form.invoiceDate,
        concept: form.concept,
        partyName: form.partyName || undefined,
        invoiceNumber: form.invoiceNumber || undefined,
        taxBaseCents,
        vatRateBps,
        irpfRateBps,
        professionalUseBps: Math.round(Number(form.professionalUse) * 100),
        taxDeductibleBps: Math.round(Number(form.taxDeductible) * 100),
        expenseNature: form.expenseNature,
        notes: form.notes || undefined,
      };
      if (form.expenseNature === 'fixed_asset') {
        if (!form.assetId) {
          body.coefficientBps = Math.round(Number(form.coefficient.replace(',', '.')) * 100);
          body.inServiceDate = form.inServiceDate || form.fiscalDate;
        }
      } else {
        body.assetId = undefined;
      }
      if (vatRateBps === 0) {
        body.vatTreatment = form.vatTreatment || 'other';
      }
      if (isEdit && movement) {
        return api(`/api/movements/${movement.id}`, { method: 'PATCH', json: body });
      }
      return api('/api/movements', {
        method: 'POST',
        json: { ...body, status: 'confirmed', source: 'manual' },
      });
    },
    onSuccess: onSaved,
    meta: { errorTitle: 'No se pudo guardar el movimiento' },
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <form
        className="max-h-[90vh] w-full max-w-lg overflow-auto border border-surface-border bg-surface-panel p-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h2 className="mb-3 text-[14px] font-semibold">
          {isEdit ? 'Editar movimiento' : 'Nuevo movimiento'}
        </h2>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Tipo">
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
            >
              <option value="expense">Gasto</option>
              <option value="income">Ingreso</option>
              <option value="autonomo_fee">Cuota autónomo</option>
              <option value="grant">Ayuda / subvención</option>
            </select>
          </Field>
          <Field label="Fecha fiscal">
            <input
              type="date"
              value={form.fiscalDate}
              onChange={(e) =>
                setForm({
                  ...form,
                  fiscalDate: e.target.value,
                  invoiceDate: e.target.value,
                  inServiceDate: form.expenseNature === 'fixed_asset' ? e.target.value : form.inServiceDate,
                })
              }
              className="w-full border border-surface-border px-2 py-1"
              required
            />
          </Field>
          <Field label="Concepto" className="col-span-2">
            <input
              value={form.concept}
              onChange={(e) => setForm({ ...form, concept: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
              required
            />
          </Field>
          <Field label="Proveedor / cliente">
            <input
              value={form.partyName}
              onChange={(e) => setForm({ ...form, partyName: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
            />
          </Field>
          <Field label="Nº factura">
            <input
              value={form.invoiceNumber}
              onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
            />
          </Field>
          <Field label="Base (€)">
            <input
              value={form.taxBaseEuros}
              onChange={(e) => setForm({ ...form, taxBaseEuros: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
              required
              placeholder="742,98"
            />
          </Field>
          <Field label="IVA %">
            <input
              value={form.vatPercent}
              onChange={(e) => setForm({ ...form, vatPercent: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
            />
          </Field>
          <Field label="IRPF %">
            <input
              value={form.irpfPercent}
              onChange={(e) => setForm({ ...form, irpfPercent: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
            />
          </Field>
          <Field label="Uso profesional %">
            <input
              value={form.professionalUse}
              onChange={(e) => setForm({ ...form, professionalUse: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
            />
          </Field>
          <Field label="Deducible %">
            <input
              value={form.taxDeductible}
              onChange={(e) => setForm({ ...form, taxDeductible: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
            />
          </Field>
          <Field label="Naturaleza">
            <select
              value={form.expenseNature}
              onChange={(e) => setForm({ ...form, expenseNature: e.target.value })}
              className="w-full border border-surface-border px-2 py-1"
            >
              <option value="current">Corriente</option>
              <option value="fixed_asset">Inmovilizado</option>
            </select>
          </Field>
          {form.expenseNature === 'fixed_asset' && !form.assetId && (
            <>
              <Field label="Coef. amortización %">
                <input
                  value={form.coefficient}
                  onChange={(e) => setForm({ ...form, coefficient: e.target.value })}
                  className="w-full border border-surface-border px-2 py-1"
                  required
                  placeholder="26"
                />
              </Field>
              <Field label="Puesta en marcha">
                <input
                  type="date"
                  value={form.inServiceDate}
                  onChange={(e) => setForm({ ...form, inServiceDate: e.target.value })}
                  className="w-full border border-surface-border px-2 py-1"
                  required
                />
              </Field>
              <p className="col-span-2 text-[11px] text-surface-muted">
                Al guardar se creará el activo en Inmovilizado y el plan de amortizaciones
                (prorrateo por días). La compra no se deduce de golpe en el modelo 130.
              </p>
            </>
          )}
          {form.expenseNature === 'fixed_asset' && form.assetId && (
            <p className="col-span-2 text-[11px] text-surface-muted">
              Ya vinculado a un activo. El plan de amortización se gestiona en Inmovilizado.
            </p>
          )}
          {form.vatPercent === '0' && (
            <Field label="Motivo IVA 0%" className="col-span-2">
              <select
                value={form.vatTreatment}
                onChange={(e) => setForm({ ...form, vatTreatment: e.target.value })}
                className="w-full border border-surface-border px-2 py-1"
              >
                <option value="">— Selecciona —</option>
                <option value="exempt">Exento</option>
                <option value="not_subject">No sujeto</option>
                <option value="reverse_charge">Inversión sujeto pasivo</option>
                <option value="zero_rate">Tipo 0</option>
                <option value="other">Otro</option>
              </select>
            </Field>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Guardar
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-[11px] text-surface-muted ${className}`}>
      {label}
      <div className="mt-0.5 text-surface-ink">{children}</div>
    </label>
  );
}
