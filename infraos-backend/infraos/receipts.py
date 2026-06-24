import hashlib
import json
import secrets
import string
import time

from . import db
from .models import VMRunResult

CODE_ALPHABET = string.digits


def new_receipt_code() -> str:
    for _ in range(20):
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(15))
        if not db.get_run_receipt(code):
            return code
    raise RuntimeError("could not allocate unique receipt code")


def create_run_receipt(
    result: VMRunResult,
    user: dict,
    *,
    object_id: str | None = None,
    file_path: str | None = None,
) -> dict:
    code = new_receipt_code()
    status = "Pass" if result.ok else "Failure"
    authorized_by = user.get("username") or "unknown"
    receipt_text = f"{code}{status}{authorized_by}AIF"
    created_at = time.time()
    payload = {
        "code": code,
        "status": status,
        "authorized_by": authorized_by,
        "authorized_user_id": user.get("id"),
        "object_id": object_id or "",
        "file_path": file_path or "",
        "stdout_sha256": hashlib.sha256(result.stdout.encode("utf-8")).hexdigest(),
        "stderr_sha256": hashlib.sha256(result.stderr.encode("utf-8")).hexdigest(),
        "created_at": created_at,
        "receipt_text": receipt_text,
    }
    receipt_hash = hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    receipt = {
        **payload,
        "receipt_hash": receipt_hash,
        "stdout": result.stdout[-4000:],
        "stderr": result.stderr[-4000:],
    }
    db.insert_run_receipt(receipt)
    result.receipt_code = code
    result.receipt_hash = receipt_hash
    result.receipt_text = receipt_text
    return receipt


def list_receipts(limit: int = 200, query: str = "") -> list[dict]:
    return db.list_run_receipts(limit=limit, query=query.strip())


def get_receipt(code: str) -> dict | None:
    return db.get_run_receipt(code)
