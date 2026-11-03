import { useQuery } from '@tanstack/react-query';
import { Quarters } from '@autonomous/shared';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Button, PageHeader } from '../../components/ui/primitives';
import { nextActionableQuarter } from '../../lib/quarters';
import { copyToClipboard } from '../clipboard/copy';
import { DatosButton, DatosPanel } from '../clipboard/DatosPanel';
import { ExportLibroButton, ExportLibroStatus, useExportLibro } from '../exports/ExportLibroButton';
import { FilingBar, useFilingView } from '../filings/FilingBar';
import type { TaxReturnsResponse } from '../filings/types';
import { Modelo303Table, modelo303ToTsv } from './Modelo303Table';

export function Tax303Page() {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api<{ activeFiscalYear?: number; workingQuarter?: string }>('/api/settings'),
  });
  const year = settings.data?.activeFiscalYear ?? 2026;
  const [quarter, setQuarter] = useState<string | null>(null);
  const [userPicked, setUserPicked] = useState(false);
  const [showDatos, setShowDatos] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const quarters = useQuery({
    queryKey: ['quarters', year],
    queryFn: () =>
      api<{ items: { quarter: string; status: string }[] }>(`/api/quarters/${year}`),
    enabled: settings.isSuccess,
  });

  useEffect(() => {
    if (userPicked || !quarters.data?.items.length) return;
    setQuarter(nextActionableQuarter(quarters.data.items));
  }, [quarters.data, userPicked]);

  const activeQuarter = quarter ?? 'T1';

  const data = useQuery({
    queryKey: ['tax303', year, activeQuarter],
    queryFn: () => api<TaxReturnsResponse>(`/api/tax-returns/${year}/${activeQuarter}`),
    enabled: Boolean(quarter),
  });

  const exportLibro = useExportLibro(year, activeQuarter);

  const live = data.data?.live.modelo303;
  const snapshots = data.data?.snapshots['303'];
  const view = useFilingView(year, activeQuarter, snapshots);
  const shown = view.selected ?? live;
  const boxes = shown?.boxes ?? {};
  const rulesVersion = view.selected ? view.selected.rulesVersion : live?.meta.version;

  return (
    <div>
      <PageHeader
        title="Modelo 303 — IVA (trimestral)"
        subtitle={`Reglas ${rulesVersion ?? '—'} · Solo ${activeQuarter} ${year}`}
        actions={
          <>
            <select
              className="border border-surface-border bg-white px-2 py-1 text-ui"
              value={activeQuarter}
              onChange={(e) => {
                setUserPicked(true);
                setQuarter(e.target.value);
              }}
            >
              {Quarters.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
            <DatosButton open={showDatos} onToggle={() => setShowDatos(!showDatos)} />
            <Button onClick={() => void copyToClipboard(modelo303ToTsv(boxes, showAll))}>
              Copiar Modelo 303
            </Button>
            <ExportLibroButton mutation={exportLibro} />
          </>
        }
      />

      <ExportLibroStatus mutation={exportLibro} />
      {showDatos && <DatosPanel year={year} quarter={activeQuarter} />}

      {data.data && (
        <FilingBar
          model="303"
          year={year}
          quarter={activeQuarter}
          snapshots={snapshots}
          liveBoxes={live?.boxes ?? {}}
          view={view}
          onChanged={() => setUserPicked(true)}
        />
      )}

      <div className="mb-2 flex items-center justify-between gap-2 text-[12px] text-surface-muted">
        <span>
          Mismo orden que el formulario de la Sede. Teclea solo las casillas marcadas como
          «Escribir»; el resto es para comprobar que coincide.
        </span>
        <label className="flex shrink-0 items-center gap-1">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Mostrar todas
        </label>
      </div>

      <Modelo303Table
        key={view.selectedId}
        boxes={boxes}
        resultCents={shown?.resultCents}
        carryForwardCents={shown?.carryForwardCents}
        quarter={activeQuarter}
        showAll={showAll}
      />
    </div>
  );
}
