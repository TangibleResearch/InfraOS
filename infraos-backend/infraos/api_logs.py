from fastapi import APIRouter, Depends
from . import auth
from .db import get_logs

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("")
def logs(user: dict = Depends(auth.require_user)):
    auth.require_privilege(user, "objects:read")
    return get_logs()
