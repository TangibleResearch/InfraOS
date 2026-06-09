from . import auth, db
from .config import AUTOSTART, OBJECTS_DIR
from .registry import load_registry


def boot() -> None:
    OBJECTS_DIR.mkdir(parents=True, exist_ok=True)
    db.init_db()
    auth.bootstrap_admin()
    load_registry()
    if AUTOSTART:
        # Autostart is intentionally left disabled-by-default until VM security grows.
        pass
