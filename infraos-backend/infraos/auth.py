import hashlib
import hmac
import secrets
import time
from fastapi import Header, HTTPException

from . import db

ALL_PRIVILEGES = [
    "objects:read",
    "objects:write",
    "vm:run",
    "compile",
    "peers:manage",
    "auth:manage",
    "admin",
]


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"pbkdf2_sha256${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt, digest = stored.split("$", 2)
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    candidate = hash_password(password, salt).split("$", 2)[2]
    return hmac.compare_digest(candidate, digest)


def bootstrap_admin() -> None:
    with db.connect() as conn:
        row = conn.execute("select id from users where username = 'admin'").fetchone()
        if row:
            return
        cur = conn.execute(
            """
            insert into users(username, password_hash, full_name, email, phone, is_admin, created_at)
            values (?, ?, ?, ?, ?, 1, ?)
            """,
            ("admin", hash_password("admin"), "Administrator", "", "", time.time()),
        )
        user_id = int(cur.lastrowid)
        for privilege in ALL_PRIVILEGES:
            conn.execute(
                "insert into user_privileges(user_id, privilege) values (?, ?)",
                (user_id, privilege),
            )


def user_payload(row, privileges: list[str]) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "full_name": row["full_name"] or "",
        "phone": row["phone"] or "",
        "email": row["email"] or "",
        "is_admin": bool(row["is_admin"]),
        "privileges": privileges,
    }


def get_privileges(conn, user_id: int) -> list[str]:
    rows = conn.execute(
        "select privilege from user_privileges where user_id = ? order by privilege",
        (user_id,),
    ).fetchall()
    return [row["privilege"] for row in rows]


def add_notification(conn, user_id: int, kind: str, message: str) -> None:
    conn.execute(
        "insert into notifications(user_id, kind, message, created_at) values (?, ?, ?, ?)",
        (user_id, kind, message, time.time()),
    )


def login(username: str, password: str) -> dict:
    bootstrap_admin()
    with db.connect() as conn:
        row = conn.execute("select * from users where username = ?", (username,)).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="invalid username or password")
        token = secrets.token_urlsafe(32)
        conn.execute(
            "insert into sessions(token, user_id, created_at) values (?, ?, ?)",
            (token, row["id"], time.time()),
        )
        return {"token": token, "user": user_payload(row, get_privileges(conn, row["id"]))}


def logout(token: str) -> None:
    with db.connect() as conn:
        conn.execute("delete from sessions where token = ?", (token,))


def current_user_from_token(token: str | None) -> dict:
    bootstrap_admin()
    if not token:
        raise HTTPException(status_code=401, detail="missing auth token")
    with db.connect() as conn:
        row = conn.execute(
            """
            select users.* from sessions
            join users on users.id = sessions.user_id
            where sessions.token = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="invalid auth token")
        return user_payload(row, get_privileges(conn, row["id"]))


def require_user(authorization: str | None = Header(default=None)) -> dict:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    return current_user_from_token(token)


def require_admin(user: dict) -> None:
    if not user.get("is_admin") and "admin" not in user.get("privileges", []):
        raise HTTPException(status_code=403, detail="admin privilege required")


def list_users() -> list[dict]:
    bootstrap_admin()
    with db.connect() as conn:
        rows = conn.execute("select * from users order by username").fetchall()
        return [user_payload(row, get_privileges(conn, row["id"])) for row in rows]


def create_user(username: str, password: str, full_name: str = "", phone: str = "", email: str = "", is_admin: bool = False, privileges: list[str] | None = None) -> dict:
    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password are required")
    privileges = privileges or []
    if is_admin:
        privileges = sorted(set(privileges + ["admin", "auth:manage"]))
    with db.connect() as conn:
        try:
            cur = conn.execute(
                """
                insert into users(username, password_hash, full_name, phone, email, is_admin, created_at)
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                (username, hash_password(password), full_name, phone, email, int(is_admin), time.time()),
            )
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"could not create user: {exc}") from exc
        user_id = int(cur.lastrowid)
        for privilege in sorted(set(privileges)):
            if privilege in ALL_PRIVILEGES:
                conn.execute("insert into user_privileges(user_id, privilege) values (?, ?)", (user_id, privilege))
        row = conn.execute("select * from users where id = ?", (user_id,)).fetchone()
        return user_payload(row, get_privileges(conn, user_id))


