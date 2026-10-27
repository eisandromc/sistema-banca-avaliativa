#!/usr/bin/env bash
# Inicializa o Sistema de Gestão de Bancas no macOS (equivalente ao start.bat do Windows).
#
#   Finder:   dois cliques neste arquivo (abre no Terminal).
#   Terminal: ./start.command [build | dev | portas | parar]
#
# Se a porta já estiver em uso, mostra quem a ocupa e pergunta: encerrar e reiniciar,
# usar outra porta (quando possível) ou cancelar. A lógica fica no start.sh.
cd "$(dirname "$0")" || exit 1

# Aberto sem terminal (por outro app, sem janela): reabre no Terminal com os mesmos argumentos.
if { [ ! -t 0 ] || [ ! -t 1 ]; } && [ -z "${BANCA_NO_RELAUNCH:-}" ] && command -v osascript >/dev/null 2>&1; then
  cmd="cd $(printf '%q' "$PWD") && ./start.command$(printf ' %q' "$@")"
  osascript \
    -e 'on run argv' \
    -e 'tell application "Terminal"' \
    -e 'do script (item 1 of argv)' \
    -e 'activate' \
    -e 'end tell' \
    -e 'end run' \
    "$cmd" >/dev/null
  exit 0
fi

# Garante que o Node seja encontrado mesmo se instalado via Homebrew ou nvm.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

# Ctrl+C encerra o servidor; este script continua para mostrar a mensagem final.
trap ':' INT
bash ./start.sh "$@"
status=$?
trap - INT

case $status in
  0) ;;
  130 | 143) echo; echo "Sistema encerrado." ;; # Ctrl+C ou pedido de encerramento
  *)
    echo
    echo "A inicialização falhou (código $status). Veja as mensagens acima."
    read -r -p "Pressione Enter para fechar..." </dev/tty 2>/dev/null || true
    ;;
esac
exit $status
