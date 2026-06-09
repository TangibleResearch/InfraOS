import type {
  AIFObject,
  AuthNotification,
  AuthUser,
  CompileResult,
  Health,
  LogEvent,
  LoginResult,
  PeerInfo,
  PrivilegeRequest,
  VMRunResult
} from "./types";

export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
const TOKEN_KEY = "infraos_auth_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) => {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    },
    ...init
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch {
      // Keep the HTTP status fallback when the backend did not return JSON.
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const getHealth = () => request<Health>("/api/health");
export const getObjects = () => request<AIFObject[]>("/api/objects");
export const getObject = (id: string) => request<AIFObject>(`/api/objects/${encodeURIComponent(id)}`);
export const getLogs = () => request<LogEvent[]>("/api/logs");
export const getPeers = () => request<PeerInfo[]>("/api/peers");
export const discoverPeers = () => request<PeerInfo[]>("/api/peers/discover", { method: "POST" });
export const runStart = () => request<VMRunResult>("/api/vm/run-start", { method: "POST" });
export const runFile = (filePath: string, objectId?: string) =>
  request<VMRunResult>("/api/vm/run-file", {
    method: "POST",
    body: JSON.stringify({ file_path: filePath, object_id: objectId || null })
  });
export const pointRun = (objectId: string) =>
  request<VMRunResult>(`/api/vm/pointrun/${encodeURIComponent(objectId)}`, { method: "POST" });

export function compileSource(source: string, name = "workspace") {
  return request<CompileResult>("/api/compile", {
    method: "POST",
    body: JSON.stringify({ source, name })
  });
}

export const login = (username: string, password: string) =>
  request<LoginResult>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  }).catch((error) => {
    if (String(error).includes("Not Found") || String(error).includes("404")) {
      throw new Error(`Auth endpoint not found on ${API_BASE}. Restart the backend so it serves /api/auth/login.`);
    }
    throw error;
  });

export const logout = () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
export const getMe = () => request<AuthUser>("/api/auth/me");
export const getPrivileges = () => request<string[]>("/api/auth/privileges");
export const listUsers = () => request<AuthUser[]>("/api/auth/users");
export const createUser = (payload: {
  username: string;
  password: string;
  full_name: string;
  phone: string;
  email: string;
  is_admin: boolean;
  privileges: string[];
}) =>
  request<AuthUser>("/api/auth/users", {
    method: "POST",
    body: JSON.stringify(payload)
  });
export const deleteUser = (userId: number) =>
  request<{ ok: boolean }>(`/api/auth/users/${userId}`, { method: "DELETE" });
export const changeUserPrivilege = (userId: number, privilege: string, enabled: boolean) =>
  request<{ ok: boolean }>(`/api/auth/users/${userId}/privileges`, {
    method: "POST",
    body: JSON.stringify({ privilege, enabled })
  });
export const requestPrivilege = (privilege: string, reason: string) =>
  request<{ id: number; privilege: string; status: string }>("/api/auth/requests", {
    method: "POST",
    body: JSON.stringify({ privilege, reason })
  });
export const listPrivilegeRequests = () => request<PrivilegeRequest[]>("/api/auth/requests");
export const resolvePrivilegeRequest = (requestId: number, approve: boolean) =>
  request<{ id: number; status: string }>(`/api/auth/requests/${requestId}/resolve`, {
    method: "POST",
    body: JSON.stringify({ approve })
  });
export const getNotifications = () => request<AuthNotification[]>("/api/auth/notifications");
export const markNotificationsSeen = () => request<{ ok: boolean }>("/api/auth/notifications/seen", { method: "POST" });
