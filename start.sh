#!/usr/bin/env bash
# Inicializa o Sistema de Gestão de Bancas.
#
# Uso:
#   ./start.sh          instala dependências (se faltar), gera o frontend (se faltar) e sobe em http://127.0.0.1:3000
#   ./start.sh build    igual ao anterior, mas sempre refaz o build do frontend
#   ./start.sh dev      modo desenvolvimento: backend :3000 + Vite :5173 com recarga automática
#   ./start.sh portas   mostra as portas abertas e se o sistema já está rodando
#   ./start.sh parar    encerra o sistema que estiver rodando
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd -P)"

MODE="${1:-start}"

case "$MODE" in
  start|build|dev|portas|parar) ;;
  -h|--help|help)
    sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *)
    echo "Opção desconhecida: $MODE (use: start, build, dev, portas ou parar)" >&2
    exit 1
    ;;
esac

# ---------- Portas e processos ----------

# Valor de uma chave do .env (ou vazio).
env_value() {
  [ -f .env ] || return 0
  sed -n "s/^$1=\(.*\)$/\1/p" .env | tail -1 | tr -d '"'"'"'\r'
}

# PIDs escutando numa porta TCP.
port_pids() {
  lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

# Nome curto do programa de um PID.
pid_name() {
  ps -o comm= -p "$1" 2>/dev/null | sed 's#.*/##' || true
}

# Processos do servidor DESTE sistema (tsx/node rodando src/index.ts com a pasta server/ como diretório atual).
app_pids() {
  local pid cwd
  for pid in $(pgrep -f 'src/index\.ts' 2>/dev/null || true); do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    [ "$cwd" = "$ROOT/server" ] && echo "$pid"
  done
  return 0
}

# Portas em que os processos informados escutam.
ports_of() {
  local pid
  for pid in "$@"; do
    lsof -nP -a -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 { sub(/.*:/, "", $9); print $9 }'
  done | sort -un
}

# Primeira porta livre a partir de $1.
free_port_from() {
  local p="$1"
  while [ -n "$(port_pids "$p")" ]; do p=$((p + 1)); done
  echo "$p"
}

show_ports() {
  echo
  echo "Portas abertas neste computador (programas do seu usuário):"
  echo "  PORTA   PID     PROGRAMA"
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 { port=$9; sub(/.*:/, "", port); printf "  %-7s %-7s %s\n", port, $2, $1 }' | sed 's/\\x20/ /g' | sort -n -u -k1,1 || true
  local pids
  pids="$(app_pids)"
  if [ -n "$pids" ]; then
    echo
    echo "O Sistema de Bancas JÁ ESTÁ RODANDO (PID $(echo $pids)) na porta $(echo $(ports_of $pids))."
  fi
  echo
}

# Encerra os PIDs (pede com educação; força depois de alguns segundos).
stop_pids() {
  local pids="$*" i
  [ -n "$pids" ] || return 0
  echo "> Encerrando o processo ${pids}..."
  kill $pids 2>/dev/null || true
  for i in $(seq 1 20); do
    local alive=""
    for p in $pids; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done
    [ -z "$alive" ] && return 0
    sleep 0.5
  done
  echo "> O processo não respondeu; forçando o encerramento."
  kill -9 $pids 2>/dev/null || true
  sleep 1
}

# Lê a escolha no teclado. Enter vazio = opção padrão; sem teclado (fim da entrada) = 0 (cancelar), nunca uma ação.
ask() {
  local answer
  if ! read -r -p "$1" answer </dev/tty; then
    echo
    answer=0
  fi
  echo "$answer"
}

if [ "$MODE" = "portas" ]; then
  show_ports
  exit 0
fi

if [ "$MODE" = "parar" ]; then
  PIDS="$(app_pids)"
  if [ -z "$PIDS" ]; then
    echo "O sistema não está rodando."
  else
    stop_pids $PIDS
    echo "Sistema encerrado."
  fi
  exit 0
fi

# ---------- Pré-requisitos ----------

# 1. Node.js >= 20.19
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale o Node.js 20.19 ou superior: https://nodejs.org" >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)'; then
  echo "Node.js $(node -v) é antigo. Este projeto exige 20.19 ou superior." >&2
  exit 1
fi

# 2. .env
if [ ! -f .env ]; then
  echo "> Criando .env a partir de .env.example"
  cp .env.example .env
fi

# 3. Portas: sistema já aberto ou porta ocupada por outro programa.
PORT_NUM="${PORT:-$(env_value PORT)}"
PORT_NUM="${PORT_NUM:-3000}"
HOST_NAME="$(env_value HOST)"
HOST_NAME="${HOST_NAME:-127.0.0.1}"
# Com PGlite (DATABASE_URL_<AMBIENTE> vazio) o banco é uma pasta que só um processo pode abrir por vez.
USES_PGLITE=1
AMBIENTE_NOME="$(printf '%s' "${AMBIENTE:-$(env_value AMBIENTE)}" | tr '[:lower:]' '[:upper:]')"
DB_URL_KEY="DATABASE_URL_$AMBIENTE_NOME"
[ -n "$(printenv "$DB_URL_KEY")$(env_value "$DB_URL_KEY")" ] && USES_PGLITE=0
INTERACTIVE=0
[ -t 0 ] && [ -t 1 ] && INTERACTIVE=1

APP_PIDS="$(app_pids)"
if [ -n "$APP_PIDS" ]; then
  APP_PORTS="$(echo $(ports_of $APP_PIDS))"
  echo
  echo "O Sistema de Bancas já está rodando (PID $(echo $APP_PIDS)) em http://$HOST_NAME:${APP_PORTS:-?}"
  echo "Ele pode ser uma versão antiga: para aplicar atualizações é preciso reiniciá-lo."
  if [ "$INTERACTIVE" = 0 ]; then
    echo "Rode \"./start.sh parar\" e depois \"./start.sh\" de novo." >&2
    exit 1
  fi
  echo
  echo "  1) Encerrar o que está rodando e iniciar de novo (recomendado)"
  if [ "$USES_PGLITE" = 1 ]; then
    echo "  2) Abrir em outra porta — indisponível: o banco embutido (PGlite) não pode ser aberto por dois servidores ao mesmo tempo"
  else
    echo "  2) Abrir mais uma instância em outra porta (porta livre: $(free_port_from $((PORT_NUM + 1))))"
  fi
  echo "  3) Manter o que está rodando e só abrir no navegador"
  echo "  0) Cancelar"
  case "$(ask 'Escolha [1]: ')" in
    ""|1) stop_pids $APP_PIDS ;;
    2)
      if [ "$USES_PGLITE" = 1 ]; then echo "Opção indisponível com o banco embutido." >&2; exit 1; fi
      PORT_NUM="$(free_port_from $((PORT_NUM + 1)))"
      ;;
    3)
      open "http://$HOST_NAME:${APP_PORTS%% *}" 2>/dev/null || true
      exit 0
      ;;
    *) echo "Cancelado."; exit 0 ;;
  esac
