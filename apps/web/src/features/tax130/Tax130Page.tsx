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
import { Modelo130Table, modelo130ToTsv } from './Modelo130Table';

export function Tax130Page() {
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api<{ activeFiscalYear?: number; workingQuarter?: string }>('/api/settings'),
  });
  const year = settings.data?.activeFiscalYear ?? 2026;
  const [quarter, setQuarter] = useState<string | null>(null);
  const [userPicked, setUserPicked] = useState(false);
  const [showDatos, setShowDatos] = useState(false);

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
    queryKey: ['tax130', year, activeQuarter],
    queryFn: () => api<TaxReturnsResponse>(`/api/tax-returns/${year}/${activeQuarter}`),
    enabled: Boolean(quarter),
  });

  const exportLibro = useExportLibro(year, activeQuarter);

  const live = data.data?.live.modelo130;
  const snapshots = data.data?.snapshots['130'];
  const view = useFilingView(year, activeQuarter, snapshots);
  const boxes = view.selected?.boxes ?? live?.boxes ?? {};
  const rulesVersion = view.selected ? view.selected.rulesVersion : live?.meta.version;

  return (
    <div>
      <PageHeader
        title="Modelo 130 — IRPF (acumulativo)"
        subtitle={`Reglas ${rulesVersion ?? '—'} · YTD hasta ${activeQuarter} ${year}`}
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
            <Button onClick={() => void copyToClipboard(modelo130ToTsv(boxes))}>
              Copiar Modelo 130
            </Button>
            <ExportLibroButton mutation={exportLibro} />
          </>
        }
      />

      <ExportLibroStatus mutation={exportLibro} />
      {showDatos && <DatosPanel year={year} quarter={activeQuarter} />}

      {data.data && (
        <FilingBar
          model="130"
          year={year}
          quarter={activeQuarter}
          snapshots={snapshots}
          liveBoxes={live?.boxes ?? {}}
          view={view}
          onChanged={() => setUserPicked(true)}
        />
      )}

      <Modelo130Table key={view.selectedId} boxes={boxes} />
    </div>
  );
}
