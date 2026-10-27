@echo off
REM Inicializa o Sistema de Gestao de Bancas.
REM
REM Uso:
REM   start.bat          instala dependencias (se faltar), gera o frontend (se faltar) e sobe em http://127.0.0.1:3000
REM   start.bat build    igual ao anterior, mas sempre refaz o build do frontend
REM   start.bat dev      modo desenvolvimento: backend :3000 + Vite :5173 com recarga automatica
REM   start.bat portas   mostra as portas abertas
REM   start.bat parar    encerra o que estiver usando a porta do sistema
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

set "MODE=%~1"
if "%MODE%"=="" set "MODE=start"

if /i "%MODE%"=="start" goto :read_env
if /i "%MODE%"=="build" goto :read_env
if /i "%MODE%"=="dev" goto :read_env
if /i "%MODE%"=="portas" goto :show_ports
if /i "%MODE%"=="parar" goto :read_env
echo Opcao desconhecida: %MODE% (use: start, build, dev, portas ou parar)
exit /b 1

:show_ports
echo.
echo Portas abertas neste computador (porta local / PID):
for /f "tokens=2,5" %%A in ('netstat -ano ^| findstr LISTENING') do echo   %%A   PID %%B
echo.
exit /b 0

:read_env
REM 1. .env
if not exist ".env" (
  echo ^> Criando .env a partir de .env.example
  copy /y ".env.example" ".env" >nul
)
set "PORT_NUM=%PORT%"
if not defined PORT_NUM for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"PORT=" .env') do set "PORT_NUM=%%B"
if not defined PORT_NUM set "PORT_NUM=3000"
REM Banco do ambiente: DATABASE_URL_<AMBIENTE> (vazio = PGlite, que só um processo abre por vez).
set "AMB=%AMBIENTE%"
if not defined AMB for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"AMBIENTE=" .env') do set "AMB=%%B"
set "DB_URL="
if defined AMB call set "DB_URL=%%DATABASE_URL_%AMB%%%"
if not defined DB_URL if defined AMB for /f "tokens=1,* delims==" %%A in ('findstr /b /c:"DATABASE_URL_%AMB%=" .env') do set "DB_URL=%%B"

if /i "%MODE%"=="parar" (
  call :port_pid %PORT_NUM%
  if not defined FOUND_PID (
    echo Nada rodando na porta %PORT_NUM%.
    exit /b 0
  )
  call :stop_pid
  exit /b 0
)

REM 2. Node.js >= 20.19
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Instale o Node.js 20.19 ou superior: https://nodejs.org
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=19)?0:1)"
if errorlevel 1 (
  echo Node.js antigo. Este projeto exige 20.19 ou superior.
  node -v
  pause
  exit /b 1
)

REM 3. Porta ocupada? Mostra quem esta nela e pergunta o que fazer.
call :port_pid %PORT_NUM%
if not defined FOUND_PID goto :port_ok
set "PNAME=?"
for /f "tokens=1 delims=," %%N in ('tasklist /fi "PID eq %FOUND_PID%" /fo csv /nh') do set "PNAME=%%~N"
call :next_free %PORT_NUM%
echo.
echo A porta %PORT_NUM% esta em uso por %PNAME% (PID %FOUND_PID%).
if /i not "%PNAME%"=="node.exe" goto :menu_other
if defined DB_URL goto :menu_other

REM Provavelmente o proprio sistema: com o banco embutido (PGlite) nao pode haver dois servidores.
echo Provavelmente e o proprio sistema ja aberto (talvez uma versao antiga).
echo O banco embutido (PGlite) nao pode ser aberto por dois servidores, por isso nao ha opcao de outra porta.
echo Dica: o jeito mais seguro e fechar a outra janela com Ctrl+C.
echo.
echo   1) Encerrar o que esta rodando e iniciar de novo (recomendado)
echo   2) Manter o que esta rodando e so abrir no navegador
echo   0) Cancelar
choice /c 120 /n /m "Escolha [1, 2 ou 0]: "
if errorlevel 3 goto :cancel
if errorlevel 2 (
  start "" "http://127.0.0.1:%PORT_NUM%"
  exit /b 0
)
call :stop_pid
goto :port_ok

:menu_other
echo.
echo   1) Iniciar o sistema na porta livre %NEXT_FREE% (recomendado)
echo   2) Encerrar %PNAME% e iniciar na porta %PORT_NUM%
echo   0) Cancelar
choice /c 120 /n /m "Escolha [1, 2 ou 0]: "
if errorlevel 3 goto :cancel
if errorlevel 2 (
  call :stop_pid
  goto :port_ok
)
set "PORT_NUM=%NEXT_FREE%"

:port_ok
REM A porta escolhida vale para esta execucao (o .env nao e alterado).
set "PORT=%PORT_NUM%"
set "BACKEND_URL=http://127.0.0.1:%PORT_NUM%"

REM 4. Dependencias
if not exist "node_modules\" (
  echo ^> Instalando dependencias (npm install^)
  call npm install
  if errorlevel 1 goto :fail
)

REM 5. Execucao
if /i "%MODE%"=="dev" (
  echo ^> Modo desenvolvimento: abra http://localhost:5173 (backend na porta %PORT_NUM%^)
  call npm run dev
  goto :end
)

set "NEED_BUILD="
if /i "%MODE%"=="build" set "NEED_BUILD=1"
if not exist "web\dist\index.html" set "NEED_BUILD=1"
if defined NEED_BUILD (
  echo ^> Gerando o frontend (web\dist^)
  call npm run build -w web
  if errorlevel 1 goto :fail
)

echo ^> Iniciando o servidor em http://127.0.0.1:%PORT_NUM%
call npm run start
goto :end

REM ---------- Sub-rotinas ----------

REM PID que escuta na porta %1 (vazio se livre) em FOUND_PID.
:port_pid
set "FOUND_PID="
for /f "tokens=2,5" %%A in ('netstat -ano ^| findstr LISTENING') do (
  echo %%A| findstr /r /c:":%~1$" >nul && set "FOUND_PID=%%B"
)
exit /b 0

REM Primeira porta livre depois de %1 em NEXT_FREE.
:next_free
set /a NEXT_FREE=%~1+1
:next_free_loop
call :port_pid %NEXT_FREE%
if defined FOUND_PID (
  set /a NEXT_FREE+=1
  goto :next_free_loop
)
call :port_pid %PORT_NUM%
exit /b 0

REM Encerra FOUND_PID e os processos filhos.
:stop_pid
echo ^> Encerrando o processo %FOUND_PID%...
taskkill /PID %FOUND_PID% /T /F >nul 2>&1
timeout /t 2 /nobreak >nul
exit /b 0

:cancel
echo Cancelado.
exit /b 0

:fail
echo.
echo Falha na inicializacao. Veja as mensagens acima.
pause
exit /b 1

:end
endlocal
