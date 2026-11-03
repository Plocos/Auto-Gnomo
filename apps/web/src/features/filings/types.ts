export type TaxModel = '130' | '303';

export type BoxBreakdown = { movementId: string; concept: string; amountCents: number };

export type TaxBox = {
  box: string;
  label: string;
  amountCents: number;
  breakdown: BoxBreakdown[];
  warning?: string;
  uncertain?: boolean;
  page?: 'liquidacion' | 'resultado' | 'adicional';
  entry?: 'manual' | 'auto' | 'prefilled';
  unit?: 'money' | 'percent';
};

export type TaxReturnSnapshot = {
  id: string;
  model: TaxModel;
  filedAt: string;
  resultCents: number;
  carryForwardCents?: number;
  boxes: Record<string, TaxBox>;
  rulesVersion: string | null;
  reopenedAt: string | null;
  createdAt: string;
};

export type ModelSnapshots = {
  current: TaxReturnSnapshot | null;
  history: TaxReturnSnapshot[];
};

type LiveModel = {
  boxes: Record<string, TaxBox>;
  resultCents: number;
  meta: { version: string };
};

export type TaxReturnsResponse = {
  live: {
    modelo130: LiveModel;
    modelo303: LiveModel & { carryForwardCents?: number };
  };
  snapshots: Record<TaxModel, ModelSnapshots>;
};
