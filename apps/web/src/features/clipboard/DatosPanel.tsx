import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/primitives';
import { CopyValue } from './CopyValue';

export function DatosButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button variant={open ? 'primary' : 'default'} onClick={onToggle}>
      Datos
    </Button>
  );
}

export function DatosPanel({ year, quarter }: { year: number; quarter: string }) {
  const profile = useQuery({
    queryKey: ['tax-profile', year],
    queryFn: () =>
      api<{ nif: string; firstName: string; lastName: string }>(`/api/tax-profiles/${year}`),
    retry: false,
  });

  const rows: [string, string][] = [
    ['Ejercicio', String(year)],
    ['Período', `${quarter.slice(1)}T`],
    ['NIF', (profile.data?.nif ?? '').replace(/[\s\-./]/g, '').toUpperCase()],
    ['Apellidos', (profile.data?.lastName ?? '').trim().toUpperCase()],
    ['Nombre', (profile.data?.firstName ?? '').trim().toUpperCase()],
  ];
  const missing = !profile.isLoading && rows.some(([, v]) => !v);

  return (
    <div className="mb-2 inline-block border border-surface-border bg-surface-panel px-2 py-1.5 text-[12px]">
      <table>
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="pr-3 text-surface-muted">{label}</td>
              <td className="font-mono">
                {value ? <CopyValue display={value} value={value} /> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {missing && (
        <p className="mt-1 text-surface-warn">
          Faltan datos del perfil fiscal.{' '}
          <Link to="/configuracion" className="text-surface-accent underline">
            Completar en Configuración
          </Link>
        </p>
      )}
    </div>
  );
}
