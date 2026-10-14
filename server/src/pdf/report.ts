import PDFDocument from 'pdfkit';
import type { ClosureSnapshot, ConsolidatedEvaluator } from '../services/closure.ts';
import { formatScore } from '../../../shared/scoring.ts';

/**
 * PDF da avaliação final no formato do instrumento "Rubrica de Avaliação da Banca":
 *   1. Capa (identificação, finalidade, escala, composição da banca);
 *   2. Uma página por avaliador (critérios com pontos, subtotal, devolutiva, nome);
 *   3. Registro consolidado (pontuações, total, parecer, pontos fortes, melhorias, orientações, assinaturas);
 *   4. Informações complementares (votação, exceções, método de cálculo, fechamento), quando houver.
 * Gerado sempre a partir do snapshot imutável do fechamento.
 */

type Doc = PDFKit.PDFDocument;

const M = 50; // margem lateral
const TOP = 105; // início do conteúdo abaixo do cabeçalho
const BOTTOM = 70; // reserva para o rodapé
const BORDER = '#c9ced6';
const ZEBRA = '#e9f1f9';
const TOTAL_FILL = '#fff4d9';
const TEXT = '#111111';
const MUTED = '#4b4f56';

interface Ctx {
  color: string;
  logo: Buffer | null;
  tz: string;
}

const W = (doc: Doc) => doc.page.width - M * 2;
const limit = (doc: Doc) => doc.page.height - BOTTOM;

function fmtDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd || '—';
}
function fmtDateTime(isoStr: string | null, tz: string): string {
  if (!isoStr) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: tz, dateStyle: 'short', timeStyle: 'short' }).format(new Date(isoStr));
}
/** Pontos: inteiros sem casas (3, 25); demais com 2 casas (7,50). */
function pts(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(Math.round(n * 1e6) / 1e6) ? String(Math.round(n)) : formatScore(n);
}

function pageHeader(doc: Doc, s: ClosureSnapshot, ctx: Ctx, cover: boolean) {
  if (ctx.logo) {
    try {
      doc.image(ctx.logo, M, 32, { fit: [120, 52] });
    } catch {
      /* logotipo inválido: ignora */
    }
  }
  if (!cover && (s.event.institution || s.event.institutionDetail)) {
    const x = doc.page.width - M - 220;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT).text(s.event.institution ?? '', x, 44, { width: 220, align: 'right' });
    if (s.event.institutionDetail) doc.font('Helvetica').fontSize(8.5).text(s.event.institutionDetail, x, doc.y, { width: 220, align: 'right' });
  }
  doc.x = M;
  doc.y = TOP;
}

function newPage(doc: Doc, s: ClosureSnapshot, ctx: Ctx) {
  doc.addPage();
  pageHeader(doc, s, ctx, false);
}

function ensure(doc: Doc, s: ClosureSnapshot, ctx: Ctx, needed: number) {
  if (doc.y + needed > limit(doc)) newPage(doc, s, ctx);
}

function title(doc: Doc, text: string, size = 17) {
  doc.font('Helvetica-Bold').fontSize(size).fillColor(TEXT).text(text, M, doc.y, { width: W(doc) });
  doc.moveDown(0.35);
}

function section(doc: Doc, s: ClosureSnapshot, ctx: Ctx, text: string) {
  ensure(doc, s, ctx, 46);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(TEXT).text(text, M, doc.y, { width: W(doc) });
  doc.moveDown(0.25);
}

/** Texto corrido com quebra de página automática (nunca corta conteúdo). */
function para(doc: Doc, s: ClosureSnapshot, ctx: Ctx, text: string, o: { size?: number; color?: string; bold?: boolean; italic?: boolean; indent?: number } = {}) {
  const size = o.size ?? 10;
  doc.font(o.bold ? 'Helvetica-Bold' : o.italic ? 'Helvetica-Oblique' : 'Helvetica').fontSize(size).fillColor(o.color ?? TEXT);
  ensure(doc, s, ctx, doc.currentLineHeight(true) * 2);
  doc.text(text, M + (o.indent ?? 0), doc.y, { width: W(doc) - (o.indent ?? 0) });
}

