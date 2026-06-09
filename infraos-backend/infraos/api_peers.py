from fastapi import APIRouter
from .events import event_bus
from .peer import discover_peers, list_peers

router = APIRouter(prefix="/api/peers", tags=["peers"])


@router.get("")
def get_peers():
    return list_peers()


@router.post("/discover")
async def post_discover():
    peers = discover_peers()
    await event_bus.emit("peer", "peer discovery is stubbed in v0.1")
    return peers
