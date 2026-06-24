from pathlib import Path
import os

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
OBJECTS_DIR = DATA_DIR / "objects"
DB_PATH = DATA_DIR / "infraos.sqlite3"
COMPILER_BIN = ROOT_DIR / "ainfra-compiler" / "target" / "debug" / "ainfra-compiler"
INFRAVM_BIN = ROOT_DIR / "infravm" / "infravm"
AUTOSTART = os.getenv("INFRAOS_AUTOSTART", "0") == "1"
SERVER_NAME = os.getenv("INFRAOS_SERVER_NAME", "InfraOS Local Server")
SESSION_TTL_SECONDS = int(os.getenv("INFRAOS_SESSION_TTL_SECONDS", "43200"))
ALLOW_DEFAULT_ADMIN = os.getenv("INFRAOS_ALLOW_DEFAULT_ADMIN", "0") == "1"
ADMIN_PASSWORD_FILE = DATA_DIR / "admin-password.txt"
PUBLIC_UI_URL = os.getenv("INFRAOS_PUBLIC_UI_URL", "http://localhost:5173")
PUBLIC_BACKEND_URL = os.getenv("INFRAOS_PUBLIC_BACKEND_URL", "http://127.0.0.1:8000")
GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID", "")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")
GITHUB_OAUTH_REDIRECT_URI = os.getenv("GITHUB_OAUTH_REDIRECT_URI", f"{PUBLIC_BACKEND_URL}/api/auth/github/callback")


def cors_origins() -> list[str]:
    raw = os.getenv("INFRAOS_CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def openai_key_available() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def provider_key_status() -> dict[str, bool]:
    return {
        "openai": bool(os.getenv("OPENAI_API_KEY")),
        "anthropic": bool(os.getenv("ANTHROPIC_API_KEY")),
        "gemini": bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")),
        "microsoft": bool(os.getenv("AZURE_OPENAI_API_KEY") or os.getenv("MICROSOFT_API_KEY")),
        "deepseek": bool(os.getenv("DEEPSEEK_API_KEY")),
        "huggingface": bool(os.getenv("HUGGINGFACE_API_KEY") or os.getenv("HF_TOKEN")),
        "ollama": True,
    }


def provider_details() -> dict[str, dict[str, str | bool]]:
    keys = provider_key_status()
    return {
        "openai": {"configured": keys["openai"], "runtime": "live", "message": "HTTPS connector is implemented in InfraVM"},
        "ollama": {"configured": True, "runtime": "live", "message": "Calls local Ollama when available; otherwise uses deterministic local VM output"},
        "anthropic": {"configured": keys["anthropic"], "runtime": "stub", "message": "Key status only; connector is not implemented yet"},
        "gemini": {"configured": keys["gemini"], "runtime": "stub", "message": "Key status only; connector is not implemented yet"},
        "microsoft": {"configured": keys["microsoft"], "runtime": "stub", "message": "Key status only; connector is not implemented yet"},
        "deepseek": {"configured": keys["deepseek"], "runtime": "stub", "message": "Key status only; connector is not implemented yet"},
        "huggingface": {"configured": keys["huggingface"], "runtime": "stub", "message": "Key status only; connector is not implemented yet"},
    }
