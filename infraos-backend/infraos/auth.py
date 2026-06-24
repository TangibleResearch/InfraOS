import hashlib
import hmac
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
from fastapi import Header, HTTPException
from fastapi.responses import RedirectResponse

from . import db
from .config import (
    ADMIN_PASSWORD_FILE,
    ALLOW_DEFAULT_ADMIN,
    GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET,
    GITHUB_OAUTH_REDIRECT_URI,
    PUBLIC_UI_URL,
    SESSION_TTL_SECONDS,
)

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
            full = conn.execute("select * from users where username = 'admin'").fetchone()
            if (
                full
                and not ALLOW_DEFAULT_ADMIN
                and verify_password("admin", full["password_hash"])
            ):
                password = generated_admin_password()
                conn.execute(
                    "update users set password_hash = ? where id = ?",
                    (hash_password(password), full["id"]),
                )
            return
        password = os.getenv("INFRAOS_ADMIN_PASSWORD") or generated_admin_password()
        cur = conn.execute(
            """
            insert into users(username, password_hash, full_name, email, phone, is_admin, created_at)
            values (?, ?, ?, ?, ?, 1, ?)
            """,
            ("admin", hash_password(password), "Administrator", "", "", time.time()),
        )
        user_id = int(cur.lastrowid)
        for privilege in ALL_PRIVILEGES:
            conn.execute(
                "insert into user_privileges(user_id, privilege) values (?, ?)",
                (user_id, privilege),
            )


def generated_admin_password() -> str:
    ADMIN_PASSWORD_FILE.parent.mkdir(parents=True, exist_ok=True)
    if ADMIN_PASSWORD_FILE.exists():
        password = ADMIN_PASSWORD_FILE.read_text(encoding="utf-8").strip()
        if password:
            return password
    password = secrets.token_urlsafe(18)
    ADMIN_PASSWORD_FILE.write_text(password + "\n", encoding="utf-8")
    try:
        ADMIN_PASSWORD_FILE.chmod(0o600)
    except OSError:
        pass
    return password


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