def delete_user(user_id: int) -> None:
    with db.connect() as conn:
        row = conn.execute("select username from users where id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="user not found")
        if row["username"] == "admin":
            raise HTTPException(status_code=400, detail="default admin cannot be removed")
        conn.execute("delete from users where id = ?", (user_id,))


def set_privilege(user_id: int, privilege: str, enabled: bool) -> None:
    if privilege not in ALL_PRIVILEGES:
        raise HTTPException(status_code=400, detail="unknown privilege")
    with db.connect() as conn:
        row = conn.execute("select id from users where id = ?", (user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="user not found")
        if enabled:
            conn.execute(
                "insert or ignore into user_privileges(user_id, privilege) values (?, ?)",
                (user_id, privilege),
            )
        else:
            conn.execute(
                "delete from user_privileges where user_id = ? and privilege = ?",
                (user_id, privilege),
            )
        add_notification(
            conn,
            user_id,
            "privilege_changed",
            f"Admin {'granted' if enabled else 'revoked'} privilege {privilege}",
        )


def request_privilege(user: dict, privilege: str, reason: str = "") -> dict:
    if privilege not in ALL_PRIVILEGES:
        raise HTTPException(status_code=400, detail="unknown privilege")
    if privilege in user.get("privileges", []):
        raise HTTPException(status_code=400, detail="user already has privilege")
    with db.connect() as conn:
        cur = conn.execute(
            """
            insert into privilege_requests(user_id, privilege, reason, created_at)
            values (?, ?, ?, ?)
            """,
            (user["id"], privilege, reason, time.time()),
        )
        admins = conn.execute("select id from users where is_admin = 1").fetchall()
        for admin in admins:
            add_notification(
                conn,
                admin["id"],
                "privilege_request",
                f"{user['username']} wants to have privilege {privilege}",
            )
        return {"id": int(cur.lastrowid), "privilege": privilege, "status": "pending"}


def list_requests(include_all: bool = True, user_id: int | None = None) -> list[dict]:
    with db.connect() as conn:
        if include_all:
            rows = conn.execute(
                """
                select privilege_requests.*, users.username, resolver.username as resolver_username
                from privilege_requests
                join users on users.id = privilege_requests.user_id
                left join users as resolver on resolver.id = privilege_requests.resolved_by
                order by privilege_requests.created_at desc
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                select privilege_requests.*, users.username, resolver.username as resolver_username
                from privilege_requests
                join users on users.id = privilege_requests.user_id
                left join users as resolver on resolver.id = privilege_requests.resolved_by
                where user_id = ?
                order by privilege_requests.created_at desc
                """,
                (user_id,),
            ).fetchall()
        return [dict(row) for row in rows]


def resolve_request(request_id: int, approve: bool, resolver: dict) -> dict:
    with db.connect() as conn:
        row = conn.execute(
            """
            select privilege_requests.*, users.username from privilege_requests
            join users on users.id = privilege_requests.user_id
            where privilege_requests.id = ?
            """,
            (request_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="request not found")
        if row["status"] != "pending":
            raise HTTPException(status_code=400, detail="request already resolved")
        status = "granted" if approve else "denied"
        conn.execute(
            "update privilege_requests set status = ?, resolved_at = ?, resolved_by = ? where id = ?",
            (status, time.time(), resolver["id"], request_id),
        )
        if approve:
            conn.execute(
                "insert or ignore into user_privileges(user_id, privilege) values (?, ?)",
                (row["user_id"], row["privilege"]),
            )
            add_notification(conn, row["user_id"], "privilege_granted", f"{resolver['username']} granted privilege {row['privilege']}")
        else:
            add_notification(conn, row["user_id"], "privilege_denied", f"{resolver['username']} denied privilege {row['privilege']}")
        return {"id": request_id, "status": status, "resolved_by": resolver["id"], "resolver_username": resolver["username"]}


def list_notifications(user_id: int) -> list[dict]:
    with db.connect() as conn:
        rows = conn.execute(
            "select * from notifications where user_id = ? order by created_at desc limit 50",
            (user_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def mark_notifications_seen(user_id: int) -> None:
    with db.connect() as conn:
        conn.execute("update notifications set seen = 1 where user_id = ?", (user_id,))
