from fastapi import APIRouter, HTTPException
from .registry import get_object, load_registry

router = APIRouter(prefix="/api/objects", tags=["objects"])


@router.get("")
def list_objects():
    return load_registry()


@router.post("/import")
def import_objects():
    return {"ok": True, "objects": load_registry()}


@router.get("/{object_id:path}")
def read_object(object_id: str):
    obj = get_object(object_id)
    if not obj:
        raise HTTPException(status_code=404, detail="object not found")
    return obj