def github_account_payload(row, include_token: bool = False) -> dict:
    payload = {
        "id": row["id"],
        "user_id": row["user_id"],
        "github_id": row["github_id"],
        "login": row["login"],
        "name": row["name"] or "",
        "email": row["email"] or "",
        "avatar_url": row["avatar_url"] or "",
        "scope": row["scope"] or "",
        "token_type": row["token_type"] or "",
        "linked_at": row["linked_at"],
        "updated_at": row["updated_at"],
    }
    if include_token:
        payload["access_token"] = row["access_token"]
    return payload


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
            select users.*, sessions.created_at as session_created_at from sessions
            join users on users.id = sessions.user_id
            where sessions.token = ?
            """,
            (token,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="invalid auth token")
        if time.time() - float(row["session_created_at"]) > SESSION_TTL_SECONDS:
            conn.execute("delete from sessions where token = ?", (token,))
            raise HTTPException(status_code=401, detail="auth token expired")
        return user_payload(row, get_privileges(conn, row["id"]))


def require_user(authorization: str | None = Header(default=None)) -> dict:
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
    return current_user_from_token(token)


def require_admin(user: dict) -> None:
    if not user.get("is_admin") and "admin" not in user.get("privileges", []):
        raise HTTPException(status_code=403, detail="admin privilege required")


def require_privilege(user: dict, privilege: str) -> None:
    privileges = user.get("privileges", [])
    if user.get("is_admin") or "admin" in privileges or privilege in privileges:
        return
    raise HTTPException(status_code=403, detail=f"{privilege} privilege required")


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


def github_oauth_config() -> dict:
    return {
        "configured": bool(GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET),
        "client_id_available": bool(GITHUB_CLIENT_ID),
        "redirect_uri": GITHUB_OAUTH_REDIRECT_URI,
        "scopes": "read:user user:email repo",
    }


def begin_github_oauth(user: dict | None = None, mode: str = "login") -> dict:
    if not GITHUB_CLIENT_ID or not GITHUB_CLIENT_SECRET:
        raise HTTPException(
            status_code=400,
            detail="GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET.",
        )
    if mode not in {"login", "link"}:
        raise HTTPException(status_code=400, detail="unknown GitHub OAuth mode")
    if mode == "link" and not user:
        raise HTTPException(status_code=401, detail="login required to link GitHub")
    state = secrets.token_urlsafe(24)
    with db.connect() as conn:
        conn.execute(
            "insert into github_oauth_states(state, user_id, mode, created_at) values (?, ?, ?, ?)",
            (state, user["id"] if user else None, mode, time.time()),
        )
    query = urllib.parse.urlencode(
        {
            "client_id": GITHUB_CLIENT_ID,
            "redirect_uri": GITHUB_OAUTH_REDIRECT_URI,
            "scope": "read:user user:email repo",
            "state": state,
            "allow_signup": "true",
        }
    )
    return {"auth_url": f"https://github.com/login/oauth/authorize?{query}", "state": state}


def complete_github_oauth(code: str, state: str) -> RedirectResponse:
    if not code or not state:
        return github_redirect("error", "missing GitHub OAuth code or state")
    with db.connect() as conn:
        oauth_state = conn.execute("select * from github_oauth_states where state = ?", (state,)).fetchone()
        if not oauth_state:
            return github_redirect("error", "invalid or expired GitHub OAuth state")
        conn.execute("delete from github_oauth_states where state = ?", (state,))
        if time.time() - float(oauth_state["created_at"]) > 600:
            return github_redirect("error", "expired GitHub OAuth state")
    try:
        token_payload = github_exchange_code(code)
        access_token = token_payload["access_token"]
        profile = github_api_json("https://api.github.com/user", access_token)
        email = github_primary_email(access_token) or profile.get("email") or ""
    except HTTPException as exc:
        return github_redirect("error", str(exc.detail))

    with db.connect() as conn:
        if oauth_state["mode"] == "link":
            user_id = int(oauth_state["user_id"])
        else:
            existing = conn.execute(
                "select user_id from github_accounts where github_id = ?",
                (int(profile["id"]),),
            ).fetchone()
            if existing:
                user_id = int(existing["user_id"])
            else:
                username = unique_github_username(conn, profile["login"])
                cur = conn.execute(
                    """
                    insert into users(username, password_hash, full_name, phone, email, is_admin, created_at)
                    values (?, ?, ?, '', ?, 0, ?)
                    """,
                    (
                        username,
                        hash_password(secrets.token_urlsafe(32)),
                        profile.get("name") or profile["login"],
                        email,
                        time.time(),
                    ),
                )
                user_id = int(cur.lastrowid)
                for privilege in ["objects:read", "vm:run", "compile"]:
                    conn.execute("insert into user_privileges(user_id, privilege) values (?, ?)", (user_id, privilege))
        upsert_github_account(conn, user_id, profile, email, token_payload)
        if oauth_state["mode"] == "login":
            row = conn.execute("select * from users where id = ?", (user_id,)).fetchone()
            token = secrets.token_urlsafe(32)
            conn.execute(
                "insert into sessions(token, user_id, created_at) values (?, ?, ?)",
                (token, user_id, time.time()),
            )
            username = row["username"] if row else "github"
            return github_redirect("login", f"signed in as {username}", token)
        add_notification(conn, user_id, "github_linked", f"GitHub account {profile['login']} linked")
    return github_redirect("linked", f"linked GitHub account {profile['login']}")


def github_redirect(status: str, message: str, token: str | None = None) -> RedirectResponse:
    query = {"github": status, "message": message}
    if token:
        query["token"] = token
    return RedirectResponse(f"{PUBLIC_UI_URL}/?{urllib.parse.urlencode(query)}")


def github_exchange_code(code: str) -> dict:
    body = urllib.parse.urlencode(
        {
            "client_id": GITHUB_CLIENT_ID,
            "client_secret": GITHUB_CLIENT_SECRET,
            "code": code,
            "redirect_uri": GITHUB_OAUTH_REDIRECT_URI,
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        "https://github.com/login/oauth/access_token",
        data=body,
        headers={"Accept": "application/json", "User-Agent": "AInfra-VM"},
        method="POST",
    )
    data = open_json(request)
    if data.get("error"):
        raise HTTPException(status_code=400, detail=data.get("error_description") or data["error"])
    if not data.get("access_token"):
        raise HTTPException(status_code=400, detail="GitHub did not return an access token")
    return data


def github_api_json(url: str, token: str) -> dict | list:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "AInfra-VM",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    return open_json(request)


def open_json(request: urllib.request.Request) -> dict | list:
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=400, detail=f"GitHub request failed: {detail}") from exc
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"GitHub request failed: {exc}") from exc


def github_primary_email(token: str) -> str:
    emails = github_api_json("https://api.github.com/user/emails", token)
    if not isinstance(emails, list):
        return ""
    for item in emails:
        if item.get("primary") and item.get("verified") and item.get("email"):
            return item["email"]
    for item in emails:
        if item.get("verified") and item.get("email"):
            return item["email"]
    return ""


def unique_github_username(conn, login_name: str) -> str:
    base = f"github_{login_name}".replace(" ", "_").lower()
    candidate = base
    suffix = 2
    while conn.execute("select id from users where username = ?", (candidate,)).fetchone():
        candidate = f"{base}_{suffix}"
        suffix += 1
    return candidate


def upsert_github_account(conn, user_id: int, profile: dict, email: str, token_payload: dict) -> None:
    now = time.time()
    conn.execute(
        """
        insert into github_accounts(
            user_id, github_id, login, name, email, avatar_url, access_token,
            scope, token_type, linked_at, updated_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(github_id) do update set
            user_id=excluded.user_id,
            login=excluded.login,
            name=excluded.name,
            email=excluded.email,
            avatar_url=excluded.avatar_url,
            access_token=excluded.access_token,
            scope=excluded.scope,
            token_type=excluded.token_type,
            updated_at=excluded.updated_at
        """,
        (
            user_id,
            int(profile["id"]),
            profile["login"],
            profile.get("name") or "",
            email,
            profile.get("avatar_url") or "",
            token_payload["access_token"],
            token_payload.get("scope") or "",
            token_payload.get("token_type") or "",
            now,
            now,
        ),
    )


def list_github_accounts(viewer: dict) -> list[dict]:
    with db.connect() as conn:
        if viewer.get("is_admin") or "admin" in viewer.get("privileges", []):
            rows = conn.execute(
                """
                select github_accounts.*, users.username, users.full_name, users.is_admin
                from github_accounts
                join users on users.id = github_accounts.user_id
                order by github_accounts.updated_at desc
                """
            ).fetchall()
        else:
            rows = conn.execute(
                """
                select github_accounts.*, users.username, users.full_name, users.is_admin
                from github_accounts
                join users on users.id = github_accounts.user_id
                where github_accounts.user_id = ?
                order by github_accounts.updated_at desc
                """,
                (viewer["id"],),
            ).fetchall()
        accounts = []
        for row in rows:
            accounts.append(
                {
                    **github_account_payload(row),
                    "username": row["username"],
                    "full_name": row["full_name"] or "",
                    "is_admin": bool(row["is_admin"]),
                    "privileges": get_privileges(conn, int(row["user_id"])),
                }
            )
        return accounts


def assign_github_account(account_id: int, user_id: int, viewer: dict) -> dict:
    require_admin(viewer)
    with db.connect() as conn:
        account = conn.execute("select * from github_accounts where id = ?", (account_id,)).fetchone()
        if not account:
            raise HTTPException(status_code=404, detail="GitHub account not found")
        user = conn.execute("select * from users where id = ?", (user_id,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="AInfra account not found")
        conn.execute(
            "update github_accounts set user_id = ?, updated_at = ? where id = ?",
            (user_id, time.time(), account_id),
        )
        add_notification(conn, user_id, "github_linked", f"GitHub account {account['login']} linked to this AInfra account")
        row = conn.execute(
            """
            select github_accounts.*, users.username, users.full_name, users.is_admin
            from github_accounts
            join users on users.id = github_accounts.user_id
            where github_accounts.id = ?
            """,
            (account_id,),
        ).fetchone()
        return {
            **github_account_payload(row),
            "username": row["username"],
            "full_name": row["full_name"] or "",
            "is_admin": bool(row["is_admin"]),
            "privileges": get_privileges(conn, user_id),
        }


def export_github_token(account_id: int, viewer: dict) -> dict:
    with db.connect() as conn:
        row = conn.execute(
            """
            select github_accounts.*, users.username
            from github_accounts
            join users on users.id = github_accounts.user_id
            where github_accounts.id = ?
            """,
            (account_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="GitHub account not found")
        if not (viewer.get("is_admin") or "admin" in viewer.get("privileges", []) or row["user_id"] == viewer["id"]):
            raise HTTPException(status_code=403, detail="cannot export this GitHub token")
    return {**github_account_payload(row, include_token=True), "username": row["username"]}


def unlink_github_account(account_id: int, viewer: dict) -> None:
    with db.connect() as conn:
        row = conn.execute("select user_id from github_accounts where id = ?", (account_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="GitHub account not found")
        if not (viewer.get("is_admin") or "admin" in viewer.get("privileges", []) or row["user_id"] == viewer["id"]):
            raise HTTPException(status_code=403, detail="cannot unlink this GitHub account")
        conn.execute("delete from github_accounts where id = ?", (account_id,))
