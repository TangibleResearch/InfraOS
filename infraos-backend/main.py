from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from infraos.api_auth import router as auth_router
from infraos.api_logs import router as logs_router
from infraos.api_objects import router as objects_router
from infraos.api_peers import router as peers_router
from infraos.api_receipts import router as receipts_router
from infraos.api_vm import router as vm_router
from infraos.boot import boot
from infraos.config import AUTOSTART, COMPILER_BIN, INFRAVM_BIN, SERVER_NAME, cors_origins, openai_key_available, provider_details, provider_key_status
from infraos.events import event_bus
from infraos.registry import get_start_object, load_registry

app = FastAPI(title="InfraOS", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    boot()
    await event_bus.emit("boot", "InfraOS boot complete")


@app.get("/api/health")
def health():
    objects = load_registry()
    start = get_start_object()
    return {
        "ok": True,
        "name": "InfraOS",
        "server_name": SERVER_NAME,
        "object_count": len(objects),
        "start_object": start.model_dump() if start else None,
        "openai_key_available": openai_key_available(),
        "providers": provider_key_status(),
        "provider_details": provider_details(),
        "autostart": AUTOSTART,
        "compiler": str(COMPILER_BIN),
        "infravm": str(INFRAVM_BIN),
    }


@app.websocket("/ws/events")
async def websocket_events(websocket: WebSocket):
    await event_bus.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await event_bus.disconnect(websocket)


app.include_router(auth_router)
app.include_router(objects_router)
app.include_router(vm_router)
app.include_router(peers_router)
app.include_router(logs_router)
app.include_router(receipts_router)
