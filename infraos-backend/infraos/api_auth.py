from fastapi import APIRouter, Depends, Header

from . import auth
from .models import (
    CreateUserRequest,
    LoginRequest,
    PrivilegeChangeRequest,
    PrivilegeRequestCreate,
    ResolvePrivilegeRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
def login(request: LoginRequest):
    return auth.login(request.username, request.password)


@router.post("/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        auth.logout(authorization.removeprefix("Bearer ").strip())
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(auth.require_user)):
    return user


@router.get("/privileges")
def privileges():
    return auth.ALL_PRIVILEGES


@router.get("/users")
def users(user: dict = Depends(auth.require_user)):
    auth.require_admin(user)
    return auth.list_users()


@router.post("/users")
def create_user(request: CreateUserRequest, user: dict = Depends(auth.require_user)):
    auth.require_admin(user)
    return auth.create_user(
        request.username,
        request.password,
        request.full_name,
        request.phone,
        request.email,
        request.is_admin,
        request.privileges,
    )


@router.delete("/users/{user_id}")
def delete_user(user_id: int, user: dict = Depends(auth.require_user)):
    auth.require_admin(user)
    auth.delete_user(user_id)
    return {"ok": True}


@router.post("/users/{user_id}/privileges")
def change_privilege(user_id: int, request: PrivilegeChangeRequest, user: dict = Depends(auth.require_user)):
    auth.require_admin(user)
    auth.set_privilege(user_id, request.privilege, request.enabled)
    return {"ok": True}


@router.post("/requests")
def request_privilege(request: PrivilegeRequestCreate, user: dict = Depends(auth.require_user)):
    return auth.request_privilege(user, request.privilege, request.reason)


@router.get("/requests")
def requests(user: dict = Depends(auth.require_user)):
    if user.get("is_admin") or "auth:manage" in user.get("privileges", []) or "admin" in user.get("privileges", []):
        return auth.list_requests(include_all=True)
    return auth.list_requests(include_all=False, user_id=user["id"])


@router.post("/requests/{request_id}/resolve")
def resolve_request(request_id: int, request: ResolvePrivilegeRequest, user: dict = Depends(auth.require_user)):
    auth.require_admin(user)
    return auth.resolve_request(request_id, request.approve, user)


@router.get("/notifications")
def notifications(user: dict = Depends(auth.require_user)):
    return auth.list_notifications(user["id"])


@router.post("/notifications/seen")
def notifications_seen(user: dict = Depends(auth.require_user)):
    auth.mark_notifications_seen(user["id"])
    return {"ok": True}
