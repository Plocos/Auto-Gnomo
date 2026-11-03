const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  income: 'Ingreso',
  expense: 'Gasto',
  autonomo_fee: 'Cuota autónomo',
  grant: 'Ayuda',
  amortization: 'Amortización',
  correction: 'Corrección',
};

const MOVEMENT_STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmado',
  locked: 'Bloqueado',
  corrected: 'Corregido',
  void: 'Anulado',
};

const EXPENSE_NATURE_LABELS: Record<string, string> = {
  current: 'Corriente',
  fixed_asset: 'Inmovilizado',
};

export function movementTypeLabel(type: string): string {
  return MOVEMENT_TYPE_LABELS[type] ?? type;
}

export function movementStatusLabel(status: string): string {
  return MOVEMENT_STATUS_LABELS[status] ?? status;
}

export function expenseNatureLabel(nature?: string): string {
  if (!nature) return '—';
  return EXPENSE_NATURE_LABELS[nature] ?? nature;
}
