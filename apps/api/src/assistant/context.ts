import { formatEuros } from '@autonomous/shared';
import type { AppDb } from '../db/sqlite.js';
import type { HistorySample } from './history.js';
import type { PromptCategory, PromptContext } from './prompt.js';

type HistoryRow = {
  party_name: string | null;
  party_nif: string | null;
  category_key: string | null;
  professional_use_bps: number;
  tax_deductible_bps: number;
  type: string;
  concept: string;
  fiscal_date: string;
  tax_base_cents: number;
  vat_rate_bps: number;
  expense_nature: string;
};

export function loadPromptContext(db: AppDb, fiscalYear: number): PromptContext & { categoryKeys: Set<string> } {
  const profile = db
    .prepare(
      `SELECT iva_regime, irpf_method, temporal_criterion
       FROM tax_profiles WHERE fiscal_year = ?`,
    )
    .get(fiscalYear) as
    | { iva_regime: string; irpf_method: string; temporal_criterion: string }
    | undefined;

  const categories = db
    .prepare(`SELECT key, name, type FROM categories ORDER BY name`)
    .all() as PromptCategory[];

  const rows = db
    .prepare(
      `SELECT party_name, party_nif, category_key, professional_use_bps, tax_deductible_bps,
              type, concept, fiscal_date, tax_base_cents, vat_rate_bps, expense_nature
       FROM movements
       WHERE type IN ('income', 'expense', 'autonomo_fee', 'grant')
       ORDER BY fiscal_date DESC, created_at DESC
       LIMIT 400`,
    )
    .all() as HistoryRow[];

  const history: HistorySample[] = [];
  const recentLines: string[] = [];
  for (const row of rows) {
    if (row.party_name) {
      history.push({
        partyName: row.party_name,
        partyNif: row.party_nif,
        categoryKey: row.category_key,
        professionalUseBps: row.professional_use_bps,
        taxDeductibleBps: row.tax_deductible_bps,
      });
    }
    if (recentLines.length < 25) {
      recentLines.push(
        `${row.fiscal_date} ${row.type} ${row.party_name ?? '—'} «${row.concept}» base ${formatEuros(row.tax_base_cents)} IVA ${row.vat_rate_bps / 100}% deducible ${row.tax_deductible_bps / 100}% ${row.expense_nature}`,
      );
    }
  }

  const temporal = profile?.temporal_criterion === 'caja' ? 'caja' : 'devengo';
  return {
    temporalCriterion: temporal,
    ivaRegime: profile?.iva_regime,
    irpfMethod: profile?.irpf_method,
    categories,
    history,
    recentLines,
    categoryKeys: new Set(categories.map((c) => c.key)),
  };
}