function labelled(doc: Doc, s: ClosureSnapshot, ctx: Ctx, label: string, value: string) {
  ensure(doc, s, ctx, 28);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text(`${label}: `, M, doc.y, { continued: true, width: W(doc) });
  doc.font('Helvetica').text(value || '—');
}

interface Cell {
  text: string;
  /** Rótulo em negrito exibido acima do texto (campos do formulário). */
  label?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  size?: number;
}

/** Linha de tabela com altura calculada pelo conteúdo; repete o cabeçalho ao quebrar página. */
function row(
  doc: Doc,
  s: ClosureSnapshot,
  ctx: Ctx,
  widths: number[],
  cells: Cell[],
  o: { header?: boolean; fill?: string; repeatHeader?: () => void; padY?: number } = {},
) {
  const padX = 6;
  const padY = o.padY ?? 5;
  const heights = cells.map((c, i) => {
    const cw = widths[i]! - padX * 2;
    let lh = 0;
    if (c.label) lh = doc.font('Helvetica-Bold').fontSize(c.size ?? 9.5).heightOfString(c.label, { width: cw }) + 2;
    doc.font(o.header || c.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(c.size ?? 9.5);
    return lh + doc.heightOfString(c.text || ' ', { width: cw });
  });
  const h = Math.max(...heights) + padY * 2;
  if (doc.y + h > limit(doc)) {
    newPage(doc, s, ctx);
    o.repeatHeader?.();
  }
  const y = doc.y;
  const total = widths.reduce((a, b) => a + b, 0);
  const fill = o.header ? ctx.color : o.fill;
  if (fill) doc.save().rect(M, y, total, h).fill(fill).restore();
  let x = M;
  cells.forEach((c, i) => {
    const cw = widths[i]!;
    doc
      .font(o.header || c.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(c.size ?? 9.5)
      .fillColor(o.header ? '#ffffff' : TEXT);
    const th = heights[i]!;
    let ty = y + padY + (c.align === 'center' || c.align === 'right' ? (h - padY * 2 - th) / 2 : 0);
    if (c.label) {
      doc.font('Helvetica-Bold').text(c.label, x + padX, ty, { width: cw - padX * 2 });
      ty = doc.y + 2;
      doc.font(o.header || c.bold ? 'Helvetica-Bold' : 'Helvetica');
    }
    doc.text(c.text, x + padX, ty, { width: cw - padX * 2, align: c.align ?? 'left' });
    x += cw;
  });
  doc.save().lineWidth(0.6).strokeColor(BORDER);
  doc.rect(M, y, total, h).stroke();
  let vx = M;
  for (let i = 0; i < widths.length - 1; i++) {
    vx += widths[i]!;
    doc.moveTo(vx, y).lineTo(vx, y + h).stroke();
  }
  doc.restore();
  doc.x = M;
  doc.y = y + h;
}

/** Faixa "Grupo / Turma / Projeto" usada no topo das páginas internas. */
/** "Rótulo: valor" alinhado à direita, com o valor destacado na cor institucional. */
function rightPair(doc: Doc, label: string, value: string, color: string) {
  doc.font('Helvetica-Bold').fontSize(11.5);
  const lw = doc.widthOfString(label);
  const vw = doc.widthOfString(value);
  const x = M + W(doc) - lw - vw;
  const y = doc.y;
  doc.fillColor(TEXT).text(label, x, y, { lineBreak: false });
  doc.fillColor(color).text(value, x + lw, y, { lineBreak: false });
  doc.x = M;
  doc.y = y + doc.currentLineHeight(true);
}

function groupStrip(doc: Doc, s: ClosureSnapshot, ctx: Ctx) {
  const w = W(doc);
  doc.moveDown(0.4);
  row(doc, s, ctx, [w * 0.34, w * 0.22, w * 0.44], [
    { text: `Grupo: ${s.group.code}`, bold: true },
    { text: `Turma: ${s.group.className || '—'}`, bold: true },
    { text: `Projeto: ${s.group.title}`, bold: true },
  ]);
  doc.moveDown(0.8);
}

function cover(doc: Doc, s: ClosureSnapshot, ctx: Ctx) {
  pageHeader(doc, s, ctx, true);
  const w = W(doc);
  doc.y = 130;
  doc
    .font('Helvetica-Bold')
    .fontSize(21)
    .fillColor(TEXT)
    .text(s.event.reportHeader || 'Avaliação da Banca', M + 20, doc.y, { width: w - 40, align: 'center' });
  doc.moveDown(1.6);
  if (s.event.reportSubtitle) {
    doc.font('Helvetica').fontSize(11).fillColor(MUTED).text(s.event.reportSubtitle, M, doc.y, { width: w });
    doc.moveDown(0.6);
  }
  const half = [w / 2, w / 2];
  const info = (a: [string, string], b: [string, string]) =>
    row(doc, s, ctx, half, [
      { label: `${a[0]}:`, text: a[1] || '—' },
      { label: `${b[0]}:`, text: b[1] || '—' },
    ], { padY: 7 });
  info(['Grupo', s.group.code], ['Turma', s.group.className]);
  info(['Título do projeto', s.group.title], ['Data', fmtDate(s.day.date)]);
  info(['Horário', s.timeRange], ['Local', s.location]);
  if (s.group.students.length) {
    doc.moveDown(0.4);
    labelled(doc, s, ctx, 'Integrantes', s.group.students.join('; '));
  }
  if (s.group.advisor) labelled(doc, s, ctx, 'Orientação', s.group.advisor);

  if (s.event.reportPurpose) {
    section(doc, s, ctx, 'Finalidade da banca');
    para(doc, s, ctx, s.event.reportPurpose);
  }

  const labels = s.evaluators.find((e) => e.rubric.scaleLabels.length)?.rubric.scaleLabels ?? [];
  if (labels.length) {
    section(doc, s, ctx, 'Escala de avaliação');
    const cw = labels.map(() => w / labels.length);
    row(doc, s, ctx, cw, labels.map((l) => ({ text: String(l.value), align: 'center' as const })), { header: true });
    row(doc, s, ctx, cw, labels.map((l) => ({ text: l.label, align: 'center' as const, size: 8.5 })), { fill: ZEBRA });
  }

  section(doc, s, ctx, 'Composição da banca e responsabilidades');
  const cw = [w * 0.34, w * 0.46, w * 0.2];
  const head = () => row(doc, s, ctx, cw, [{ text: 'Avaliador' }, { text: 'Dimensão avaliada', align: 'center' }, { text: 'Pontuação', align: 'center' }], { header: true });
  head();
  s.evaluators.forEach((e, i) => {
    row(
      doc,
      s,
      ctx,
      cw,
      [
        { text: `${i + 1} - ${e.rubric.evaluatorRole || e.rubric.title}\n${e.name}` },
        { text: e.rubric.dimension || e.rubric.templateName },
        { text: `${pts(e.rubric.scale.min)} a ${pts(e.maxPoints)}`, align: 'center' },
      ],
      { fill: i % 2 ? ZEBRA : undefined, repeatHeader: head },
    );
  });
  if (s.event.reportGuidance) {
    doc.moveDown(0.6);
    ensure(doc, s, ctx, 30);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT).text('Orientação: ', M, doc.y, { continued: true, width: w });
    doc.font('Helvetica').text(s.event.reportGuidance);
  }
}

const STATUS_PT: Record<string, string> = { submitted: 'enviada', draft: 'rascunho (não enviada)', not_opened: 'não aberta' };

function evaluatorPage(doc: Doc, s: ClosureSnapshot, ctx: Ctx, e: ConsolidatedEvaluator) {
  newPage(doc, s, ctx);
  const w = W(doc);
  title(doc, e.rubric.title || `Avaliador - ${e.rubric.templateName}`);
  if (e.rubric.instructions) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(TEXT).text('Responsabilidade: ', M, doc.y, { continued: true, width: w });
    doc.font('Helvetica').text(e.rubric.instructions);
  }
  groupStrip(doc, s, ctx);

  if (e.absent) {
    para(doc, s, ctx, `Avaliador dispensado por ${e.absent.by} em ${fmtDateTime(e.absent.at, ctx.tz)}. Motivo: ${e.absent.reason}`, { italic: true });
  } else {
    const cw = [w - 80, 80];
    const head = () => row(doc, s, ctx, cw, [{ text: 'Critério de avaliação' }, { text: 'Pontos', align: 'center' }], { header: true });
    head();
    e.criteria.forEach((c, i) => {
      const value = c.waived ? 'dispensado' : c.score === null ? '—' : pts(c.score);
      const weight = c.weight !== 1 ? ` (peso ${pts(c.weight)})` : '';
      row(doc, s, ctx, cw, [{ text: `${i + 1}. ${c.title}${c.required ? '' : ' (opcional)'}${weight}` }, { text: value, align: 'center', bold: true, size: 11 }], {
        fill: i % 2 ? ZEBRA : undefined,
        repeatHeader: head,
      });
      if (c.waived) para(doc, s, ctx, `Critério dispensado por ${c.waived.by}. Motivo: ${c.waived.reason}`, { size: 8.5, italic: true, indent: 8 });
      if (c.comment && c.comment.trim()) para(doc, s, ctx, `Justificativa: ${c.comment.trim()}`, { size: 8.5, color: MUTED, indent: 8 });
    });
    doc.moveDown(0.5);
    ensure(doc, s, ctx, 20);
    rightPair(doc, 'Subtotal do avaliador: ', `${pts(e.points)} / ${pts(e.maxPoints)}`, ctx.color);
    if (s.event.aggregation === 'mean') {
      doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(`Pontuação normalizada: ${formatScore(e.teacherScore)} / 100`, M, doc.y, { width: w, align: 'right' });
    }
  }

  section(doc, s, ctx, e.rubric.feedbackLabel || 'Devolutiva');
  para(doc, s, ctx, e.generalComment && e.generalComment.trim() ? e.generalComment.trim() : '(sem devolutiva registrada)', {
    italic: !(e.generalComment && e.generalComment.trim()),
  });

  doc.moveDown(1.6);
  ensure(doc, s, ctx, 50);
  const y = doc.y;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TEXT).text('Nome do avaliador:', M, y, { width: w / 2 - 10 });
  doc.font('Helvetica').text(e.name, M, doc.y, { width: w / 2 - 10 });
  doc.font('Helvetica-Bold').text('Assinatura:', M + w / 2, y, { width: w / 2 });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(MUTED)
    .text(
      e.absent ? '—' : e.submittedAt ? `Ficha ${STATUS_PT[e.status]} eletronicamente em ${fmtDateTime(e.submittedAt, ctx.tz)}` : `Ficha ${STATUS_PT[e.status]}`,
      M + w / 2,
      doc.y,
      { width: w / 2 },
    );
  doc.x = M;
}

