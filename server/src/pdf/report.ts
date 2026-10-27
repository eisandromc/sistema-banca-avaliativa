import PDFDocument from 'pdfkit';
import type { ClosureSnapshot, ConsolidatedEvaluator } from '../services/closure.ts';
import { formatScore } from '../../../shared/scoring.ts';

/**
 * PDF da avaliação final, reproduzindo o instrumento "Rubrica de Avaliação da Banca" já preenchido:
 * folha Carta, mesmas tabelas, cores, linhas pautadas, campos de assinatura e rodapé "… | Página N".
 *   1. Capa (identificação, finalidade, escala, composição da banca), sem rodapé;
 *   2. Uma página por avaliador (critérios com pontos, subtotal, devolutiva, nome e assinatura);
 *   3. Registro consolidado (pontuações, total, parecer, pontos fortes, melhorias, orientações, assinaturas);
 *   4. Informações complementares (votação, exceções, método da média), só quando houver.
 * Gerado sempre a partir do snapshot imutável do fechamento. Cada projeto numera as próprias páginas.
 */

type Doc = PDFKit.PDFDocument;
type Align = 'left' | 'center' | 'right';

// Medidas do instrumento original, em pontos.
const PAGE_W = 612;
const M = 50; // margem lateral
const W = PAGE_W - M * 2; // largura útil
const TOP = 100; // início do conteúdo abaixo do cabeçalho
const LIMIT = 745; // conteúdo termina acima do rodapé
const FOOTER_BASELINE = 768;
const RULE_W = 489; // largura das linhas pautadas
const ASC = 0.718; // ascendente da Helvetica (topo do texto → linha de base)

const BORDER = '#d9d9d9';
const ZEBRA = '#eaf3fa';
const TOTAL_FILL = '#fff4dc';
const BLACK = '#000000';
const TEXT = '#202020';
const SUBTITLE = '#4a4a4a';
const RULE = '#606060';
const FOOTER = '#5a5a5a';
const MUTED = '#6b6b6b';
const REG = 'Helvetica';
const BOLD = 'Helvetica-Bold';
const ITALIC = 'Helvetica-Oblique';
const NB = String.fromCharCode(160); // espaço não separável

interface Ctx {
  s: ClosureSnapshot;
  color: string;
  logo: Buffer | null;
  tz: string;
}

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

// ---------------------------------------------------------------- texto

type Line = Array<{ t: string; font: string }>;

/** Quebra o texto (fonte atual) em linhas; `first` é a largura livre na primeira linha. Palavras longas são cortadas. */
function wrap(doc: Doc, text: string, width: number, first = width): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    let avail = out.length ? width : first;
    const push = () => {
      out.push(line);
      line = '';
      avail = width;
    };
    for (let word of para.split(/ +/).filter(Boolean)) {
      while (doc.widthOfString(word) > avail) {
        if (line) {
          push();
          continue;
        }
        let n = word.length - 1;
        while (n > 1 && doc.widthOfString(word.slice(0, n)) > avail) n--;
        line = word.slice(0, n);
        push();
        word = word.slice(n);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (doc.widthOfString(candidate) <= avail) line = candidate;
      else {
        push();
        line = word;
      }
    }
    out.push(line);
    avail = width;
  }
  return out;
}

/** Linhas de um campo: rótulo em negrito (acima, ou na mesma linha com `inline`) e o texto. */
function layout(doc: Doc, size: number, width: number, text: string, o: { label?: string; inline?: boolean; font?: string } = {}): Line[] {
  const body = o.font ?? REG;
  const lines: Line[] = [];
  let first = width;
  let lead: Line[number] | null = null;
  if (o.label && o.inline) {
    lead = { t: `${o.label} `, font: BOLD };
    first = Math.max(1, width - doc.font(BOLD).fontSize(size).widthOfString(lead.t));
  } else if (o.label) {
    doc.font(BOLD).fontSize(size);
    for (const l of wrap(doc, o.label, width)) lines.push([{ t: l, font: BOLD }]);
  }
  doc.font(body).fontSize(size);
  wrap(doc, text, width, first).forEach((l, i) => lines.push(i === 0 && lead ? [lead, { t: l, font: body }] : [{ t: l, font: body }]));
  return lines;
}

