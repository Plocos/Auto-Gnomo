import type { ZodIssue } from 'zod';

export const FIELD_LABELS: Record<string, string> = {
  fiscalYear: 'Ejercicio',
  activeFiscalYear: 'Ejercicio activo',
  workingQuarter: 'Trimestre de trabajo',
  activityStartDate: 'Inicio de actividad',
  nif: 'NIF',
  firstName: 'Nombre',
  lastName: 'Apellidos',
  fullName: 'Nombre completo',
  epigrafe: 'Epígrafe',
  activityCode: 'Código de actividad',
  activityType: 'Tipo de actividad',
  ivaRegime: 'Régimen IVA',
  irpfMethod: 'Método IRPF',
  temporalCriterion: 'Criterio temporal',
  name: 'Nombre',
  concept: 'Concepto',
  invoiceDate: 'Fecha de factura',
  fiscalDate: 'Fecha fiscal',
  invoiceNumber: 'Número de factura',
  partyName: 'Contraparte',
  partyNif: 'NIF contraparte',
  taxBaseCents: 'Base imponible',
  vatRateBps: 'Tipo de IVA',
  irpfRateBps: 'Tipo de IRPF',
  totalCents: 'Total',
  reason: 'Motivo',
};

export interface ValidationIssue {
  path: string;
  field: string;
  message: string;
  code: string;
}

export function fieldLabel(path: (string | number)[]): string {
  const key = [...path].reverse().find((p) => typeof p === 'string');
  if (key === undefined) return path.length ? path.join('.') : 'Datos';
  return FIELD_LABELS[key] ?? key;
}

export function issueMessage(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null'
        ? 'es obligatorio'
        : `tipo no válido (se esperaba ${issue.expected}, llegó ${issue.received})`;
    case 'too_small':
      if (issue.type === 'string') {
        return Number(issue.minimum) <= 1
          ? 'es obligatorio'
          : `debe tener al menos ${issue.minimum} caracteres`;
      }
      if (issue.type === 'array') return `debe tener al menos ${issue.minimum} elementos`;
      return `debe ser ${issue.inclusive ? '≥' : '>'} ${issue.minimum}`;
    case 'too_big':
      if (issue.type === 'string') return `debe tener como máximo ${issue.maximum} caracteres`;
      if (issue.type === 'array') return `debe tener como máximo ${issue.maximum} elementos`;
      return `debe ser ${issue.inclusive ? '≤' : '<'} ${issue.maximum}`;
    case 'invalid_enum_value':
      return `valor no permitido «${String(issue.received)}» (opciones: ${issue.options.join(', ')})`;
    case 'invalid_literal':
      return `debe ser ${JSON.stringify(issue.expected)}`;
    case 'invalid_string':
      return 'formato no válido';
    case 'invalid_date':
      return 'fecha no válida';
    case 'unrecognized_keys':
      return `campos no reconocidos: ${issue.keys.join(', ')}`;
    default:
      return issue.message;
  }
}

export function toValidationIssues(issues: ZodIssue[]): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    field: fieldLabel(issue.path),
    message: issueMessage(issue),
    code: issue.code,
  }));
}

export function summarizeIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `${i.field} ${i.message}`).join('; ');
}
