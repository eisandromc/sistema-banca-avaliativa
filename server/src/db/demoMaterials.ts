import type { Database } from './database.ts';

/**
 * Complementa as bancas de DEMONSTRAÇÃO (dados FICTÍCIOS) com resumo, orientadores e materiais (os tipos de rubrica vêm dos seeds).
 * Idempotente: só preenche o que ainda está vazio, então também atualiza bancos criados por versões anteriores.
 * Os PDFs de exemplo ficam em web/public/demo (conteúdo fictício).
 */
export const DEMO_LINKS = {
  pdfUrl: '/demo/artigo-exemplo.pdf',
  slidesUrl: '/demo/apresentacao-exemplo.pdf',
  projectUrl: 'https://example.org/projeto-ficticio',
  githubUrl: 'https://github.com/exemplo/projeto-ficticio',
};

const ADVISORS = [['Profa. Orientadora Fictícia'], ['Prof. Orientador Exemplo', 'Profa. Coorientadora Modelo'], ['Prof. Orientador Demonstração']];

export async function enrichDemoData(db: Database) {
  await db.tx(async (q) => {
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
    // Repositório no GitHub dos grupos com materiais de demonstração (inclusive de bancos criados antes deste campo).
    await q.query(
      `update groups g set github_url = $1 from events e
        where e.id = g.event_id and e.name like '%DEMONSTRAÇÃO%' and g.github_url is null and g.project_url = $2`,
      [DEMO_LINKS.githubUrl, DEMO_LINKS.projectUrl],
    );
  });
}
