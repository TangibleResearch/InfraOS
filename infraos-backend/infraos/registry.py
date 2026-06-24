from pathlib import Path
import struct
import time
from typing import Any

from . import db
from .config import OBJECTS_DIR
from .models import AIFObject, AIFPointer

MAX_OBJECTS = 4096
MAX_PROPERTIES = 4096
MAX_POINTERS = 4096
MAX_LIST_ITEMS = 8192
MAX_STRING_BYTES = 1024 * 1024


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
        size = self.u32()
        if size > MAX_STRING_BYTES:
            raise ValueError("AIF string exceeds size limit")
        return self.take(size).decode("utf-8")

    def value(self) -> Any:
        tag = self.u8()
        if tag in (1, 2, 4):
            return self.string()
        if tag == 3:
            return bool(self.u8())
        if tag == 5:
            count = self.u32()
            if count > MAX_LIST_ITEMS:
                raise ValueError("AIF list exceeds item limit")
            return [self.value() for _ in range(count)]
        raise ValueError(f"unknown AIF value tag {tag}")


def read_aif(path: Path) -> list[AIFObject]:
    reader = Reader(path.read_bytes())
    if reader.take(4) != b"AIF0":
        raise ValueError(f"{path} is not an AIF file")
    version = reader.u16()
    if version != 1:
        raise ValueError(f"unsupported AIF version {version}")
    objects: list[AIFObject] = []
    object_count = reader.u32()
    if object_count > MAX_OBJECTS:
        raise ValueError("AIF object count exceeds limit")
    for _ in range(object_count):
        object_id = reader.string()
        name = reader.string()
        object_type = reader.string()
        start_flag = bool(reader.u8())
        property_count = reader.u32()
        if property_count > MAX_PROPERTIES:
            raise ValueError("AIF property count exceeds limit")
        properties = {reader.string(): reader.value() for _ in range(property_count)}
        pointer_count = reader.u32()
        if pointer_count > MAX_POINTERS:
            raise ValueError("AIF pointer count exceeds limit")
        pointers = [
            AIFPointer(pointer_type=reader.string(), target_object_id=reader.string())
            for _ in range(pointer_count)
        ]
        instruction_count = reader.u32()
        if instruction_count:
            raise ValueError("AIF instructions are reserved but not executable in v1")
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
        try:
            file_objects = read_aif(path)
        except Exception as exc:
            db.add_log("registry", f"skipped {path.name}: {exc}", time.time())
            continue
        for obj in file_objects:
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
