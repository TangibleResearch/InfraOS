from pathlib import Path
import re
import subprocess
import tempfile

from fastapi import HTTPException

from .config import COMPILER_BIN, INFRAVM_BIN, OBJECTS_DIR
from .models import CompileRequest, CompileResult, VMRunResult
from .registry import load_registry, get_start_object

OBJECT_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]+$")


def safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip("-")
    return cleaned or "workspace"


def validate_object_id(object_id: str | None) -> str | None:
    if object_id is None or object_id == "":
        return None
    if len(object_id) > 256 or not OBJECT_ID_RE.fullmatch(object_id):
        raise HTTPException(status_code=400, detail="invalid object_id")
    return object_id


def resolve_object_file(file_path: str) -> Path:
    OBJECTS_DIR.mkdir(parents=True, exist_ok=True)
    candidate = Path(file_path)
    if not candidate.is_absolute():
        candidate = OBJECTS_DIR / candidate
    try:
        resolved = candidate.resolve(strict=True)
        object_root = OBJECTS_DIR.resolve(strict=True)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail="AIF file does not exist") from exc
    if object_root != resolved and object_root not in resolved.parents:
        raise HTTPException(status_code=400, detail="AIF file must live under data/objects")
    if resolved.suffix != ".aif":
        raise HTTPException(status_code=400, detail="run-file only accepts .aif files")
    return resolved


def compile_source(request: CompileRequest) -> CompileResult:
    OBJECTS_DIR.mkdir(parents=True, exist_ok=True)
    name = safe_name(request.name)
    with tempfile.TemporaryDirectory() as tmp:
        source_path = Path(tmp) / f"{name}.ainfra"
        output_path = OBJECTS_DIR / f"{name}.aif"
        source_path.write_text(request.source, encoding="utf-8")
        proc = subprocess.run(
            [str(COMPILER_BIN), str(source_path), "-o", str(output_path)],
            text=True,
            capture_output=True,
            cwd=str(COMPILER_BIN.parents[2]),
            timeout=30,
        )
    objects = load_registry() if proc.returncode == 0 else []
    return CompileResult(
        ok=proc.returncode == 0,
        output_path=str(output_path) if proc.returncode == 0 else None,
        stdout=proc.stdout,
        stderr=proc.stderr,
        objects=objects,
    )


def run_vm(file_path: str, object_id: str | None = None) -> VMRunResult:
    resolved_file = resolve_object_file(file_path)
    safe_object_id = validate_object_id(object_id)
    cmd = [str(INFRAVM_BIN), str(resolved_file)]
    if safe_object_id:
        cmd.append(safe_object_id)
    proc = subprocess.run(
        cmd,
        text=True,
        capture_output=True,
        cwd=str(INFRAVM_BIN.parent),
        timeout=120,
    )
    return VMRunResult(ok=proc.returncode == 0, stdout=proc.stdout, stderr=proc.stderr)


def run_start() -> VMRunResult:
    start = get_start_object()
    if not start or not start.file_path:
        return VMRunResult(ok=False, stderr="no start AIF object found")
    return run_vm(start.file_path)


def pointrun(object_id: str) -> VMRunResult:
    validate_object_id(object_id)
    objects = load_registry()
    obj = next((item for item in objects if item.object_id == object_id), None)
    if not obj or not obj.file_path:
        return VMRunResult(ok=False, stderr=f"object not found: {object_id}")
    return run_vm(obj.file_path, object_id)
