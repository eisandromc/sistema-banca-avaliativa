import { useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { formatScore } from '@shared/scoring.ts';
import { Alert, Button, ConfirmDialog, ErrorBox, Field, Modal, Spinner, useLoad, useToast, ActionButton } from './ui.tsx';
import { fmtDateTime } from '../lib/format.ts';

const STATUS_PT: Record<string, string> = { submitted: 'Enviada', draft: 'Rascunho', not_opened: 'Não aberta' };
const fmtPts = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number.isInteger(n) ? String(n) : formatScore(n));

/** Parecer da banca (opções configuradas) + pontos fortes, prioridades de melhoria e orientações finais. */
function VerdictEditor({
  groupId,
  data,
  readOnly,
  onSaved,
  onDirtyChange,
}: {
  groupId: number;
  data: any;
  readOnly: boolean;
  onSaved: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const toast = useToast();
  const [f, setF] = useState({
    verdict: data.verdict?.verdict ?? '',
    strengths: data.verdict?.strengths ?? '',
    improvements: data.verdict?.improvements ?? '',
    guidance: data.verdict?.guidance ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const saved = {
    verdict: data.verdict?.verdict ?? '',
    strengths: data.verdict?.strengths ?? '',
    improvements: data.verdict?.improvements ?? '',
    guidance: data.verdict?.guidance ?? '',
  };
  const dirty = !readOnly && JSON.stringify(saved) !== JSON.stringify(f);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  return (
    <section className="card" aria-labelledby={`parecer-${groupId}`}>
      <h4 id={`parecer-${groupId}`}>Parecer da banca</h4>
      {dirty && <Alert kind="warn">Há alterações no parecer que ainda não foram salvas.</Alert>}
      <fieldset className="verdict-options" disabled={readOnly}>
        <legend className="sr-only">Parecer da banca</legend>
        {data.event.verdictOptions.map((o: string) => (
          <label key={o} className={`vote-opt ${f.verdict === o ? 'selected' : ''}`}>
            <input type="radio" name={`verdict-${groupId}`} checked={f.verdict === o} onChange={() => set({ verdict: o })} /> {o}
          </label>
        ))}
      </fieldset>
      <Field label="Pontos fortes do grupo">{(p) => <textarea {...p} rows={2} disabled={readOnly} value={f.strengths} onChange={(e) => set({ strengths: e.target.value })} />}</Field>
      <Field label="Prioridades de melhoria">{(p) => <textarea {...p} rows={2} disabled={readOnly} value={f.improvements} onChange={(e) => set({ improvements: e.target.value })} />}</Field>
      <Field label="Orientações finais da banca">{(p) => <textarea {...p} rows={2} disabled={readOnly} value={f.guidance} onChange={(e) => set({ guidance: e.target.value })} />}</Field>
      {err && <Alert kind="error">{err}</Alert>}
      {!readOnly && (
        <Button
          variant="primary"
          loading={busy}
          disabled={!f.verdict}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await api.put(`/api/groups/${groupId}/verdict`, f);
              toast.push({ kind: 'success', text: 'Parecer salvo.' });
              await onSaved();
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Salvar parecer
        </Button>
      )}
    </section>
  );
}

/** Conferência da avaliação de um grupo: consolidação verificável, fechamento, PDF, reabertura e exceções. */
export function Review({ groupId, onChanged }: { groupId: number; onChanged?: () => void }) {
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/groups/${groupId}/review`), [groupId]);
  const toast = useToast();
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [excOpen, setExcOpen] = useState(false);
  const [verdictDirty, setVerdictDirty] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { consolidation: live, closed, history, isAdmin } = data;
  const c = closed ?? live;
  const tz = c.event.timezone;
  const pdfUrl = (v?: number) => `/api/groups/${groupId}/report.pdf${v ? `?version=${v}` : ''}`;
  const changed = async () => {
    await reload(true);
    onChanged?.();
  };

  return (
    <div className="review">
      <div className="review-head">
        <div>
          <h3>
            {c.group.code} — {c.group.title}
          </h3>
          <p className="muted">
            Turma {c.group.className} · Alunos: {c.group.students.join('; ')}
            {c.group.advisor ? ` · Orientação: ${c.group.advisor}` : ''}
          </p>
          <p className="muted">
            Apresentação: início {fmtDateTime(c.entry.startedAt, tz)} · término {fmtDateTime(c.entry.endedAt, tz)}
          </p>
        </div>
        <div className="final-score" aria-label="Resultado consolidado">
          <div className="final-label">Resultado das rubricas</div>
          <div className="final-value">{c.event.aggregation === 'sum' ? fmtPts(c.finalScore) : formatScore(c.finalScore)}</div>
          <div className="muted small">
            de {fmtPts(c.finalMax ?? 100)} · {c.event.aggregation === 'sum' ? 'soma dos subtotais' : 'média'} de {c.countedEvaluators} avaliação(ões) válida(s)
          </div>
        </div>
      </div>

      {closed ? (
        <Alert kind="success">
          Avaliação <strong>fechada</strong> (versão {closed.closure.version}) por {closed.closure.closedBy} em {fmtDateTime(closed.closure.closedAt, tz)}. Dados congelados — exibindo o registro imutável.
        </Alert>
      ) : live.blockers.length ? (
        <Alert kind="warn">
          <strong>Fechamento bloqueado:</strong>
          <ul>
            {live.blockers.map((b: string, i: number) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert kind="success">Todas as avaliações obrigatórias foram enviadas. Confira os dados e feche a avaliação.</Alert>
      )}

      <div className="row wrap gap">
        {!closed && (
          <Button variant="primary" disabled={live.blockers.length > 0 || verdictDirty} onClick={() => setCloseOpen(true)}>
            ✔ Conferir e fechar avaliação
          </Button>
        )}
        {!closed && verdictDirty && <span className="warn-text small">Salve o parecer antes de fechar.</span>}
        {closed && (
          <a className="btn btn-primary" href={pdfUrl()} download>
            ⬇ Baixar PDF (v{closed.closure.version})
          </a>
        )}
        {closed && isAdmin && (
          <Button variant="danger" onClick={() => setReopenOpen(true)}>
            Reabrir com justificativa
          </Button>
        )}
        {!closed && isAdmin && <Button onClick={() => setExcOpen(true)}>Registrar exceção/dispensa</Button>}
        <Button variant="ghost" onClick={() => reload()}>
          Atualizar
        </Button>
      </div>

      <h4>Avaliadores e rubricas</h4>
      {c.evaluators.map((e: any) => (
        <section key={e.userId} className="card evaluator">
          <div className="row between wrap">
            <h5>
              {e.name} <span className="muted">— {e.rubric.title} ({e.rubric.templateName} v{e.rubric.version})</span>
            </h5>
            <div>
              <span className={`pill pill-${e.absent ? 'muted' : e.status === 'submitted' ? 'ok' : 'warn'}`}>{e.absent ? 'Dispensado' : STATUS_PT[e.status]}</span>{' '}
              <strong>{e.counted ? `${fmtPts(e.points)} / ${fmtPts(e.maxPoints)}` : '—'}</strong>
              {e.counted && c.event.aggregation === 'mean' && <span className="muted small"> ({formatScore(e.teacherScore)} / 100)</span>}
            </div>
          </div>
          {e.absent && (
            <p className="muted">
              Dispensa registrada por {e.absent.by}: {e.absent.reason}
            </p>
          )}
          {!e.absent && e.pendencies.length > 0 && <p className="warn-text">Pendências: {e.pendencies.join(' ')}</p>}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Critério</th>
                  <th scope="col" className="num">
                    Peso
                  </th>
                  <th scope="col" className="num">
                    Nota
                  </th>
                  <th scope="col" className="num">
                    Contribuição
                  </th>
                  <th scope="col">Justificativa</th>
                </tr>
              </thead>
              <tbody>
                {e.criteria.map((cr: any) => (
                  <tr key={cr.id}>
                    <td>
                      {cr.title}
                      {!cr.required && <span className="muted"> (opcional)</span>}
                    </td>
                    <td className="num">{formatScore(cr.weight)}</td>
                    <td className="num">{cr.waived ? <em>dispensado</em> : cr.score === null ? <em>sem nota</em> : formatScore(cr.score)}</td>
                    <td className="num">{cr.contribution === null ? '—' : formatScore(cr.contribution)}</td>
                    <td className="pre">{cr.waived ? `Dispensa: ${cr.waived.reason}` : cr.comment || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {e.generalComment && (
            <p className="pre">
              <strong>Observações gerais:</strong> {e.generalComment}
            </p>
          )}
        </section>
      ))}

      {c.event.verdictOptions?.length > 0 && (
        <VerdictEditor
          key={closed ? `v${closed.closure.version}` : 'aberto'}
          groupId={groupId}
          data={c}
          readOnly={!!closed}
          onSaved={changed}
          onDirtyChange={setVerdictDirty}
        />
      )}

      {c.votes.length > 0 && (
        <>
          <h4>Votação (separada das notas)</h4>
          {c.votes.map((v: any) => (
            <section key={v.questionId} className="card">
              <h5>
                {v.title} <span className="muted">— {v.prompt}</span>
              </h5>
              <p className="muted small">
                Regra: {v.ruleLabel}
                {v.rule === 'quorum' ? ` (quórum ${v.quorumMin})` : ''}
              </p>
              <ul className="tally">
                {v.tally.counts.map((t: any) => (
                  <li key={t.optionId}>
                    {t.label}
                    {t.isAbstain ? ' (abstenção)' : ''}: <strong>{t.count}</strong>
                  </li>
                ))}
              </ul>
              <p>
                <strong>Apuração:</strong> {v.tally.explanation}
              </p>
              {v.ballots ? (
                <p className="small">Votos nominais: {v.ballots.map((b: any) => `${b.evaluatorName}: ${b.optionLabel}`).join('; ') || '—'}</p>
              ) : (
                <p className="small muted">Votos nominais ocultos pela política de privacidade da banca.</p>
              )}
            </section>
          ))}
        </>
      )}

      {c.exceptions.length > 0 && (
        <>
          <h4>Exceções administrativas</h4>
          <ul>
            {c.exceptions.map((x: any) => (
              <li key={x.id}>
                {x.kind === 'evaluator_absent' ? 'Avaliador dispensado' : `Critério dispensado (${x.criterionTitle})`} — {x.evaluatorName}. Por {x.createdBy} em{' '}
                {fmtDateTime(x.createdAt, tz)}: {x.reason}{' '}
                {!closed && isAdmin && (
                  <ActionButton
                    variant="ghost"
                    onAction={async () => {
                      await api.post(`/api/exceptions/${x.id}/revoke`);
                      await changed();
                    }}
                  >
                    Revogar
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <details className="formula">
        <summary>Como o resultado é calculado</summary>
        <p>{c.formula}</p>
      </details>

      {history.length > 0 && (
        <>
          <h4>Histórico de fechamentos</h4>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Versão</th>
                <th scope="col">Fechado por</th>
                <th scope="col">Data</th>
                <th scope="col">Resultado</th>
                <th scope="col">Reabertura</th>
                <th scope="col">PDF</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h: any) => (
                <tr key={h.id}>
                  <td>v{h.version}</td>
                  <td>{h.closedBy}</td>
                  <td>{fmtDateTime(h.closedAt, tz)}</td>
                  <td>{formatScore(h.finalScore)}</td>
                  <td>{h.reopenedAt ? `${h.reopenedBy} em ${fmtDateTime(h.reopenedAt, tz)}: ${h.reopenReason}` : 'Vigente'}</td>
                  <td>
                    <a href={pdfUrl(h.version)} download>
                      PDF v{h.version}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title="Fechar a avaliação deste projeto?"
        description={`Resultado consolidado: ${live.event.aggregation === 'sum' ? fmtPts(live.finalScore) : formatScore(live.finalScore)} / ${fmtPts(live.finalMax ?? 100)}. Após o fechamento, as fichas ficam bloqueadas para edição e o PDF oficial é gerado. Só um administrador pode reabrir.`}
        confirmLabel="Fechar avaliação"
        onConfirm={async () => {
          try {
            // O token vincula o fechamento exatamente aos dados conferidos nesta tela.
            const r = await api.post(`/api/groups/${groupId}/close`, { confirm: true, reviewToken: data.reviewToken });
            toast.push({ kind: 'success', text: `Avaliação fechada (versão ${r.version}). PDF disponível.` });
          } catch (e: any) {
            if (e?.code === 'REVIEW_STALE') await reload(true);
            throw e;
          }
          await changed();
        }}
      />
      <ConfirmDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        title="Reabrir avaliação"
        description="O fechamento atual permanece no histórico. As fichas voltam a rascunho para correção e reenvio; um novo fechamento gerará nova versão."
        confirmLabel="Reabrir"
        variant="danger"
        reason={{ label: 'Motivo da reabertura', minLength: 10, required: true }}
        onConfirm={async (reason) => {
          await api.post(`/api/groups/${groupId}/reopen`, { reason });
          toast.push({ kind: 'success', text: 'Avaliação reaberta.' });
          await changed();
        }}
      />
      {isAdmin && !closed && <ExceptionDialog open={excOpen} onOpenChange={setExcOpen} groupId={groupId} evaluators={live.evaluators} onDone={changed} />}
    </div>
  );
}

function ExceptionDialog({ open, onOpenChange, groupId, evaluators, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; groupId: number; evaluators: any[]; onDone: () => void }) {
  const withEval = evaluators.filter((e) => e.evaluationId);
  const [kind, setKind] = useState<'evaluator_absent' | 'criterion_waived'>('evaluator_absent');
  const [evalId, setEvalId] = useState<number | ''>('');
  const [critId, setCritId] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ev = withEval.find((e) => e.evaluationId === evalId);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Registrar exceção (somente administrador)" description="A exceção constará na consolidação e no PDF, com seu nome e motivo.">
      <Field label="Tipo">
        {(p) => (
          <select {...p} value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="evaluator_absent">Dispensar avaliador ausente (sai da base de cálculo)</option>
            <option value="criterion_waived">Dispensar critério obrigatório não avaliado</option>
          </select>
        )}
      </Field>
      <Field label="Avaliador">
        {(p) => (
          <select {...p} value={evalId} onChange={(e) => setEvalId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Selecione…</option>
            {withEval.map((e) => (
              <option key={e.evaluationId} value={e.evaluationId}>
                {e.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {withEval.length < evaluators.length && <p className="muted small">Avaliadores cuja ficha ainda não foi aberta não aparecem: inicie a apresentação primeiro.</p>}
      {kind === 'criterion_waived' && ev && (
        <Field label="Critério">
          {(p) => (
            <select {...p} value={critId} onChange={(e) => setCritId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Selecione…</option>
              {ev.criteria.map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label="Motivo" required hint="Mínimo de 5 caracteres.">
        {(p) => <textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={!evalId || reason.trim().length < 5 || (kind === 'criterion_waived' && !critId)}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await api.post(`/api/groups/${groupId}/exceptions`, { kind, evaluationId: evalId, criterionId: kind === 'criterion_waived' ? critId : null, reason: reason.trim() });
              onOpenChange(false);
              setReason('');
              onDone();
            } catch (e) {
              setErr(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Registrar
        </Button>
      </div>
    </Modal>
  );
}
