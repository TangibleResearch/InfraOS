from fastapi import APIRouter, Depends, HTTPException, Query

from . import auth
from .receipts import get_receipt, list_receipts

router = APIRouter(prefix="/api/receipts", tags=["receipts"])


@router.get("")
def receipts(
    limit: int = Query(default=200, ge=1, le=500),
    q: str = "",
    user: dict = Depends(auth.require_user),
):
    auth.require_privilege(user, "vm:run")
    return list_receipts(limit=limit, query=q)


@router.get("/{code}")
def receipt(code: str, user: dict = Depends(auth.require_user)):
    auth.require_privilege(user, "vm:run")
    item = get_receipt(code)
    if not item:
        raise HTTPException(status_code=404, detail="receipt not found")
    return item
