import { normalizeNif, normalizePartyName } from './parse.js';
import type { AssistantProposal } from '@autonomous/shared';

export type HistorySample = {
  partyName: string;
  partyNif: string | null;
  categoryKey: string | null;
  professionalUseBps: number;
  taxDeductibleBps: number;
};

/** Newest first. If the latest rows of that party agree, their % and categoría win. */
export function applyPartyHistory(proposal: AssistantProposal, history: HistorySample[]): AssistantProposal {
  const nif = proposal.partyNif ? normalizeNif(proposal.partyNif) : '';
  const name = proposal.partyName ? normalizePartyName(proposal.partyName) : '';
  if (!nif && !name) return proposal;

  const matches = history.filter((row) => {
    if (nif && row.partyNif && normalizeNif(row.partyNif) === nif) return true;
    if (name && normalizePartyName(row.partyName) === name) return true;
    return false;
  });
  const recent = matches.slice(0, 3);
  const first = recent[0];
  if (!first) return proposal;
  const agree = recent.every(
    (row) =>
      row.categoryKey === first.categoryKey &&
      row.professionalUseBps === first.professionalUseBps &&
      row.taxDeductibleBps === first.taxDeductibleBps,
  );
  if (!agree) return proposal;

  return {
    ...proposal,
    categoryKey: first.categoryKey ?? proposal.categoryKey,
    professionalUseBps: first.professionalUseBps,
    taxDeductibleBps: first.taxDeductibleBps,
    deductionOrigin: 'history',
  };
}
