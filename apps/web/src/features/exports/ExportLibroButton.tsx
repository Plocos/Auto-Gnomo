import { useMutation } from '@tanstack/react-query';
import { Button } from '../../components/ui/primitives';
import { exportLibroExpedidas, type LibroExportResult } from './exportLibroExpedidas';

export function useExportLibro(year: number, quarter: string) {
  return useMutation<LibroExportResult, Error>({
    mutationFn: () => exportLibroExpedidas(year, quarter),
    meta: { errorTitle: 'No se pudo exportar el libro registro' },
  });
}

type ExportLibroMutation = ReturnType<typeof useExportLibro>;

export function ExportLibroButton({ mutation }: { mutation: ExportLibroMutation }) {
  return (
    <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
      {mutation.isPending ? 'Exportando…' : 'Exportar Excel AEAT'}
    </Button>
  );
}

export function ExportLibroStatus({ mutation }: { mutation: ExportLibroMutation }) {
  const result = mutation.data;
  if (!mutation.isSuccess || !result || result.status === 'cancelled') return null;
  return (
    <div className="mb-2 border border-surface-border bg-surface-panel px-2 py-1.5 text-[12px] text-surface-ok">
      {result.status === 'saved'
        ? `Libro registro guardado en ${result.path} (${result.rowCount} líneas).`
        : `Libro registro descargado: ${result.fileName}`}
    </div>
  );
}
