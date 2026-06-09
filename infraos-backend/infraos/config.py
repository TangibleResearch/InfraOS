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
