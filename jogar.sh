#!/usr/bin/env bash
# Sobe um servidor local e abre o jogo no navegador do Windows.
cd "$(dirname "$0")"
PORT=${PORT:-8000}
python3 -m http.server "$PORT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER' EXIT
sleep 0.5
powershell.exe -Command "Start-Process 'http://localhost:$PORT'" 2>/dev/null || echo "Abra http://localhost:$PORT no navegador"
echo "Servidor rodando em http://localhost:$PORT (Ctrl+C para parar)"
wait $SERVER
