import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { PageHeader } from '../../components/ui/primitives';

export function AuditPage() {
  const log = useQuery({
    queryKey: ['audit'],
    queryFn: () =>
      api<{
        items: {
          id: string;
          action: string;
          entity: string;
          entityId?: string;
          reason?: string;
          createdAt: string;
        }[];
        total: number;
      }>('/api/audit-log'),
  });

  return (
    <div>
      <PageHeader title="Historial / Auditoría" subtitle={`${log.data?.total ?? 0} eventos`} />
      <table className="dense-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Acción</th>
            <th>Entidad</th>
            <th>Id</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          {(log.data?.items ?? []).map((a) => (
            <tr key={a.id}>
              <td className="font-mono text-[11px]">
                {a.createdAt ? new Date(a.createdAt).toLocaleString('es-ES') : '—'}
              </td>
              <td>{a.action}</td>
              <td>{a.entity}</td>
              <td className="font-mono text-[11px]">{a.entityId ?? '—'}</td>
              <td>{a.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
