export type AlertActionKind = 'link_asset' | 'goto_movement' | 'none';

export type AlertCatalogEntry = {
  title: string;
  explanation: string;
  action: AlertActionKind;
  solutionHint: string;
};

const CATALOG: Record<string, AlertCatalogEntry> = {
  FIXED_ASSET_NO_LINK: {
    title: 'Inmovilizado sin activo',
    explanation:
      'Este gasto está marcado como naturaleza «Inmovilizado», pero aún no tiene activo ni plan de amortización. El activo debe nacer desde este movimiento.',
    action: 'link_asset',
    solutionHint:
      'Indica el coeficiente de amortización para generar el activo y las cuotas desde este gasto.',
  },
  QUARTER_MISMATCH: {
    title: 'Trimestre distinto al de trabajo',
    explanation:
      'La fecha fiscal del movimiento cae en un trimestre distinto al trimestre de trabajo configurado. Puede ser intencional, pero conviene revisarlo.',
    action: 'goto_movement',
    solutionHint: 'Revisa la fecha fiscal o cambia el trimestre de trabajo en Configuración.',
  },
  INVALID_NIF: {
    title: 'NIF/CIF inválido',
    explanation: 'El identificador fiscal del tercero no parece un NIF/CIF español válido.',
    action: 'goto_movement',
    solutionHint: 'Edita el movimiento y corrige el NIF del proveedor o cliente.',
  },
  ACCRUAL_CROSS_YEAR: {
    title: 'Periodificación entre ejercicios',
    explanation:
      'El gasto o ingreso abarca más de un ejercicio fiscal. Puede requerir un calendario de periodificación.',
    action: 'goto_movement',
    solutionHint: 'Revisa las fechas y, si aplica, configura periodificación desde Inmovilizado.',
  },
  DUPLICATE_INVOICE: {
    title: 'Posible factura duplicada',
    explanation:
      'Ya existe otro movimiento con el mismo número de factura y tercero en el ejercicio.',
    action: 'goto_movement',
    solutionHint: 'Comprueba si es un duplicado real o cambia el número de factura.',
  },
};

export function getAlertCatalog(code: string): AlertCatalogEntry {
  return (
    CATALOG[code] ?? {
      title: code,
      explanation: 'Esta alerta indica un problema de validación en el movimiento asociado.',
      action: 'goto_movement',
      solutionHint: 'Abre el movimiento, revisa los campos marcados y corrige los datos.',
    }
  );
}
