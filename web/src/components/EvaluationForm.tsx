import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api.ts';
import type { EvaluationForm as FormData } from '../lib/types.ts';
import { formatScore, teacherScore, validateScore, normalizationConfigured } from '@shared/scoring.ts';
import { Alert, Button, ErrorBox, Modal, Spinner, useToast } from './ui.tsx';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'offline' | 'conflict' | 'invalid';

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'Rascunho salvo no servidor',
  dirty: 'Alterações ainda não salvas…',
  saving: 'Salvando…',
  error: 'Erro ao salvar',
  offline: 'Sem conexão — rascunho guardado neste dispositivo, será sincronizado ao reconectar',
  conflict: 'Conflito: a ficha foi alterada em outro dispositivo',
  invalid: 'Corrija os campos destacados para salvar',
};

interface Values {
  scores: Record<number, { raw: string; comment: string }>;
  general: string;
  votes: Record<number, number | null>;
}

const storageKey = (id: number) => `banca.draft.${id}`;

function readLocal(id: number): { values: Values; baseRevision: number } | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeLocal(id: number, values: Values, baseRevision: number) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify({ values, baseRevision }));
  } catch {
    /* armazenamento indisponível */
  }
}
function clearLocal(id: number) {
  try {
    localStorage.removeItem(storageKey(id));
  } catch {
    /* ignore */
  }
}

function valuesFromForm(f: FormData): Values {
  const scores: Values['scores'] = {};
  for (const c of f.rubric.criteria) {
    const s = f.scores.find((x) => x.criterionId === c.id);
    scores[c.id] = { raw: s?.score === null || s?.score === undefined ? '' : String(s.score).replace('.', ','), comment: s?.comment ?? '' };
  }
  const votes: Values['votes'] = {};
  for (const q of f.questions) votes[q.id] = f.votes.find((v) => v.questionId === q.id)?.optionId ?? null;
  return { scores, general: f.evaluation.generalComment ?? '', votes };
}

function parseScore(raw: string): number | null | 'invalid' {
  const t = raw.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : 'invalid';
}

const same = (a: Values, b: Values) => JSON.stringify(a) === JSON.stringify(b);

const fmtPts = (n: number | null) => (n === null ? '—' : Number.isInteger(n) ? String(n) : formatScore(n));

