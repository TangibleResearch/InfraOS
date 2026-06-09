#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
RUN_DIR="$ROOT_DIR/.infraos"
LOG_DIR="$RUN_DIR/logs"
BACKEND_PID="$RUN_DIR/backend.pid"
UI_PID="$RUN_DIR/ui.pid"
BACKEND_URL="${INFRAOS_BACKEND_URL:-http://127.0.0.1:8000}"
UI_URL="${INFRAOS_UI_URL:-http://127.0.0.1:5173}"
BACKEND_PORT="${INFRAOS_BACKEND_PORT:-8000}"
UI_PORT="${INFRAOS_UI_PORT:-5173}"

mkdir -p "$RUN_DIR" "$LOG_DIR" "$ROOT_DIR/data/objects"

usage() {
  cat <<'EOF'
InfraOS developer shell

Common:
  start              Build, then start backend and UI in background
  stop               Stop background backend and UI
  restart            Stop, then start
  status             Show services, tools, keys, and object count
  open               Open backend/UI URLs when supported
  logs [backend|ui]  Tail service logs
  doctor             Check local tools and provider key status
  init               Create runtime dirs, SQLite DB, and default admin if missing

Build/run:
  build              Build optimizer, compiler, InfraVM, and UI
  compile [src out]  Compile AInfra to AIF
  run [aif id]       Run InfraVM start object or object id
  demo               Build, compile local stub, and run it
  providers          Compile and run multi-provider stub example

Dev:
  backend            Run backend in foreground
  ui                 Run UI in foreground
  shell              Build and open the C interactive shell
  health             Query backend health
  objects            Query backend object registry
  clean              Remove generated runtime artifacts

Examples:
  shell/infraos.sh start
  shell/infraos.sh demo
  shell/infraos.sh compile examples/hello.ainfra data/objects/hello.aif
  shell/infraos.sh run data/objects/hello.aif run:1
EOF
}

have() {
  command -v "$1" >/dev/null 2>&1
}

