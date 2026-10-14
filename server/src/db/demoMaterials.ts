import type { Database } from './database.ts';
import { PI_DEMO_EVENT } from './seed.ts';
import { SCENARIO_EVENT } from './scenarios.ts';
import { ensurePiType } from '../templates/projetoIntegrador.ts';

/**
 * Complementa as bancas de DEMONSTRAÇÃO (dados FICTÍCIOS) com tipos de rubrica, resumo, orientadores e materiais.
 * Idempotente: só preenche o que ainda está vazio, então também atualiza bancos criados por versões anteriores.
 * Os PDFs de exemplo ficam em web/public/demo (conteúdo fictício).
 */
export const DEMO_LINKS = {
  pdfUrl: '/demo/artigo-exemplo.pdf',
  slidesUrl: '/demo/apresentacao-exemplo.pdf',
  projectUrl: 'https://example.org/projeto-ficticio',
};

const ADVISORS = [['Profa. Orientadora Fictícia'], ['Prof. Orientador Exemplo', 'Profa. Coorientadora Modelo'], ['Prof. Orientador Demonstração']];

const TYPES: Array<{ event: string; type: string; description: string; rubrics: string[] }> = [
  {
    event: 'Banca de Projetos — DEMONSTRAÇÃO',
    type: 'Técnica + Comunicação (exemplo)',
    description: 'Duas fichas: avaliação técnica e avaliação da comunicação. Rubricas fictícias de demonstração.',
    rubrics: ['Rubrica Técnica (exemplo)', 'Rubrica de Comunicação (exemplo)'],
  },
  {
    event: SCENARIO_EVENT,
    type: 'Cenários de teste',
    description: 'Rubricas fictícias usadas pela banca de cenários de teste.',
    rubrics: ['Cenários — Técnica (teste)', 'Cenários — Comunicação (teste)'],
  },
];

export async function enrichDemoData(db: Database) {
  await db.tx(async (q) => {
    for (const t of TYPES) {
      const templates = await q.query<{ id: number; name: string; type_id: number | null }>('select id, name, type_id from rubric_templates where name in (select jsonb_array_elements_text($1::jsonb))', [t.rubrics]);
      if (!templates.length) continue;
      let typeId = (await q.one<{ id: number }>('select id from rubric_types where lower(name) = lower($1)', [t.type]))?.id;
      if (!typeId) typeId = (await q.one<{ id: number }>('insert into rubric_types (name, description) values ($1, $2) returning id', [t.type, t.description]))!.id;
      for (const tpl of templates) {
        if (tpl.type_id === null) await q.query('update rubric_templates set type_id = $2, type_position = $3 where id = $1', [tpl.id, typeId, t.rubrics.indexOf(tpl.name) + 1]);
      }
      await q.query('update events set rubric_type_id = $2 where name = $1 and rubric_type_id is null', [t.event, typeId]);
    }
    const pi = await ensurePiType(q);
    await q.query('update events set rubric_type_id = $2 where name = $1 and rubric_type_id is null', [PI_DEMO_EVENT, pi]);

    // Materiais dos grupos de demonstração que ainda não têm nenhum (um a cada três fica sem apresentação, para mostrar o caso vazio).
    const groups = await q.query<{ id: number; description: string | null; title: string }>(
      `select g.id, g.description, g.title from groups g join events e on e.id = g.event_id
        where e.name like '%DEMONSTRAÇÃO%' and g.project_url is null and g.pdf_url is null and g.slides_url is null
        order by g.event_id, g.code`,
    );
    let i = 0;
    for (const g of groups) {
      const n = i++;
      const summary =
        !g.description || /^(Descrição fictícia|Projeto Integrador fictício|Grupo fictício)/.test(g.description)
          ? `Resumo fictício de "${g.title.replace(/\s*\(.*\)$/, '')}": o grupo identificou um problema da escola, pesquisou soluções e construiu um protótipo. ` +
            'O texto é apenas um exemplo para demonstrar a área do professor; não descreve um projeto real.'
          : g.description;
      await q.query(
        `update groups set description = $2,
                advisors = case when advisors = '[]'::jsonb then $3::jsonb else advisors end,
                advisor = case when advisors = '[]'::jsonb then $4 else advisor end,
                project_url = $5, pdf_url = $6, slides_url = $7
          where id = $1`,
        [
          g.id,
          summary,
          JSON.stringify(ADVISORS[n % ADVISORS.length]),
          ADVISORS[n % ADVISORS.length]!.join(', '),
          DEMO_LINKS.projectUrl,
          DEMO_LINKS.pdfUrl,
          n % 3 === 2 ? null : DEMO_LINKS.slidesUrl,
        ],
      );
    }
  });
}
