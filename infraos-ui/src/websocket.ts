import { API_BASE } from "./api";
import type { LogEvent } from "./types";

export function connectEvents(onEvent: (event: LogEvent) => void): WebSocket {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/events";
  const ws = new WebSocket(url);
  ws.onmessage = (message) => {
    onEvent(JSON.parse(message.data) as LogEvent);
  };
  return ws;
}