fi

OTHER_PIDS="$(port_pids "$PORT_NUM")"
if [ -n "$OTHER_PIDS" ]; then
  NEXT_FREE="$(free_port_from $((PORT_NUM + 1)))"
  echo
  echo "A porta $PORT_NUM está ocupada por outro programa: $(for p in $OTHER_PIDS; do printf '%s (PID %s) ' "$(pid_name "$p")" "$p"; done)"
  if [ "$INTERACTIVE" = 0 ]; then
    echo "Libere a porta ou defina outra em .env (PORT=$NEXT_FREE)." >&2
    exit 1
  fi
  echo
  echo "  1) Iniciar o sistema na porta livre $NEXT_FREE (recomendado)"
  echo "  2) Encerrar o programa que ocupa a porta $PORT_NUM e iniciar nela"
  echo "  0) Cancelar"
  case "$(ask 'Escolha [1]: ')" in
    ""|1) PORT_NUM="$NEXT_FREE" ;;
    2) stop_pids $OTHER_PIDS ;;
    *) echo "Cancelado."; exit 0 ;;
  esac
fi

# A porta escolhida vale para esta execução (o .env não é alterado).
export PORT="$PORT_NUM"
export BACKEND_URL="http://127.0.0.1:$PORT_NUM"

# 4. Dependências (instala se faltarem ou se o package-lock.json mudou)
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "> Instalando dependências (npm install)"
  npm install
fi

# 5. Execução
if [ "$MODE" = "dev" ]; then
  echo "> Modo desenvolvimento: abra http://localhost:5173 (backend na porta $PORT_NUM)"
  exec npm run dev
fi

if [ "$MODE" = "build" ] || [ ! -f web/dist/index.html ]; then
  echo "> Gerando o frontend (web/dist)"
  npm run build -w web
fi

echo "> Iniciando o servidor em http://$HOST_NAME:$PORT_NUM"
exec npm run start