function consolidatedPage(doc: Doc, s: ClosureSnapshot, ctx: Ctx) {
  newPage(doc, s, ctx);
  const w = W(doc);
  title(doc, 'Registro Consolidado da Banca');
  para(doc, s, ctx, 'Consolidação das pontuações atribuídas pelos avaliadores e parecer da banca.', { size: 10 });
  groupStrip(doc, s, ctx);

  const cw = [w * 0.3, w * 0.48, w * 0.22];
  const head = () => row(doc, s, ctx, cw, [{ text: 'Avaliador', align: 'center' }, { text: 'Dimensão', align: 'center' }, { text: 'Pontuação', align: 'center' }], { header: true });
  head();
  s.evaluators.forEach((e, i) => {
    const score = e.absent ? 'dispensado' : `${pts(e.points)} / ${pts(e.maxPoints)}`;
    row(doc, s, ctx, cw, [{ text: `Avaliador ${i + 1}\n${e.name}`, align: 'center' }, { text: e.rubric.dimensionShort || e.rubric.dimension || e.rubric.templateName }, { text: score, align: 'center', bold: true }], {
      fill: i % 2 ? ZEBRA : undefined,
      repeatHeader: head,
    });
  });
  const totalLabel = s.event.aggregation === 'sum' ? 'TOTAL DA BANCA' : 'RESULTADO DA BANCA (média das avaliações)';
  const totalValue = s.event.aggregation === 'sum' ? `${pts(s.finalScore)} / ${pts(s.finalMax)}` : `${formatScore(s.finalScore)} / 100`;
  row(doc, s, ctx, [cw[0]! + cw[1]!, cw[2]!], [{ text: totalLabel, align: 'right', bold: true }, { text: totalValue, align: 'center', bold: true, size: 11 }], { fill: TOTAL_FILL });

  if (s.event.verdictOptions.length) {
    section(doc, s, ctx, 'Parecer da banca');
    const NB = String.fromCharCode(160); // espaço não separável: cada opção fica inteira na linha
    const line = s.event.verdictOptions.map((o) => `(${s.verdict.verdict === o ? 'X' : NB + NB})${NB}${o.split(' ').join(NB)}`).join('     ');
    para(doc, s, ctx, line, { size: 10 });
  }
  const blocks: Array<[string, string | null]> = [
    ['Pontos fortes do grupo', s.verdict.strengths],
    ['Prioridades de melhoria', s.verdict.improvements],
    ['Orientações finais da banca', s.verdict.guidance],
  ];
  for (const [label, text] of blocks) {
    if (!s.event.verdictOptions.length && !text) continue;
    section(doc, s, ctx, label);
    para(doc, s, ctx, text && text.trim() ? text.trim() : '(não registrado)', { italic: !(text && text.trim()) });
  }

  section(doc, s, ctx, 'Assinaturas dos avaliadores');
  for (let i = 0; i < s.evaluators.length; i += 2) {
    ensure(doc, s, ctx, 36);
    const y = doc.y + 6;
    [0, 1].forEach((k) => {
      const e = s.evaluators[i + k];
      if (!e) return;
      const x = M + k * (w / 2);
      doc.font('Helvetica').fontSize(9.5).fillColor(TEXT).text(`Avaliador ${i + k + 1}: ${e.name}`, x, y, { width: w / 2 - 14 });
      doc
        .save()
        .lineWidth(0.6)
        .strokeColor('#888888')
        .moveTo(x, doc.y + 12)
        .lineTo(x + w / 2 - 24, doc.y + 12)
        .stroke()
        .restore();
    });
    doc.y = y + 34;
    doc.x = M;
  }

  doc.moveDown(0.6);
  para(doc, s, ctx, `Fechamento v${s.closure.version} — registrado por ${s.closure.closedBy} em ${fmtDateTime(s.closure.closedAt, ctx.tz)}.`, { size: 8.5, color: MUTED });
}

