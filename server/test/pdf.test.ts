import { describe, expect, it } from 'vitest';
import { renderReportPdf } from '../src/pdf/report.ts';
import type { ClosureSnapshot } from '../src/services/closure.ts';
import { pdfText } from './helpers.ts';

function bigSnapshot(): ClosureSnapshot {
  const criteria = Array.from({ length: 40 }, (_, i) => ({
    id: i + 1,
    title: `Critério número ${i + 1} com título razoavelmente longo para testar quebra de linha na tabela`,
    description: null,
    weight: 1,
    required: true,
    score: 7.5,
    comment: `Comentário ${i + 1}: ` + 'texto de justificativa extenso '.repeat(25) + `FIM-${i + 1}`,
    waived: null,
    contribution: 2.5,
  }));
  return {
    generatedAt: new Date().toISOString(),
    event: {
      id: 1,
      name: 'Banca Teste',
      institution: 'Escola Fictícia',
      period: '2026',
      timezone: 'America/Sao_Paulo',
      reportHeader: 'Escola Fictícia',
      reportSubtitle: null,
      reportFooter: 'Rodapé fictício',
      reportColor: '#1f3a5f',
      votePrivacy: 'nominal',
      institutionDetail: 'Cidade Fictícia',
      reportPurpose: 'Finalidade fictícia.',
      reportGuidance: null,
      aggregation: 'mean',
      verdictOptions: [],
    },
    day: { id: 1, label: 'Dia 1', date: '2026-10-20', room: 'Sala 1' },
    location: 'Sala 1',
    timeRange: '08:00–08:20',
    verdict: { verdict: null, strengths: null, improvements: null, guidance: null },
    group: { id: 1, code: 'G99', className: '3º A', title: 'Projeto Longo', description: null, advisor: null, students: ['Aluno Fictício'] },
    entry: { id: 1, startedAt: new Date().toISOString(), endedAt: new Date().toISOString() },
    evaluators: [
      {
        userId: 1,
        name: 'Prof. Fictício',
        evaluationId: 1,
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        absent: null,
        counted: true,
        rubric: {
          versionId: 1,
          templateName: 'Modelo',
          title: 'Rubrica',
          version: 1,
          instructions: null,
          evaluatorRole: null,
          dimension: null,
          dimensionShort: null,
          feedbackLabel: null,
          scaleLabels: [],
          sortOrder: 0,
          scale: { min: 0, max: 10, step: 0.5, normalization: null },
        },
        criteria,
        generalComment: 'Observação geral final ' + 'longa '.repeat(200) + 'FIM-GERAL',
        teacherScore: 75,
        points: 300,
        maxPoints: 400,
        usedWeight: 40,
        totalWeight: 40,
        pendencies: [],
      },
    ],
    exceptions: [],
    votes: [],
    finalScore: 75,
    finalMax: 100,
    countedEvaluators: 1,
    formula: 'fórmula',
    blockers: [],
    closure: { version: 1, closedAt: new Date().toISOString(), closedBy: 'Prof. Fictício' },
  };
}

describe('PDF — paginação legível', () => {
  it('quebra em várias páginas sem cortar critérios nem comentários', async () => {
    const pdf = await renderReportPdf([bigSnapshot()], { compress: false });
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThan(3);
    const text = pdfText(pdf).replace(/\s+/g, ' ');
    for (let i = 1; i <= 40; i++) expect(text).toContain(`FIM-${i}`);
    expect(text).toContain('FIM-GERAL');
    expect(text).toContain(`Página ${pages} de ${pages}`);
    expect(text).toContain('75,00 / 100');
  });
});
