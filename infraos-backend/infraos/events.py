import asyncio
import time
from fastapi import WebSocket
from . import db
from .models import LogEvent


class EventBus:
    def __init__(self) -> None:
        self._clients: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._clients.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._clients.discard(websocket)

    async def emit(self, kind: str, message: str) -> LogEvent:
        event = LogEvent(kind=kind, message=message, ts=time.time())
        db.add_log(event.kind, event.message, event.ts)
        payload = event.model_dump()
        async with self._lock:
            clients = list(self._clients)
        for client in clients:
            try:
                await client.send_json(payload)
            except Exception:
                await self.disconnect(client)
        return event


event_bus = EventBus()