/** Desenha linhas já quebradas a partir de `y` (topo do texto), sem quebra automática de página. Não altera `doc.y`. */
function drawLines(doc: Doc, lines: Line[], x: number, y: number, width: number, size: number, lead: number, align: Align, color: string) {
  const keepY = doc.y; // doc.text() move doc.y para a linha desenhada
  lines.forEach((line, i) => {
    const w = line.reduce((acc, seg) => acc + doc.font(seg.font).fontSize(size).widthOfString(seg.t), 0);
    let cx = align === 'center' ? x + (width - w) / 2 : align === 'right' ? x + width - w : x;
    for (const seg of line) {
      doc.font(seg.font).fontSize(size).fillColor(color);
      if (seg.t) doc.text(seg.t, cx, y + i * lead, { lineBreak: false });
      cx += doc.widthOfString(seg.t);
    }
  });
  doc.x = M;
  doc.y = keepY;
}

interface Flow {
  size: number;
  lead?: number;
  color?: string;
  font?: string;
  label?: string;
  x?: number;
  width?: number;
  align?: Align;
}

/** Texto corrido com quebra de página linha a linha (nunca corta conteúdo). */
function flow(doc: Doc, c: Ctx, text: string, o: Flow) {
  const x = o.x ?? M;
  const width = o.width ?? W - (x - M);
  const lead = o.lead ?? o.size * 1.25;
  for (const line of layout(doc, o.size, width, text, { label: o.label, inline: !!o.label, font: o.font })) {
    if (doc.y + lead > LIMIT) newPage(doc, c);
    drawLines(doc, [line], x, doc.y, width, o.size, lead, o.align ?? 'left', o.color ?? TEXT);
    doc.y += lead;
  }
}

function heading(doc: Doc, c: Ctx, text: string, size: number, color = BLACK, space = 40) {
  if (doc.y + space > LIMIT) newPage(doc, c);
  drawLines(doc, [[{ t: text, font: BOLD }]], M, doc.y, W, size, size, 'left', color);
}

/** Linhas pautadas da devolutiva, com o texto escrito sobre elas; pauta extra quando o texto é maior. */
function ruled(doc: Doc, c: Ctx, text: string | null, minLines: number, step: number) {
  doc.font(REG).fontSize(10);
  const lines = text && text.trim() ? wrap(doc, text.trim(), RULE_W - 4) : [];
  const n = Math.max(minLines, lines.length);
  for (let i = 0; i < n; i++) {
    if (doc.y + step > LIMIT) newPage(doc, c);
    const base = doc.y + 10.5;
    if (lines[i]) drawLines(doc, [[{ t: lines[i]!, font: REG }]], M + 2, base - 3.2 - ASC * 10, RULE_W, 10, 10, 'left', TEXT);
    doc.save().lineWidth(0.5).strokeColor(RULE).moveTo(M, base).lineTo(M + RULE_W, base).stroke().restore();
    doc.y += step;
  }
}

// ---------------------------------------------------------------- tabelas

interface Cell {
  text: string;
  /** Rótulo em negrito: acima do texto ou, com `inline`, na mesma linha. */
  label?: string;
  inline?: boolean;
  bold?: boolean;
  align?: Align;
  size?: number;
  fill?: string;
}

