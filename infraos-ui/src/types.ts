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
