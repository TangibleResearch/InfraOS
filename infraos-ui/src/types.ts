export type AIFPointer = {
  pointer_type: string;
  target_object_id: string;
};

export type AIFObject = {
  object_id: string;
  name: string;
  type: string;
  start_flag: boolean;
  properties: Record<string, unknown>;
  pointers: AIFPointer[];
  file_path?: string | null;
};

export type Health = {
  ok: boolean;
  name: string;
  server_name: string;
  object_count: number;
  start_object?: AIFObject | null;
  openai_key_available: boolean;
  providers?: Record<string, boolean>;
  provider_details?: Record<string, { configured: boolean; runtime: "live" | "stub"; message: string }>;
  autostart: boolean;
};

export type AuthUser = {
  id: number;
  username: string;
  full_name: string;
  phone: string;
  email: string;
  is_admin: boolean;
  privileges: string[];
};

export type GitHubOAuthConfig = {
  configured: boolean;
  client_id_available: boolean;
  redirect_uri: string;
  scopes: string;
};

export type GitHubAccount = {
  id: number;
  user_id: number;
  username: string;
  full_name: string;
  is_admin: boolean;
  privileges: string[];
  github_id: number;
  login: string;
  name: string;
  email: string;
  avatar_url: string;
  scope: string;
  token_type: string;
  linked_at: number;
  updated_at: number;
  access_token?: string;
};

export type LoginResult = {
  token: string;
  user: AuthUser;
};

export type PrivilegeRequest = {
  id: number;
  user_id: number;
  username: string;
  privilege: string;
  reason: string;
  status: "pending" | "granted" | "denied";
  created_at: number;
  resolved_at?: number | null;
  resolved_by?: number | null;
  resolver_username?: string | null;
};

export type AuthNotification = {
  id: number;
  user_id: number;
  kind: string;
  message: string;
  seen: number;
  created_at: number;
};

export type VMRunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  receipt_code?: string | null;
  receipt_hash?: string | null;
  receipt_text?: string | null;
};

export type RunReceipt = {
  code: string;
  receipt_hash: string;
  status: string;
  authorized_by: string;
  authorized_user_id?: number | null;
  object_id: string;
  file_path: string;
  receipt_text: string;
  stdout: string;
  stderr: string;
  created_at: number;
};

export type CompileResult = {
  ok: boolean;
  output_path?: string | null;
  stdout: string;
  stderr: string;
  objects: AIFObject[];
};

export type PeerInfo = {
  peer_id: string;
  address: string;
  status: string;
};

export type LogEvent = {
  kind: string;
  message: string;
  ts: number;
};
