import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Quarters, taxProfileSchema, toValidationIssues } from '@autonomous/shared';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiClientError } from '../../lib/api';
import { pushError } from '../../lib/errorStore';
import { isTauri, openProfile, pickFolder } from '../../lib/profile';
import { useAutosave, type AutosaveStatus } from '../../lib/useAutosave';
import { useProfileModal } from '../profiles/ProfileModalContext';
import { Button, PageHeader } from '../../components/ui/primitives';

const ACTIVITY_CODES = [
  { value: 'A', label: 'A — Actividades incluidas en el IAE' },
  { value: 'B', label: 'B — Actividades no incluidas en el IAE' },
  { value: 'C', label: 'C — Actividades no iniciadas' },
  { value: 'D', label: 'D — Arrendadores de inmuebles no incluidos en los anteriores' },
];

const ACTIVITY_TYPES: Record<string, { value: string; label: string }[]> = {
  A: [
    { value: '01', label: '01 — Arrendadores de bienes inmuebles' },
    { value: '02', label: '02 — Ganadería independiente' },
    { value: '03', label: '03 — Resto de actividades empresariales' },
    { value: '04', label: '04 — Actividades profesionales artísticas o deportivas' },
    { value: '05', label: '05 — Resto de actividades profesionales' },
  ],
  B: [
    { value: '01', label: '01 — Actividad agrícola' },
    { value: '02', label: '02 — Actividad ganadera dependiente' },
    { value: '03', label: '03 — Actividad forestal' },
    { value: '04', label: '04 — Producción del mejillón en batea' },
    { value: '05', label: '05 — Actividad pesquera' },
    { value: '06', label: '06 — Otras actividades no sujetas al IAE' },
  ],
};

type TaxForm = {
  nif: string;
  firstName: string;
  lastName: string;
  epigrafe: string;
  activityCode: string;
  activityType: string;
  activityStartDate: string;
  ivaRegime: string;
  irpfMethod: string;
  temporalCriterion: string;
};

type TaxProfileResponse = Partial<TaxForm> & { fullName?: string };

const EMPTY_TAX_FORM: TaxForm = {
  nif: '',
  firstName: '',
  lastName: '',
  epigrafe: '',
  activityCode: 'A',
  activityType: '05',
  activityStartDate: '2026-05-08',
  ivaRegime: 'general',
  irpfMethod: 'estimacion_directa_simplificada',
  temporalCriterion: 'devengo',
};

function taxFormFrom(data: TaxProfileResponse, base: TaxForm): TaxForm {
  const pick = (k: keyof TaxForm) => data[k] ?? base[k];
  return {
    nif: pick('nif'),
    firstName: pick('firstName'),
    lastName: pick('lastName'),
    epigrafe: pick('epigrafe'),
    activityCode: pick('activityCode'),
    activityType: pick('activityType'),
    activityStartDate: pick('activityStartDate'),
    ivaRegime: pick('ivaRegime'),
    irpfMethod: pick('irpfMethod'),
    temporalCriterion: pick('temporalCriterion'),
  };
}

function taxPayload(form: TaxForm, fiscalYear: number) {
  return {
    fiscalYear,
    nif: form.nif,
    firstName: form.firstName,
    lastName: form.lastName,
    epigrafe: form.epigrafe,
    activityCode: form.activityCode,
    activityType: ACTIVITY_TYPES[form.activityCode] ? form.activityType : '',
    activityStartDate: form.activityStartDate,
    ivaRegime: form.ivaRegime,
    irpfMethod: form.irpfMethod,
    temporalCriterion: form.temporalCriterion,
  };
}

type TaxPayload = ReturnType<typeof taxPayload>;

const STATUS_PRIORITY: AutosaveStatus[] = ['saving', 'pending', 'error', 'invalid', 'saved'];

