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
  ideOutputPath: null
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
  return ["Dashboard", "Objects", "Graph", "IDE", "VM", "Peers", "Auth", "Settings"];
}

function pageMeta(page: string) {
  const meta: Record<string, { icon: string; group: string }> = {
    Dashboard: { icon: "OV", group: "Overview" },
    Objects: { icon: "OB", group: "Resources" },
    Graph: { icon: "GR", group: "Resources" },
    IDE: { icon: "ID", group: "Runtime" },
    VM: { icon: "VM", group: "Runtime" },
    Peers: { icon: "NW", group: "Runtime" },
    Auth: { icon: "AU", group: "Access" },
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
  const fresh = notifications.filter((notification) => !notification.seen && (showToasts || !oldIds.has(notification.id)));
  for (const notification of fresh.reverse()) {
    toast(notification.message, notification.kind === "privilege_request" ? "auth" : undefined);
  }
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

function graphPage() {
  const nodes = state.objects.map((object, index) => {
    const x = 80 + (index % 3) * 250;
    const y = 70 + Math.floor(index / 3) * 145;
    return { object, x, y };
  });
  const pos = new Map(nodes.map((node) => [node.object.object_id, node]));
  const edges = state.objects.flatMap((object) =>
    object.pointers.map((pointer) => {
      const a = pos.get(object.object_id);
      const b = pos.get(pointer.target_object_id);
      if (!a || !b) return "";
      return `<line x1="${a.x + 90}" y1="${a.y + 28}" x2="${b.x}" y2="${b.y + 28}" />
              <text x="${(a.x + b.x) / 2 + 40}" y="${(a.y + b.y) / 2 + 20}">${esc(pointer.pointer_type)}</text>`;
    })
  ).join("");
  return `
    ${pageHeader("Graph", "Pointer relationships between AIF objects and runtime execution targets.")}
    <div class="split">
      <section class="panel">
        <div class="panel-head"><h2>Object Graph</h2><span class="helper-text">Visual topology</span></div>
        <svg class="graph" viewBox="0 0 900 620">
          <g class="edges">${edges}</g>
          ${nodes.map(({ object, x, y }) => `
            <g class="node ${object.start_flag ? "start" : ""}" data-object="${esc(object.object_id)}" transform="translate(${x}, ${y})">
              <rect width="180" height="58" rx="7"></rect>
              <text x="12" y="24">${esc(object.name)}</text>
              <text x="12" y="44">${esc(object.type)}</text>
            </g>`).join("")}
        </svg>
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
          <p class="request-line"><strong>${esc(request.username)}</strong> ${esc(request.status)} ${esc(request.privilege)}</p>
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
        ${state.privilegeRequests.map((request) => `<p class="request-line">${esc(request.privilege)}: <strong>${esc(request.status)}</strong></p>`).join("")}
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
    case "VM": return vmPage();
    case "Peers": return peersPage();
    case "Auth": return authPage();
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
    button.onclick = () => {
      state.page = button.dataset.page ?? "Dashboard";
      render();
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
  document.querySelectorAll<HTMLElement>("[data-object]").forEach((el) => {
    el.onclick = () => {
      state.selected = state.objects.find((object) => object.object_id === el.dataset.object) ?? state.selected;
      render();
    };
  });
  document.querySelector("#run-start")?.addEventListener("click", async () => {
    await runAction(async () => runStart());
  });
  document.querySelector("#run-selected")?.addEventListener("click", async () => {
    if (!state.selected) return;
    await runAction(async () => pointRun(state.selected!.object_id));
  });
  document.querySelector("#run-object")?.addEventListener("click", async () => {
    const id = (document.querySelector("#object-id") as HTMLInputElement).value;
    await runAction(async () => pointRun(id));
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
    await runAction(async () => runFile(state.ideOutputPath!), "run IDE file");
  });
  document.querySelector("#ide-pointrun")?.addEventListener("click", async () => {
    const objectId = (document.querySelector("#ide-object-id") as HTMLInputElement).value;
    if (!state.ideOutputPath) {
      toast("Compile the IDE source before PointRun.");
      return;
    }
    await runAction(async () => runFile(state.ideOutputPath!, objectId), `pointrun ${objectId}`);
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

async function runAction(action: () => Promise<{ stdout: string; stderr: string }>, label = "run") {
  try {
    const result = await action();
    state.output = result.stdout || result.stderr;
    state.assistantMessages = [...state.assistantMessages, analyzeOpsContext(label, formValue("ide-source", defaultSource), state.output)];
    await refresh();
  } catch (error) {
    state.output = String(error);
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
