import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import { Button, PageHeader } from '../../components/ui/primitives';

type PasteResult = {
  dryRun: boolean;
  summary: { total: number; ok: number; errors: number; warnings: number };
  rows: { row: number; ok: boolean; errors: string[]; warnings: string[] }[];
  createdIds?: string[];
};

export function ImportPage() {
  const [tsv, setTsv] = useState(
    'Fecha\tConcepto\tBase\tIVA\tTotal\n01/09/2026\tNetcup\t19.95\t21\t24.14',
  );
  const [result, setResult] = useState<PasteResult | null>(null);

  const preview = useMutation({
    mutationFn: () =>
      api<PasteResult>('/api/imports/paste', {
        method: 'POST',
        json: { tsv, defaultType: 'expense', dryRun: true },
      }),
    onSuccess: setResult,
    meta: { errorTitle: 'No se pudo generar la vista previa' },
  });

  const commit = useMutation({
    mutationFn: () =>
      api<PasteResult>('/api/imports/paste', {
        method: 'POST',
        json: { tsv, defaultType: 'expense', dryRun: false },
      }),
    onSuccess: setResult,
    meta: { errorTitle: 'No se pudo importar' },
  });

  return (
    <div>
      <PageHeader
        title="Importar / Pegar desde Excel"
        subtitle="Pega una tabla TSV (copiada de Excel). Vista previa antes de guardar."
        actions={
          <>
            <Button onClick={() => preview.mutate()} disabled={preview.isPending}>
              Vista previa
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (!confirm('¿Importar filas válidas?')) return;
                commit.mutate();
              }}
              disabled={commit.isPending}
            >
              Importar válidas
            </Button>
          </>
        }
      />
      <textarea
        className="h-48 w-full border border-surface-border bg-white p-2 font-mono text-table"
        value={tsv}
        onChange={(e) => setTsv(e.target.value)}
        spellCheck={false}
      />
      {result && (
        <div className="mt-3 border border-surface-border bg-surface-panel p-3">
          <p className="text-ui">
            {result.summary.ok} correctas · {result.summary.errors} con error ·{' '}
            {result.summary.warnings} con avisos
            {!result.dryRun && result.createdIds
              ? ` · importadas ${result.createdIds.length}`
              : ' (simulación)'}
          </p>
          <ul className="mt-2 max-h-64 overflow-auto text-[12px]">
            {result.rows.map((r) => (
              <li key={r.row} className={r.ok ? 'text-surface-ok' : 'text-surface-danger'}>
                Fila {r.row}: {r.ok ? 'OK' : r.errors.join('; ')}
                {r.warnings.length ? ` · avisos: ${r.warnings.join('; ')}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
