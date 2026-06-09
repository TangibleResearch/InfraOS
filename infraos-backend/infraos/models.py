from pydantic import BaseModel, Field
from typing import Any


class AIFPointer(BaseModel):
    pointer_type: str
    target_object_id: str


class AIFObject(BaseModel):
    object_id: str
    name: str
    type: str
    start_flag: bool = False
    properties: dict[str, Any] = Field(default_factory=dict)
    pointers: list[AIFPointer] = Field(default_factory=list)
    file_path: str | None = None


class CompileRequest(BaseModel):
    source: str
    name: str = "workspace"


class CompileResult(BaseModel):
    ok: bool
    output_path: str | None = None
    stdout: str = ""
    stderr: str = ""
    objects: list[AIFObject] = Field(default_factory=list)


class VMRunRequest(BaseModel):
    object_id: str | None = None
    file_path: str | None = None


class VMRunResult(BaseModel):
    ok: bool
    stdout: str = ""
    stderr: str = ""


class PeerInfo(BaseModel):
    peer_id: str
    address: str
    status: str


class LogEvent(BaseModel):
    kind: str
    message: str
    ts: float


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    full_name: str = ""
    phone: str = ""
    email: str = ""
    is_admin: bool = False
    privileges: list[str] = Field(default_factory=list)


class PrivilegeChangeRequest(BaseModel):
    privilege: str
    enabled: bool


class PrivilegeRequestCreate(BaseModel):
    privilege: str
    reason: str = ""


class ResolvePrivilegeRequest(BaseModel):
    approve: bool
