import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { errorMessage } from '../lib/api.ts';
import { Alert, Button, Field } from '../components/ui.tsx';

const AREA_NAME: Record<string, string> = { '/professor': 'Professor', '/configuracao': 'Configuração', '/cronometro': 'Cronômetro' };

export function LoginPage() {
  const { login, user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const back = params.get('voltar');
  const safeBack = back && back.startsWith('/') && !back.startsWith('//') ? back : '/';
  const area = AREA_NAME[safeBack.split('?')[0]!];

  return (
    <div className="page narrow">
      <div className="card" style={{ padding: 28, marginTop: 24 }}>
        <h1>Entrar</h1>
        <p className="muted">{area ? `Acesso à área ${area}.` : 'Use a conta fornecida pela administração.'}</p>
        {user && <Alert kind="info">Você já está conectado como {user.name}.</Alert>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setErr(null);
            try {
              await login(email, password);
              nav(safeBack, { replace: true });
            } catch (e2) {
              setErr(errorMessage(e2));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="E-mail" required>
            {(p) => <input {...p} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Senha" required>
            {(p) => <input {...p} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          {err && <Alert kind="error">{err}</Alert>}
          <Button variant="primary" type="submit" loading={busy} className="btn-block btn-lg" style={{ marginTop: 8 }}>
            Entrar
          </Button>
        </form>
      </div>
      {import.meta.env.DEV && (
        <details className="card muted">
          <summary>Contas de demonstração (somente desenvolvimento, dados fictícios)</summary>
          <p>
            Senha: <code>demo1234</code>
          </p>
          <ul>
            <li>
              <code>admin@demo.banca</code> — administrador
            </li>
            <li>
              <code>ana@demo.banca</code> — professora primária e avaliadora
            </li>
            <li>
              <code>bruno@demo.banca</code>, <code>carla@demo.banca</code>, <code>daniel@demo.banca</code>, <code>elisa@demo.banca</code>, <code>fabio@demo.banca</code> —
              avaliadores
            </li>
            <li>
              <code>telao@demo.banca</code> — visualização do cronômetro
            </li>
          </ul>
        </details>
      )}
    </div>
  );
}