export function SettingsPage() {
  const { openProfileModal } = useProfileModal();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () =>
      api<{
        activeFiscalYear?: number;
        workingQuarter?: string;
        dataDir?: string;
        vaultName?: string;
      }>('/api/settings'),
  });
  const year = settings.data?.activeFiscalYear ?? 2026;
  const taxProfile = useQuery({
    queryKey: ['tax-profile', year],
    queryFn: () => api<TaxProfileResponse>(`/api/tax-profiles/${year}`),
    enabled: settings.isSuccess,
    retry: false,
  });

  const [profileName, setProfileName] = useState('');
  const [dataDirInput, setDataDirInput] = useState('');
  const [general, setGeneral] = useState({ activeFiscalYear: year, workingQuarter: 'T3' });
  const [tax, setTax] = useState<TaxForm>(EMPTY_TAX_FORM);
  /** Ejercicio al que pertenecen los datos fiscales del formulario (null = sin cargar). */
  const [taxYear, setTaxYear] = useState<number | null>(null);
  const [settingsHydrated, setSettingsHydrated] = useState(false);

  const nameAutosave = useAutosave({
    value: profileName.trim(),
    enabled: settingsHydrated,
    validate: (name) => (name ? [] : ['Nombre del perfil es obligatorio']),
    errorTitle: 'No se pudo renombrar el perfil',
    save: async (name) => {
      await api('/api/vault', { method: 'PUT', json: { name } });
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['profile-ready'] });
    },
  });

  const generalAutosave = useAutosave({
    value: general,
    enabled: settingsHydrated,
    validate: (g) =>
      Number.isInteger(g.activeFiscalYear) && g.activeFiscalYear >= 2000 && g.activeFiscalYear <= 2100
        ? []
        : ['Ejercicio activo debe estar entre 2000 y 2100'],
    errorTitle: 'No se pudo guardar el ejercicio',
    save: async (g) => {
      await api('/api/settings', { method: 'PUT', json: g });
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'tax-profile' });
    },
  });

  const payload = useMemo(() => taxPayload(tax, taxYear ?? year), [tax, taxYear, year]);
  const taxIssues = useMemo(() => {
    const parsed = taxProfileSchema.safeParse(payload);
    return parsed.success ? [] : toValidationIssues(parsed.error.issues);
  }, [payload]);
  const taxEnabled = taxYear === year;

  const taxAutosave = useAutosave<TaxPayload>({
    value: payload,
    enabled: taxEnabled,
    validate: () => taxIssues.map((i) => `${i.field} ${i.message}`),
    errorTitle: 'No se pudieron guardar los datos fiscales',
    save: async (p) => {
      await api(`/api/tax-profiles/${p.fiscalYear}`, { method: 'PUT', json: p });
      qc.setQueryData<TaxProfileResponse>(['tax-profile', p.fiscalYear], (old) => ({
        ...old,
        ...p,
        fullName: `${p.lastName.trim()} ${p.firstName.trim()}`,
      }));
      void qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== 'tax-profile' && q.queryKey[0] !== 'settings',
      });
    },
  });

  useEffect(() => {
    if (!settings.data) return;
    if (settings.data.dataDir) setDataDirInput(settings.data.dataDir);
    if (settingsHydrated) return;
    setSettingsHydrated(true);
    const name = settings.data.vaultName ?? '';
    const g = {
      activeFiscalYear: settings.data.activeFiscalYear ?? 2026,
      workingQuarter: settings.data.workingQuarter ?? 'T3',
    };
    setProfileName(name);
    setGeneral(g);
    nameAutosave.reset(name.trim());
    generalAutosave.reset(g);
  }, [settings.data, settingsHydrated, nameAutosave.reset, generalAutosave.reset]);

  useEffect(() => {
    if (taxYear === year || taxProfile.isFetching) return;
    if (taxProfile.data) {
      const next = taxFormFrom(taxProfile.data, EMPTY_TAX_FORM);
      setTax(next);
      setTaxYear(year);
      taxAutosave.reset(taxPayload(next, year));
    } else if (taxProfile.error instanceof ApiClientError && taxProfile.error.status === 404) {
      // Sin perfil para este ejercicio: se crea con lo que haya en el formulario en cuanto sea válido.
      setTaxYear(year);
      taxAutosave.reset(null);
    }
  }, [year, taxYear, taxProfile.data, taxProfile.error, taxProfile.isFetching, taxAutosave.reset]);

  const changeFolder = useMutation({
    mutationFn: async (path: string) => openProfile(path),
    onSuccess: async (res) => {
      setDataDirInput(res.path);
      // Rehidratar solo con los datos del perfil nuevo, no con la caché del anterior.
      await qc.invalidateQueries();
      setSettingsHydrated(false);
      setTaxYear(null);
    },
    meta: { errorTitle: 'No se pudo cambiar la carpeta del perfil' },
  });

  async function pickAndSwitchFolder() {
    if (isTauri()) {
      const picked = await pickFolder();
      if (picked.ok) changeFolder.mutate(picked.path);
      else if (!picked.cancelled) pushError(picked.message, 'No se pudo elegir la carpeta');
      return;
    }
    const path = window.prompt('Ruta de la carpeta del perfil');
    if (path?.trim()) changeFolder.mutate(path.trim());
  }

  const units = [nameAutosave, generalAutosave, taxAutosave];
  const overall = STATUS_PRIORITY.find((s) => units.some((u) => u.status === s)) ?? 'idle';
  const missing = [
    ...new Set([
      ...(nameAutosave.status === 'invalid' ? ['Nombre del perfil'] : []),
      ...(generalAutosave.status === 'invalid' ? ['Ejercicio activo'] : []),
      ...(taxAutosave.status === 'invalid' ? taxIssues.map((i) => i.field) : []),
    ]),
  ];

  const issueFor = (path: string) =>
    taxEnabled ? taxIssues.find((i) => i.path === path)?.message : undefined;

  return (
    <div>
      <PageHeader
        title="Configuración"
        subtitle="Perfil, ejercicio y datos fiscales AEAT. Los cambios se guardan automáticamente."
        actions={<SaveIndicator status={overall} missing={missing} />}
      />
      <div className="grid max-w-xl gap-2">
        <h3 className="mt-2 text-[12px] font-semibold uppercase tracking-wide text-surface-muted">
          Perfil
        </h3>
        <Field
          label="Nombre del perfil"
          hint={nameAutosave.status === 'invalid' ? 'es obligatorio' : undefined}
        >
          <input
            className="w-full border px-2 py-1"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
          />
        </Field>
        <Field label="Carpeta de datos">
          <div className="flex gap-2">
            <input
              className="w-full border px-2 py-1 font-mono text-[12px]"
              value={
                settings.isLoading
                  ? 'Cargando…'
                  : settings.isError
                    ? ''
                    : dataDirInput
              }
              readOnly
              placeholder={
                settings.isError ? 'No se pudo leer la carpeta de datos' : undefined
              }
            />
            <Button
              variant="primary"
              onClick={() => void pickAndSwitchFolder()}
              disabled={changeFolder.isPending}
            >
              Cambiar…
            </Button>
          </div>
          {settings.isError ? (
            <p className="mt-1 text-[11px] text-red-700">
              No se pudo leer la carpeta de datos (API bloqueada o sin respuesta). Cierra otras
              instancias, reabre el perfil desde «Cambiar perfil» y no crees uno nuevo encima.
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-surface-muted">
              Contiene <code>autonomous.db</code> y <code>vault.json</code>.{' '}
              <button
                type="button"
                className="text-surface-accent hover:underline"
                onClick={openProfileModal}
              >
                Cambiar perfil
              </button>
            </p>
          )}
        </Field>

        <h3 className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-surface-muted">
          Ejercicio
        </h3>
        <Field
          label="Ejercicio activo"
          hint={generalAutosave.status === 'invalid' ? 'debe estar entre 2000 y 2100' : undefined}
        >
          <input
            type="number"
            className="w-full border px-2 py-1"
            value={general.activeFiscalYear}
            onChange={(e) => setGeneral({ ...general, activeFiscalYear: Number(e.target.value) })}
          />
        </Field>
        <Field label="Trimestre de trabajo">
          <select
            className="w-full border px-2 py-1"
            value={general.workingQuarter}
            onChange={(e) => setGeneral({ ...general, workingQuarter: e.target.value })}
          >
            {Quarters.map((q) => (
              <option key={q} value={q}>
                {q}
              </option>
            ))}
          </select>
        </Field>

        <h3 className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-surface-muted">
          Datos fiscales {taxYear ?? year}
        </h3>
        <Field label="Nombre" hint={issueFor('firstName')}>
          <input
            className="w-full border px-2 py-1"
            value={tax.firstName}
            onChange={(e) => setTax({ ...tax, firstName: e.target.value })}
          />
        </Field>
        <Field label="Apellidos" hint={issueFor('lastName')}>
          <input
            className="w-full border px-2 py-1"
            value={tax.lastName}
            onChange={(e) => setTax({ ...tax, lastName: e.target.value })}
          />
        </Field>
        <Field label="NIF" hint={issueFor('nif')}>
          <input
            className="w-full border px-2 py-1"
            value={tax.nif}
            onChange={(e) => setTax({ ...tax, nif: e.target.value })}
          />
        </Field>
        <Field label="Epígrafe" hint={issueFor('epigrafe')}>
          <input
            className="w-full border px-2 py-1"
            value={tax.epigrafe}
            onChange={(e) => setTax({ ...tax, epigrafe: e.target.value })}
          />
        </Field>
        <Field label="Código de actividad (libro registro AEAT)">
          <select
            className="w-full border px-2 py-1"
            value={tax.activityCode}
            onChange={(e) => {
              const activityCode = e.target.value;
              const types = ACTIVITY_TYPES[activityCode];
              const activityType = types?.some((t) => t.value === tax.activityType)
                ? tax.activityType
                : (types?.[0]?.value ?? '');
              setTax({ ...tax, activityCode, activityType });
            }}
          >
            {ACTIVITY_CODES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        {ACTIVITY_TYPES[tax.activityCode] && (
          <Field label="Tipo de actividad (libro registro AEAT)" hint={issueFor('activityType')}>
            <select
              className="w-full border px-2 py-1"
              value={tax.activityType}
              onChange={(e) => setTax({ ...tax, activityType: e.target.value })}
            >
              {ACTIVITY_TYPES[tax.activityCode]!.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Inicio de actividad / alta de autónomo" hint={issueFor('activityStartDate')}>
          <input
            type="date"
            className="w-full border px-2 py-1"
            value={tax.activityStartDate}
            onChange={(e) => setTax({ ...tax, activityStartDate: e.target.value })}
          />
        </Field>
        <Field label="Régimen IVA">
          <select
            className="w-full border px-2 py-1"
            value={tax.ivaRegime}
            onChange={(e) => setTax({ ...tax, ivaRegime: e.target.value })}
          >
            <option value="general">General</option>
            <option value="exento">Exento</option>
          </select>
        </Field>
        <Field label="Método IRPF">
          <select
            className="w-full border px-2 py-1"
            value={tax.irpfMethod}
            onChange={(e) => setTax({ ...tax, irpfMethod: e.target.value })}
          >
            <option value="estimacion_directa_simplificada">Estimación directa simplificada</option>
            <option value="estimacion_directa_normal">Estimación directa normal</option>
          </select>
        </Field>
        <Field label="Criterio temporal">
          <select
            className="w-full border px-2 py-1"
            value={tax.temporalCriterion}
            onChange={(e) => setTax({ ...tax, temporalCriterion: e.target.value })}
          >
            <option value="devengo">Devengo</option>
            <option value="caja">Caja (preparado, MVP usa devengo)</option>
          </select>
        </Field>
      </div>
      <p className="mt-4 text-[12px] text-surface-muted">
        Backup: copia la carpeta del perfil completa.
      </p>
    </div>
  );
}

function SaveIndicator({ status, missing }: { status: AutosaveStatus; missing: string[] }) {
  const content: Record<AutosaveStatus, { text: string; className: string } | null> = {
    idle: null,
    pending: { text: 'Cambios pendientes…', className: 'text-surface-muted' },
    saving: { text: 'Guardando…', className: 'text-surface-muted' },
    saved: { text: 'Guardado', className: 'text-surface-ok' },
    error: { text: 'Error al guardar (ver detalles arriba)', className: 'text-surface-danger' },
    invalid: {
      text: `Sin guardar — revisa: ${missing.join(', ')}`,
      className: 'text-surface-warn',
    },
  };
  const c = content[status];
  if (!c) return null;
  return (
    <span className={`self-center text-[12px] font-medium ${c.className}`} aria-live="polite">
      {c.text}
    </span>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-[11px] text-surface-muted">
      {label}
      <div className="mt-0.5">{children}</div>
      {hint && <span className="mt-0.5 block text-[11px] text-surface-warn">{label} {hint}</span>}
    </label>
  );
}
