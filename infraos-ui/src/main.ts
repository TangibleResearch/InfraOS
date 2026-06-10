import "./styles.css";
import {
  changeUserPrivilege,
  compileSource,
  createUser,
  deleteUser,
  discoverPeers,
  getHealth,
  getLogs,
  getMe,
  getNotifications,
  getObjects,
  getPeers,
  getPrivileges,
  getToken,
  listPrivilegeRequests,
  listUsers,
  login,
  logout,
  markNotificationsSeen,
  pointRun,
  requestPrivilege,
  resolvePrivilegeRequest,
  runFile,
  runStart,
  setToken
} from "./api";
import { connectEvents } from "./websocket";
import type { AIFObject, AuthNotification, AuthUser, Health, LogEvent, PeerInfo, PrivilegeRequest } from "./types";

type Toast = {
  id: number;
  message: string;
  action?: "auth";
};

type DragPointKind = "model" | "prompt" | "agent" | "run" | "port";

type DragPointBlock = {
  id: string;
  kind: DragPointKind;
  name: string;
  x: number;
  y: number;
  promptText?: string;
};

type DragPointWire = {
  id: string;
  from: string;
  to: string;
  label: string;
};

type CanvasPoint = {
  x: number;
  y: number;
};

type State = {
  page: string;
  health: Health | null;
  objects: AIFObject[];
  selected: AIFObject | null;
  peers: PeerInfo[];
  logs: LogEvent[];
  output: string;
  user: AuthUser | null;
  authUsers: AuthUser[];
  privileges: string[];
  privilegeRequests: PrivilegeRequest[];
  notifications: AuthNotification[];
  toasts: Toast[];
  formValues: Record<string, string | boolean>;
  assistantMessages: string[];
  ideOutputPath: string | null;
  dragPointBlocks: DragPointBlock[];
  dragPointWires: DragPointWire[];
  lastRunObjectId: string | null;
  lastRunTrace: string[];
  graphNodePositions: Record<string, CanvasPoint>;
};

const EDITABLE_SELECTOR = "input, textarea, select";

const state: State = {
  page: "Dashboard",
  health: null,
  objects: [],
  selected: null,
  peers: [],
  logs: [],
  output: "",
  user: null,
  authUsers: [],
  privileges: [],
  privilegeRequests: [],
  notifications: [],
  toasts: [],
  formValues: {},
  assistantMessages: [
    "I can help debug compile errors, failed VM runs, missing provider keys, and AInfra object wiring. Compile or run something, then ask me what went wrong."
  ],
  ideOutputPath: null,
  dragPointBlocks: [
    { id: "dp-model-local", kind: "model", name: "local", x: 20, y: 44 },
    { id: "dp-prompt-answer", kind: "prompt", name: "answer", x: 20, y: 170, promptText: "Answer clearly and briefly: {input}" },
    { id: "dp-agent-helper", kind: "agent", name: "helper", x: 230, y: 106 },
    { id: "dp-run-main", kind: "run", name: "main", x: 450, y: 106 }
  ],
  dragPointWires: [
    { id: "wire-agent-model", from: "dp-agent-helper", to: "dp-model-local", label: "model" },
    { id: "wire-agent-prompt", from: "dp-agent-helper", to: "dp-prompt-answer", label: "prompt" },
    { id: "wire-run-agent", from: "dp-run-main", to: "dp-agent-helper", label: "runs" }
  ],
  lastRunObjectId: null,
  lastRunTrace: [],
  graphNodePositions: {}
};

const defaultSource = `import ai.local.ollama

// $start$

model local {
    engine = "ollama"
    name = "llama3.2"
}

prompt answer {
    text = "Answer clearly and briefly: {input}"
}

agent helper {
    model = local
    prompt = answer
}

run agent helper on "What is PointRun?"`;

const openAiTemplate = `import ai.remote.openai

// $start$

model cloud {
    engine = "openai"
    name = "gpt-4.1-mini"
    max_output_tokens = 128
    temperature = 0.7
}

prompt answer {
    text = "Answer clearly and briefly: {input}"
}

agent helper {
    model = cloud
    prompt = answer
}

run agent helper on "What is InfraVM?"`;

const portTemplate = `import ai.local.ollama
import ai.net.port

var PORT = 8080

// $start$

model local {
    engine = "ollama"
    name = "llama3.2"
}

prompt route_answer {
    text = "Handle the request and answer clearly: {input}"
}

agent helper {
    model = local
    prompt = route_answer
}

port api {
    protocol = "http"
    host = "127.0.0.1"
    port = PORT

    on_request {
        return helper
    }
}

run port api`;

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function captureFormValues() {
  document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(EDITABLE_SELECTOR).forEach((el) => {
    if (!el.id) return;
    if (el instanceof HTMLInputElement && el.type === "checkbox") {
      state.formValues[el.id] = el.checked;
    } else {
      state.formValues[el.id] = el.value;
    }
  });
}

function formValue(id: string, fallback = "") {
  const value = state.formValues[id];
  return typeof value === "string" ? value : fallback;
}

function checkedAttr(id: string) {
  return state.formValues[id] === true ? "checked" : "";
}

function selectedAttr(id: string, value: string) {
  return formValue(id) === value ? "selected" : "";
}

function clearFormValues(ids: string[]) {
  for (const id of ids) delete state.formValues[id];
}

function pages() {
  return ["Dashboard", "Objects", "Graph", "IDE", "Drag Points", "VM", "Peers", "Auth", "Notifications", "Settings"];
}

function pageMeta(page: string) {
  const meta: Record<string, { icon: string; group: string }> = {
    Dashboard: { icon: "OV", group: "Overview" },
    Objects: { icon: "OB", group: "Resources" },
    Graph: { icon: "GR", group: "Resources" },
    IDE: { icon: "ID", group: "Runtime" },
    "Drag Points": { icon: "DP", group: "Runtime" },
    VM: { icon: "VM", group: "Runtime" },
    Peers: { icon: "NW", group: "Runtime" },
    Auth: { icon: "AU", group: "Access" },
    Notifications: { icon: "NT", group: "Access" },
    Settings: { icon: "ST", group: "Access" }
  };
  return meta[page] ?? { icon: "VM", group: "Overview" };
}

function isAdmin() {
  return Boolean(state.user?.is_admin || state.user?.privileges.includes("admin") || state.user?.privileges.includes("auth:manage"));
}

function toast(message: string, action?: "auth") {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  state.toasts = [...state.toasts, { id, message, action }];
  safeRender();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((item) => item.id !== id);
    safeRender();
  }, 7000);
}

async function refreshAuth() {
  if (!getToken()) return;
  state.user = await getMe();
  state.privileges = await getPrivileges();
  state.privilegeRequests = await listPrivilegeRequests();
  if (isAdmin()) {
    state.authUsers = await listUsers();
  }
}

async function refreshNotifications(showToasts = false) {
  if (!state.user) return;
  const notifications = await getNotifications();
  const oldIds = new Set(state.notifications.map((notification) => notification.id));
  state.notifications = notifications;
  const fresh = notifications.filter((notification) => !notification.seen && shouldToastNotification(notification) && (showToasts || !oldIds.has(notification.id)));
  for (const notification of fresh.reverse()) {
    toast(notification.message, notification.kind === "privilege_request" ? "auth" : undefined);
  }
}

