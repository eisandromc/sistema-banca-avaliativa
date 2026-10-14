import type { Queryable } from '../db/database.ts';

/**
 * Modelo "Rubrica de Avaliação da Banca do Projeto Integrador" (4 avaliadores, critérios 0–5,
 * subtotal 0–25 por avaliador, total da banca 0–100 pela soma), transcrito do instrumento em PDF.
 */

export const PI_SCALE_LABELS = [
  { value: 0, label: 'Não evidenciado' },
  { value: 1, label: 'Inicial' },
  { value: 2, label: 'Parcial' },
  { value: 3, label: 'Adequado' },
  { value: 4, label: 'Consistente' },
  { value: 5, label: 'Plenamente desenvolvido' },
];

export interface PiRubric {
  name: string;
  title: string;
  role: string;
  dimension: string;
  dimensionShort: string;
  responsibility: string;
  feedbackLabel: string;
  sortOrder: number;
  criteria: string[];
}

export const PI_RUBRICS: PiRubric[] = [
  {
    name: 'Projeto Integrador — 1. Conteúdo Técnico',
    title: 'Avaliador - Conteúdo Técnico',
    role: 'Professor técnico',
    dimension: 'Solução tecnológica',
    dimensionShort: 'Solução tecnológica',
    responsibility: 'avaliar a qualidade da solução tecnológica e a aplicação dos conteúdos técnicos compatíveis com o ano cursado.',
    feedbackLabel: 'Devolutiva técnica',
    sortOrder: 1,
    criteria: [
      'As funcionalidades atendem ao problema, ao público definido e aos requisitos apresentados pelo grupo.',
      'As tecnologias escolhidas são adequadas e foram aplicadas de forma coerente à proposta.',
      'O projeto apresenta organização técnica compatível com a etapa do curso: código, banco de dados, APIs, interfaces, versionamento ou documentação.',
      'A solução demonstra qualidade em funcionamento, usabilidade, acessibilidade, responsividade, segurança e boas práticas aplicáveis.',
      'O grupo demonstra e explica tecnicamente os principais fluxos, testes e decisões de desenvolvimento.',
    ],
  },
  {
    name: 'Projeto Integrador — 2. Artigo e Pesquisa',
    title: 'Avaliador - Artigo e Pesquisa',
    role: 'Professor do artigo e pesquisa',
    dimension: 'Qualidade acadêmica do artigo',
    dimensionShort: 'Artigo e pesquisa',
    responsibility: 'avaliar a qualidade acadêmica do artigo e a consistência da pesquisa que fundamenta a proposta.',
    feedbackLabel: 'Devolutiva sobre o artigo e a pesquisa',
    sortOrder: 2,
    criteria: [
      'O artigo apresenta problema, justificativa, objetivo geral e objetivos específicos de forma clara.',
      'O problema investigado é relevante, contextualizado e relacionado a uma necessidade real.',
      'A fundamentação teórica utiliza fontes pertinentes, confiáveis e devidamente referenciadas.',
      'A metodologia, a análise e os resultados são coerentes com a proposta e com a solução desenvolvida.',
      'O texto apresenta estrutura, clareza, coesão, linguagem adequada e atendimento às normas definidas pela instituição.',
    ],
  },
  {
    name: 'Projeto Integrador — 3. Projeto Integrador',
    title: 'Avaliador - Projeto Integrador',
    role: 'Professor do Projeto Integrador',
    dimension: 'Investigação, integração e impacto',
    dimensionShort: 'Projeto Integrador',
    responsibility: 'avaliar a investigação do problema, a integração curricular, o impacto social e as evidências do processo de construção.',
    feedbackLabel: 'Devolutiva sobre o desenvolvimento do Projeto Integrador',
    sortOrder: 3,
    criteria: [
      'O grupo compreende e explica o problema, o público envolvido e o contexto investigado.',
      'A solução mantém coerência entre problema, pesquisa, objetivos, requisitos e produto desenvolvido.',
      'O projeto evidencia integração entre conhecimentos técnicos e aprendizagens de outras áreas do currículo.',
      'O grupo relaciona o trabalho aos ODS, à ética, à acessibilidade, à sustentabilidade ou ao impacto social de forma consistente.',
      'Há evidências do processo de construção: planejamento, registros, decisões, testes, melhorias e documentação.',
    ],
  },
  {
    name: 'Projeto Integrador — 4. Apresentação e Defesa',
    title: 'Avaliador - Apresentação e Defesa',
    role: 'Professor da apresentação',
    dimension: 'Comunicação, defesa e postura',
    dimensionShort: 'Apresentação e defesa',
    responsibility: 'avaliar a comunicação do grupo, a organização da apresentação, a defesa das decisões e a postura profissional.',
    feedbackLabel: 'Devolutiva sobre a apresentação e a defesa',
    sortOrder: 4,
    criteria: [
      'A apresentação possui sequência lógica, clareza visual e respeito ao tempo previsto.',
      'Os integrantes comunicam o problema, a pesquisa e a solução com clareza e domínio.',
      'A demonstração é compreensível, objetiva e conectada ao problema apresentado.',
      'O grupo responde às perguntas com argumentação, segurança e capacidade de justificar suas decisões.',
      'Os integrantes demonstram participação equilibrada, colaboração, postura ética e profissional.',
    ],
  },
];

