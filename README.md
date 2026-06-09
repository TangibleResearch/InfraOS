# InfraOS

InfraOS is the web console and backend control plane for AInfra/InfraVM systems.

It includes:

- FastAPI backend
- Vanilla TypeScript + Vite UI
- SQLite auth
- default local admin bootstrap
- server name support
- account and privilege management
- privilege request notifications
- AInfra IDE
- local Ops Assistant
- object registry APIs
- VM compile/run bridge
- provider key status dashboard

## Requirements

- Git
- Python 3.12+
- Node.js 22+
- npm
- Optional: Rust compiler and InfraVM binary when connected to the full AInfra workspace

### macOS

```sh
brew install python node git
```

### Ubuntu/Debian

```sh
sudo apt-get update
sudo apt-get install -y python3 python3-venv nodejs npm git curl
```

### Windows

Use WSL2 Ubuntu for the simplest path.

## Setup

```sh
git clone https://github.com/TangibleResearch/InfraOS.git
cd InfraOS
shell/infraos.sh init
```

The init command creates runtime folders, initializes SQLite if missing, and creates:

```text
username: admin
password: admin
```

Change the default admin password before exposing the backend beyond localhost.

## Run

```sh
shell/infraos.sh start
```

Open:

```text
http://127.0.0.1:5173
```

Stop:

```sh
shell/infraos.sh stop
```

`InfraOS` can run standalone for dashboard, auth, account management, and UI development. Compile/run actions require the AInfra compiler and InfraVM runtime from the combined `AInfra` repo or compatible local binaries.

## Manual Backend

```sh
cd infraos-backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

## Manual UI

```sh
cd infraos-ui
npm ci
npm run dev
```

## Environment Variables

```sh
export INFRAOS_SERVER_NAME="My VM Server"
export INFRAOS_BACKEND_PORT=8000
export INFRAOS_UI_PORT=5173
export OPENAI_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export GEMINI_API_KEY="..."
export GOOGLE_API_KEY="..."
export AZURE_OPENAI_API_KEY="..."
export MICROSOFT_API_KEY="..."
export DEEPSEEK_API_KEY="..."
export HUGGINGFACE_API_KEY="..."
export HF_TOKEN="..."
```

## CI/CD

GitHub Actions in `.github/workflows/ci.yml` runs:

- backend dependency install
- Python import/compile check
- npm clean install
- TypeScript/Vite UI build

## License

MIT