/** Linha de tabela com altura pelo conteúdo, grade cinza e texto centralizado na vertical; repete o cabeçalho ao quebrar página. */
function row(
  doc: Doc,
  c: Ctx,
  widths: number[],
  cells: Cell[],
  o: { header?: boolean; fill?: string; padY?: number; color?: string; valign?: 'top' | 'middle'; repeatHeader?: () => void } = {},
) {
  const padX = 6;
  const padY = o.padY ?? 5;
  const laid = cells.map((cell, i) => {
    const size = cell.size ?? 9.5;
    const lines = layout(doc, size, widths[i]! - padX * 2, cell.text, { label: cell.label, inline: cell.inline, font: o.header || cell.bold ? BOLD : REG });
    return { size, lead: size * 1.2, lines };
  });
  const h = Math.max(...laid.map((l) => l.lines.length * l.lead)) + padY * 2;
  if (doc.y + h > LIMIT) {
    newPage(doc, c);
    o.repeatHeader?.();
  }
  const y = doc.y;
  let x = M;
  cells.forEach((cell, i) => {
    const w = widths[i]!;
    const fill = o.header ? c.color : (cell.fill ?? o.fill);
    if (fill) doc.save().rect(x, y, w, h).fill(fill).restore();
    const l = laid[i]!;
    const capBlock = (l.lines.length - 1) * l.lead + l.size * ASC;
    const ty = o.valign === 'top' ? y + padY + (l.lead - l.size * ASC) / 2 : y + (h - capBlock) / 2;
    drawLines(doc, l.lines, x + padX, ty, w - padX * 2, l.size, l.lead, cell.align ?? 'left', o.header ? '#ffffff' : (o.color ?? TEXT));
    x += w;
  });
  const total = widths.reduce((a, b) => a + b, 0);
  doc.save().lineWidth(0.75).strokeColor(BORDER);
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

/** Faixa "Grupo / Turma / Projeto" das páginas internas. */
function groupStrip(doc: Doc, c: Ctx) {
  const { group } = c.s;
  row(
    doc,
    c,
    [184, 118, 210],
    [
      { label: 'Grupo:', inline: true, text: group.code, size: 9 },
      { label: 'Turma:', inline: true, text: group.className || '—', size: 9 },
      { label: 'Projeto:', inline: true, text: group.title, size: 9 },
    ],
    { padY: 4.35 },
  );
}

// ---------------------------------------------------------------- páginas

function image(doc: Doc, logo: Buffer | null, x: number, y: number, fit: [number, number]) {
  if (!logo) return;
  try {
    doc.image(logo, x, y, { fit });
  } catch {
    /* logotipo inválido: ignora */
  }
}

/** Cabeçalho das páginas internas: logotipo à esquerda, instituição à direita. */
function newPage(doc: Doc, c: Ctx) {
  doc.addPage();
  image(doc, c.logo, 54, 30, [78, 46]);
  const ev = c.s.event;
  const right = PAGE_W - 54;
  if (ev.institution) drawLines(doc, [[{ t: ev.institution, font: BOLD }]], right - 300, 32.8, 300, 9.5, 9.5, 'right', TEXT);
  if (ev.institutionDetail) drawLines(doc, [[{ t: ev.institutionDetail, font: REG }]], right - 300, 43.6, 300, 8.5, 8.5, 'right', TEXT);
  doc.x = M;
  doc.y = TOP;
}

function cover(doc: Doc, c: Ctx) {
  const s = c.s;
  doc.addPage();
  image(doc, c.logo, 49, 18, [66, 39]);
  doc.y = 87;
  flow(doc, c, s.event.reportHeader || 'Avaliação da Banca', { size: 22, lead: 25, font: BOLD, color: BLACK, align: 'center', x: M + 20, width: W - 40 });
  doc.y += 26;
  if (s.event.reportSubtitle) flow(doc, c, s.event.reportSubtitle, { size: 11.5, color: SUBTITLE });
  doc.y += 9.5;

  const half = [254, W - 254];
  const info = (a: Cell, b: Cell) => row(doc, c, half, [a, b], { padY: 4.35, valign: 'top' });
  info({ label: 'Grupo:', text: s.group.code }, { label: 'Turma:', text: s.group.className || '—' });
  info({ label: 'Título do projeto:', text: s.group.title }, { label: 'Data:', inline: true, text: fmtDate(s.day.date) });
  info({ label: 'Horário:', text: s.timeRange || '—' }, { label: 'Local:', text: s.location || '—' });

  if (s.event.reportPurpose) {
    doc.y += 26;
    heading(doc, c, 'Finalidade da banca', 12);
    doc.y += 18;
    flow(doc, c, s.event.reportPurpose, { size: 10.5, lead: 14 });
  }

  const labels = s.evaluators.find((e) => e.rubric.scaleLabels.length)?.rubric.scaleLabels ?? [];
  if (labels.length) {
    doc.y += 28;
    heading(doc, c, 'Escala de avaliação', 12, BLACK, 90);
    doc.y += 15;
    const cw = labels.map(() => W / labels.length);
    row(doc, c, cw, labels.map((l) => ({ text: String(l.value), align: 'center' as const, size: 10 })), { header: true });
    row(doc, c, cw, labels.map((l, i) => ({ text: l.label, align: 'center' as const, size: 8, fill: i % 2 ? ZEBRA : undefined })));
  }

  doc.y += 14;
  heading(doc, c, 'Composição da banca e responsabilidades', 12, BLACK, 70);
  doc.y += 15.6;
  const cw = [140, 292, W - 432];
  const head = () =>
    row(doc, c, cw, [{ text: 'Avaliador', align: 'center' }, { text: 'Dimensão avaliada', align: 'center' }, { text: 'Pontuação', align: 'center' }], { header: true });
  head();
  s.evaluators.forEach((e, i) => {
    row(
      doc,
      c,
      cw,
      [
        { text: `${i + 1} - ${e.rubric.evaluatorRole || e.rubric.title}`, size: 9 },
        { text: e.rubric.dimension || e.rubric.templateName, size: 9 },
        { text: `${pts(e.rubric.scale.min)} a ${pts(e.maxPoints)}`, align: 'center', size: 9 },
      ],
      { fill: i % 2 ? ZEBRA : undefined, repeatHeader: head },
    );
  });
  if (s.event.reportGuidance) {
    doc.y += 13;
    flow(doc, c, s.event.reportGuidance, { size: 9.5, lead: 12, label: 'Orientação:' });
  }
}

const STATUS_PT: Record<string, string> = { submitted: 'enviada', draft: 'rascunho (não enviada)', not_opened: 'não aberta' };

/** Campo "Rótulo:" com o valor escrito sobre a linha e, abaixo dela, uma observação discreta. */
function lineField(doc: Doc, label: string, value: string, x: number, y: number, width: number, note?: string) {
  drawLines(doc, [[{ t: label, font: BOLD }]], x, y, width, 9.5, 9.5, 'left', TEXT);
  if (value) drawLines(doc, [[{ t: value, font: REG }]], x, y + 11.5, width, 9.5, 9.5, 'left', TEXT);
  const base = y + 23;
  doc.save().lineWidth(0.6).strokeColor(TEXT).moveTo(x, base).lineTo(x + width, base).stroke().restore();
  if (note) drawLines(doc, [[{ t: note, font: REG }]], x, base + 3, width + 40, 7, 7, 'left', MUTED);
}

function evaluatorPage(doc: Doc, c: Ctx, e: ConsolidatedEvaluator) {
  const s = c.s;
  newPage(doc, c);
  flow(doc, c, e.rubric.title || `Avaliador - ${e.rubric.templateName}`, { size: 16, lead: 19, font: BOLD, color: BLACK });
  doc.y += 7;
  if (e.rubric.instructions) flow(doc, c, e.rubric.instructions, { size: 10, lead: 13, label: 'Responsabilidade:' });
  doc.y += 6;
  groupStrip(doc, c);
  doc.y += 15.6;

  if (e.absent) {
    flow(doc, c, `Avaliador dispensado por ${e.absent.by} em ${fmtDateTime(e.absent.at, c.tz)}. Motivo: ${e.absent.reason}`, { size: 10, font: ITALIC });
  } else {
    const cw = [446, W - 446];
    const head = () => row(doc, c, cw, [{ text: 'Critério de avaliação', size: 10 }, { text: 'Pontos', align: 'center', size: 10 }], { header: true });
    head();
    e.criteria.forEach((cr, i) => {
      const value = cr.waived ? 'dispensado' : cr.score === null ? '—' : pts(cr.score);
      const weight = cr.weight !== 1 ? ` (peso ${pts(cr.weight)})` : '';
      row(
        doc,
        c,
        cw,
        [
          { text: `${i + 1}. ${cr.title}${cr.required ? '' : ' (opcional)'}${weight}`, size: 10 },
          { text: value, align: 'center', bold: true, size: cr.waived ? 8.5 : 10.5 },
        ],
        { fill: i % 2 ? ZEBRA : undefined, repeatHeader: head },
      );
      if (cr.waived) flow(doc, c, `Critério dispensado por ${cr.waived.by}. Motivo: ${cr.waived.reason}`, { size: 8.5, font: ITALIC, color: MUTED, x: M + 8 });
      if (cr.comment && cr.comment.trim()) flow(doc, c, `Justificativa: ${cr.comment.trim()}`, { size: 8.5, color: MUTED, x: M + 8 });
    });
  }

  doc.y += 11;
  if (doc.y + 16 > LIMIT) newPage(doc, c);
  const subtotal = e.absent ? 'dispensado' : `${pts(e.points)} / ${pts(e.maxPoints)}`;
  doc.font(BOLD).fontSize(11);
  const vw = doc.widthOfString(subtotal);
  drawLines(doc, [[{ t: 'Subtotal do avaliador: ', font: BOLD }]], M, doc.y, W - vw, 11, 11, 'right', TEXT);
  drawLines(doc, [[{ t: subtotal, font: BOLD }]], M, doc.y, W, 11, 11, 'right', c.color);
  doc.y += 13;
  if (s.event.aggregation === 'mean' && !e.absent) {
    drawLines(doc, [[{ t: `Pontuação normalizada: ${formatScore(e.teacherScore)} / 100`, font: REG }]], M, doc.y, W, 9.5, 9.5, 'right', MUTED);
    doc.y += 12;
  }

  doc.y += 12;
  heading(doc, c, e.rubric.feedbackLabel || 'Devolutiva', 11, BLACK, 60);
  doc.y += 15;
  ruled(doc, c, e.generalComment, 16, 14.5);

  doc.y += 36;
  if (doc.y + 40 > LIMIT) newPage(doc, c);
  const note = e.absent ? undefined : e.submittedAt ? `Ficha ${STATUS_PT[e.status]} eletronicamente em ${fmtDateTime(e.submittedAt, c.tz)}` : `Ficha ${STATUS_PT[e.status]}`;
  lineField(doc, 'Nome do avaliador:', e.name, M + 1, doc.y, 200);
  lineField(doc, 'Assinatura:', '', M + 256, doc.y, 201, note);
  doc.y += 36;
}

function consolidatedPage(doc: Doc, c: Ctx) {
  const s = c.s;
  newPage(doc, c);
  flow(doc, c, 'Registro Consolidado da Banca', { size: 16, lead: 19, font: BOLD, color: BLACK });
  doc.y += 7;
  const n = s.evaluators.length;
  const count = ['', '', 'dois', 'três', 'quatro', 'cinco', 'seis'][n] || String(n);
  const intro = n === 1 ? 'Consolide a pontuação atribuída pelo avaliador' : `Consolide as pontuações atribuídas pelos ${count} avaliadores`;
  flow(doc, c, `${intro} e registre o parecer da banca.`, { size: 10, lead: 13 });
  doc.y += 6;
  groupStrip(doc, c);
  doc.y += 15.6;

  const cw = [115, 285, W - 400];
  const head = () =>
    row(doc, c, cw, [{ text: 'Avaliador', align: 'center' }, { text: 'Dimensão', align: 'center' }, { text: 'Pontuação', align: 'center' }], { header: true });
  head();
  s.evaluators.forEach((e, i) => {
    const score = e.absent ? 'dispensado' : `${pts(e.points)} / ${pts(e.maxPoints)}`;
    row(
      doc,
      c,
      cw,
      [
        { text: `Avaliador ${i + 1}`, align: 'center' },
        { text: e.rubric.dimensionShort || e.rubric.dimension || e.rubric.templateName },
        { text: score, align: 'center', bold: true },
      ],
      { fill: i % 2 ? ZEBRA : undefined, repeatHeader: head },
    );
  });
  const sum = s.event.aggregation === 'sum';
  const totalLabel = sum ? 'TOTAL DA BANCA' : 'RESULTADO DA BANCA (média das avaliações)';
  const totalValue = sum ? `${pts(s.finalScore)} / ${pts(s.finalMax)}` : `${formatScore(s.finalScore)} / 100`;
  row(doc, c, [cw[0]! + cw[1]!, cw[2]!], [{ text: totalLabel, align: 'right', bold: true, size: 10 }, { text: totalValue, align: 'center', bold: true, size: 10 }], {
    fill: TOTAL_FILL,
    color: BLACK,
  });

  if (s.event.verdictOptions.length) {
    doc.y += 40;
    heading(doc, c, 'Parecer da banca', 11.5);
    doc.y += 17;
    // Cada opção fica inteira na linha; entre elas, 4 espaços (o último permite quebrar).
    const options = s.event.verdictOptions.map((o) => `(${s.verdict.verdict === o ? `${NB}X${NB}` : NB.repeat(3)})${NB}${o.split(' ').join(NB)}`).join(`${NB.repeat(3)} `);
    flow(doc, c, options, { size: 9, lead: 11 });
  }
  const blocks: Array<[string, string | null]> = [
    ['Pontos fortes do grupo', s.verdict.strengths],
    ['Prioridades de melhoria', s.verdict.improvements],
    ['Orientações finais da banca', s.verdict.guidance],
  ];
  blocks.forEach(([label, text], i) => {
    if (!s.event.verdictOptions.length && !text) return;
    doc.y += i === 0 ? 25 : 4.5;
    heading(doc, c, label, 10.5, TEXT, 55);
    doc.y += 14;
    ruled(doc, c, text, 3, 13.5);
  });

  doc.y += 30;
  heading(doc, c, 'Assinaturas dos avaliadores', 10.5, TEXT, 60);
  doc.y += 23;
  for (let i = 0; i < n; i += 2) {
    if (doc.y + 26 > LIMIT) newPage(doc, c);
    const y = doc.y;
    [0, 1].forEach((k) => {
      const e = s.evaluators[i + k];
      if (!e) return;
      const x = M + 1 + k * 255;
      const label = `Avaliador ${i + k + 1}: `;
      drawLines(doc, [[{ t: label, font: REG }]], x, y, 215, 9, 9, 'left', TEXT);
      const lx = x + doc.font(REG).fontSize(9).widthOfString(label);
      doc.save().lineWidth(0.6).strokeColor(TEXT).moveTo(lx, y + ASC * 9 + 1.5).lineTo(x + 215, y + ASC * 9 + 1.5).stroke().restore();
      drawLines(doc, [[{ t: e.name, font: REG }]], lx, y + ASC * 9 + 4, x + 215 - lx, 7, 7, 'left', MUTED);
    });
    doc.y = y + 26;
  }

  doc.y += 8;
  flow(doc, c, `Fechamento v${s.closure.version} — registrado por ${s.closure.closedBy} em ${fmtDateTime(s.closure.closedAt, c.tz)}. Documento gerado pelo sistema a partir do registro imutável do fechamento.`, {
    size: 7,
    lead: 9,
    color: MUTED,
  });
}

/** Votação, exceções e método da média: não fazem parte do instrumento, por isso só aparecem quando existem. */
function complementary(doc: Doc, c: Ctx) {
  const s = c.s;
  const mean = s.event.aggregation === 'mean';
  if (!s.votes.length && !s.exceptions.length && !mean) return;
  doc.y += 18;
  heading(doc, c, 'Informações complementares', 10.5, TEXT, 60);
  doc.y += 16;
  for (const v of s.votes) {
    flow(doc, c, `Votação — ${v.title}: ${v.prompt}`, { size: 9, font: BOLD });
    flow(doc, c, `Regra: ${v.ruleLabel}${v.rule === 'quorum' ? ` (quórum mínimo ${v.quorumMin})` : ''}. Contagem: ${v.tally.counts.map((x) => `${x.label} ${x.count}`).join('; ')}.`, { size: 9 });
    flow(doc, c, `Apuração: ${v.tally.explanation}`, { size: 9 });
    flow(doc, c, v.ballots ? `Votos nominais: ${v.ballots.map((b) => `${b.evaluatorName}: ${b.optionLabel}`).join('; ') || '—'}` : 'Votos nominais ocultos pela política da banca.', {
      size: 9,
      color: MUTED,
    });
    doc.y += 4;
  }
  for (const x of s.exceptions) {
    flow(
      doc,
      c,
      `Exceção: ${x.kind === 'evaluator_absent' ? 'avaliador dispensado' : `critério dispensado (${x.criterionTitle})`} — ${x.evaluatorName}. Registrada por ${x.createdBy} em ${fmtDateTime(x.createdAt, c.tz)}. Motivo: ${x.reason}`,
      { size: 9 },
    );
  }
  if (mean) flow(doc, c, `Método de cálculo: ${s.formula}`, { size: 8.5, color: MUTED });
}

/** Rodapé "… | Página N" em todas as páginas menos a capa; cada projeto numera as próprias páginas. */
function footers(doc: Doc, pages: Array<{ s: ClosureSnapshot; n: number }>) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    const p = pages[i];
    if (!p || p.n === 1) continue;
    doc.switchToPage(i);
    const label = `${p.s.event.reportFooter || p.s.event.reportHeader || p.s.event.name}  |  Página `;
    const num = String(p.n);
    const lw = doc.font(REG).fontSize(8).widthOfString(label);
    const nw = doc.font(REG).fontSize(10.5).widthOfString(num);
    const x = (PAGE_W - lw - nw) / 2;
    drawLines(doc, [[{ t: label, font: REG }]], x, FOOTER_BASELINE - ASC * 8, lw, 8, 8, 'left', FOOTER);
    drawLines(doc, [[{ t: num, font: REG }]], x + lw, FOOTER_BASELINE - ASC * 10.5, nw, 10.5, 10.5, 'left', TEXT);
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

/** Gera um PDF com um ou mais projetos (cada projeto começa na própria capa). */
export function renderReportPdf(snapshots: ClosureSnapshot[], opts: PdfOptions = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: TOP, left: M, right: M, bottom: 30 },
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
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const pages: Array<{ s: ClosureSnapshot; n: number }> = [];
    for (const s of snapshots) {
      const c: Ctx = { s, color: s.event.reportColor || '#005ca9', logo: opts.logo ?? null, tz: s.event.timezone || 'America/Sao_Paulo' };
      const start = doc.bufferedPageRange().count;
      cover(doc, c);
      for (const e of s.evaluators) evaluatorPage(doc, c, e);
      consolidatedPage(doc, c);
      complementary(doc, c);
      const end = doc.bufferedPageRange().count;
      for (let p = start; p < end; p++) pages[p] = { s, n: p - start + 1 };
    }
    footers(doc, pages);
    doc.end();
  });
}