export const PI_EVENT_CONFIG = {
  institution: 'SENAC ENSINO MÉDIO',
  institutionDetail: 'Porto Alegre - RS',
  reportHeader: 'Rubrica de Avaliação da Banca do Projeto Integrador',
  reportSubtitle: 'Instrumento para apresentação do artigo e do projeto desenvolvido',
  reportFooter: 'Rubrica de Avaliação da Banca do Projeto Integrador',
  reportPurpose:
    'A banca avalia a trajetória completa do Projeto Integrador: a investigação de um problema real, a qualidade do artigo, a solução técnica desenvolvida, a demonstração e a defesa das decisões do grupo.',
  reportGuidance:
    'Cada professor avalia somente os critérios de sua dimensão. A exigência técnica deve ser compatível com o ano cursado e os conteúdos trabalhados pela turma.',
  reportColor: '#0b5cab',
  aggregation: 'sum' as const,
  verdictOptions: ['Projeto plenamente desenvolvido', 'Projeto desenvolvido', 'Projeto em desenvolvimento', 'Necessita retomada'],
};

export const PI_TYPE_NAME = 'Projeto Integrador';

/** Tipo de rubrica "Projeto Integrador" (criado se ainda não existir). */
export async function ensurePiType(q: Queryable): Promise<number> {
  const found = await q.one<{ id: number }>('select id from rubric_types where lower(name) = lower($1)', [PI_TYPE_NAME]);
  if (found) return found.id;
  return (await q.one<{ id: number }>('insert into rubric_types (name, description) values ($1, $2) returning id', [
    PI_TYPE_NAME,
    'As 4 fichas da Rubrica de Avaliação da Banca do Projeto Integrador: técnico, artigo e pesquisa, projeto integrador, apresentação e defesa.',
  ]))!.id;
}

/** Cria (se ainda não existirem, pelo nome) os 4 modelos de rubrica, dentro do tipo "Projeto Integrador". Retorna os ids das versões, na ordem. */
export async function installPiRubrics(q: Queryable): Promise<number[]> {
  const typeId = await ensurePiType(q);
  const ids: number[] = [];
  for (const r of PI_RUBRICS) {
    const existing = await q.one<{ id: number; template_id: number }>(
      `select v.id, v.template_id from rubric_versions v join rubric_templates t on t.id = v.template_id
        where t.name = $1 order by v.version desc limit 1`,
      [r.name],
    );
    if (existing) {
      await q.query('update rubric_templates set type_id = $2, type_position = $3 where id = $1 and type_id is null', [existing.template_id, typeId, r.sortOrder]);
      ids.push(existing.id);
      continue;
    }
    const t = await q.one<{ id: number }>('insert into rubric_templates (name, description, type_id, type_position) values ($1, $2, $3, $4) returning id', [
      r.name,
      `${r.role} — ${r.dimension}. Rubrica de Avaliação da Banca do Projeto Integrador.`,
      typeId,
      r.sortOrder,
    ]);
    const v = await q.one<{ id: number }>(
      `insert into rubric_versions (template_id, version, title, instructions, scale_min, scale_max, scale_step, normalization,
                                    general_comment_required, evaluator_role, dimension, dimension_short, feedback_label, scale_labels, sort_order)
       values ($1, 1, $2, $3, 0, 5, 1, 'linear', false, $4, $5, $6, $7, $8, $9) returning id`,
      [t!.id, r.title, r.responsibility, r.role, r.dimension, r.dimensionShort, r.feedbackLabel, PI_SCALE_LABELS, r.sortOrder],
    );
    let i = 0;
    for (const c of r.criteria) {
      await q.query('insert into rubric_criteria (version_id, position, title, weight, required, comment_enabled) values ($1, $2, $3, 1, true, false)', [
        v!.id,
        i++,
        c,
      ]);
    }
    ids.push(v!.id);
  }
  return ids;
}

/** Aplica a identidade e as regras do Projeto Integrador a uma banca (soma, parecer, textos do documento). */
export async function applyPiEventConfig(q: Queryable, eventId: number) {
  const c = PI_EVENT_CONFIG;
  const typeId = await ensurePiType(q);
  await q.query(
    `update events set institution = $2, institution_detail = $3, report_header = $4, report_subtitle = $5, report_footer = $6,
            report_purpose = $7, report_guidance = $8, report_color = $9, aggregation = $10, verdict_options = $11, rubric_type_id = $12
      where id = $1`,
    [eventId, c.institution, c.institutionDetail, c.reportHeader, c.reportSubtitle, c.reportFooter, c.reportPurpose, c.reportGuidance, c.reportColor, c.aggregation, c.verdictOptions, typeId],
  );
}
