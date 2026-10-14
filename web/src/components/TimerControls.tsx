import { useEffect, useState } from 'react';
import type { Stage, TimerView } from '@shared/timer.ts';
import { api } from '../lib/api.ts';
import type { LiveState } from '../lib/types.ts';
import { ActionButton, Alert, Button, ConfirmDialog, Modal, Field, useToast } from './ui.tsx';
import { StageEditor, stagesValid } from './StageEditor.tsx';
import { errorMessage } from '../lib/api.ts';

/** Controles exclusivos do professor primário / administrador. O servidor também valida a permissão. */
export function TimerControls({ dayId, live, view }: { dayId: number; live: LiveState; view: TimerView | null }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState<null | 'advance' | 'finish' | 'restart'>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const cur = live.current;
  const t = live.timer;
  const active = t && (t.status === 'running' || t.status === 'paused');
  const base = `/api/days/${dayId}/timer`;

  if (!cur) return <Alert kind="info">Selecione um grupo no cronograma para iniciar a apresentação.</Alert>;

  return (
    <div className="controls" role="group" aria-label="Controles do cronômetro">
      {!t && cur.status !== 'finalized' && (
        <ActionButton
          variant="success"
          className="btn-lg"
          onAction={async () => {
            const r = await api.post(`${base}/start`, { entryId: cur.entryId });
            toast.push({ kind: 'success', text: r.alreadyStarted ? 'A apresentação já estava em andamento.' : `Apresentação de ${cur.code} iniciada. Fichas liberadas aos avaliadores.` });
          }}
        >
          ▶ Iniciar apresentação
        </ActionButton>
      )}
      {t?.status === 'running' && (
        <ActionButton variant="primary" onAction={() => api.post(`${base}/pause`)}>
          ❚❚ Pausar
        </ActionButton>
      )}
      {t?.status === 'paused' && (
        <ActionButton variant="primary" onAction={() => api.post(`${base}/resume`)}>
          ▶ Retomar
        </ActionButton>
      )}
      {active && (
        <Button onClick={() => setConfirm('advance')}>⏭ Avançar etapa</Button>
      )}
      {active && (
        <Button variant="danger" onClick={() => setConfirm('finish')}>
          ■ Encerrar apresentação
        </Button>
      )}
      {t && t.status !== 'stopped' && (
        <Button onClick={() => setAdjustOpen(true)}>⏱ Ajustar tempos</Button>
      )}
      {t && (
        <Button variant="ghost" onClick={() => setConfirm('restart')}>
          ↺ Reiniciar
        </Button>
      )}

      <ConfirmDialog
        open={confirm === 'advance'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Avançar para a próxima etapa?"
        description={view?.nextStage ? `A etapa "${view.stage?.name}" será concluída agora e começará "${view.nextStage.name}". O tempo restante desta etapa é descartado do total.` : 'Esta é a última etapa: avançar encerra o tempo total.'}
        confirmLabel="Avançar"
        onConfirm={() => api.post(`${base}/advance`)}
      />
      <ConfirmDialog
        open={confirm === 'finish'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Encerrar a apresentação antes do prazo?"
        description="O cronômetro será encerrado. As fichas de avaliação continuam abertas até o fechamento."
        confirmLabel="Encerrar"
        variant="danger"
        reason={{ label: 'Motivo (opcional)', minLength: 0, required: false }}
        onConfirm={(reason) => api.post(`${base}/finish`, { reason: reason || undefined })}
      />
      <ConfirmDialog
        open={confirm === 'restart'}
        onOpenChange={(v) => !v && setConfirm(null)}
        title="Reiniciar a apresentação?"
        description="A sessão atual fica registrada no histórico e o grupo volta a “pronto para iniciar”. As fichas já preenchidas são preservadas."
        confirmLabel="Reiniciar"
        variant="danger"
        reason={{ label: 'Justificativa', minLength: 5, required: true }}
        onConfirm={(reason) => api.post(`${base}/restart`, { reason })}
      />
      {t && <AdjustDialog open={adjustOpen} onOpenChange={setAdjustOpen} dayId={dayId} stages={t.stages} />}
    </div>
  );
}

function AdjustDialog({ open, onOpenChange, dayId, stages }: { open: boolean; onOpenChange: (v: boolean) => void; dayId: number; stages: Stage[] }) {
  const [draft, setDraft] = useState<Stage[]>(stages);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  // Cada abertura começa um rascunho novo a partir das etapas atuais da sessão.
  useEffect(() => {
    if (open) {
      setDraft(stages);
      setReason('');
      setErr(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Ajustar tempos desta apresentação"
      description="Altera somente a sessão em andamento (o perfil de tempo global não muda). O tempo já decorrido é mantido. A alteração é sincronizada e auditada."
      wide
    >
      <StageEditor stages={draft} onChange={setDraft} />
      <Field label="Justificativa" required hint="Mínimo de 5 caracteres.">
        {(p) => <textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={() => onOpenChange(false)}>Cancelar</Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={reason.trim().length < 5 || !stagesValid(draft)}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await api.post(`/api/days/${dayId}/timer/adjust`, { stages: draft, reason: reason.trim() });
              toast.push({ kind: 'success', text: 'Tempos ajustados.' });
              onOpenChange(false);
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Aplicar ajuste
        </Button>
      </div>
    </Modal>
  );
}