pid_alive() {
  test -f "$1" || return 1
  pid="$(cat "$1" 2>/dev/null || true)"
  test -n "$pid" || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

listener_pids() {
  port="$1"
  if have lsof; then
    lsof -ti "TCP:$port" -sTCP:LISTEN 2>/dev/null || true
  fi
}

port_busy() {
  test -n "$(listener_pids "$1")"
}

say_status() {
  if pid_alive "$1"; then
    echo "$2: running pid $(cat "$1")"
  else
    echo "$2: stopped"
  fi
}

say_port_status() {
  port="$1"
  name="$2"
  pids="$(listener_pids "$port" | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if [ -n "$pids" ]; then
    echo "$name port $port: listening pid(s) $pids"
  else
    echo "$name port $port: free"
  fi
}

ensure_backend_venv() {
  if [ ! -x "$ROOT_DIR/infraos-backend/.venv/bin/uvicorn" ]; then
    echo "Creating backend venv and installing requirements..."
    python3 -m venv "$ROOT_DIR/infraos-backend/.venv"
    "$ROOT_DIR/infraos-backend/.venv/bin/pip" install -r "$ROOT_DIR/infraos-backend/requirements.txt"
  fi
}

ensure_runtime_state() {
  mkdir -p "$RUN_DIR" "$LOG_DIR" "$ROOT_DIR/data/objects"
  ensure_backend_venv
  PYTHONPATH="$ROOT_DIR/infraos-backend" "$ROOT_DIR/infraos-backend/.venv/bin/python" -c 'from infraos.boot import boot; boot(); print("runtime state: ok")' \
    >/dev/null 2>&1 || {
      echo "runtime state failed: could not initialize SQLite/admin defaults"
      return 1
    }
}

build_all() {
  cargo build --manifest-path "$ROOT_DIR/optimizer/rust/Cargo.toml"
  cargo build --manifest-path "$ROOT_DIR/ainfra-compiler/Cargo.toml"
  make -C "$ROOT_DIR/infravm"
  if have npm; then
    (cd "$ROOT_DIR/infraos-ui" && npm install && npm run build)
  else
    echo "npm missing: skipping UI build"
  fi
}

compile_aif() {
  src="${1:-$ROOT_DIR/examples/local-stub.ainfra}"
  out="${2:-$ROOT_DIR/data/objects/local-stub.aif}"
  "$ROOT_DIR/ainfra-compiler/target/debug/ainfra-compiler" "$src" -o "$out"
}

run_aif() {
  aif="${1:-$ROOT_DIR/data/objects/local-stub.aif}"
  if [ "${2:-}" ]; then
    "$ROOT_DIR/infravm/infravm" "$aif" "$2"
  else
    "$ROOT_DIR/infravm/infravm" "$aif"
  fi
}

start_backend_bg() {
  if pid_alive "$BACKEND_PID"; then
    echo "backend already running"
    return
  fi
  if port_busy "$BACKEND_PORT"; then
    echo "backend port $BACKEND_PORT is occupied by stale process(es): $(listener_pids "$BACKEND_PORT" | tr '\n' ' ')"
    stop_port "$BACKEND_PORT" "backend"
  fi
  ensure_runtime_state
  test -n "${OPENAI_API_KEY:-}" && echo "OPENAI_API_KEY will be passed to backend" || echo "OPENAI_API_KEY is not set in this shell"
  echo "starting backend -> $BACKEND_URL"
  (
    cd "$ROOT_DIR/infraos-backend"
    exec .venv/bin/uvicorn main:app --host 127.0.0.1 --port "$BACKEND_PORT"
  ) >"$LOG_DIR/backend.log" 2>&1 &
  echo "$!" > "$BACKEND_PID"
}

start_ui_bg() {
  if pid_alive "$UI_PID"; then
    echo "ui already running"
    return
  fi
  if ! have npm; then
    echo "npm missing: cannot start UI"
    return 1
  fi
  if port_busy "$UI_PORT"; then
    echo "ui port $UI_PORT is occupied by stale process(es): $(listener_pids "$UI_PORT" | tr '\n' ' ')"
    stop_port "$UI_PORT" "ui"
  fi
  echo "starting ui -> $UI_URL"
  (
    cd "$ROOT_DIR/infraos-ui"
    npm install >/dev/null 2>&1
    exec npm run dev -- --host 127.0.0.1
  ) >"$LOG_DIR/ui.log" 2>&1 &
  echo "$!" > "$UI_PID"
}

stop_pid() {
  file="$1"
  name="$2"
  if pid_alive "$file"; then
    pid="$(cat "$file")"
    echo "stopping $name pid $pid"
    kill "$pid" >/dev/null 2>&1 || true
    sleep 0.2
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "force stopping $name pid $pid"
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  fi
  rm -f "$file"
}

stop_port() {
  port="$1"
  name="$2"
  pids="$(listener_pids "$port" | tr '\n' ' ')"
  for pid in $pids; do
    echo "stopping stale $name listener pid $pid on port $port"
    kill "$pid" >/dev/null 2>&1 || true
  done
  sleep 0.2
  for pid in $pids; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "force stopping stale $name listener pid $pid on port $port"
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done
}

open_url() {
  if have open; then
    open "$1" >/dev/null 2>&1 || echo "$1"
  else
    echo "$1"
  fi
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  start)
    build_all
    start_backend_bg
    start_ui_bg || true
    "$0" status
    ;;
  stop)
    stop_pid "$UI_PID" "ui"
    stop_pid "$BACKEND_PID" "backend"
    stop_port "$UI_PORT" "ui"
    stop_port "$BACKEND_PORT" "backend"
    ;;
  restart)
    "$0" stop
    "$0" start
    ;;
  status)
    say_status "$BACKEND_PID" "backend"
    say_status "$UI_PID" "ui"
    say_port_status "$BACKEND_PORT" "backend"
    say_port_status "$UI_PORT" "ui"
    echo "backend url: $BACKEND_URL"
    echo "ui url: $UI_URL"
    if have curl && pid_alive "$BACKEND_PID"; then
      curl -fsS "$BACKEND_URL/api/health" 2>/dev/null || true
      echo
    fi
    ;;
  open)
    open_url "$UI_URL"
    open_url "$BACKEND_URL/docs"
    ;;
  logs)
    which_log="${1:-backend}"
    case "$which_log" in
      backend) tail -n 80 -f "$LOG_DIR/backend.log" ;;
      ui) tail -n 80 -f "$LOG_DIR/ui.log" ;;
      *) echo "Usage: logs [backend|ui]"; exit 2 ;;
    esac
    ;;
  doctor)
    have cargo && echo "cargo: ok" || echo "cargo: missing"
    have cc && echo "cc: ok" || echo "cc: missing"
    have python3 && echo "python3: ok" || echo "python3: missing"
    have npm && echo "npm: ok" || echo "npm: missing"
    have curl && echo "curl: ok" || echo "curl: missing"
    test -n "${OPENAI_API_KEY:-}" && echo "OPENAI_API_KEY: set" || echo "OPENAI_API_KEY: missing"
    test -n "${ANTHROPIC_API_KEY:-}" && echo "ANTHROPIC_API_KEY: set" || echo "ANTHROPIC_API_KEY: missing"
    test -n "${GEMINI_API_KEY:-}${GOOGLE_API_KEY:-}" && echo "GEMINI/GOOGLE key: set" || echo "GEMINI/GOOGLE key: missing"
    test -n "${AZURE_OPENAI_API_KEY:-}${MICROSOFT_API_KEY:-}" && echo "MICROSOFT/AZURE key: set" || echo "MICROSOFT/AZURE key: missing"
    test -n "${DEEPSEEK_API_KEY:-}" && echo "DEEPSEEK_API_KEY: set" || echo "DEEPSEEK_API_KEY: missing"
    test -n "${HUGGINGFACE_API_KEY:-}${HF_TOKEN:-}" && echo "HUGGINGFACE/HF key: set" || echo "HUGGINGFACE/HF key: missing"
    ;;
  init)
    ensure_runtime_state
    echo "SQLite DB: $ROOT_DIR/data/infraos.sqlite3"
    echo "Default admin: admin / admin"
    ;;
  build)
    build_all
    ;;
  compile)
    compile_aif "${1:-}" "${2:-}"
    ;;
  run)
    run_aif "${1:-}" "${2:-}"
    ;;
  demo)
    build_all
    compile_aif "$ROOT_DIR/examples/local-stub.ainfra" "$ROOT_DIR/data/objects/local-stub.aif"
    run_aif "$ROOT_DIR/data/objects/local-stub.aif"
    ;;
  providers)
    build_all
    compile_aif "$ROOT_DIR/examples/multi-provider.ainfra" "$ROOT_DIR/data/objects/multi-provider.aif"
    run_aif "$ROOT_DIR/data/objects/multi-provider.aif"
    ;;
  backend)
    ensure_runtime_state
    stop_port "$BACKEND_PORT" "backend"
    test -n "${OPENAI_API_KEY:-}" && echo "OPENAI_API_KEY will be passed to backend" || echo "OPENAI_API_KEY is not set in this shell"
    cd "$ROOT_DIR/infraos-backend"
    .venv/bin/uvicorn main:app --reload --port "$BACKEND_PORT"
    ;;
  ui)
    cd "$ROOT_DIR/infraos-ui"
    npm install
    npm run dev
    ;;
  shell)
    cc -std=c11 -Wall -Wextra -Wpedantic -O2 -o "$RUN_DIR/infra-shell" "$ROOT_DIR/shell/shell.c" -lcurl
    "$RUN_DIR/infra-shell"
    ;;
  health)
    curl -fsS "$BACKEND_URL/api/health"
    echo
    ;;
  objects)
    curl -fsS "$BACKEND_URL/api/objects"
    echo
    ;;
  clean)
    "$0" stop
    rm -f "$ROOT_DIR"/data/objects/*.aif "$ROOT_DIR/infravm/infravm" "$RUN_DIR/infra-shell"
    rm -f "$LOG_DIR"/*.log
    ;;
  help|--help|-h)
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
