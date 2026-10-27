import { useState } from 'react';
import { api } from '../lib/api.ts';
import type { GroupFile, ProjectInfo } from '../lib/types.ts';
import { fmtBytes } from '../lib/format.ts';
import { downloadUrl, embedUrl } from '@shared/groups.ts';
import { Button, Empty, ErrorBox, Modal, Spinner, useLoad } from './ui.tsx';

/** Selo "#ordem" com a cor de identificação do grupo. */
export function OrderBadge({ position, color, large }: { position: number | null | undefined; color: string; large?: boolean }) {
  return (
    <span className={`order-badge ${large ? 'order-badge-lg' : ''}`} style={{ background: color }} title={position ? `Ordem de apresentação: ${position}` : undefined}>
      <span className="sr-only">Ordem </span>#{position ?? '–'}
    </span>
  );
}

/** Lista de nomes legível: "A", "A e B", "A, B e C". */
export function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** `download`: endereço para baixar (arquivos enviados ao sistema); sem ele, o link de origem. */
type Viewer = { kind: 'pdf' | 'slides'; url: string; download?: string } | null;

const isPdf = (f: GroupFile) => f.mime === 'application/pdf';
const fileDownload = (f: GroupFile) => `${f.url}${f.url.includes('?') ? '&' : '?'}download=1`;
const fileType = (f: GroupFile) => (/\.([a-z0-9]+)$/i.exec(f.name)?.[1] ?? 'arquivo').toUpperCase();

/** Item da lista de materiais para um arquivo enviado: PDF abre no sistema; os demais são baixados. */
function FileMaterial({ file, label, viewLabel, kind, onView }: { file: GroupFile; label: string; viewLabel: string; kind: 'pdf' | 'slides'; onView: (v: Viewer) => void }) {
  return (
    <li className="material">
      <span>
        <span className="material-kind">{label}</span>
        <span className="small muted">
          {' '}
          · {file.name} · {fmtBytes(file.size)}
        </span>
      </span>
      <span className="row gap wrap">
        {isPdf(file) && (
          <Button variant="primary" onClick={() => onView({ kind, url: file.url, download: fileDownload(file) })}>
            {viewLabel}
          </Button>
        )}
        <a className={`btn ${isPdf(file) ? 'btn-secondary' : 'btn-primary'}`} href={fileDownload(file)} download={file.name}>
          Baixar {fileType(file)}
        </a>
      </span>
    </li>
  );
}

/** Modal com resumo, orientadores e materiais do projeto; o PDF e os slides abrem em uma visualização ampla. */
export function ProjectModal({ groupId, onClose }: { groupId: number; onClose: () => void }) {
  const p = useLoad(() => api.get<ProjectInfo>(`/api/groups/${groupId}/project`), [groupId]);
  const [viewer, setViewer] = useState<Viewer>(null);
  const g = p.data;
  return (
    <>
      <Modal open={!viewer} onOpenChange={(v) => !v && onClose()} title={g ? `${g.code} — ${g.title}` : 'Projeto'} wide>
        {p.loading && !g ? (
          <Spinner />
        ) : p.error ? (
          <ErrorBox error={p.error} onRetry={p.reload} />
        ) : (
          g && <ProjectDetails g={g} onView={setViewer} />
        )}
      </Modal>
      {viewer && g && <MaterialViewer viewer={viewer} title={`${viewer.kind === 'pdf' ? 'PDF' : 'Apresentação'} — ${g.code}`} onClose={() => setViewer(null)} />}
    </>
  );
}

