import { useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, ROLE_LABEL } from './lib/auth.tsx';
import { LoginPage } from './pages/Login.tsx';
import { HomePage } from './pages/Home.tsx';
import { CronometroPage } from './pages/Cronometro.tsx';
import { ProfessorPage } from './pages/Professor.tsx';
import { ConfiguracaoPage } from './pages/Configuracao.tsx';
import { Spinner } from './components/ui.tsx';
import { IconClock } from './components/icons.tsx';

const AREA_TITLE: Record<string, string> = { cronometro: 'Cronômetro', professor: 'Professor', configuracao: 'Configuração', login: 'Entrar' };

function initials(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, '')
    .replace(/^(Prof(a)?\.|Dr(a)?\.)\s*/i, '')
    .trim()
    .split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

/** Cabeçalho mínimo: marca (volta à tela inicial), área atual e conta. Sem menu de áreas. */
function TopBar() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  const area = AREA_TITLE[loc.pathname.split('/')[1] ?? ''];
  return (
    <header className="topbar">
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>
      <Link to="/" className="brand" aria-label="Gestão de Bancas — tela inicial">
        <span className="brand-mark" aria-hidden="true">
          <IconClock size={18} />
        </span>
        Gestão de Bancas
      </Link>
      {area && (
        <span className="crumb" aria-current="page">
          {area}
        </span>
      )}
      <div className="topbar-right">
        {user ? (
          <>
            <span className="user-chip" title={user.email}>
              <span className="avatar" aria-hidden="true">
                {initials(user.name)}
              </span>
              <span className="user-chip-text">
                <strong>{user.name}</strong>
                <span>{ROLE_LABEL[user.role]}</span>
              </span>
            </span>
            <button className="btn btn-ghost" onClick={() => void logout()}>
              Sair
            </button>
          </>
        ) : (
          loc.pathname !== '/login' && (
            <Link className="btn" to={`/login?voltar=${encodeURIComponent(loc.pathname + loc.search)}`}>
              Entrar
            </Link>
          )
        )}
      </div>
    </header>
  );
}

export function App() {
  const { loading } = useAuth();
  const loc = useLocation();
  useEffect(() => {
    const key = loc.pathname.split('/')[1] ?? '';
    document.title = `${AREA_TITLE[key] ?? 'Início'} · Gestão de Bancas`;
  }, [loc.pathname]);
  // O telão ocupa a tela inteira, sem cabeçalho.
  const projection = loc.pathname === '/cronometro';

  if (loading) return <Spinner />;
  return (
    <div className="app">
      {!projection && <TopBar />}
      <main id="conteudo" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/cronometro" element={<CronometroPage />} />
          <Route path="/professor" element={<ProfessorPage />} />
          <Route path="/configuracao/*" element={<ConfiguracaoPage />} />
          <Route
            path="*"
            element={
              <div className="page narrow">
                <h1>Página não encontrada</h1>
                <p>
                  <Link to="/">Voltar à tela inicial</Link>
                </p>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
