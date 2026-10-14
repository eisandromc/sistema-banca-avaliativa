/**
 * Apuração da votação configurável — sempre separada das notas.
 * Nenhuma decisão é inferida das notas; a regra vem da configuração da pergunta.
 */

export type VoteRule = 'simple_majority' | 'quorum' | 'counts_only';

export const VOTE_RULE_LABEL: Record<VoteRule, string> = {
  simple_majority: 'Maioria simples dos votos válidos',
  quorum: 'Maioria simples com quórum mínimo',
  counts_only: 'Somente contagem (sem decisão automática)',
};

export interface VoteOptionDef {
  id: number;
  label: string;
  isAbstain: boolean;
}

export type VoteDecision =
  | { kind: 'winner'; optionId: number; label: string }
  | { kind: 'tie' }
  | { kind: 'no_quorum' }
  | { kind: 'no_votes' }
  | { kind: 'counts_only' };

export interface VoteTally {
  counts: Array<{ optionId: number; label: string; count: number; isAbstain: boolean }>;
  totalVotes: number;
  validVotes: number;
  abstentions: number;
  decision: VoteDecision;
  explanation: string;
}

export function tallyVotes(
  options: VoteOptionDef[],
  chosenOptionIds: number[],
  rule: VoteRule,
  quorumMin: number | null,
): VoteTally {
  const counts = options.map((o) => ({
    optionId: o.id,
    label: o.label,
    isAbstain: o.isAbstain,
    count: chosenOptionIds.filter((id) => id === o.id).length,
  }));
  const totalVotes = counts.reduce((a, c) => a + c.count, 0);
  const abstentions = counts.filter((c) => c.isAbstain).reduce((a, c) => a + c.count, 0);
  const validVotes = totalVotes - abstentions;

  if (rule === 'counts_only') {
    return { counts, totalVotes, validVotes, abstentions, decision: { kind: 'counts_only' }, explanation: 'Apresentação apenas das contagens; a banca não configurou decisão automática.' };
  }
  if (rule === 'quorum') {
    const min = quorumMin ?? 1;
    if (validVotes < min) {
      return { counts, totalVotes, validVotes, abstentions, decision: { kind: 'no_quorum' }, explanation: `Quórum não atingido: ${validVotes} voto(s) válido(s) de ${min} exigido(s).` };
    }
  }
  if (validVotes === 0) {
    return { counts, totalVotes, validVotes, abstentions, decision: { kind: 'no_votes' }, explanation: 'Nenhum voto válido (abstenções não contam).' };
  }
  const ranked = counts.filter((c) => !c.isAbstain).sort((a, b) => b.count - a.count);
  const top = ranked[0]!;
  if (ranked[1] && ranked[1].count === top.count) {
    return { counts, totalVotes, validVotes, abstentions, decision: { kind: 'tie' }, explanation: `Empate entre as opções mais votadas (${top.count} voto(s) cada); sem decisão automática.` };
  }
  const prefix = rule === 'quorum' ? `Quórum atingido (${validVotes} voto(s) válido(s); mínimo ${quorumMin ?? 1}). ` : '';
  return {
    counts,
    totalVotes,
    validVotes,
    abstentions,
    decision: { kind: 'winner', optionId: top.optionId, label: top.label },
    explanation: `${prefix}"${top.label}" obteve maioria simples com ${top.count} de ${validVotes} voto(s) válido(s).`,
  };
}