function complementary(doc: Doc, s: ClosureSnapshot, ctx: Ctx) {
  const hasVotes = s.votes.length > 0;
  const hasExc = s.exceptions.length > 0;
  section(doc, s, ctx, 'Informações complementares');
  if (hasVotes) {
    for (const v of s.votes) {
      para(doc, s, ctx, `Votação — ${v.title}: ${v.prompt}`, { bold: true, size: 9.5 });
      para(doc, s, ctx, `Regra: ${v.ruleLabel}${v.rule === 'quorum' ? ` (quórum mínimo ${v.quorumMin})` : ''}. Contagem: ${v.tally.counts.map((c) => `${c.label} ${c.count}`).join('; ')}.`, {
        size: 9,
      });
      para(doc, s, ctx, `Apuração: ${v.tally.explanation}`, { size: 9 });
      para(doc, s, ctx, v.ballots ? `Votos nominais: ${v.ballots.map((b) => `${b.evaluatorName}: ${b.optionLabel}`).join('; ') || '—'}` : 'Votos nominais ocultos pela política da banca.', {
        size: 9,
        color: MUTED,
      });
      doc.moveDown(0.3);
    }
  }
  if (hasExc) {
    for (const x of s.exceptions) {
      para(
        doc,
        s,
        ctx,
        `Exceção: ${x.kind === 'evaluator_absent' ? 'avaliador dispensado' : `critério dispensado (${x.criterionTitle})`} — ${x.evaluatorName}. Registrada por ${x.createdBy} em ${fmtDateTime(x.createdAt, ctx.tz)}. Motivo: ${x.reason}`,
        { size: 9 },
      );
    }
  }
  para(doc, s, ctx, `Método de cálculo: ${s.formula}`, { size: 8.5, color: MUTED });
  para(doc, s, ctx, 'Documento gerado a partir do registro imutável do fechamento; arredondamento apenas na apresentação.', { size: 8.5, color: MUTED });
}

