import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from '../lib/api';
import { isApiReady } from '../lib/profile';
import { AppLayout } from './AppLayout';
import { AlertsPage } from '../features/alerts/AlertsPage';
import { AssetsPage } from '../features/assets/AssetsPage';
import { AuditPage } from '../features/audit/AuditPage';
import { DashboardPage } from '../features/dashboard/DashboardPage';
import { MovementsPage } from '../features/movements/MovementsPage';
import { QuartersPage } from '../features/quarters/QuartersPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { Tax130Page } from '../features/tax130/Tax130Page';
import { Tax303Page } from '../features/tax303/Tax303Page';
import { AssistantPage } from '../features/assistant/AssistantPage';
import { ProfileModalProvider } from '../features/profiles/ProfileModalContext';
import { ProfilePickerPage } from '../features/profiles/ProfilePickerPage';

function ProfileGate({ children }: { children: React.ReactNode }) {
  const ready = useQuery({
    queryKey: ['profile-ready'],
    queryFn: async () => {
      const ok = await isApiReady();
      if (!ok) return { ok: false as const };
      const vault = await api<{ name: string; dataDir: string }>('/api/vault');
      return { ok: true as const, vault };
    },
    retry: false,
    refetchOnWindowFocus: true,
  });

  if (ready.isLoading) {
    return (
      <div className="grid h-full place-items-center text-surface-muted">Cargando…</div>
    );
  }
  if (ready.isError || !ready.data?.ok) {
    return <Navigate to="/perfiles" replace />;
  }
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/perfiles" element={<ProfilePickerPage />} />
      <Route path="/bovedas" element={<Navigate to="/perfiles" replace />} />
      <Route
        path="/*"
        element={
          <ProfileGate>
            <ProfileModalProvider>
              <AppLayout>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/movimientos" element={<MovementsPage />} />
                  <Route path="/ingresos" element={<MovementsPage forcedType="income" />} />
                  <Route path="/gastos" element={<MovementsPage forcedType="expense" />} />
                  <Route path="/inmovilizado" element={<AssetsPage />} />
                  <Route path="/trimestres" element={<QuartersPage />} />
                  <Route path="/modelo-130" element={<Tax130Page />} />
                  <Route path="/modelo-303" element={<Tax303Page />} />
                  <Route path="/alertas" element={<AlertsPage />} />
                  <Route path="/auditoria" element={<AuditPage />} />
                  <Route path="/importar" element={<Navigate to="/asistente" replace />} />
                  <Route path="/asistente" element={<AssistantPage />} />
                  <Route path="/configuracion" element={<SettingsPage />} />
                </Routes>
              </AppLayout>
            </ProfileModalProvider>
          </ProfileGate>
        }
      />
    </Routes>
  );
}