function ProjectDetails({ g, onView }: { g: ProjectInfo; onView: (v: Viewer) => void }) {
  const hasMaterials = !!(g.pdfUrl || g.slidesUrl || g.projectUrl || g.githubUrl || g.slidesFile || g.articleFile);
  return (
    <div className="project">
      <div className="project-head" style={{ borderColor: g.color }}>
        <OrderBadge position={g.position} color={g.color} large />
        <div>
          <p className="project-code">
            {g.code}
            {g.className && ` · ${g.className}`}
            {g.rubricTypeName && <span className="pill">{g.rubricTypeName}</span>}
          </p>
          <p className="project-title">{g.title}</p>
        </div>
      </div>

      <dl className="project-facts">
        <div>
          <dt>{g.advisors.length > 1 ? 'Professores orientadores' : 'Professor(a) orientador(a)'}</dt>
          <dd>{g.advisors.length ? namesList(g.advisors) : <span className="muted">não informado</span>}</dd>
        </div>
        <div>
          <dt>Alunos</dt>
          <dd>{g.students.length ? namesList(g.students) : '—'}</dd>
        </div>
      </dl>

      <section aria-labelledby="resumo-projeto">
        <h3 id="resumo-projeto" className="h4">
          Resumo do projeto
        </h3>
        {g.summary ? <p className="project-summary">{g.summary}</p> : <p className="muted">O resumo não foi cadastrado.</p>}
      </section>

      <section aria-labelledby="materiais-projeto">
        <h3 id="materiais-projeto" className="h4">
          Materiais
        </h3>
        {!hasMaterials ? (
          <Empty>Nenhum material cadastrado para este grupo.</Empty>
        ) : (
          <ul className="material-list">
            {g.slidesFile && <FileMaterial file={g.slidesFile} label="Apresentação (slides)" viewLabel="Ver apresentação" kind="slides" onView={onView} />}
            {g.slidesUrl && (
              <li className="material">
                <span className="material-kind">Apresentação (slides){g.slidesFile && ' — link'}</span>
                <span className="row gap wrap">
                  <Button variant="primary" onClick={() => onView({ kind: 'slides', url: g.slidesUrl! })}>
                    Ver apresentação
                  </Button>
                  <a className="btn btn-ghost" href={g.slidesUrl} target="_blank" rel="noopener noreferrer">
                    Abrir em nova aba
                  </a>
                </span>
              </li>
            )}
            {g.articleFile && <FileMaterial file={g.articleFile} label="Artigo" viewLabel="Ler artigo" kind="pdf" onView={onView} />}
            {g.pdfUrl && (
              <li className="material">
                <span className="material-kind">{g.articleFile ? 'Artigo — link' : 'Documento em PDF'}</span>
                <span className="row gap wrap">
                  <Button variant="primary" onClick={() => onView({ kind: 'pdf', url: g.pdfUrl! })}>
                    Ler PDF
                  </Button>
                  <a className="btn btn-secondary" href={downloadUrl(g.pdfUrl)} download target="_blank" rel="noopener noreferrer">
                    Baixar PDF
                  </a>
                </span>
              </li>
            )}
            {g.projectUrl && (
              <li className="material">
                <span className="material-kind">Link de acesso ao projeto</span>
                <a className="btn btn-secondary" href={g.projectUrl} target="_blank" rel="noopener noreferrer">
                  Acessar projeto ↗
                </a>
              </li>
            )}
            {g.githubUrl && (
              <li className="material">
                <span className="material-kind">Repositório no GitHub</span>
                <a className="btn btn-secondary" href={g.githubUrl} target="_blank" rel="noopener noreferrer">
                  Abrir no GitHub ↗
                </a>
              </li>
            )}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Visualização ampla do PDF ou dos slides dentro do sistema, com saída para nova aba. */
function MaterialViewer({ viewer, title, onClose }: { viewer: NonNullable<Viewer>; title: string; onClose: () => void }) {
  // Slides em PDF: uma página por vez, ajustada à tela (o visualizador ignora o que não conhece).
  const base = embedUrl(viewer.url);
  const src = viewer.kind === 'slides' && /\.pdf($|\?)/i.test(base) && !base.includes('#') ? `${base}#view=Fit` : base;
  return (
    <Modal open onOpenChange={(v) => !v && onClose()} title={title} full>
      <div className="viewer">
        <iframe className="viewer-frame" src={src} title={title} allow="fullscreen" allowFullScreen referrerPolicy="no-referrer" />
        <div className="viewer-bar">
          <span className="small muted">Se o conteúdo não aparecer, o site de origem pode bloquear a exibição dentro de outras páginas.</span>
          <span className="row gap wrap">
            {(viewer.kind === 'pdf' || viewer.download) && (
              <a className="btn btn-secondary" href={viewer.download ?? downloadUrl(viewer.url)} download target="_blank" rel="noopener noreferrer">
                Baixar PDF
              </a>
            )}
            <a className="btn btn-secondary" href={viewer.url} target="_blank" rel="noopener noreferrer">
              Abrir em nova aba
            </a>
            <Button variant="primary" onClick={onClose}>
              Voltar ao projeto
            </Button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
