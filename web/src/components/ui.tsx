import * as Dialog from '@radix-ui/react-dialog';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { errorMessage } from '../lib/api.ts';
import type { EntryStatus } from '../lib/types.ts';

/** Item excluído (na lixeira) que ainda aparece por estar vinculado a outro: sempre taxado e em vermelho. */
export function Struck({ deleted, children }: { deleted?: boolean; children: ReactNode }) {
  if (!deleted) return <>{children}</>;
  return (
    <span className="struck" title="Item excluído (está na lixeira)">
      {children}
    </span>
  );
}

// ---------- Botão ----------
/** `create` (verde), `edit` (azul) e `delete` (vermelho): criar, editar e excluir têm sempre a mesma cor. */
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success' | 'create' | 'edit' | 'delete';

export function Button({
  variant = 'secondary',
  loading,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button {...rest} className={`btn btn-${variant} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading && <span className="spinner spinner-sm" aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Botão que executa uma ação assíncrona e bloqueia cliques repetidos até terminar. */
export function ActionButton({
  onAction,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & { variant?: Variant; onAction: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  return (
    <Button
      {...rest}
      loading={busy}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onAction();
        } catch (e) {
          toast.push({ kind: 'error', text: errorMessage(e) });
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}

// ---------- Campos ----------
export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean; required?: boolean }) => ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  return (
    <div className={`field ${error ? 'field-error' : ''}`}>
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {children({ id, 'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined, 'aria-invalid': !!error || undefined, required })}
      {hint && (
        <div className="hint" id={hintId}>
          {hint}
        </div>
      )}
      {error && (
        <div className="error-text" id={errId} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="checkbox">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <label htmlFor={id}>
        {label}
        {hint && <span className="hint"> — {hint}</span>}
      </label>
    </div>
  );
}

// ---------- Estados ----------
export function Spinner({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <span aria-hidden="true">⚠ </span>
      {errorMessage(error)}
      {onRetry && (
        <Button variant="ghost" onClick={onRetry} className="ml">
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const icon = { info: 'ℹ', warn: '⚠', error: '⛔', success: '✔' }[kind];
  return (
    <div className={`alert alert-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span aria-hidden="true">{icon} </span>
      {children}
    </div>
  );
}

// ---------- Situação dos grupos (texto + ícone, não só cor) ----------
const STATUS_ICON: Record<EntryStatus, string> = {
  waiting: '○',
  running: '▶',
  started: '✓',
  awaiting_closure: '⧗',
  finalized: '■',
};

export function StatusBadge({ status, label }: { status: EntryStatus; label: string }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden="true">{STATUS_ICON[status]} </span>
      {label}
    </span>
  );
}

export function StartedCheck({ started, at }: { started: boolean; at?: string | null }) {
  if (!started) return <span className="muted">—</span>;
  return (
    <span className="check-started" title={at ? `Iniciado às ${new Date(at).toLocaleTimeString('pt-BR')}` : 'Iniciado'}>
      <span aria-hidden="true">☑ </span>Iniciado
    </span>
  );
}

const EVAL_STATUS: Record<string, [string, string]> = {
  not_opened: ['Não aberta', 'muted'],
  draft: ['Rascunho', 'warn'],
  submitted: ['Enviada', 'ok'],
};

export function EvalStatus({ status }: { status: string | null }) {
  const [label, cls] = EVAL_STATUS[status ?? 'not_opened'] ?? ['—', 'muted'];
  return <span className={`pill pill-${cls}`}>{label}</span>;
}

// ---------- Diálogos ----------
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
  full,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** Ocupa quase toda a tela (visualização de slides e PDF). */
  full?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={`dialog ${wide ? 'dialog-wide' : ''} ${full ? 'dialog-full' : ''}`} aria-describedby={description ? undefined : undefined}>
          <Dialog.Title className="dialog-title">{title}</Dialog.Title>
          {description ? <Dialog.Description className="dialog-desc">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
          {children}
          <Dialog.Close asChild>
            <button className="dialog-x" aria-label="Fechar">
              ×
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Confirmação com justificativa opcional/obrigatória. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirmar',
  variant = 'primary',
  reason,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  variant?: Variant;
  reason?: { label: string; minLength: number; required: boolean };
  onConfirm: (reason: string) => Promise<unknown>;
  children?: ReactNode;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setText('');
      setErr(null);
    }
  }, [open]);
  const tooShort = !!reason?.required && text.trim().length < reason.minLength;
  return (
    <Modal open={open} onOpenChange={(v) => !busy && onOpenChange(v)} title={title} description={description}>
      {children}
      {reason && (
        <Field label={reason.label} required={reason.required} hint={reason.required ? `Mínimo de ${reason.minLength} caracteres.` : undefined}>
          {(p) => <textarea {...p} rows={3} value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
      )}
      {err && <Alert kind="error">{err}</Alert>}
      <div className="dialog-actions">
        <Button onClick={() => onOpenChange(false)} disabled={busy}>
          Cancelar
        </Button>
        <Button
          variant={variant}
          loading={busy}
          disabled={tooShort}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await onConfirm(text.trim());
              onOpenChange(false);
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

// ---------- Avisos (toasts) ----------
interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error' | 'warn';
  text: string;
}
const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++seq.current;
    setToasts((all) => [...all.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), t.kind === 'error' ? 8000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            {t.text}
            <button className="toast-x" aria-label="Dispensar aviso" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

// ---------- Carregamento de dados ----------
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await loaderRef.current();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}
