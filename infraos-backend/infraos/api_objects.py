from fastapi import APIRouter, Depends, HTTPException
from . import auth
from .registry import get_object, load_registry

router = APIRouter(prefix="/api/objects", tags=["objects"])


@router.get("")
def list_objects(user: dict = Depends(auth.require_user)):
    auth.require_privilege(user, "objects:read")
    return load_registry()


@router.post("/import")
def import_objects(user: dict = Depends(auth.require_user)):
    auth.require_privilege(user, "objects:write")
    return {"ok": True, "objects": load_registry()}


@router.get("/{object_id:path}")
def read_object(object_id: str, user: dict = Depends(auth.require_user)):
    auth.require_privilege(user, "objects:read")
    obj = get_object(object_id)
    if not obj:
        raise HTTPException(status_code=404, detail="object not found")
    return obj