function shouldToastNotification(notification: AuthNotification) {
  if (notification.kind !== "privilege_request") return true;
  const match = notification.message.match(/^(.+) wants to have privilege (.+)$/);
  if (!match) return true;
  const [, username, privilege] = match;
  return state.privilegeRequests.some((request) =>
    request.username === username &&
    request.privilege === privilege &&
    request.status === "pending"
  );
}

async function refresh() {
  const [health, objects, peers, logs] = await Promise.all([getHealth(), getObjects(), getPeers(), getLogs()]);
  state.health = health;
  state.objects = objects;
  state.peers = peers;
  state.logs = logs;
  state.selected = state.selected ?? objects.find((object) => object.start_flag) ?? objects[0] ?? null;
  if (state.user) {
    await refreshAuth();
    await refreshNotifications();
  }
  safeRender();
}

async function boot() {
  if (getToken()) {
    try {
      await refreshAuth();
      await refreshNotifications(true);
    } catch {
      setToken(null);
      state.user = null;
    }
  }
  await refresh();
}

function loginPage() {
  return `
    <main class="login-page">
      <section class="login-panel">
        <div class="login-copy">
          <div class="cloud-mark">VM</div>
          <h1>${esc(state.health?.server_name ?? "InfraOS Local Server")}</h1>
          <p>Console access for AIF resources, VM runs, provider status, account privileges, and local infrastructure controls.</p>
          <div class="login-status">
            <span>SQLite auth</span>
            <span>Local VM</span>
            <span>${state.health?.openai_key_available ? "OpenAI key ready" : "OpenAI key missing"}</span>
          </div>
        </div>
        <form id="login-form" class="login-form">
          <h2>Sign in</h2>
          <label>Username <input id="login-username" autocomplete="username" value="${esc(formValue("login-username", "admin"))}"></label>
          <label>Password <input id="login-password" type="password" autocomplete="current-password" value="${esc(formValue("login-password", "admin"))}"></label>
          <button type="submit">Sign In</button>
          <p class="helper-text">Default development login is admin / admin.</p>
        </form>
      </section>
      ${toastHtml()}
    </main>`;
}

function nav() {
  const grouped = pages().reduce<Record<string, string[]>>((acc, page) => {
    const group = pageMeta(page).group;
    acc[group] = [...(acc[group] ?? []), page];
    return acc;
  }, {});
  return `
    <aside class="sidebar">
      <div class="brand-block">
        <div class="brand">VM</div>
        <div>
          <strong>InfraOS</strong>
          <span>${esc(state.health?.server_name ?? "Local Server")}</span>
        </div>
      </div>
      ${Object.entries(grouped).map(([group, groupPages]) => `
        <div class="nav-group">
          <div class="nav-heading">${esc(group)}</div>
          ${groupPages.map((page) => {
            const meta = pageMeta(page);
            return `<button class="nav ${state.page === page ? "active" : ""}" data-page="${page}">
              <span class="nav-icon">${esc(meta.icon)}</span>
              <span>${esc(page)}</span>
            </button>`;
          }).join("")}
        </div>
      `).join("")}
    </aside>`;
}

function topbar() {
  const providers = state.health?.providers ? Object.entries(state.health.providers as Record<string, boolean>) : [];
  const ready = providers.filter(([, ok]) => ok).length;
  const unread = state.notifications.filter((notification) => !notification.seen).length;
  return `
    <header class="topbar">
      <div class="crumbs">
        <span>Console</span>
        <strong>${esc(state.page)}</strong>
      </div>
      <div class="top-actions">
        <div class="search-box">Search resources</div>
        <div class="provider-strip">
          <span class="health-chip">${ready}/${providers.length} providers ready</span>
        </div>
        <button class="ghost notification-button" data-page="Notifications">Notifications${unread ? ` <span>${unread}</span>` : ""}</button>
        <div class="user-chip">${esc(state.user?.username ?? "user")}</div>
        <button id="logout" class="ghost">Sign Out</button>
      </div>
    </header>`;
}

function dashboard() {
  const start = state.health?.start_object;
  const providers = state.health?.providers ? Object.entries(state.health.providers as Record<string, boolean>) : [];
  const ready = providers.filter(([, ok]) => ok).length;
  return `
    ${pageHeader(
      state.health?.server_name ?? "VM Server",
      `${state.objects.length} AIF resources loaded. Start object: ${start?.object_id ?? "none"}.`,
      `<button data-page="IDE">Open IDE</button><button id="run-start" class="ghost">Run Start</button>`
    )}
    <div class="overview-grid">
      ${card("AIF Objects", String(state.objects.length), "Registry entries", "Objects")}
      ${card("IDE", "Ready", "Compile and run source", "IDE")}
      ${card("Runtime Peers", String(state.peers.length), "Local network endpoints", "Peers")}
      ${card("Providers", `${ready}/${providers.length}`, "Configured model engines", "Settings")}
    </div>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head">
          <h2>Provider Health</h2>
          <span class="helper-text">${ready} ready</span>
        </div>
        <table>
          <thead><tr><th>Provider</th><th>Status</th></tr></thead>
          <tbody>
            ${providers.map(([name, ok]) => `<tr><td>${esc(name)}</td><td>${statusBadge(ok ? "ready" : "missing")}</td></tr>`).join("")}
          </tbody>
        </table>
      </section>
      <section class="panel">
        <div class="panel-head">
          <h2>Recent Events</h2>
          <span class="helper-text">${state.logs.length} events</span>
        </div>
        <div class="event-list">
          ${state.logs.slice(-6).reverse().map((log) => `<p><span>${esc(log.kind)}</span>${esc(log.message)}</p>`).join("") || `<p><span>idle</span>No VM events yet.</p>`}
        </div>
      </section>
    </div>
    ${consolePanel("Runtime Console")}`;
}

function pageHeader(title: string, description: string, actions = "") {
  return `
    <section class="page-header">
      <div>
        <div class="eyebrow">VM Console</div>
        <h1>${esc(title)}</h1>
        <p>${esc(description)}</p>
      </div>
      <div class="header-actions">${actions}</div>
    </section>`;
}

function card(title: string, value: string, note: string, page?: string) {
  return `
    <button class="metric-card" ${page ? `data-page="${esc(page)}"` : ""}>
      <span>${esc(title)}</span>
      <strong>${esc(value)}</strong>
      <p>${esc(note)}</p>
    </button>`;
}

function statusBadge(status: string) {
  const ok = status === "ready" || status === "running" || status === "ok";
  return `<span class="status ${ok ? "ok" : "warn"}"><i></i>${esc(status)}</span>`;
}

