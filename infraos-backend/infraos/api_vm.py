from fastapi import APIRouter, Depends
from . import auth
from .events import event_bus
from .models import CompileRequest, VMRunRequest
from .receipts import create_run_receipt
from .vm_bridge import compile_source, pointrun, run_start, run_vm

router = APIRouter(prefix="/api", tags=["vm"])


@router.post("/compile")
async def compile_ainfra(request: CompileRequest, user: dict = Depends(auth.require_user)):
    auth.require_privilege(user, "compile")
    result = compile_source(request)
    await event_bus.emit("compile", result.stdout or result.stderr or "compile completed")
    return result


@router.post("/vm/run-start")
async def vm_run_start(user: dict = Depends(auth.require_user)):
    auth.require_privilege(user, "vm:run")
    result = run_start()
    create_run_receipt(result, user, object_id="start")
    await event_bus.emit("vm", result.stdout or result.stderr or "run-start completed")
    return result


@router.post("/vm/pointrun/{object_id:path}")
async def vm_pointrun(object_id: str, user: dict = Depends(auth.require_user)):
    auth.require_privilege(user, "vm:run")
    result = pointrun(object_id)
    create_run_receipt(result, user, object_id=object_id)
    await event_bus.emit("pointrun", result.stdout or result.stderr or f"PointRun {object_id}")
    return result


@router.post("/vm/run-file")
async def vm_run_file(request: VMRunRequest, user: dict = Depends(auth.require_user)):
    auth.require_privilege(user, "vm:run")
    if not request.file_path:
        return {"ok": False, "stdout": "", "stderr": "file_path is required"}
    result = run_vm(request.file_path, request.object_id)
    create_run_receipt(result, user, object_id=request.object_id, file_path=request.file_path)
    await event_bus.emit("vm", result.stdout or result.stderr or f"run file {request.file_path}")
    return result
