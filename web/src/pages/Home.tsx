import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth.tsx';
import { IconArrowRight, IconClipboard, IconClock, IconSliders } from '../components/icons.tsx';

interface Access {
  to: string;
  title: string;
  text: string;
  audience: string;
  icon: ReactNode;
  needsLogin: boolean;
}

const ACCESSES: Access[] = [
  {
    to: '/cronometro',
    title: 'Cronômetro',
    text: 'Tela de projeção com o tempo da apresentação, sincronizada para toda a sala.',
    audience: 'Telão da sala',
    icon: <IconClock size={28} />,
    needsLogin: false,
  },
  {
    to: '/professor',
    title: 'Professor',
    text: 'Avaliar os grupos do dia e, para o professor primário, conduzir o tempo e fechar as avaliações.',
    audience: 'Professores',
    icon: <IconClipboard size={28} />,
    needsLogin: true,
  },
  {
    to: '/configuracao',
    title: 'Configuração',
    text: 'Preparar bancas, dias, grupos, rubricas e professores; acompanhar e emitir os resultados.',
    audience: 'Administração',
    icon: <IconSliders size={28} />,
    needsLogin: true,
  },
];

/** Tela inicial: apenas os três acessos. Cada cartão leva direto à área (ou ao login, quando exigido). */
export function HomePage() {
  const { user } = useAuth();
  const suggested = user ? (user.role === 'admin' ? '/configuracao' : user.role === 'viewer' ? '/cronometro' : '/professor') : null;
  return (
    <div className="home">
      <div className="home-hero">
        <h1>Gestão de Bancas</h1>
        <p>Escolha o acesso.</p>
      </div>
      <nav aria-label="Acessos" className="home-grid">
        {ACCESSES.map((a) => {
          const href = a.needsLogin && !user ? `/login?voltar=${encodeURIComponent(a.to)}` : a.to;
          return (
            <Link key={a.to} to={href} className={`home-card ${suggested === a.to ? 'is-suggested' : ''}`}>
              <span className="home-icon">{a.icon}</span>
              <h2>{a.title}</h2>
              <p>{a.text}</p>
              <span className="home-card-foot">
                <span>{a.audience}</span>
                <strong className="row" style={{ gap: 4 }}>
                  {a.needsLogin && !user ? 'Entrar' : 'Abrir'} <IconArrowRight size={16} />
                </strong>
              </span>
            </Link>
          );
        })}
      </nav>
      {user && <p className="home-note">Conectado como {user.name}.</p>}
    </div>
  );
}
