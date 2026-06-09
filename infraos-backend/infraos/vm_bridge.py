from pathlib import Path
import re
import subprocess
import tempfile

from .config import COMPILER_BIN, INFRAVM_BIN, OBJECTS_DIR
from .models import CompileRequest, CompileResult, VMRunResult
from .registry import load_registry, get_start_object


def safe_name(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip("-")
    return cleaned or "workspace"


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
    cmd = [str(INFRAVM_BIN), file_path]
    if object_id:
        cmd.append(object_id)
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
    objects = load_registry()
    obj = next((item for item in objects if item.object_id == object_id), None)
    if not obj or not obj.file_path:
        return VMRunResult(ok=False, stderr=f"object not found: {object_id}")
    return run_vm(obj.file_path, object_id)
