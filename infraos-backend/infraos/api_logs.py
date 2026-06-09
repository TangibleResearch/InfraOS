from fastapi import APIRouter
from .db import get_logs

router = APIRouter(prefix="/api/logs", tags=["logs"])


@router.get("")
def logs():
    return get_logs()