export function EvaluationForm({ evaluationId, onSubmitted }: { evaluationId: number; onSubmitted?: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState<FormData | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [values, setValues] = useState<Values | null>(null);
  const [state, setState] = useState<SaveState>('saved');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [staleLocal, setStaleLocal] = useState<Values | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const revisionRef = useRef(0);
  const valuesRef = useRef<Values | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const serverValuesRef = useRef<Values | null>(null);

  const load = useCallback(
    async (opts: { keepLocal?: boolean } = {}) => {
      try {
        const f = await api.get<FormData>(`/api/evaluations/${evaluationId}`);
        const server = valuesFromForm(f);
        serverValuesRef.current = server;
        revisionRef.current = f.evaluation.revision;
        setForm(f);
        setLoadError(null);
        const local = readLocal(evaluationId);
        if (opts.keepLocal && valuesRef.current) {
          // Mantém as alterações deste dispositivo e grava sobre a nova revisão.
          setState('dirty');
          writeLocal(evaluationId, valuesRef.current, f.evaluation.revision);
          scheduleSave(0);
          return;
        }
        if (local && f.evaluation.editable && !same(local.values, server)) {
          if (local.baseRevision === f.evaluation.revision) {
            // Alterações locais ainda não sincronizadas (ex.: queda de conexão): restaura e sincroniza.
            valuesRef.current = local.values;
            setValues(local.values);
            setState('dirty');
            scheduleSave(300);
            return;
          }
          setStaleLocal(local.values);
        } else if (local) {
          clearLocal(evaluationId);
        }
        valuesRef.current = server;
        setValues(server);
        setState('saved');
      } catch (e) {
        setLoadError(e);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [evaluationId],
  );

  useEffect(() => {
    setForm(null);
    setValues(null);
    setStaleLocal(null);
    void load();
    return () => window.clearTimeout(timerRef.current);
  }, [load]);

  const invalidFields = useMemo(() => {
    const out: Record<number, string> = {};
    if (!form || !values) return out;
    for (const c of form.rubric.criteria) {
      const p = parseScore(values.scores[c.id]?.raw ?? '');
      if (p === 'invalid') out[c.id] = 'Digite um número (ex.: 7,5).';
      else if (p !== null) {
        const err = validateScore(p, form.rubric.scale);
        if (err) out[c.id] = err;
      }
    }
    return out;
  }, [form, values]);

  const doSave = useCallback(async () => {
    const v = valuesRef.current;
    if (!v || !form) return;
    const f = form;
    // Validação local: não envia valores fora da escala.
    for (const c of f.rubric.criteria) {
      const p = parseScore(v.scores[c.id]?.raw ?? '');
      if (p === 'invalid' || (p !== null && validateScore(p, f.rubric.scale))) {
        setState('invalid');
        return;
      }
    }
    setState('saving');
    try {
      const r = await api.put<{ revision: number }>(`/api/evaluations/${evaluationId}/draft`, {
        revision: revisionRef.current,
        generalComment: v.general,
        scores: f.rubric.criteria.map((c) => ({
          criterionId: c.id,
          score: parseScore(v.scores[c.id]?.raw ?? '') as number | null,
          comment: c.commentEnabled ? v.scores[c.id]?.comment ?? '' : undefined,
        })),
        votes: f.questions.map((q) => ({ questionId: q.id, optionId: v.votes[q.id] ?? null })),
      });
      revisionRef.current = r.revision;
      serverValuesRef.current = v;
      setSaveError(null);
      setLastSaved(new Date());
      if (valuesRef.current === v) {
        setState('saved');
        clearLocal(evaluationId);
        if (form.evaluation.status === 'submitted') setForm({ ...form, evaluation: { ...form.evaluation, status: 'draft', revision: r.revision } });
      } else {
        writeLocal(evaluationId, valuesRef.current!, r.revision);
        scheduleSave(400);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') setState('conflict');
      else if (e instanceof ApiError && e.isNetwork) {
        setState('offline');
        scheduleSave(5000);
      } else if (e instanceof ApiError && e.code === 'LOCKED') {
        setState('error');
        setSaveError(e.message);
        void load();
      } else {
        setState('error');
        setSaveError(errorMessage(e));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluationId, form]);

  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  function scheduleSave(delay = 900) {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const run = async () => {
        if (savingRef.current) await savingRef.current;
        savingRef.current = doSaveRef.current().finally(() => (savingRef.current = null));
        await savingRef.current;
      };
      void run();
    }, delay);
  }

  useEffect(() => {
    const onOnline = () => {
      if (state === 'offline' || state === 'dirty') scheduleSave(200);
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const update = (fn: (v: Values) => Values) => {
    if (!valuesRef.current) return;
    const next = fn(valuesRef.current);
    valuesRef.current = next;
    setValues(next);
    setState('dirty');
    writeLocal(evaluationId, next, revisionRef.current);
    scheduleSave();
  };

  /**
   * Garante que o conteúdo exibido é exatamente o gravado no servidor antes de enviar.
   * Se o salvamento falhar, lança erro: o envio é bloqueado e o rascunho local é preservado.
   */
  async function flush() {
    window.clearTimeout(timerRef.current);
    for (let attempt = 0; attempt < 3; attempt++) {
      if (savingRef.current) await savingRef.current;
      if (!valuesRef.current || !serverValuesRef.current || same(valuesRef.current, serverValuesRef.current)) return;
      savingRef.current = doSave().finally(() => (savingRef.current = null));
      await savingRef.current;
    }
    if (valuesRef.current && serverValuesRef.current && !same(valuesRef.current, serverValuesRef.current)) {
      throw new Error('Não foi possível salvar as últimas alterações no servidor. Nada foi enviado; suas alterações continuam neste dispositivo. Tente novamente.');
    }
  }

  if (loadError) return <ErrorBox error={loadError} onRetry={() => void load()} />;
  if (!form || !values) return <Spinner label="Carregando ficha…" />;

  const ro = !form.evaluation.editable;
  const scale = form.rubric.scale;
  const scoreMap = new Map<number, number | null>();
  for (const c of form.rubric.criteria) {
    const p = parseScore(values.scores[c.id]?.raw ?? '');
    scoreMap.set(c.id, p === 'invalid' || (p !== null && validateScore(p, scale)) ? null : p);
  }
  const preview = normalizationConfigured(scale)
    ? teacherScore(
        form.rubric.criteria.map((c) => ({ id: c.id, title: c.title, weight: c.weight, required: c.required })),
        scoreMap,
        scale,
      )
    : null;

  // Pontos brutos (soma das notas × peso), como no subtotal do instrumento impresso.
  let points: number | null = null;
  let maxPoints = 0;
  for (const c of form.rubric.criteria) {
    maxPoints += scale.max * c.weight;
    const sc = scoreMap.get(c.id);
    if (sc !== null && sc !== undefined) points = (points ?? 0) + sc * c.weight;
  }
  const pendencies: string[] = [];
  // Referência curta: critérios de instrumentos costumam ser frases longas.
  const ref = (t: string, i: number) => (t.length > 40 ? `critério ${i + 1}` : t);
  form.rubric.criteria.forEach((c, i) => {
    if (c.required && scoreMap.get(c.id) === null) pendencies.push(`Nota: ${ref(c.title, i)}`);
    if (c.commentEnabled && c.commentRequired && !values.scores[c.id]?.comment.trim()) pendencies.push(`Justificativa: ${ref(c.title, i)}`);
  });
  if (form.rubric.generalCommentRequired && !values.general.trim()) pendencies.push('Observação geral');
  for (const q of form.questions) if (q.required && !values.votes[q.id]) pendencies.push(`Voto: ${q.title}`);
  const hasInvalid = Object.keys(invalidFields).length > 0;

  return (
    <form className="eval-form" onSubmit={(e) => e.preventDefault()} aria-label={`Ficha de avaliação — ${form.group.code}`}>
      <div className="eval-head">
        <div>
          <h3>
            {form.rubric.title} <span className="muted">· {form.rubric.templateName} v{form.rubric.version}</span>
          </h3>
          <p className="muted">
            Escala {String(scale.min).replace('.', ',')} a {String(scale.max).replace('.', ',')} (incremento {String(scale.step).replace('.', ',')}). Zero é nota válida;
            campo vazio significa “sem nota”.
          </p>
          {form.rubric.instructions && <p className="instructions">{form.rubric.instructions}</p>}
        </div>
        <div className={`save-state save-${state}`} role="status" aria-live="polite">
          <span aria-hidden="true">{state === 'saved' ? '✔' : state === 'saving' ? '⟳' : state === 'dirty' ? '…' : '⚠'} </span>
          {ro ? (form.evaluation.status === 'submitted' ? 'Ficha enviada' : 'Somente leitura') : SAVE_LABEL[state]}
          {state === 'saved' && lastSaved && !ro && <span className="muted"> às {lastSaved.toLocaleTimeString('pt-BR')}</span>}
        </div>
      </div>

      {ro && form.evaluation.lockedReason && <Alert kind="info">{form.evaluation.lockedReason}</Alert>}
      {!ro && form.evaluation.status === 'submitted' && (
        <Alert kind="info">Ficha já enviada. Pela política da banca você ainda pode editá-la; qualquer alteração exige reenviar.</Alert>
      )}
      {state === 'error' && saveError && <Alert kind="error">{saveError}</Alert>}
      {state === 'conflict' && (
        <Alert kind="warn">
          Esta ficha foi alterada em outro dispositivo ou aba.{' '}
          <Button variant="ghost" onClick={() => (clearLocal(evaluationId), void load())}>
            Carregar versão do servidor
          </Button>{' '}
          <Button variant="ghost" onClick={() => void load({ keepLocal: true })}>
            Manter as minhas alterações
          </Button>
        </Alert>
      )}
      {staleLocal && (
        <Alert kind="warn">
          Há um rascunho antigo guardado neste dispositivo que difere do servidor.{' '}
          <Button
            variant="ghost"
            onClick={() => {
              const v = staleLocal;
              setStaleLocal(null);
              update(() => v);
            }}
          >
            Restaurar rascunho local
          </Button>{' '}
          <Button variant="ghost" onClick={() => (clearLocal(evaluationId), setStaleLocal(null))}>
            Descartar
          </Button>
        </Alert>
      )}

      <ol className="criteria">
        {form.rubric.criteria.map((c) => {
          const v = values.scores[c.id] ?? { raw: '', comment: '' };
          const err = invalidFields[c.id];
          const empty = v.raw.trim() === '';
          const inputId = `crit-${c.id}`;
          return (
            <li key={c.id} className={`criterion ${err ? 'has-error' : ''}`}>
              <div className="criterion-head">
                <label htmlFor={inputId} id={`${inputId}-title`} className="criterion-title">
                  {c.title}
                  {c.required ? (
                    <span className="req" title="Obrigatório">
                      {' '}
                      *<span className="sr-only"> (obrigatório)</span>
                    </span>
                  ) : (
                    <span className="muted"> (opcional)</span>
                  )}
                </label>
                <span className="weight">Peso {formatScore(c.weight, c.weight % 1 ? 1 : 0)}</span>
              </div>
              {c.description && (
                <p className="muted small" id={`${inputId}-desc`}>
                  {c.description}
                </p>
              )}
              {form.rubric.scaleLabels.length > 0 ? (
                <div className="scale-row" role="radiogroup" aria-labelledby={`${inputId}-title`} aria-describedby={`${inputId}-desc`}>
                  {form.rubric.scaleLabels.map((l) => {
                    const checked = !empty && parseScore(v.raw) === l.value;
                    return (
                      <label key={l.value} className={`scale-opt ${checked ? 'selected' : ''} ${ro ? 'disabled' : ''}`}>
                        <input
                          type="radio"
                          name={`crit-${evaluationId}-${c.id}`}
                          checked={checked}
                          disabled={ro}
                          onChange={() => update((s) => ({ ...s, scores: { ...s.scores, [c.id]: { ...v, raw: String(l.value) } } }))}
                        />
                        <span className="scale-value">{l.value}</span>
                        <span className="scale-label">{l.label}</span>
                      </label>
                    );
                  })}
                  {empty && <span className="muted small">Sem nota</span>}
                  {!ro && !empty && (
                    <Button variant="ghost" aria-label={`Limpar nota de ${c.title}`} onClick={() => update((s) => ({ ...s, scores: { ...s.scores, [c.id]: { ...v, raw: '' } } }))}>
                      Limpar
                    </Button>
                  )}
                </div>
              ) : (
              <div className="score-row">
                <input
                  id={inputId}
                  className="score-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={v.raw}
                  disabled={ro}
                  placeholder="sem nota"
                  aria-invalid={!!err || undefined}
                  aria-describedby={`${inputId}-desc ${inputId}-hint`}
                  onChange={(e) => update((s) => ({ ...s, scores: { ...s.scores, [c.id]: { ...v, raw: e.target.value } } }))}
                />
                <span id={`${inputId}-hint`} className="muted small">
                  {empty ? 'Sem nota' : err ? '' : `de ${scale.max}`}
                </span>
                {!ro && !empty && (
                  <Button variant="ghost" aria-label={`Limpar nota de ${c.title}`} onClick={() => update((s) => ({ ...s, scores: { ...s.scores, [c.id]: { ...v, raw: '' } } }))}>
                    Limpar
                  </Button>
                )}
              </div>
              )}
              {err && (
                <div className="error-text" role="alert">
                  {err}
                </div>
              )}
              {c.commentEnabled && (
                <div className="field">
                  <label htmlFor={`${inputId}-c`}>
                    Justificativa{c.commentRequired ? ' (obrigatória)' : ''}
                  </label>
                  <textarea
                    id={`${inputId}-c`}
                    rows={2}
                    value={v.comment}
                    disabled={ro}
                    maxLength={5000}
                    onChange={(e) => update((s) => ({ ...s, scores: { ...s.scores, [c.id]: { ...v, comment: e.target.value } } }))}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="field">
        <label htmlFor={`general-${evaluationId}`}>{form.rubric.feedbackLabel || 'Observações gerais do projeto'}
          {form.rubric.generalCommentRequired ? ' (obrigatório)' : ''}</label>
        <textarea id={`general-${evaluationId}`} rows={4} value={values.general} disabled={ro} maxLength={10000} onChange={(e) => update((s) => ({ ...s, general: e.target.value }))} />
      </div>

      {form.questions.length > 0 && (
        <fieldset className="votes">
          <legend>Votação (independente das notas)</legend>
          {form.questions.map((q) => (
            <div key={q.id} className="vote-q" role="radiogroup" aria-labelledby={`vq-${q.id}`}>
              <p id={`vq-${q.id}`}>
                <strong>{q.title}</strong> — {q.prompt}
                {q.required && <span className="req"> *</span>}
              </p>
              <div className="vote-options">
                {q.options.map((o) => (
                  <label key={o.id} className={`vote-opt ${values.votes[q.id] === o.id ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name={`vote-${evaluationId}-${q.id}`}
                      checked={values.votes[q.id] === o.id}
                      disabled={ro}
                      onChange={() => update((s) => ({ ...s, votes: { ...s.votes, [q.id]: o.id } }))}
                    />
                    {o.label}
                  </label>
                ))}
                {!ro && values.votes[q.id] && (
                  <Button variant="ghost" onClick={() => update((s) => ({ ...s, votes: { ...s.votes, [q.id]: null } }))}>
                    Limpar voto
                  </Button>
                )}
              </div>
            </div>
          ))}
        </fieldset>
      )}

      <div className="eval-foot">
        <div>
          <div>
            Subtotal: <strong>{fmtPts(points)}</strong> / {fmtPts(maxPoints)}
            {form.evaluation.aggregation === 'mean' && (
              <span className="muted">
                {' '}
                · pontuação normalizada {preview ? formatScore(preview.score) : '—'} / 100
              </span>
            )}
          </div>
          {!ro && (
            <div className={pendencies.length ? 'warn-text' : 'ok-text'}>
              {pendencies.length ? (
                <>
                  <span aria-hidden="true">⚠ </span>
                  {pendencies.length} pendência(s): {pendencies.join('; ')}
                </>
              ) : (
                <>
                  <span aria-hidden="true">✔ </span>Pronta para envio
                </>
              )}
            </div>
          )}
        </div>
        {!ro && (
          <Button
            variant="primary"
            className="btn-lg"
            disabled={pendencies.length > 0 || hasInvalid || state === 'conflict'}
            onClick={async () => {
              setSubmitError(null);
              try {
                await flush();
                setConfirmOpen(true);
              } catch (e) {
                toast.push({ kind: 'error', text: errorMessage(e) });
              }
            }}
          >
            Enviar avaliação
          </Button>
        )}
      </div>

      <Modal open={confirmOpen} onOpenChange={(v) => !submitting && setConfirmOpen(v)} title="Confirmar envio da avaliação" description={`${form.group.code} — ${form.group.title}`} wide>
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Critério</th>
              <th scope="col">Peso</th>
              <th scope="col">Nota</th>
            </tr>
          </thead>
          <tbody>
            {form.rubric.criteria.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td>{formatScore(c.weight, c.weight % 1 ? 1 : 0)}</td>
                <td>{scoreMap.get(c.id) === null ? <em>sem nota</em> : formatScore(scoreMap.get(c.id)!, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {form.questions.map((q) => (
          <p key={q.id}>
            {q.title}: <strong>{q.options.find((o) => o.id === values.votes[q.id])?.label ?? 'sem voto'}</strong>
          </p>
        ))}
        <p>
          Subtotal do avaliador: <strong>{fmtPts(points)} / {fmtPts(maxPoints)}</strong>
          {form.evaluation.aggregation === 'mean' && <> · pontuação normalizada {preview ? formatScore(preview.score) : '—'} / 100</>}
        </p>
        <p className="muted">
          {form.evaluation.editPolicy === 'locked' ? 'Após o envio, a ficha não poderá ser editada (política da banca).' : 'Após o envio você ainda poderá editar até o fechamento, mas precisará reenviar.'}
        </p>
        {submitError && <Alert kind="error">{submitError}</Alert>}
        <div className="dialog-actions">
          <Button onClick={() => setConfirmOpen(false)} disabled={submitting}>
            Revisar
          </Button>
          <Button
            variant="primary"
            loading={submitting}
            onClick={async () => {
              setSubmitting(true);
              setSubmitError(null);
              try {
                await flush();
                await api.post(`/api/evaluations/${evaluationId}/submit`, { revision: revisionRef.current });
                clearLocal(evaluationId);
                setConfirmOpen(false);
                toast.push({ kind: 'success', text: 'Avaliação enviada.' });
                await load();
                onSubmitted?.();
              } catch (e) {
                setSubmitError(errorMessage(e));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            Confirmar envio
          </Button>
        </div>
      </Modal>
    </form>
  );
}