function footers(doc: Doc, footerFor: (pageIndex: number) => string) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const old = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(MUTED)
      .text(`${footerFor(i)} | Página ${i - range.start + 1} de ${range.count}`, M, doc.page.height - 40, { width: W(doc), align: 'center', lineBreak: false });
    doc.page.margins.bottom = old;
  }
}

export interface PdfOptions {
  compress?: boolean;
  /** Logotipo institucional (PNG/JPEG) — usa o logotipo atual da banca. */
  logo?: Buffer | null;
}

export function logoFromDataUrl(dataUrl: string | null | undefined): Buffer | null {
  if (!dataUrl) return null;
  const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl);
  return m ? Buffer.from(m[2]!, 'base64') : null;
}

/** Gera um PDF com um ou mais projetos (cada projeto começa em nova página). */
export function renderReportPdf(snapshots: ClosureSnapshot[], opts: PdfOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: TOP, left: M, right: M, bottom: BOTTOM },
      bufferPages: true,
      autoFirstPage: false,
      compress: opts.compress ?? true,
      info: {
        Title: snapshots.length === 1 ? `Avaliação final — ${snapshots[0]!.group.code} — ${snapshots[0]!.group.title}` : 'Avaliações finais — lote',
        Author: snapshots[0]?.event.institution ?? 'Sistema de Gestão de Bancas',
        Subject: snapshots[0]?.event.reportHeader ?? 'Avaliação final de projeto',
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const owner: ClosureSnapshot[] = [];
    for (const s of snapshots) {
      const ctx: Ctx = { color: s.event.reportColor || '#1f3a5f', logo: opts.logo ?? null, tz: s.event.timezone || 'America/Sao_Paulo' };
      const start = doc.bufferedPageRange().count;
      doc.addPage();
      cover(doc, s, ctx);
      for (const e of s.evaluators) evaluatorPage(doc, s, ctx, e);
      consolidatedPage(doc, s, ctx);
      complementary(doc, s, ctx);
      const end = doc.bufferedPageRange().count - 1;
      for (let p = start; p <= end; p++) owner[p] = s;
    }
    footers(doc, (i) => {
      const s = owner[i]!;
      return `${s.event.reportFooter || s.event.reportHeader || s.event.name} — ${s.group.code} — Fechamento v${s.closure.version}`;
    });
    doc.end();
  });
}
