import sqlite3
import time
from .config import DATA_DIR, DB_PATH


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            create table if not exists objects (
                object_id text primary key,
                name text not null,
                type text not null,
                start_flag integer not null,
                file_path text not null
            )
            """
        )
        conn.execute(
            """
            create table if not exists logs (
                id integer primary key autoincrement,
                kind text not null,
                message text not null,
                ts real not null
            )
            """
        )
        conn.execute(
            """
            create table if not exists users (
                id integer primary key autoincrement,
                username text not null unique,
                password_hash text not null,
                full_name text default '',
                phone text default '',
                email text default '',
                is_admin integer not null default 0,
                created_at real not null
            )
            """
        )
        conn.execute(
            """
            create table if not exists user_privileges (
                user_id integer not null,
                privilege text not null,
                primary key(user_id, privilege),
                foreign key(user_id) references users(id) on delete cascade
            )
            """
        )
        conn.execute(
            """
            create table if not exists sessions (
                token text primary key,
                user_id integer not null,
                created_at real not null,
                foreign key(user_id) references users(id) on delete cascade
            )
            """
        )
        conn.execute(
            """
            create table if not exists privilege_requests (
                id integer primary key autoincrement,
                user_id integer not null,
                privilege text not null,
                reason text default '',
                status text not null default 'pending',
                created_at real not null,
                resolved_at real,
                foreign key(user_id) references users(id) on delete cascade
            )
            """
        )
        columns = {row[1] for row in conn.execute("pragma table_info(privilege_requests)").fetchall()}
        if "resolved_by" not in columns:
            conn.execute("alter table privilege_requests add column resolved_by integer")
        conn.execute(
            """
            create table if not exists notifications (
                id integer primary key autoincrement,
                user_id integer not null,
                kind text not null,
                message text not null,
                seen integer not null default 0,
                created_at real not null,
                foreign key(user_id) references users(id) on delete cascade
            )
            """
        )


def upsert_object(object_id: str, name: str, object_type: str, start_flag: bool, file_path: str) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            insert into objects(object_id, name, type, start_flag, file_path)
            values (?, ?, ?, ?, ?)
            on conflict(object_id) do update set
              name=excluded.name,
              type=excluded.type,
              start_flag=excluded.start_flag,
              file_path=excluded.file_path
            """,
            (object_id, name, object_type, int(start_flag), file_path),
        )


def add_log(kind: str, message: str, ts: float) -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("insert into logs(kind, message, ts) values (?, ?, ?)", (kind, message, ts))


def get_logs(limit: int = 200) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "select kind, message, ts from logs order by id desc limit ?",
            (limit,),
        ).fetchall()
    return [dict(row) for row in reversed(rows)]


def connect() -> sqlite3.Connection:
    init_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("pragma foreign_keys = on")
    return conn


def add_notification(user_id: int, kind: str, message: str) -> None:
    with connect() as conn:
        conn.execute(
            "insert into notifications(user_id, kind, message, created_at) values (?, ?, ?, ?)",
            (user_id, kind, message, time.time()),
        )
