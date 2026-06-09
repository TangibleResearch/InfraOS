from pathlib import Path
import struct
from typing import Any

from . import db
from .config import OBJECTS_DIR
from .models import AIFObject, AIFPointer


class Reader:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.pos = 0

    def take(self, count: int) -> bytes:
        if self.pos + count > len(self.data):
            raise ValueError("truncated AIF file")
        out = self.data[self.pos : self.pos + count]
        self.pos += count
        return out

    def u8(self) -> int:
        return self.take(1)[0]

    def u16(self) -> int:
        return struct.unpack("<H", self.take(2))[0]

    def u32(self) -> int:
        return struct.unpack("<I", self.take(4))[0]

    def string(self) -> str:
        return self.take(self.u32()).decode("utf-8")

    def value(self) -> Any:
        tag = self.u8()
        if tag in (1, 2, 4):
            return self.string()
        if tag == 3:
            return bool(self.u8())
        if tag == 5:
            return [self.value() for _ in range(self.u32())]
        raise ValueError(f"unknown AIF value tag {tag}")


def read_aif(path: Path) -> list[AIFObject]:
    reader = Reader(path.read_bytes())
    if reader.take(4) != b"AIF0":
        raise ValueError(f"{path} is not an AIF file")
    version = reader.u16()
    if version != 1:
        raise ValueError(f"unsupported AIF version {version}")
    objects: list[AIFObject] = []
    for _ in range(reader.u32()):
        object_id = reader.string()
        name = reader.string()
        object_type = reader.string()
        start_flag = bool(reader.u8())
        properties = {reader.string(): reader.value() for _ in range(reader.u32())}
        pointers = [
            AIFPointer(pointer_type=reader.string(), target_object_id=reader.string())
            for _ in range(reader.u32())
        ]
        instruction_count = reader.u32()
        for _ in range(instruction_count):
            reader.u8()
        obj = AIFObject(
            object_id=object_id,
            name=name,
            type=object_type,
            start_flag=start_flag,
            properties=properties,
            pointers=pointers,
            file_path=str(path),
        )
        objects.append(obj)
    return objects


def load_registry() -> list[AIFObject]:
    db.init_db()
    OBJECTS_DIR.mkdir(parents=True, exist_ok=True)
    objects: list[AIFObject] = []
    for path in sorted(OBJECTS_DIR.glob("*.aif")):
        for obj in read_aif(path):
            objects.append(obj)
            db.upsert_object(obj.object_id, obj.name, obj.type, obj.start_flag, str(path))
    return objects


def get_object(object_id: str) -> AIFObject | None:
    for obj in load_registry():
        if obj.object_id == object_id:
            return obj
    return None


def get_start_object() -> AIFObject | None:
    for obj in load_registry():
        if obj.start_flag:
            return obj
    objects = load_registry()
    return objects[0] if objects else None