function objectsPage() {
  return `
    ${pageHeader("Objects", "Compiled AIF resources currently known to this VM server.")}
    <div class="split">
      <section class="panel">
        <div class="panel-head"><h2>Resource Inventory</h2><span class="helper-text">${state.objects.length} objects</span></div>
        <table>
          <thead><tr><th>ID</th><th>Type</th><th>Start</th><th>Pointers</th></tr></thead>
          <tbody>
            ${state.objects.map((object) => `
              <tr data-object="${esc(object.object_id)}" class="${state.selected?.object_id === object.object_id ? "selected" : ""}">
                <td>${esc(object.object_id)}</td>
                <td><span class="badge">${esc(object.type)}</span></td>
                <td>${object.start_flag ? "yes" : ""}</td>
                <td>${object.pointers.length}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </section>
      ${inspector()}
    </div>`;
}

function objectRank(object: AIFObject) {
  const ranks: Record<string, number> = {
    import: 0,
    var: 0,
    model: 1,
    prompt: 1,
    port: 2,
    agent: 2,
    run: 3
  };
  return ranks[object.type] ?? 1;
}

function objectGraphNodes() {
  const buckets = new Map<number, AIFObject[]>();
  state.objects.forEach((object) => {
    const rank = objectRank(object);
    buckets.set(rank, [...(buckets.get(rank) ?? []), object]);
  });
  const nodes: { object: AIFObject; x: number; y: number }[] = [];
  Array.from(buckets.entries()).sort(([a], [b]) => a - b).forEach(([rank, objects]) => {
    objects
      .sort((a, b) => a.object_id.localeCompare(b.object_id))
      .forEach((object, index) => {
        const saved = state.graphNodePositions[object.object_id];
        nodes.push({ object, x: saved?.x ?? 42 + rank * 200, y: saved?.y ?? 52 + index * 108 });
      });
  });
  return nodes;
}

function runTraceFromOutput(output: string) {
  const trace = Array.from(output.matchAll(/PointRun start:\s+([^\s]+)\s+\(/g)).map((match) => match[1]);
  return trace.filter((id, index) => trace.indexOf(id) === index);
}

function dragPointBlockTitle(kind: DragPointKind) {
  const titles: Record<DragPointKind, string> = {
    model: "Model",
    prompt: "Prompt",
    agent: "Agent",
    run: "Run",
    port: "Port"
  };
  return titles[kind];
}

function dragPointDefaults(kind: DragPointKind) {
  const count = state.dragPointBlocks.filter((block) => block.kind === kind).length + 1;
  const baseName: Record<DragPointKind, string> = {
    model: count === 1 ? "local" : `model${count}`,
    prompt: count === 1 ? "answer" : `prompt${count}`,
    agent: count === 1 ? "helper" : `agent${count}`,
    run: count === 1 ? "main" : `run${count}`,
    port: count === 1 ? "api" : `port${count}`
  };
  return baseName[kind];
}

function connectorPath(from: CanvasPoint, to: CanvasPoint, width = 150, height = 68, fromOffsetY = 0, toOffsetY = 0) {
  const fromCenter = { x: from.x + width / 2, y: from.y + height / 2 };
  const toCenter = { x: to.x + width / 2, y: to.y + height / 2 };
  const leftToRight = toCenter.x >= fromCenter.x;
  const start = {
    x: leftToRight ? from.x + width : from.x,
    y: fromCenter.y + fromOffsetY
  };
  const end = {
    x: leftToRight ? to.x : to.x + width,
    y: toCenter.y + toOffsetY
  };
  const distance = Math.max(80, Math.abs(end.x - start.x) * 0.45);
  const c1 = { x: start.x + (leftToRight ? distance : -distance), y: start.y };
  const c2 = { x: end.x - (leftToRight ? distance : -distance), y: end.y };
  return {
    d: `M ${start.x} ${start.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${end.x} ${end.y}`,
    labelX: (start.x + end.x) / 2,
    labelY: (start.y + end.y) / 2 - 8
  };
}

function dragPointWirePath(wire: DragPointWire, from: DragPointBlock, to: DragPointBlock) {
  const targetOffsets: Record<string, number> = {
    model: -13,
    prompt: 13,
    runs: 0
  };
  const visualSource = to;
  const visualTarget = from;
  return connectorPath(visualSource, visualTarget, 150, 68, 0, targetOffsets[wire.label] ?? 0);
}

function sourceString(value: string) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\n", "\\n")}"`;
}

function dragPointSource() {
  const blocks = state.dragPointBlocks;
  const wires = state.dragPointWires;
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const byKind = (kind: DragPointKind) => blocks.filter((block) => block.kind === kind);
  const wireTargets = (block: DragPointBlock, label: string) =>
    wires
      .filter((wire) => wire.from === block.id && wire.label === label)
      .map((wire) => byId.get(wire.to))
      .filter((target): target is DragPointBlock => Boolean(target));
  const lines: string[] = ["import ai.local.ollama", ""];

  for (const block of byKind("model")) {
    lines.push(`model ${block.name} {`, `    engine = "ollama"`, `    name = "llama3.2"`, `}`, "");
  }
  for (const block of byKind("prompt")) {
    lines.push(`prompt ${block.name} {`, `    text = ${sourceString(block.promptText || "Answer clearly and briefly: {input}")}`, `}`, "");
  }
  for (const block of byKind("agent")) {
    const model = wireTargets(block, "model")[0] ?? byKind("model")[0];
    const prompt = wireTargets(block, "prompt")[0] ?? byKind("prompt")[0];
    lines.push(`agent ${block.name} {`);
    if (model) lines.push(`    model = ${model.name}`);
    if (prompt) lines.push(`    prompt = ${prompt.name}`);
    lines.push(`}`, "");
  }
  for (const block of byKind("port")) {
    const target = wireTargets(block, "runs")[0] ?? byKind("agent")[0];
    lines.push(`port ${block.name} {`, `    protocol = "http"`, `    host = "127.0.0.1"`, `    port = 8080`);
    if (target) lines.push("", "    on_request {", `        return ${target.name}`, "    }");
    lines.push(`}`, "");
  }
  const runBlocks = byKind("run");
  runBlocks.forEach((block, index) => {
    const target = wireTargets(block, "runs")[0] ?? byKind("agent")[0] ?? byKind("port")[0];
    if (index === 0) lines.push("// $start$");
    if (target) {
      lines.push(`run ${target.kind} ${target.name} on "What is PointRun?"`, "");
    } else {
      lines.push(`run agent helper on "What is PointRun?"`, "");
    }
  });

  return lines.join("\n").trimEnd();
}

function dragPointsPage() {
  const blockOptions = state.dragPointBlocks.map((block) => `<option value="${esc(block.id)}">${esc(block.name)} (${esc(block.kind)})</option>`).join("");
  const promptBlocks = state.dragPointBlocks.filter((block) => block.kind === "prompt");
  const source = dragPointSource();
  const wires = state.dragPointWires.map((wire) => {
    const from = state.dragPointBlocks.find((block) => block.id === wire.from);
    const to = state.dragPointBlocks.find((block) => block.id === wire.to);
    if (!from || !to) return "";
    const path = dragPointWirePath(wire, from, to);
    return `<path d="${path.d}" />
            <text x="${path.labelX}" y="${path.labelY}">${esc(wire.label)}</text>`;
  }).join("");
  return `
    ${pageHeader("Drag Points", "Build AInfra by placing blocks and connecting object pointers.", `<button id="drag-generate-source">Send To IDE</button><button id="drag-compile">Compile Graph</button>`)}
    <div class="dragpoints-grid">
      <section class="panel drag-palette">
        <div class="panel-head"><h2>Blocks</h2><span class="helper-text">drag into canvas</span></div>
        ${(["model", "prompt", "agent", "run", "port"] as DragPointKind[]).map((kind) => `
          <button class="drag-block-palette" draggable="true" data-drag-kind="${kind}">
            <strong>${esc(dragPointBlockTitle(kind))}</strong>
            <span>${kind === "agent" ? "connect model + prompt" : kind === "run" ? "entry point" : "AIF object"}</span>
          </button>
        `).join("")}
        <form id="wire-form" class="wire-form">
          <h3>Wire Objects</h3>
          <label>From <select id="wire-from">${blockOptions}</select></label>
          <label>To <select id="wire-to">${blockOptions}</select></label>
          <label>Pointer
            <select id="wire-label">
              <option value="runs">runs</option>
              <option value="model">model</option>
              <option value="prompt">prompt</option>
            </select>
          </label>
          <button type="submit">Add Wire</button>
        </form>
        ${promptBlocks.length ? `
          <div class="prompt-editor-list">
            <h3>Prompt Text</h3>
            ${promptBlocks.map((block) => `
              <label>${esc(block.name)}
                <textarea class="small-textarea drag-prompt-input" data-prompt-block="${esc(block.id)}">${esc(block.promptText || "Answer clearly and briefly: {input}")}</textarea>
              </label>
            `).join("")}
          </div>
        ` : ""}
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Canvas</h2><span class="helper-text">${state.dragPointBlocks.length} blocks, ${state.dragPointWires.length} wires</span></div>
        <div id="drag-canvas" class="drag-canvas">
          <svg class="drag-wire-layer" viewBox="0 0 900 460" preserveAspectRatio="none">
            <defs><marker id="drag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>
            <g>${wires}</g>
          </svg>
          ${state.dragPointBlocks.map((block) => `
            <div class="drag-point-block ${esc(block.kind)}" draggable="true" data-block-id="${esc(block.id)}" style="left:${block.x}px; top:${block.y}px">
              <span>${esc(dragPointBlockTitle(block.kind))}</span>
              <strong>${esc(block.name)}</strong>
              <button class="block-remove" data-remove-block="${esc(block.id)}" title="Remove block">x</button>
            </div>
          `).join("")}
        </div>
      </section>
      <section class="panel drag-source-panel">
        <div class="panel-head"><h2>Generated Source</h2><span class="helper-text">compiler input</span></div>
        <pre id="drag-generated-source">${esc(source)}</pre>
      </section>
    </div>`;
}

function graphPage() {
  const nodes = objectGraphNodes();
  const pos = new Map(nodes.map((node) => [node.object.object_id, node]));
  const trace = new Set(state.lastRunTrace);
  const graphWidth = Math.max(980, ...nodes.map((node) => node.x + 250));
  const graphHeight = Math.max(620, ...nodes.map((node) => node.y + 130));
  const edges = state.objects.flatMap((object) =>
    object.pointers.map((pointer) => {
      const a = pos.get(object.object_id);
      const b = pos.get(pointer.target_object_id);
      if (!a || !b) return "";
      const highlighted = trace.has(object.object_id) && trace.has(pointer.target_object_id);
      const path = connectorPath(a, b, 198, 72);
      return `<path class="${highlighted ? "hot" : ""}" d="${path.d}" />
              <text x="${path.labelX}" y="${path.labelY}">${esc(pointer.pointer_type)}</text>`;
    })
  ).join("");
  return `
    ${pageHeader("Graph", "Pointer relationships between compiled AIF objects and the last PointRun VM position.")}
    <div class="graph-page-grid">
      <section class="panel">
        <div class="panel-head">
          <h2>Object Graph</h2>
          <span class="helper-text">${state.lastRunObjectId ? `VM at ${esc(state.lastRunObjectId)}` : "drag blocks or run to place VM marker"}</span>
        </div>
        <div id="object-graph-canvas" class="graph-canvas" style="--graph-width:${graphWidth}px; --graph-height:${graphHeight}px">
          <svg class="graph-wire-layer" viewBox="0 0 ${graphWidth} ${graphHeight}">
            <defs><marker id="graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs>
            <g class="edges">${edges}</g>
          </svg>
          ${nodes.map(({ object, x, y }) => `
            <button class="graph-object-block ${object.type} ${object.start_flag ? "start" : ""} ${trace.has(object.object_id) ? "visited" : ""}" draggable="true" data-object="${esc(object.object_id)}" data-graph-object="${esc(object.object_id)}" style="left:${x}px; top:${y}px">
              <span>${esc(object.type)}${object.start_flag ? " / start" : ""}</span>
              <strong>${esc(object.name)}</strong>
              <small>${esc(object.object_id)}</small>
              ${state.lastRunObjectId === object.object_id ? `<i class="vm-marker">VM</i>` : ""}
            </button>`).join("")}
        </div>
      </section>
      ${inspector(true)}
    </div>`;
}

function inspector(withRun = false) {
  const object = state.selected;
  if (!object) return `<section class="panel"><h2>Inspector</h2><p>Select an object.</p></section>`;
  return `
    <section class="panel">
      <h2>${esc(object.object_id)}</h2>
      <span class="badge">${esc(object.type)}</span>
      ${withRun ? `<button id="run-selected">PointRun</button>` : ""}
      <h3>Properties</h3>
      <pre>${esc(JSON.stringify(object.properties, null, 2))}</pre>
      <h3>Pointers</h3>
      <pre>${esc(JSON.stringify(object.pointers, null, 2))}</pre>
    </section>`;
}

function vmPage() {
  return `
    ${pageHeader("VM Runtime", "Compile source, run the start object, or PointRun a specific object.", `<button id="run-start">Run Start</button>`)}
    <div class="split">
      <section class="panel">
        <div class="panel-head"><h2>Run Control</h2><span class="helper-text">AInfra input</span></div>
        <label>Object ID <input id="object-id" value="${esc(formValue("object-id", state.selected?.object_id ?? "run:1"))}"></label>
        <button id="run-object">PointRun Object</button>
        <h3>AInfra Source</h3>
        <textarea id="source">${esc(formValue("source", defaultSource))}</textarea>
        <button id="compile-source">Compile Source</button>
      </section>
      ${consolePanel()}
    </div>`;
}

function idePage() {
  const source = formValue("ide-source", defaultSource);
  return `
    ${pageHeader("AInfra IDE", "Write objects, compile to AIF, inspect the result, then run the VM from one workspace.", `<button id="ide-compile">Compile</button><button id="ide-run" class="ghost">Run Start</button>`)}
    <div class="ide-grid">
      <section class="panel ide-editor">
        <div class="panel-head">
          <h2>Source</h2>
          <div class="toolbar">
            ${state.ideOutputPath ? `<span class="badge">compiled</span>` : `<span class="status warn"><i></i>not compiled</span>`}
            <button class="ghost small" data-template="local">Local Agent</button>
            <button class="ghost small" data-template="openai">OpenAI Agent</button>
            <button class="ghost small" data-template="port">Port</button>
          </div>
        </div>
        <textarea id="ide-source" spellcheck="false">${esc(source)}</textarea>
        <div class="ide-actions">
          <label>Object ID <input id="ide-object-id" value="${esc(formValue("ide-object-id", state.selected?.object_id ?? "run:1"))}"></label>
          <button id="ide-pointrun">PointRun</button>
        </div>
      </section>
      <section class="panel assistant-panel">
        <div class="panel-head">
          <h2>Ops Assistant</h2>
          <span class="helper-text">local analysis</span>
        </div>
        <div class="assistant-thread">
          ${state.assistantMessages.map((message) => `<div class="assistant-message">${esc(message)}</div>`).join("")}
        </div>
        <form id="assistant-form" class="assistant-form">
          <textarea id="assistant-input" class="small-textarea" placeholder="Ask about the latest compile or VM failure...">${esc(formValue("assistant-input"))}</textarea>
          <button type="submit">Ask Assistant</button>
        </form>
      </section>
    </div>
    <div class="ide-bottom-grid">
      <section class="panel">
        <div class="panel-head"><h2>Compiled Objects</h2><span class="helper-text">${state.objects.length} loaded</span></div>
        <table>
          <thead><tr><th>ID</th><th>Type</th><th>Start</th></tr></thead>
          <tbody>${state.objects.slice(0, 10).map((object) => `
            <tr data-object="${esc(object.object_id)}">
              <td>${esc(object.object_id)}</td>
              <td>${esc(object.type)}</td>
              <td>${object.start_flag ? "yes" : ""}</td>
            </tr>`).join("")}</tbody>
        </table>
      </section>
      ${consolePanel("IDE Output")}
    </div>`;
}

function peersPage() {
  return `
    <section class="panel">
      <div class="panel-head"><h2>Peers</h2><button id="discover">Discover</button></div>
      <table>
        <thead><tr><th>Peer</th><th>Address</th><th>Status</th></tr></thead>
        <tbody>${state.peers.map((peer) => `<tr><td>${esc(peer.peer_id)}</td><td>${esc(peer.address)}</td><td>${statusBadge(peer.status)}</td></tr>`).join("")}</tbody>
      </table>
    </section>`;
}

function settingsPage() {
  const providers = state.health?.providers ? Object.entries(state.health.providers as Record<string, boolean>) : [];
  return `
    ${pageHeader("Settings", "Server configuration, provider key status, and local runtime paths.")}
    <section class="panel">
      <div class="panel-head"><h2>Environment</h2><span class="helper-text">Local backend</span></div>
      <table>
        <tbody>
          <tr><td>Server</td><td><strong>${esc(state.health?.server_name ?? "unknown")}</strong></td></tr>
          <tr><td>Backend</td><td><code>${esc(import.meta.env.VITE_API_BASE ?? "http://localhost:8000")}</code></td></tr>
          <tr><td>Autostart</td><td>${statusBadge(state.health?.autostart ? "ready" : "missing")}</td></tr>
          ${providers.map(([name, ok]) => `<tr><td>${esc(name)}</td><td>${statusBadge(ok ? "ready" : "missing")}</td></tr>`).join("")}
        </tbody>
      </table>
    </section>`;
}

function authPage() {
  return isAdmin() ? adminAuthPage() : userAuthPage();
}

function adminAuthPage() {
  const pending = state.privilegeRequests.filter((request) => request.status === "pending");
  return `
    ${pageHeader("Identity and Access", "Manage accounts, privileges, and access requests for this VM server.")}
    <div class="auth-grid">
      <section class="panel">
        <div class="panel-head"><h2>Accounts</h2><span class="helper-text">${state.authUsers.length} users</span></div>
        <form id="create-user-form" class="form-grid">
          <label>Username <input id="new-username" required value="${esc(formValue("new-username"))}"></label>
          <label>Password <input id="new-password" type="password" required value="${esc(formValue("new-password"))}"></label>
          <label>Full name <input id="new-full-name" value="${esc(formValue("new-full-name"))}"></label>
          <label>Email <input id="new-email" type="email" value="${esc(formValue("new-email"))}"></label>
          <label>Phone <input id="new-phone" value="${esc(formValue("new-phone"))}"></label>
          <label class="check-row"><input id="new-is-admin" type="checkbox" ${checkedAttr("new-is-admin")}> Admin</label>
          <button type="submit">Add Account</button>
        </form>
        <div class="account-list">
          ${state.authUsers.map((user) => accountCard(user)).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Privilege Requests</h2><span class="helper-text">${pending.length} pending</span></div>
        ${pending.length ? pending.map(requestCard).join("") : `<p class="subtle no-margin">No pending privilege requests.</p>`}
        <h3>History</h3>
        ${state.privilegeRequests.slice(0, 12).map((request) => `
          <p class="request-line"><strong>${esc(request.username)}</strong> ${esc(request.status)} ${esc(request.privilege)}<br><span>${esc(respondedBy(request))}</span></p>
        `).join("")}
      </section>
    </div>`;
}

function accountCard(user: AuthUser) {
  return `
    <article class="account-card">
      <div class="account-head">
        <div>
          <strong>${esc(user.username)}</strong>
          <p>${esc(user.full_name || "No full name")} ${user.email ? `- ${esc(user.email)}` : ""} ${user.phone ? `- ${esc(user.phone)}` : ""}</p>
        </div>
        ${user.username !== "admin" ? `<button class="danger" data-delete-user="${user.id}">Remove</button>` : `<span class="badge">default</span>`}
      </div>
      <div class="privilege-list">
        ${state.privileges.map((privilege) => {
          const enabled = user.privileges.includes(privilege);
          return `
            <button class="privilege-toggle ${enabled ? "enabled" : ""}" data-user="${user.id}" data-privilege="${esc(privilege)}" data-enabled="${enabled}">
              ${enabled ? "Revoke" : "Grant"} ${esc(privilege)}
            </button>`;
        }).join("")}
      </div>
    </article>`;
}

function requestCard(request: PrivilegeRequest) {
  return `
    <article class="request-card">
      <strong>${esc(request.username)} wants to have this privilege</strong>
      <p><span class="badge">${esc(request.privilege)}</span></p>
      ${request.reason ? `<p>${esc(request.reason)}</p>` : ""}
      <button data-resolve-request="${request.id}" data-approve="true">Grant</button>
      <button class="ghost" data-resolve-request="${request.id}" data-approve="false">Deny</button>
    </article>`;
}

function userAuthPage() {
  const current = state.user?.privileges ?? [];
  const available = state.privileges.filter((privilege) => !current.includes(privilege));
  return `
    ${pageHeader("Account Access", "Review your current privileges or request access from an admin.")}
    <div class="auth-grid">
      <section class="panel">
        <h2>Your Account</h2>
        <p><strong>${esc(state.user?.username)}</strong></p>
        <p>${esc(state.user?.full_name || "No full name on file")}</p>
        <h3>Current Privileges</h3>
        <div class="chip-row">${current.map((privilege) => `<span class="pill ok">${esc(privilege)}</span>`).join("") || `<span class="subtle">None yet.</span>`}</div>
      </section>
      <section class="panel">
        <h2>Request Privilege</h2>
        <form id="request-privilege-form">
          <label>Privilege
            <select id="request-privilege">
              ${available.map((privilege) => `<option value="${esc(privilege)}" ${selectedAttr("request-privilege", privilege)}>${esc(privilege)}</option>`).join("")}
            </select>
          </label>
          <label>Reason <textarea id="request-reason" class="small-textarea">${esc(formValue("request-reason"))}</textarea></label>
          <button type="submit" ${available.length ? "" : "disabled"}>Request Privilege</button>
        </form>
        <h3>Requests</h3>
        ${state.privilegeRequests.map((request) => `<p class="request-line">${esc(request.privilege)}: <strong>${esc(request.status)}</strong><br><span>${esc(respondedBy(request))}</span></p>`).join("")}
      </section>
    </div>`;
}

function formatTime(ts?: number | null) {
  if (!ts) return "";
  return new Date(ts * 1000).toLocaleString();
}

function respondedBy(request: PrivilegeRequest) {
  if (request.status === "pending") return "waiting for admin response";
  return `responded by ${request.resolver_username || "unknown admin"}`;
}

function notificationsPage() {
  const unread = state.notifications.filter((notification) => !notification.seen).length;
  const resolved = state.privilegeRequests.filter((request) => request.status !== "pending");
  return `
    ${pageHeader("Notifications", "Review alerts, access decisions, and privilege request responses.", `<button id="mark-notifications-seen" class="ghost">Mark All Read</button>`)}
    <div class="notifications-grid">
      <section class="panel">
        <div class="panel-head"><h2>Notification Center</h2><span class="helper-text">${unread} unread</span></div>
        <div class="notification-list">
          ${state.notifications.length ? state.notifications.map((notification) => `
            <article class="notification-card ${notification.seen ? "" : "unread"}">
              <div>
                <strong>${esc(notification.message)}</strong>
                <p>${esc(notification.kind)}${formatTime(notification.created_at) ? ` - ${esc(formatTime(notification.created_at))}` : ""}</p>
              </div>
              ${notification.seen ? `<span class="badge">read</span>` : `<span class="pill ok">new</span>`}
            </article>
          `).join("") : `<p class="subtle no-margin">No notifications yet.</p>`}
        </div>
      </section>
      <section class="panel">
        <div class="panel-head"><h2>Privilege Responses</h2><span class="helper-text">${resolved.length} handled</span></div>
        <div class="notification-list">
          ${state.privilegeRequests.length ? state.privilegeRequests.map((request) => `
            <article class="notification-card ${request.status === "pending" ? "pending" : ""}">
              <div>
                <strong>${esc(request.username)} requested ${esc(request.privilege)}</strong>
                <p>${esc(request.status)} - ${esc(respondedBy(request))}${request.resolved_at ? ` - ${esc(formatTime(request.resolved_at))}` : ""}</p>
              </div>
              <span class="badge">${esc(request.status)}</span>
            </article>
          `).join("") : `<p class="subtle no-margin">No privilege request history yet.</p>`}
        </div>
      </section>
    </div>`;
}

function consolePanel(title = "Console") {
  const text = state.output || state.logs.map((log) => `[${log.kind}] ${log.message}`).join("\n") || "Waiting for VM events...";
  return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2><span class="helper-text">stdout / events</span></div><pre class="console">${esc(text)}</pre></section>`;
}

function pageHtml() {
  switch (state.page) {
    case "Objects": return objectsPage();
    case "Graph": return graphPage();
    case "IDE": return idePage();
    case "Drag Points": return dragPointsPage();
    case "VM": return vmPage();
    case "Peers": return peersPage();
    case "Auth": return authPage();
    case "Notifications": return notificationsPage();
    case "Settings": return settingsPage();
    default: return dashboard();
  }
}

function toastHtml() {
  return `
    <div class="toast-stack">
      ${state.toasts.map((item) => `
        <button class="toast" data-toast="${item.id}" data-toast-action="${item.action ?? ""}">
          ${esc(item.message)}
        </button>`).join("")}
    </div>`;
}

function render() {
  captureFormValues();
  if (!state.user) {
    document.querySelector("#root")!.innerHTML = loginPage();
  } else {
    document.querySelector("#root")!.innerHTML = `<div class="shell">${nav()}<main>${topbar()}<div class="workspace">${pageHtml()}</div></main>${toastHtml()}</div>`;
  }
  bind();
}

function isEditing() {
  return Boolean(document.activeElement?.matches(EDITABLE_SELECTOR));
}

function safeRender() {
  if (!isEditing()) render();
}

function bind() {
  document.querySelector("#login-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = (document.querySelector("#login-username") as HTMLInputElement).value;
    const password = (document.querySelector("#login-password") as HTMLInputElement).value;
    try {
      const result = await login(username, password);
      setToken(result.token);
      state.user = result.user;
      state.page = "Dashboard";
      clearFormValues(["login-username", "login-password"]);
      await refreshAuth();
      await refreshNotifications(true);
      await refresh();
      toast(`Signed in as ${result.user.username}`);
    } catch (error) {
      toast(String(error));
    }
  });
  document.querySelector("#logout")?.addEventListener("click", async () => {
    try {
      await logout();
    } catch {
      // Local logout should still clear the browser session if the server is unavailable.
    }
    setToken(null);
    state.user = null;
    state.authUsers = [];
    state.privilegeRequests = [];
    state.notifications = [];
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-page]").forEach((button) => {
    button.onclick = async () => {
      state.page = button.dataset.page ?? "Dashboard";
      render();
      if (state.page === "Notifications" && state.user) {
        await markNotificationsSeen().catch(() => undefined);
        state.notifications = state.notifications.map((notification) => ({ ...notification, seen: 1 }));
        render();
      }
    };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-toast]").forEach((button) => {
    button.onclick = async () => {
      state.toasts = state.toasts.filter((item) => item.id !== Number(button.dataset.toast));
      if (button.dataset.toastAction === "auth") state.page = "Auth";
      if (state.user) await markNotificationsSeen().catch(() => undefined);
      await refresh().catch(() => render());
    };
  });
  document.querySelector("#mark-notifications-seen")?.addEventListener("click", async () => {
    if (!state.user) return;
    await markNotificationsSeen().catch(() => undefined);
    state.notifications = state.notifications.map((notification) => ({ ...notification, seen: 1 }));
    render();
  });
  document.querySelectorAll<HTMLElement>("[data-object]").forEach((el) => {
    el.onclick = () => {
      state.selected = state.objects.find((object) => object.object_id === el.dataset.object) ?? state.selected;
      render();
    };
  });
  document.querySelector("#run-start")?.addEventListener("click", async () => {
    await runAction(async () => runStart(), "run start", state.health?.start_object?.object_id ?? null);
  });
  document.querySelector("#run-selected")?.addEventListener("click", async () => {
    if (!state.selected) return;
    await runAction(async () => pointRun(state.selected!.object_id), `pointrun ${state.selected.object_id}`, state.selected.object_id);
  });
  document.querySelector("#run-object")?.addEventListener("click", async () => {
    const id = (document.querySelector("#object-id") as HTMLInputElement).value;
    await runAction(async () => pointRun(id), `pointrun ${id}`, id);
  });
  document.querySelector("#compile-source")?.addEventListener("click", async () => {
    const source = (document.querySelector("#source") as HTMLTextAreaElement).value;
    try {
      const result = await compileSource(source, "workspace");
      state.output = result.stdout || result.stderr;
      await refresh();
    } catch (error) {
      toast(String(error));
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-template]").forEach((button) => {
    button.onclick = () => {
      const template = button.dataset.template ?? "local";
      state.formValues["ide-source"] = template === "openai" ? openAiTemplate : template === "port" ? portTemplate : defaultSource;
      render();
    };
  });
  document.querySelector("#ide-compile")?.addEventListener("click", async () => {
    const source = (document.querySelector("#ide-source") as HTMLTextAreaElement).value;
    state.formValues["ide-source"] = source;
    try {
      const result = await compileSource(source, "workspace");
      state.output = result.stdout || result.stderr || "compile completed";
      state.ideOutputPath = result.output_path ?? state.ideOutputPath;
      state.assistantMessages = [...state.assistantMessages, analyzeOpsContext("compile", source)];
      await refresh();
    } catch (error) {
      state.output = String(error);
      state.assistantMessages = [...state.assistantMessages, analyzeOpsContext("compile", source, String(error))];
      toast(String(error));
      safeRender();
    }
  });
  document.querySelector("#ide-run")?.addEventListener("click", async () => {
    if (!state.ideOutputPath) {
      toast("Compile the IDE source before running it.");
      return;
    }
    await runAction(async () => runFile(state.ideOutputPath!), "run IDE file", state.objects.find((object) => object.start_flag)?.object_id ?? null);
  });
  document.querySelector("#ide-pointrun")?.addEventListener("click", async () => {
    const objectId = (document.querySelector("#ide-object-id") as HTMLInputElement).value;
    if (!state.ideOutputPath) {
      toast("Compile the IDE source before PointRun.");
      return;
    }
    await runAction(async () => runFile(state.ideOutputPath!, objectId), `pointrun ${objectId}`, objectId);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-drag-kind]").forEach((button) => {
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", `kind:${button.dataset.dragKind}`);
    });
  });
  document.querySelectorAll<HTMLElement>("[data-block-id]").forEach((blockEl) => {
    blockEl.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", `block:${blockEl.dataset.blockId}`);
    });
  });
  document.querySelectorAll<HTMLElement>("[data-graph-object]").forEach((blockEl) => {
    blockEl.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", `graph:${blockEl.dataset.graphObject}`);
    });
  });
  const graphCanvas = document.querySelector<HTMLElement>("#object-graph-canvas");
  if (graphCanvas) {
    graphCanvas.addEventListener("dragover", (event) => event.preventDefault());
    graphCanvas.addEventListener("drop", (event) => {
      event.preventDefault();
      const payload = event.dataTransfer?.getData("text/plain") ?? "";
      if (!payload.startsWith("graph:")) return;
      const objectId = payload.slice(6);
      const rect = graphCanvas.getBoundingClientRect();
      state.graphNodePositions = {
        ...state.graphNodePositions,
        [objectId]: {
          x: Math.max(12, event.clientX - rect.left + graphCanvas.scrollLeft - 98),
          y: Math.max(12, event.clientY - rect.top + graphCanvas.scrollTop - 36)
        }
      };
      render();
    });
  }
  const dragCanvas = document.querySelector<HTMLElement>("#drag-canvas");
  if (dragCanvas) {
    dragCanvas.addEventListener("dragover", (event) => event.preventDefault());
    dragCanvas.addEventListener("drop", (event) => {
      event.preventDefault();
      const payload = event.dataTransfer?.getData("text/plain") ?? "";
      const rect = dragCanvas.getBoundingClientRect();
      const x = Math.max(8, Math.min(730, event.clientX - rect.left - 80));
      const y = Math.max(8, Math.min(380, event.clientY - rect.top - 30));
      if (payload.startsWith("kind:")) {
        const kind = payload.slice(5) as DragPointKind;
        const id = `dp-${kind}-${Date.now()}`;
        state.dragPointBlocks = [
          ...state.dragPointBlocks,
          {
            id,
            kind,
            name: dragPointDefaults(kind),
            x,
            y,
            ...(kind === "prompt" ? { promptText: "Answer clearly and briefly: {input}" } : {})
          }
        ];
      }
      if (payload.startsWith("block:")) {
        const id = payload.slice(6);
        state.dragPointBlocks = state.dragPointBlocks.map((block) => block.id === id ? { ...block, x, y } : block);
      }
      render();
    });
  }
  document.querySelectorAll<HTMLTextAreaElement>("[data-prompt-block]").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const id = textarea.dataset.promptBlock ?? "";
      state.dragPointBlocks = state.dragPointBlocks.map((block) =>
        block.id === id ? { ...block, promptText: textarea.value } : block
      );
      const sourcePanel = document.querySelector<HTMLElement>("#drag-generated-source");
      if (sourcePanel) sourcePanel.textContent = dragPointSource();
    });
  });
  document.querySelector("#wire-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const from = (document.querySelector("#wire-from") as HTMLSelectElement).value;
    const to = (document.querySelector("#wire-to") as HTMLSelectElement).value;
    const label = (document.querySelector("#wire-label") as HTMLSelectElement).value;
    if (!from || !to || from === to) {
      toast("Pick two different blocks for the wire.");
      return;
    }
    state.dragPointWires = [
      ...state.dragPointWires.filter((wire) => !(wire.from === from && wire.label === label)),
      { id: `wire-${Date.now()}`, from, to, label }
    ];
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-remove-block]").forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      const id = button.dataset.removeBlock ?? "";
      state.dragPointBlocks = state.dragPointBlocks.filter((block) => block.id !== id);
      state.dragPointWires = state.dragPointWires.filter((wire) => wire.from !== id && wire.to !== id);
      render();
    };
  });
  document.querySelector("#drag-generate-source")?.addEventListener("click", () => {
    state.formValues["ide-source"] = dragPointSource();
    state.page = "IDE";
    toast("Drag Points source sent to IDE.");
    render();
  });
  document.querySelector("#drag-compile")?.addEventListener("click", async () => {
    const source = dragPointSource();
    state.formValues["ide-source"] = source;
    try {
      const result = await compileSource(source, "drag-points");
      state.output = result.stdout || result.stderr || "compile completed";
      state.ideOutputPath = result.output_path ?? state.ideOutputPath;
      state.assistantMessages = [...state.assistantMessages, analyzeOpsContext("drag compile", source)];
      await refresh();
    } catch (error) {
      state.output = String(error);
      toast(String(error));
      safeRender();
    }
  });
  document.querySelector("#assistant-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = (document.querySelector("#assistant-input") as HTMLTextAreaElement).value.trim();
    if (!question) return;
    clearFormValues(["assistant-input"]);
    const source = (document.querySelector("#ide-source") as HTMLTextAreaElement | null)?.value ?? formValue("ide-source", defaultSource);
    state.assistantMessages = [
      ...state.assistantMessages,
      `You: ${question}`,
      analyzeOpsContext(question, source)
    ];
    render();
  });
  document.querySelector("#discover")?.addEventListener("click", async () => {
    state.peers = await discoverPeers();
    render();
  });
  document.querySelector("#create-user-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await createUser({
        username: (document.querySelector("#new-username") as HTMLInputElement).value,
        password: (document.querySelector("#new-password") as HTMLInputElement).value,
        full_name: (document.querySelector("#new-full-name") as HTMLInputElement).value,
        phone: (document.querySelector("#new-phone") as HTMLInputElement).value,
        email: (document.querySelector("#new-email") as HTMLInputElement).value,
        is_admin: (document.querySelector("#new-is-admin") as HTMLInputElement).checked,
        privileges: []
      });
      clearFormValues(["new-username", "new-password", "new-full-name", "new-phone", "new-email", "new-is-admin"]);
      toast("Account created");
      await refreshAuth();
      render();
    } catch (error) {
      toast(String(error));
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-delete-user]").forEach((button) => {
    button.onclick = async () => {
      try {
        await deleteUser(Number(button.dataset.deleteUser));
        toast("Account removed");
        await refreshAuth();
        render();
      } catch (error) {
        toast(String(error));
      }
    };
  });
  document.querySelectorAll<HTMLButtonElement>("[data-user][data-privilege]").forEach((button) => {
    button.onclick = async () => {
      try {
        const userId = Number(button.dataset.user);
        const privilege = button.dataset.privilege ?? "";
        const enabled = button.dataset.enabled !== "true";
        await changeUserPrivilege(userId, privilege, enabled);
        toast(enabled ? "Privilege granted" : "Privilege revoked");
        await refreshAuth();
        render();
      } catch (error) {
        toast(String(error));
      }
    };
  });
  document.querySelector("#request-privilege-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const privilege = (document.querySelector("#request-privilege") as HTMLSelectElement).value;
      const reason = (document.querySelector("#request-reason") as HTMLTextAreaElement).value;
      await requestPrivilege(privilege, reason);
      clearFormValues(["request-privilege", "request-reason"]);
      toast("Privilege request sent");
      await refreshAuth();
      render();
    } catch (error) {
      toast(String(error));
    }
  });
  document.querySelectorAll<HTMLButtonElement>("[data-resolve-request]").forEach((button) => {
    button.onclick = async () => {
      try {
        await resolvePrivilegeRequest(Number(button.dataset.resolveRequest), button.dataset.approve === "true");
        toast(button.dataset.approve === "true" ? "Privilege granted" : "Privilege denied");
        await refreshAuth();
        render();
      } catch (error) {
        toast(String(error));
      }
    };
  });
}

async function runAction(action: () => Promise<{ stdout: string; stderr: string }>, label = "run", requestedObjectId: string | null = null) {
  try {
    const result = await action();
    state.output = result.stdout || result.stderr;
    const trace = runTraceFromOutput(state.output);
    state.lastRunTrace = trace.length ? trace : requestedObjectId ? [requestedObjectId] : [];
    state.lastRunObjectId = state.lastRunTrace.length ? state.lastRunTrace[state.lastRunTrace.length - 1] : requestedObjectId;
    state.assistantMessages = [...state.assistantMessages, analyzeOpsContext(label, formValue("ide-source", defaultSource), state.output)];
    await refresh();
  } catch (error) {
    state.output = String(error);
    state.lastRunTrace = requestedObjectId ? [requestedObjectId] : [];
    state.lastRunObjectId = requestedObjectId;
    state.assistantMessages = [...state.assistantMessages, analyzeOpsContext(label, formValue("ide-source", defaultSource), String(error))];
    toast(String(error));
  }
}

function analyzeOpsContext(intent: string, source: string, explicitOutput = "") {
  const recentLogs = state.logs.slice(-8).map((log) => `[${log.kind}] ${log.message}`).join("\n");
  const output = `${explicitOutput}\n${state.output}`.trim();
  const sourceLower = source.toLowerCase();
  const activeLower = `${intent}\n${source}\n${output}`.toLowerCase();
  const historyLower = recentLogs.toLowerCase();
  const suggestions: string[] = [];

  if (sourceLower.includes("openai") && !state.health?.openai_key_available) {
    suggestions.push("OpenAI is referenced but OPENAI_API_KEY is not available to the backend. Use the Local Agent template or export OPENAI_API_KEY before starting the backend.");
  }
  if (activeLower.includes("incorrect api key") || activeLower.includes("401")) {
    suggestions.push("The OpenAI key reached the API but was rejected. Rotate the key and restart the backend with the valid environment variable.");
  }
  if (activeLower.includes("not found") && activeLower.includes("/api/auth/login")) {
    suggestions.push("The UI is pointed at a backend that does not expose auth routes. Restart the backend on the same API_BASE the UI is using.");
  }
  if (activeLower.includes("compile") && activeLower.includes("error")) {
    suggestions.push("Check required block properties: models need engine, agents need model and prompt references, and run targets must match an existing agent/model/port name.");
  }
  if (activeLower.includes("agent.model") || activeLower.includes("does not reference")) {
    suggestions.push("The agent model reference does not match a model block. Rename the model or update `model = ...` inside the agent.");
  }
  if (activeLower.includes("unknown") && activeLower.includes("value")) {
    suggestions.push("The VM failed while reading output. Rebuild the compiler and VM, then recompile the source so the AIF format matches the runtime.");
  }
  if (sourceLower.includes("ollama")) {
    suggestions.push("Ollama is a local stub in this prototype, so it should be the safest template for compile/run demos without cloud keys.");
  }
  if (!suggestions.length && historyLower.includes("openai connector failed")) {
    suggestions.push("Recent logs include OpenAI connector failures, but the active source does not require OpenAI unless you choose that template.");
  }
  if (!source.includes("// $start$")) {
    suggestions.push("Add `// $start$` before the block or run statement you want InfraOS to treat as the default start object.");
  }
  if (!/run\s+(agent|model|port)\s+/i.test(source)) {
    suggestions.push("Add a `run agent ... on \"input\"` or `run port ...` statement so the VM has an executable entrypoint.");
  }
  if (!suggestions.length) {
    suggestions.push("No obvious failure signature found. Compile first, then run start; if it fails, paste the stderr/output here and I will narrow it down.");
  }

  return `Ops Assistant: ${suggestions.slice(0, 4).join(" ")}`;
}

connectEvents((event) => {
  state.logs = [...state.logs.slice(-99), event];
  safeRender();
});

window.setInterval(() => {
  if (!state.user) return;
  refreshNotifications().then(() => safeRender()).catch(() => undefined);
}, 5000);

boot().catch((error) => {
  state.output = String(error);
  render();
});
