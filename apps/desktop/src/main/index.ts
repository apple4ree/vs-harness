import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  shell,
} from "electron";
import {
  ChildProcessWithoutNullStreams,
  spawn,
  spawnSync,
} from "node:child_process";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import pty, { IPty } from "node-pty";
import chokidar, { type FSWatcher } from "chokidar";
import { searchRepository } from "./services/workspace-search";
import { RepositoryAnalysisService } from "./services/repository-analysis";
import { LanguageServer } from "./services/language-server";
import { AgentService } from "./services/agent-service";
import { NodeDebugService } from "./services/node-debugger";
import { SettingsService } from "./services/settings-service";
import { SessionStore } from "./services/session-store";
import { WorkspaceOperation } from "./services/workspace-operation";
import { WorkbenchStore } from "./services/workbench-store";
import {
  ProviderKeyStore,
  type ApiProviderId,
} from "./services/provider-key-store";
import type {
  SnapshotMetadata as Snapshot,
  TaskRecord,
} from "../shared/history";
import { cliEnvironment, findCliExecutable } from "./services/cli-discovery";
import type { SessionUpdate } from "../shared/session";
import {
  validateExtension,
  type Preferences,
  type SettingsSnapshot,
} from "../shared/settings";
import {
  executionCatalog,
  resolveLaunch,
  resolveTask,
} from "./services/execution-config";
import type { DebugAction } from "../shared/execution";
import {
  listWorkspace,
  readWorkspaceText,
  writeWorkspaceText,
  isEditorTemporary,
  resolveWorkspacePath,
  assertMutablePath,
  contentHash,
  DEFAULT_IGNORES,
} from "./services/workspace-files";
import type {
  ArchitectureGraph,
  ArchitectureNode,
  ArchitectureEdge,
} from "../shared/architecture";
import type { Range, SignatureContext } from "../shared/language";
import type { AgentRequest } from "../shared/agent";
import { compareArchitectureGraphs } from "../shared/architecture-delta";
import {
  renderArchitectureHtml,
  serializeArchitectureJson,
} from "../shared/architecture-export";

// Explicit profile override allows development and packaged smoke tests without touching a real profile.
if (process.env.WITCH_USER_DATA_DIR) {
  if (!path.isAbsolute(process.env.WITCH_USER_DATA_DIR))
    throw new Error("WITCH_USER_DATA_DIR must be an absolute path");
  app.setPath("userData", process.env.WITCH_USER_DATA_DIR);
}
// Two processes sharing a profile would overwrite settings, recovery, and run history.
// Separate WITCH_USER_DATA_DIR profiles remain independent.
const ownsProfile = app.requestSingleInstanceLock();
if (!ownsProfile) app.quit();

type Workspace = { root: string; name: string; branch: string; status: string };
type FileEntry = { path: string; extension: string; size: number };
type LspPosition = { line: number; character: number };
type LspDiagnostic = {
  message: string;
  severity?: number;
  start: LspPosition;
  end: LspPosition;
  source?: string;
  code?: string | number;
};
type LspStatus = { installed: boolean; connected: boolean; message: string };
type LspLocation = { path: string; start: LspPosition; end: LspPosition };
type LspCompletion = {
  label: string;
  detail?: string;
  documentation?: string;
  kind?: number;
  insertText?: string;
};
type GraphNode = ArchitectureNode;
type GraphEdge = ArchitectureEdge;
type AnalysisGraph = ArchitectureGraph;
type CuaStatus = {
  installed: boolean;
  executable?: string;
  version?: string;
  connected: boolean;
  mode: "disconnected" | "bounded-observe";
  message: string;
  tools: string[];
};
type CodexStatus = {
  installed: boolean;
  executable?: string;
  version?: string;
  connected: boolean;
  running: boolean;
  message: string;
};
type CliProviderStatus = {
  installed: boolean;
  executable?: string;
  version?: string;
  message: string;
};
type ApiProviderStatus = {
  configured: boolean;
  encryptionAvailable: boolean;
  updatedAt?: string;
  message: string;
};
type ProviderStatus = {
  codex: CodexStatus;
  claude: CliProviderStatus;
  openaiApi: ApiProviderStatus;
  anthropicApi: ApiProviderStatus;
};

const terminalSessions = new Map<string, IPty>();
const terminalSnapshots = new Map<
  string,
  {
    id: string;
    cwd: string;
    shell: string;
    root: string;
    buffer: string;
    sequence: number;
  }
>();
let currentWorkspace: Workspace | null = null;
let applicationWindow: BrowserWindow | null = null;
let quitRequested = false;
let shutdownStarted = false;
let shutdownComplete = false;
const pendingDesktopCalls = new Set<Promise<unknown>>();
let languageService: LanguageServer | null = null;
let workspaceWatcher: FSWatcher | null = null;
let watcherTimer: NodeJS.Timeout | null = null;
let latestGraph: ArchitectureGraph | null = null;
let searchController: AbortController | null = null;
let graphGeneration = 0;
let agentService: AgentService | null = null;
let debugService: NodeDebugService | null = null;
let executionBusy = false;
let settingsService: SettingsService | null = null;
let providerKeyStore: ProviderKeyStore | null = null;
let sessionStore: SessionStore | null = null;
const repositoryAnalysis = new RepositoryAnalysisService();
const workspaceOperation = new WorkspaceOperation();
let acceptingSessionUpdates = true;
let applyingAgentChanges = false;
let dirtyPaths = new Set<string>();
let cuaMcp: ChildProcessWithoutNullStreams | null = null;
let cuaBuffer = "";
let cuaRequestId = 0;
const cuaPending = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();

const cuaObserveManifest = `# Managed by Witch. This policy is deliberately read-only.
version: 3
expires_after: 1h
idle_timeout: 10m
resources: {}
allow:
  tools:
    - check_permissions
    - get_accessibility_tree
    - get_config
    - get_cursor_position
    - get_screen_size
    - get_window_state
    - health_report
    - list_apps
    - list_windows
deny:
  tools:
    - browser_click
    - browser_download
    - browser_navigate
    - browser_pointer
    - browser_set_input_files
    - browser_type
    - click
    - clipboard_read
    - clipboard_write
    - double_click
    - drag
    - hotkey
    - kill_app
    - launch_app
    - move_cursor
    - press_key
    - right_click
    - scroll
    - type_text
`;

let historyStore: WorkbenchStore | null = null;
function getHistoryStore() {
  if (!historyStore)
    historyStore = new WorkbenchStore(
      path.join(app.getPath("userData"), "state"),
      (message) => {
        if (!applicationWindow?.isDestroyed())
          applicationWindow?.webContents.send("workspace:warning", message);
      },
    );
  return historyStore;
}
const loadWitchState = () => getHistoryStore().get();

async function atomicWriteText(target: string, contents: string) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${randomUUID()}.tmp`,
  );
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(contents, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, target);
  } finally {
    await fs.unlink(temporary).catch(() => undefined);
  }
}

async function recordProjectOpen(workspace: Workspace) {
  const now = new Date().toISOString();
  const lastCommit =
    git(workspace.root, ["rev-parse", "HEAD"]) || "uncommitted";
  await getHistoryStore().update((state) => {
    const existing = state.projects.find(
      (project) => project.root === workspace.root,
    );
    if (existing)
      Object.assign(existing, {
        name: workspace.name,
        lastOpenedAt: now,
        lastBranch: workspace.branch,
        lastCommit,
      });
    else
      state.projects.unshift({
        root: workspace.root,
        name: workspace.name,
        lastOpenedAt: now,
        lastBranch: workspace.branch,
        lastCommit,
      });
    state.projects = state.projects
      .sort((left, right) =>
        right.lastOpenedAt.localeCompare(left.lastOpenedAt),
      )
      .slice(0, 30);
  });
}

async function saveSnapshot(
  workspace: Workspace,
  graph: AnalysisGraph,
): Promise<Snapshot> {
  return getHistoryStore().saveSnapshot(
    graph,
    workspace.name,
    git(workspace.root, ["rev-parse", "HEAD"]) || "uncommitted",
  );
}

async function listSnapshots(workspaceRoot?: string): Promise<Snapshot[]> {
  const state = await loadWitchState();
  return state.snapshots.filter(
    (snapshot) => !workspaceRoot || snapshot.workspaceRoot === workspaceRoot,
  );
}

async function listTasks(workspaceRoot?: string): Promise<TaskRecord[]> {
  const state = await loadWitchState();
  return state.tasks.filter(
    (task) => !workspaceRoot || task.workspaceRoot === workspaceRoot,
  );
}

function git(root: string, args: string[]): string {
  const result = spawnSync(
    "git",
    ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", root, ...args],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 1500,
      maxBuffer: 1_000_000,
    },
  );
  return result.status === 0 ? result.stdout.trim() : "";
}

function findCuaExecutable(): string | null {
  const candidates = process.env.LOCALAPPDATA
    ? [
        path.join(
          process.env.LOCALAPPDATA,
          "Programs",
          "Cua",
          "cua-driver",
          "bin",
          "cua-driver.exe",
        ),
      ]
    : [];
  return findCliExecutable(
    "cua-driver",
    process.env.WITCH_CUA_DRIVER_PATH,
    candidates,
  );
}
function currentCuaStatus(
  message = "CUA executable detected. It is not connected until you enable observation.",
): CuaStatus {
  const executable = findCuaExecutable();
  return {
    installed: Boolean(executable),
    ...(executable ? { executable } : {}),
    connected: Boolean(cuaMcp),
    mode: cuaMcp ? "bounded-observe" : "disconnected",
    message: executable
      ? message
      : "CUA Driver is not installed. Install it before enabling Computer Use.",
    tools: [],
  };
}
function findCodexExecutable(): string | null {
  return findCliExecutable("codex", process.env.WITCH_CODEX_PATH);
}
function currentCodexStatus(): CodexStatus {
  const executable = findCodexExecutable();
  const running = Boolean(agentService?.isRunning());
  const connected = Boolean(agentService?.isConnected());
  return {
    installed: Boolean(executable),
    ...(executable ? { executable } : {}),
    connected,
    running,
    message: executable
      ? connected
        ? "Codex is connected for the current restricted agent request."
        : running
          ? "Witch is preparing or finishing the current agent request."
          : "Codex executable detected. Sign-in and connection are verified when starting a request."
      : "Codex CLI was not found. Install it, or set WITCH_CODEX_PATH to its absolute executable path.",
  };
}
function findClaudeExecutable(): string | null {
  return findCliExecutable("claude", process.env.WITCH_CLAUDE_PATH);
}
function currentClaudeStatus(): CliProviderStatus {
  const executable = findClaudeExecutable();
  return {
    installed: Boolean(executable),
    ...(executable ? { executable } : {}),
    message: executable
      ? "Claude Code executable detected. Its runtime adapter is not connected in this preview."
      : "Claude Code CLI was not found. Its runtime adapter is not connected in this preview.",
  };
}

function getProviderKeys() {
  return (providerKeyStore ||= new ProviderKeyStore(
    path.join(app.getPath("userData"), "providers"),
  ));
}

async function apiProviderStatus(
  provider: ApiProviderId,
): Promise<ApiProviderStatus> {
  if (!safeStorage.isEncryptionAvailable())
    return {
      configured: false,
      encryptionAvailable: false,
      message:
        "Operating-system secure credential storage is unavailable, so Witch will not accept an API key.",
    };
  let entry;
  try {
    entry = (await getProviderKeys().read()).keys[provider];
  } catch (error) {
    return {
      configured: false,
      encryptionAvailable: true,
      message: `Stored credentials could not be read and were kept unchanged. ${error}`,
    };
  }
  return entry
    ? {
        configured: true,
        encryptionAvailable: true,
        updatedAt: entry.updatedAt,
        message:
          "An encrypted API key is stored locally. The key is never returned to the UI.",
      }
    : {
        configured: false,
        encryptionAvailable: true,
        message: "No API key is stored.",
      };
}

async function providerStatus(): Promise<ProviderStatus> {
  return {
    codex: currentCodexStatus(),
    claude: currentClaudeStatus(),
    openaiApi: await apiProviderStatus("openai"),
    anthropicApi: await apiProviderStatus("anthropic"),
  };
}

async function saveApiKey(
  provider: ApiProviderId,
  key: string,
): Promise<ProviderStatus> {
  if (!["openai", "anthropic"].includes(provider))
    throw new Error("Unsupported AI provider");
  const normalized = key.trim();
  if (normalized.length < 12 || normalized.length > 16_000)
    throw new Error("Enter a valid API key (12–16,000 characters)");
  if (!safeStorage.isEncryptionAvailable())
    throw new Error(
      "Operating-system secure credential storage is unavailable",
    );
  const encrypted = safeStorage.encryptString(normalized).toString("base64");
  await getProviderKeys().update((store) => {
    store.keys[provider] = { encrypted, updatedAt: new Date().toISOString() };
  });
  return providerStatus();
}

async function removeApiKey(provider: ApiProviderId): Promise<ProviderStatus> {
  if (!["openai", "anthropic"].includes(provider))
    throw new Error("Unsupported AI provider");
  await getProviderKeys().update((store) => {
    delete store.keys[provider];
  });
  return providerStatus();
}

async function ensureCuaObserveManifest(): Promise<string> {
  const directory = path.join(app.getPath("userData"), "cua");
  const manifestPath = path.join(directory, "witch-observe-policy.yaml");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(manifestPath, cuaObserveManifest, "utf8");
  return manifestPath;
}

function rejectCuaPending(reason: Error) {
  cuaPending.forEach(({ reject }) => reject(reason));
  cuaPending.clear();
}

function handleCuaLine(line: string) {
  let message: { id?: number; result?: unknown; error?: { message?: string } };
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (typeof message.id !== "number") return;
  const pending = cuaPending.get(message.id);
  if (!pending) return;
  cuaPending.delete(message.id);
  if (message.error)
    pending.reject(
      new Error(message.error.message || "CUA MCP request failed"),
    );
  else pending.resolve(message.result);
}

function cuaRequest(
  method: string,
  params?: Record<string, unknown>,
): Promise<unknown> {
  if (!cuaMcp) return Promise.reject(new Error("CUA Driver is not connected"));
  const id = ++cuaRequestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cuaPending.delete(id);
      reject(new Error(`CUA request timed out: ${method}`));
    }, 15_000);
    cuaPending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (reason) => {
        clearTimeout(timeout);
        reject(reason);
      },
    });
    cuaMcp?.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
    );
  });
}

async function connectCua(): Promise<CuaStatus> {
  if (cuaMcp)
    return currentCuaStatus(
      "CUA Driver is connected with Witch’s read-only policy.",
    );
  const executable = findCuaExecutable();
  if (!executable) return currentCuaStatus();
  const manifestPath = await ensureCuaObserveManifest();
  cuaMcp = spawn(executable, ["mcp", "--direct", "--no-overlay"], {
    windowsHide: true,
    env: {
      ...cliEnvironment(executable),
      CUA_DRIVER_PERMISSION_MODE: "bounded",
      CUA_DRIVER_CAPABILITY_MANIFEST_FILE: manifestPath,
      CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED: "true",
    },
  });
  cuaBuffer = "";
  cuaMcp.stdout.on("data", (chunk: Buffer) => {
    cuaBuffer += chunk.toString();
    const lines = cuaBuffer.split(/\r?\n/);
    cuaBuffer = lines.pop() || "";
    lines.filter(Boolean).forEach(handleCuaLine);
  });
  cuaMcp.stderr.on("data", () => undefined);
  cuaMcp.on("exit", () => {
    cuaMcp = null;
    rejectCuaPending(new Error("CUA Driver disconnected"));
  });
  try {
    await cuaRequest("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "Witch", version: app.getVersion() },
    });
    cuaMcp?.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    const listed = (await cuaRequest("tools/list")) as {
      tools?: Array<{ name?: string }>;
    };
    return {
      ...currentCuaStatus(
        "CUA Driver connected in bounded observe mode. Computer-control tools are blocked.",
      ),
      tools: (listed.tools || [])
        .map((tool) => tool.name || "")
        .filter(Boolean),
    };
  } catch (error) {
    cuaMcp?.kill();
    cuaMcp = null;
    return currentCuaStatus(
      error instanceof Error ? error.message : "Unable to start CUA Driver",
    );
  }
}

function disconnectCua(): CuaStatus {
  cuaMcp?.kill();
  cuaMcp = null;
  rejectCuaPending(new Error("CUA Driver disconnected by Witch"));
  return currentCuaStatus(
    "CUA Driver disconnected. No desktop controls remain available to Witch.",
  );
}

function workspaceFor(root: string): Workspace {
  const branch = git(root, ["branch", "--show-current"]) || "detached";
  const status = git(root, ["status", "--short", "--branch"]);
  return { root, name: path.basename(root), branch, status };
}

function safePath(root: string, relativePath: string): string {
  if (typeof relativePath !== "string" || !relativePath.trim())
    throw new Error("A workspace-relative path is required");
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Path escapes the active workspace");
  return resolved;
}

function getLanguageServer() {
  if (!languageService) {
    const unpacked = (file: string) =>
      file.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    languageService = new LanguageServer({
      runtime: process.execPath,
      entrypoint: unpacked(
        require.resolve("typescript-language-server/lib/cli.mjs"),
      ),
      tsserver: unpacked(require.resolve("typescript/lib/tsserver.js")),
      runAsNode: true,
    });
    languageService.on("diagnostics", (event) => {
      if (!applicationWindow?.isDestroyed())
        applicationWindow?.webContents.send("lsp:diagnostics", event);
    });
    languageService.on("status", (event) => {
      if (!applicationWindow?.isDestroyed())
        applicationWindow?.webContents.send("lsp:status", event);
    });
  }
  languageService.setWorkspace(currentWorkspace?.root || null);
  return languageService;
}

function getAgentService() {
  if (!agentService) {
    agentService = new AgentService({
      dataDirectory: path.join(app.getPath("userData"), "agent-runs"),
      command: findCodexExecutable,
      version: app.getVersion(),
    });
    agentService.on("event", (event) => {
      if (!applicationWindow?.isDestroyed())
        applicationWindow?.webContents.send("agent:event", event);
    });
  }
  return agentService;
}

function getDebugger() {
  if (!debugService) {
    debugService = new NodeDebugService({
      runtime: process.execPath,
      runAsNode: true,
      breakpointDirectory: path.join(app.getPath("userData"), "breakpoints"),
    });
    debugService.on("state", (state) => {
      if (!applicationWindow?.isDestroyed())
        applicationWindow?.webContents.send("debug:state", state);
    });
  }
  return debugService;
}

function getSessions() {
  return (sessionStore ||= new SessionStore(
    path.join(app.getPath("userData"), "editor-sessions"),
  ));
}
function getSettings() {
  return (settingsService ||= new SettingsService(
    path.join(app.getPath("userData"), "settings"),
  ));
}
function publishSettings(snapshot: SettingsSnapshot) {
  if (!applicationWindow?.isDestroyed())
    applicationWindow?.webContents.send("settings:changed", snapshot);
  return snapshot;
}

async function createTerminalSession(
  options: { cwd?: string; cols?: number; rows?: number },
  task?: Awaited<ReturnType<typeof resolveTask>>,
) {
  if (!currentWorkspace) throw new Error("Open a project first");
  if (terminalSessions.size >= 8)
    throw new Error("Close a terminal before opening another (maximum 8)");
  const root = currentWorkspace.root;
  const cwd =
    task?.cwd ||
    (options.cwd ? await resolveWorkspacePath(root, options.cwd) : root);
  if (currentWorkspace?.root !== root) throw new Error("Workspace changed");
  const id = crypto.randomUUID();
  const executable =
    process.platform === "win32"
      ? "powershell.exe"
      : process.env.SHELL || "/bin/bash";
  const args = task
    ? process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-Command", task.shellCommand]
      : ["-lc", task.shellCommand]
    : process.platform === "win32"
      ? ["-NoLogo"]
      : ["-l"];
  const session = pty.spawn(executable, args, {
    name: "xterm-256color",
    cols: Math.max(2, Math.min(500, Math.trunc(options.cols || 100))),
    rows: Math.max(2, Math.min(200, Math.trunc(options.rows || 20))),
    cwd,
    env: { ...cliEnvironment(), ...task?.env } as Record<string, string>,
  });
  terminalSessions.set(id, session);
  const snapshot = {
    id,
    cwd,
    shell: task?.label || executable,
    root,
    buffer: "",
    sequence: 0,
  };
  terminalSnapshots.set(id, snapshot);
  session.onData((data) => {
    snapshot.sequence++;
    snapshot.buffer = (snapshot.buffer + data).slice(-160_000);
    if (!applicationWindow?.isDestroyed())
      applicationWindow?.webContents.send("terminal:data", {
        id,
        data,
        sequence: snapshot.sequence,
      });
  });
  session.onExit(({ exitCode }) => {
    terminalSessions.delete(id);
    terminalSnapshots.delete(id);
    if (!applicationWindow?.isDestroyed())
      applicationWindow?.webContents.send("terminal:exit", { id, exitCode });
  });
  return { ...snapshot };
}

async function updateArchitecture(root: string): Promise<ArchitectureGraph> {
  const generation = ++graphGeneration;
  const graph = await repositoryAnalysis.analyze(root);
  if (generation === graphGeneration && currentWorkspace?.root === root) {
    latestGraph = graph;
    if (!applicationWindow?.isDestroyed())
      applicationWindow?.webContents.send("analysis:updated", graph);
  }
  return graph;
}

async function activateWorkspace(root: string): Promise<Workspace> {
  if (currentWorkspace && path.resolve(root) === currentWorkspace.root)
    return currentWorkspace;
  if (executionBusy || debugService?.isRunning())
    throw new Error("Stop the debug session before switching projects");
  if (agentService?.isRunning() || applyingAgentChanges)
    throw new Error("Stop the active agent before switching workspaces");
  if (dirtyPaths.size || terminalSessions.size) {
    const decision = await dialog.showMessageBox(applicationWindow!, {
      type: "warning",
      message: "Open another project?",
      detail: `${dirtyPaths.size ? `Unsaved edits will be discarded:\n${[...dirtyPaths].join("\n")}\n\n` : ""}${terminalSessions.size ? `${terminalSessions.size} terminal session(s) will be closed.` : ""}`,
      buttons: ["Cancel", "Discard and open"],
      defaultId: 0,
      cancelId: 0,
    });
    if (decision.response !== 1)
      throw new Error("Project switch canceled; unsaved edits were kept");
  }
  const resolved = await fs.realpath(root);
  if (!(await fs.stat(resolved)).isDirectory())
    throw new Error("Choose a folder");
  acceptingSessionUpdates = false;
  try {
    if (currentWorkspace && dirtyPaths.size)
      await getSessions().discardDrafts(currentWorkspace.root);
  } catch (error) {
    acceptingSessionUpdates = true;
    throw error;
  }
  terminalSessions.forEach((session) => session.kill());
  terminalSessions.clear();
  terminalSnapshots.clear();
  searchController?.abort(new Error("Search canceled by a project change"));
  await workspaceWatcher?.close();
  if (watcherTimer) clearTimeout(watcherTimer);
  graphGeneration++;
  latestGraph = null;
  dirtyPaths.clear();
  currentWorkspace = workspaceFor(resolved);
  acceptingSessionUpdates = true;
  getLanguageServer().setWorkspace(resolved);
  const changed = new Set<string>();
  workspaceWatcher = chokidar.watch(resolved, {
    ignoreInitial: true,
    ignored: (file) =>
      path
        .relative(resolved, file)
        .split(path.sep)
        .some((part) => DEFAULT_IGNORES.has(part) || isEditorTemporary(part)),
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 75 },
  });
  workspaceWatcher.on("all", (_event, filename) => {
    const relative = path.relative(resolved, filename).replaceAll("\\", "/");
    if (!relative || currentWorkspace?.root !== resolved) return;
    changed.add(relative);
    if (watcherTimer) clearTimeout(watcherTimer);
    watcherTimer = setTimeout(() => {
      const paths = [...changed];
      changed.clear();
      if (!applicationWindow?.isDestroyed())
        applicationWindow?.webContents.send("workspace:changed", {
          root: resolved,
          paths,
        });
      if (latestGraph && currentWorkspace?.root === resolved)
        void updateArchitecture(resolved).catch((error) => {
          if (
            currentWorkspace?.root === resolved &&
            !applicationWindow?.isDestroyed()
          )
            applicationWindow?.webContents.send(
              "analysis:error",
              String(error),
            );
        });
    }, 400);
  });
  workspaceWatcher.on("error", (error) => {
    if (
      currentWorkspace?.root === resolved &&
      !applicationWindow?.isDestroyed()
    )
      applicationWindow?.webContents.send(
        "analysis:error",
        `File watcher: ${error}`,
      );
  });
  await recordProjectOpen(currentWorkspace);
  return currentWorkspace;
}

async function refreshCurrentWorkspace(): Promise<Workspace> {
  if (!currentWorkspace) throw new Error("Open a repository first");
  currentWorkspace = workspaceFor(currentWorkspace.root);
  await recordProjectOpen(currentWorkspace);
  return currentWorkspace;
}

function assertWorkspaceRoot(expectedRoot?: string) {
  if (!currentWorkspace) throw new Error("Open a repository first");
  if (expectedRoot !== undefined && expectedRoot !== currentWorkspace.root)
    throw new Error("The project changed; this operation was not applied.");
}

function assertNoUnsavedFiles(relative: string) {
  const normalize = (value: string) => {
    const result = assertMutablePath(value);
    return process.platform === "win32" ? result.toLowerCase() : result;
  };
  const target = normalize(relative);
  if (
    [...dirtyPaths].some((file) => {
      const candidate = normalize(file);
      return candidate === target || candidate.startsWith(target + "/");
    })
  )
    throw new Error(
      "Save or close unsaved files inside this path before moving or deleting it.",
    );
}

async function createWorkspaceFile(
  relativePath: string,
  content = "",
): Promise<Workspace> {
  if (!currentWorkspace) throw new Error("Open a repository first");
  if (
    typeof content !== "string" ||
    Buffer.byteLength(content, "utf8") > 1_500_000
  )
    throw new Error("File content must be text under 1.5 MB");
  assertMutablePath(relativePath);
  const absolutePath = await resolveWorkspacePath(
    currentWorkspace.root,
    relativePath,
    true,
  );
  const parent = path.dirname(absolutePath);
  const parentStat = await fs.stat(parent).catch(() => null);
  if (!parentStat?.isDirectory())
    throw new Error("Create the parent folder first");
  if (await fs.lstat(absolutePath).catch(() => null))
    throw new Error("A file or folder already exists at that path");
  await fs.writeFile(absolutePath, content, { encoding: "utf8", flag: "wx" });
  return refreshCurrentWorkspace();
}

async function createWorkspaceFolder(relativePath: string): Promise<Workspace> {
  if (!currentWorkspace) throw new Error("Open a repository first");
  assertMutablePath(relativePath);
  const absolutePath = await resolveWorkspacePath(
    currentWorkspace.root,
    relativePath,
    true,
  );
  const parentStat = await fs
    .stat(path.dirname(absolutePath))
    .catch(() => null);
  if (!parentStat?.isDirectory())
    throw new Error("Create the parent folder first");
  if (await fs.lstat(absolutePath).catch(() => null))
    throw new Error("A file or folder already exists at that path");
  await fs.mkdir(absolutePath);
  return refreshCurrentWorkspace();
}

async function moveWorkspacePath(
  sourcePath: string,
  destinationPath: string,
): Promise<Workspace> {
  if (!currentWorkspace) throw new Error("Open a repository first");
  if (debugService?.isRunning())
    throw new Error("Stop the debugger before moving or deleting files");
  assertMutablePath(sourcePath);
  assertMutablePath(destinationPath);
  assertNoUnsavedFiles(sourcePath);
  const source = await resolveWorkspacePath(currentWorkspace.root, sourcePath);
  const destination = await resolveWorkspacePath(
    currentWorkspace.root,
    destinationPath,
    true,
  );
  const sourceStat = await fs.lstat(source).catch(() => null);
  if (!sourceStat)
    throw new Error("The source file or folder no longer exists");
  if (sourceStat.isSymbolicLink())
    throw new Error("Symbolic links cannot be moved through Witch");
  if (await fs.lstat(destination).catch(() => null))
    throw new Error("A file or folder already exists at the destination");
  const parentStat = await fs.stat(path.dirname(destination)).catch(() => null);
  if (!parentStat?.isDirectory())
    throw new Error("Create the destination folder first");
  if (
    sourceStat.isDirectory() &&
    (destination === source || destination.startsWith(`${source}${path.sep}`))
  )
    throw new Error("A folder cannot be moved into itself");
  await fs.rename(source, destination);
  await relocateBreakpointMetadata(
    currentWorkspace.root,
    sourcePath,
    destinationPath,
  );
  return refreshCurrentWorkspace();
}

async function deleteWorkspacePath(
  relativePath: string,
  confirmed: boolean,
): Promise<Workspace> {
  if (!currentWorkspace) throw new Error("Open a repository first");
  if (debugService?.isRunning())
    throw new Error("Stop the debugger before moving or deleting files");
  if (confirmed !== true)
    throw new Error("Deletion requires explicit confirmation");
  assertMutablePath(relativePath);
  assertNoUnsavedFiles(relativePath);
  const absolutePath = await resolveWorkspacePath(
    currentWorkspace.root,
    relativePath,
  );
  const stat = await fs.lstat(absolutePath).catch(() => null);
  if (!stat) throw new Error("The file or folder no longer exists");
  if (stat.isSymbolicLink())
    throw new Error("Symbolic links cannot be deleted through Witch");
  const decision = await dialog.showMessageBox(applicationWindow!, {
    type: "warning",
    message: `Move ${relativePath} to ${process.platform === "darwin" ? "Trash" : "Recycle Bin"}?`,
    detail: stat.isDirectory()
      ? "The folder and its contents will be moved. You can recover them using your operating system."
      : absolutePath,
    buttons: ["Cancel", "Move to trash"],
    defaultId: 0,
    cancelId: 0,
  });
  if (decision.response !== 1) throw new Error("Deletion canceled");
  assertNoUnsavedFiles(relativePath);
  await resolveWorkspacePath(currentWorkspace.root, relativePath);
  await shell.trashItem(absolutePath);
  await relocateBreakpointMetadata(currentWorkspace.root, relativePath);
  return refreshCurrentWorkspace();
}

async function relocateBreakpointMetadata(
  root: string,
  source: string,
  destination?: string,
) {
  try {
    await getDebugger().relocateBreakpoints(root, source, destination);
  } catch (error) {
    // The filesystem operation succeeded. Report a metadata failure honestly
    // without pretending that the file move/trash was rolled back.
    applicationWindow?.webContents.send(
      "workspace:warning",
      `The file operation completed, but saved breakpoints could not be updated. ${error}`,
    );
  }
}

const exclusiveWorkspaceOperations: Record<string, string> = {
  "workspace:open": "opening a project",
  "workspace:open-recent": "opening a project",
  "workspace:write-file": "saving a file",
  "workspace:create-file": "creating a file",
  "workspace:create-folder": "creating a folder",
  "workspace:move": "moving a file or folder",
  "workspace:delete": "moving a file or folder to trash",
  "agent:start": "starting an agent",
  "agent:apply": "applying reviewed changes",
  "agent:archive": "archiving a pending review",
  "execution:configure": "creating a project configuration",
  "terminal:create": "starting a terminal",
  "terminal:run-task": "starting a task",
  "debug:start": "starting the debugger",
};
const queuedWorkspaceOperations = new Set([
  "terminal:create",
  "terminal:run-task",
]);

function handleDesktop(
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1],
) {
  ipcMain.handle(channel, (event, ...args) => {
    if (shutdownStarted) throw new Error("Witch is shutting down");
    const contents = applicationWindow?.webContents;
    const frame = event.senderFrame;
    if (
      !contents ||
      contents.isDestroyed() ||
      event.sender !== contents ||
      !frame ||
      frame.processId !== contents.mainFrame.processId ||
      frame.routingId !== contents.mainFrame.routingId
    )
      throw new Error("Untrusted desktop IPC sender");
    const label = exclusiveWorkspaceOperations[channel];
    const invoke = () => listener(event, ...args);
    const operation = Promise.resolve(
      label
        ? queuedWorkspaceOperations.has(channel)
          ? workspaceOperation.enqueue(label, invoke)
          : workspaceOperation.run(label, invoke)
        : invoke(),
    );
    pendingDesktopCalls.add(operation);
    void operation.then(
      () => pendingDesktopCalls.delete(operation),
      () => pendingDesktopCalls.delete(operation),
    );
    return operation;
  });
}

function createWindow(): BrowserWindow {
  acceptingSessionUpdates = true;
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#100b18",
    title: "Witch",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "icon.png")
      : path.join(app.getAppPath(), "build/icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    // Vite full reload and the recovery screen reload the exact trusted document.
    // Prevent navigation to any other page, including another local file.
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  applicationWindow = window;
  let closing = false;
  let closeQueued = false;
  window.on("close", (event) => {
    if (workspaceOperation.busy) {
      event.preventDefault();
      if (!closeQueued) {
        closeQueued = true;
        void workspaceOperation.whenIdle().then(() => {
          setImmediate(() => {
            closeQueued = false;
            if (!window.isDestroyed()) {
              if (quitRequested) app.quit();
              else window.close();
            }
          });
        });
      }
      return;
    }
    if (closing) {
      event.preventDefault();
      return;
    }
    if (
      !dirtyPaths.size &&
      !agentService?.isRunning() &&
      !applyingAgentChanges &&
      !debugService?.isRunning() &&
      !terminalSessions.size &&
      !executionBusy
    )
      return;
    event.preventDefault();
    if (applyingAgentChanges || executionBusy) return;
    closing = true;
    void dialog
      .showMessageBox(window, {
        type: "warning",
        message: "Close Witch?",
        detail: `${dirtyPaths.size ? `${dirtyPaths.size} file(s) have unsaved edits. ` : ""}${agentService?.isRunning() ? "The running agent will be stopped. " : ""}${debugService?.isRunning() || terminalSessions.size ? "Debug and terminal processes will be stopped. " : ""}Saved files and completed review history are retained.`,
        buttons: ["Cancel", "Close without saving"],
        defaultId: 0,
        cancelId: 0,
      })
      .then(async (result) => {
        if (result.response === 1) {
          acceptingSessionUpdates = false;
          if (currentWorkspace)
            await getSessions().discardDrafts(currentWorkspace.root);
          await agentService?.stop();
          await debugService?.stop();
          terminalSessions.forEach((session) => session.kill());
          terminalSessions.clear();
          terminalSnapshots.clear();
          dirtyPaths.clear();
          window.destroy();
          if (process.platform !== "darwin" || quitRequested) app.quit();
        } else {
          closing = false;
          quitRequested = false;
        }
      })
      .catch((error) => {
        closing = false;
        quitRequested = false;
        acceptingSessionUpdates = true;
        console.error("Close confirmation failed", error);
      });
  });
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else window.loadFile(path.join(__dirname, "../renderer/index.html"));
  return window;
}

app.on("second-instance", () => {
  if (shutdownStarted) return;
  if (!applicationWindow || applicationWindow.isDestroyed()) {
    if (app.isReady()) createWindow();
    return;
  }
  if (applicationWindow.isMinimized()) applicationWindow.restore();
  applicationWindow.show();
  applicationWindow.focus();
});

app.whenReady().then(() => {
  if (!ownsProfile) return;
  const window = createWindow();
  applicationWindow = window;
  handleDesktop("workspace:open", async () => {
    const result = await dialog.showOpenDialog(applicationWindow!, {
      title: "Open repository",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return activateWorkspace(result.filePaths[0]);
  });
  handleDesktop("settings:get", () => getSettings().get());
  handleDesktop("settings:save", async (_event, value: Preferences) =>
    publishSettings(await getSettings().save(value)),
  );
  handleDesktop("settings:import-extension", async () => {
    const result = await dialog.showOpenDialog(applicationWindow!, {
      title: "Import Witch snippet extension",
      properties: ["openFile"],
      filters: [{ name: "Witch extension (JSON)", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return getSettings().get();
    const target = result.filePaths[0];
    if ((await fs.stat(target)).size > 1_500_000)
      throw new Error("Extension manifest exceeds 1.5 MB");
    const manifest = validateExtension(
      JSON.parse(await fs.readFile(target, "utf8")),
    );
    const choice = await dialog.showMessageBox(applicationWindow!, {
      type: "question",
      message: `Install ${manifest.name}?`,
      detail: `${manifest.id} · ${manifest.version}\n${manifest.snippets.length} snippet(s)\n\nThis replaces any installed extension with the same id. Extensions contribute text snippets only; no scripts or external services are executed.`,
      buttons: ["Cancel", "Install snippets"],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice.response !== 1) return getSettings().get();
    return publishSettings(await getSettings().install(manifest));
  });
  handleDesktop(
    "settings:toggle-extension",
    async (_event, id: string, enabled: boolean) =>
      publishSettings(await getSettings().toggle(id, enabled)),
  );
  handleDesktop("settings:remove-extension", async (_event, id: string) => {
    const target = await getSettings().extensionPath(id);
    await shell.trashItem(target);
    return publishSettings(await getSettings().get());
  });
  handleDesktop("workspace:current", () => currentWorkspace);
  handleDesktop("workspace:session", async (_event, root: string) => {
    if (!currentWorkspace || root !== currentWorkspace.root)
      throw new Error("Workspace changed");
    return getSessions().get(root);
  });
  handleDesktop(
    "workspace:save-session",
    async (_event, session: SessionUpdate) => {
      if (!acceptingSessionUpdates) return;
      if (!currentWorkspace || session?.root !== currentWorkspace.root)
        throw new Error("Workspace changed");
      return getSessions().save(currentWorkspace.root, session);
    },
  );
  handleDesktop(
    "workspace:recent",
    async () => (await loadWitchState()).projects,
  );
  handleDesktop("workspace:open-recent", async (_event, root: string) => {
    const project = (await loadWitchState()).projects.find(
      (item) => item.root === root,
    );
    if (!project)
      throw new Error("This project is not in Witch’s recent-project registry");
    const stat = await fs.stat(project.root).catch(() => null);
    if (!stat?.isDirectory())
      throw new Error("The saved project folder is no longer available");
    return activateWorkspace(project.root);
  });
  handleDesktop("workspace:files", async () =>
    currentWorkspace
      ? (await listWorkspace(currentWorkspace.root)).entries.filter(
          (entry) => entry.kind === "file",
        )
      : [],
  );
  handleDesktop("workspace:entries", async () =>
    currentWorkspace
      ? listWorkspace(currentWorkspace.root)
      : { entries: [], truncated: false, warnings: [] },
  );
  handleDesktop(
    "workspace:dirty",
    (_event, paths: string[], expectedRoot?: string) => {
      if (expectedRoot !== undefined && expectedRoot !== currentWorkspace?.root)
        return;
      if (
        !Array.isArray(paths) ||
        paths.length > 1000 ||
        paths.some((value) => typeof value !== "string")
      )
        throw new Error("Invalid editor state");
      dirtyPaths = new Set(paths.map(assertMutablePath));
    },
  );
  handleDesktop(
    "workspace:read-document",
    async (_event, relative: string, expectedRoot?: string) => {
      assertWorkspaceRoot(expectedRoot);
      const content = await readWorkspaceText(currentWorkspace!.root, relative);
      return { content, hash: contentHash(content) };
    },
  );
  handleDesktop("workspace:read-file", async (_event, relativePath: string) => {
    if (!currentWorkspace) throw new Error("Open a repository first");
    return readWorkspaceText(currentWorkspace.root, relativePath);
  });
  handleDesktop(
    "workspace:write-file",
    async (
      _event,
      relativePath: string,
      content: string,
      expectedHash?: string,
      expectedRoot?: string,
    ) => {
      assertWorkspaceRoot(expectedRoot);
      if (typeof content !== "string")
        throw new Error("File content must be text");
      if (Buffer.byteLength(content, "utf8") > 1_500_000)
        throw new Error("File is too large to save through the editor");
      const saved = await writeWorkspaceText(
        currentWorkspace!.root,
        relativePath,
        content,
        expectedHash,
      );
      const refreshed = await refreshCurrentWorkspace();
      return {
        ...saved,
        gitStatus: refreshed.status,
      };
    },
  );
  handleDesktop(
    "workspace:create-file",
    async (
      _event,
      relativePath: string,
      content?: string,
      expectedRoot?: string,
    ) => {
      assertWorkspaceRoot(expectedRoot);
      return createWorkspaceFile(relativePath, content);
    },
  );
  handleDesktop(
    "workspace:create-folder",
    async (_event, relativePath: string, expectedRoot?: string) => {
      assertWorkspaceRoot(expectedRoot);
      return createWorkspaceFolder(relativePath);
    },
  );
  handleDesktop(
    "workspace:move",
    async (
      _event,
      sourcePath: string,
      destinationPath: string,
      expectedRoot?: string,
    ) => {
      assertWorkspaceRoot(expectedRoot);
      return moveWorkspacePath(sourcePath, destinationPath);
    },
  );
  handleDesktop(
    "workspace:delete",
    async (
      _event,
      relativePath: string,
      confirmed: boolean,
      expectedRoot?: string,
    ) => {
      assertWorkspaceRoot(expectedRoot);
      return deleteWorkspacePath(relativePath, confirmed);
    },
  );
  handleDesktop("workspace:git-status", () => currentWorkspace?.status || "");
  handleDesktop(
    "workspace:search",
    async (_event, query: string, root?: string) => {
      assertWorkspaceRoot(root);
      searchController?.abort(new Error("Search superseded by a new query"));
      const controller = new AbortController();
      searchController = controller;
      try {
        return await searchRepository(currentWorkspace!.root, query, {
          signal: controller.signal,
        });
      } finally {
        if (searchController === controller) searchController = null;
      }
    },
  );
  handleDesktop("workspace:cancel-search", () => {
    searchController?.abort(new Error("Search canceled"));
  });
  handleDesktop("lsp:status", () => getLanguageServer().status());
  for (const channel of ["lsp:open", "lsp:change"])
    handleDesktop(
      channel,
      (_event, relative: string, content: string, root?: string) => {
        assertWorkspaceRoot(root);
        return getLanguageServer().sync(relative, content);
      },
    );
  handleDesktop("lsp:close", (_event, relative: string, root?: string) => {
    assertWorkspaceRoot(root);
    return getLanguageServer().close(relative);
  });
  handleDesktop(
    "lsp:completion",
    (_event, relative: string, position: LspPosition, root?: string) => {
      assertWorkspaceRoot(root);
      return getLanguageServer().completion(relative, position);
    },
  );
  handleDesktop(
    "lsp:hover",
    (_event, relative: string, position: LspPosition, root?: string) => {
      assertWorkspaceRoot(root);
      return getLanguageServer().hover(relative, position);
    },
  );
  handleDesktop(
    "lsp:signature-help",
    (
      _event,
      relative: string,
      position: LspPosition,
      context?: SignatureContext,
      root?: string,
    ) => {
      assertWorkspaceRoot(root);
      return getLanguageServer().signatureHelp(relative, position, context);
    },
  );
  handleDesktop("lsp:resolve-completion", (_event, id: string) =>
    getLanguageServer().resolveCompletion(id),
  );
  handleDesktop(
    "lsp:definition",
    (_event, relative: string, position: LspPosition, root?: string) => {
      assertWorkspaceRoot(root);
      return getLanguageServer().locations("definition", relative, position);
    },
  );
  handleDesktop(
    "lsp:references",
    (_event, relative: string, position: LspPosition, root?: string) => {
      assertWorkspaceRoot(root);
      return getLanguageServer().locations("references", relative, position);
    },
  );
  handleDesktop(
    "lsp:rename",
    (
      _event,
      relative: string,
      position: LspPosition,
      newName: string,
      root?: string,
    ) => {
      assertWorkspaceRoot(root);
      return getLanguageServer().rename(relative, position, newName);
    },
  );
  handleDesktop(
    "lsp:code-actions",
    (_event, relative: string, range: Range, root?: string) => {
      assertWorkspaceRoot(root);
      return getLanguageServer().codeActions(relative, range);
    },
  );
  handleDesktop("lsp:resolve-action", (_event, id: string) =>
    getLanguageServer().resolveAction(id),
  );
  handleDesktop("analysis:start", async () => {
    if (!currentWorkspace) throw new Error("Open a repository first");
    const workspace = currentWorkspace;
    const graph = await updateArchitecture(workspace.root);
    if (currentWorkspace?.root !== workspace.root)
      throw new Error("The active workspace changed");
    const snapshot = await saveSnapshot(workspace, graph);
    return { ...graph, snapshot };
  });
  handleDesktop("analysis:snapshots", async () =>
    listSnapshots(currentWorkspace?.root),
  );
  handleDesktop("analysis:current", () => latestGraph);
  handleDesktop("analysis:delta", async (_event, snapshotId: string) => {
    if (!currentWorkspace || !latestGraph)
      throw new Error("Open and analyze a repository first");
    const workspaceRoot = currentWorkspace.root;
    const head = latestGraph;
    const base = await getHistoryStore().loadSnapshot(
      snapshotId,
      workspaceRoot,
    );
    if (
      currentWorkspace?.root !== workspaceRoot ||
      head.workspaceRoot !== workspaceRoot
    )
      throw new Error("The active architecture reading is stale");
    return compareArchitectureGraphs(base, head);
  });
  handleDesktop("analysis:export", async (_event, format: "json" | "html") => {
    if (!currentWorkspace || !latestGraph)
      throw new Error("Open and analyze a repository first");
    if (!(["json", "html"] as const).includes(format))
      throw new Error("Unsupported architecture export format");
    if (latestGraph.workspaceRoot !== currentWorkspace.root)
      throw new Error("The active architecture reading is stale");
    const graph = latestGraph;
    const workspace = currentWorkspace;
    const extension = format;
    const suggested = `${workspace.name.replace(/[^a-z0-9._-]+/gi, "-") || "witch"}-architecture.${extension}`;
    const result = await dialog.showSaveDialog(applicationWindow!, {
      title: `Export Witch architecture ${format.toUpperCase()}`,
      defaultPath: path.join(app.getPath("documents"), suggested),
      filters: [
        {
          name: format === "html" ? "Self-contained HTML" : "Witch IR JSON",
          extensions: [extension],
        },
      ],
    });
    if (result.canceled || !result.filePath) return null;
    if (currentWorkspace?.root !== workspace.root)
      throw new Error("The active workspace changed before export");
    const contents =
      format === "html"
        ? renderArchitectureHtml(graph)
        : serializeArchitectureJson(graph);
    await atomicWriteText(result.filePath, contents);
    return result.filePath;
  });
  handleDesktop("agent:list", async () =>
    currentWorkspace ? getAgentService().list(currentWorkspace.root) : [],
  );
  handleDesktop("agent:start", async (_event, request: AgentRequest) => {
    if (!currentWorkspace) throw new Error("Open a repository first");
    if (applyingAgentChanges)
      throw new Error("Finish the current operation first");
    if (dirtyPaths.size)
      throw new Error(
        "Save or close unsaved files first. The agent reads the files saved on disk.",
      );
    const root = currentWorkspace.root;
    const graph = await updateArchitecture(root);
    if (currentWorkspace?.root !== root || dirtyPaths.size)
      throw new Error("The active workspace changed");
    return getAgentService().start(root, graph, request);
  });
  handleDesktop("agent:stop", () => getAgentService().stop());
  handleDesktop("agent:archive", async (_event, id: string) => {
    if (!currentWorkspace) throw new Error("Open a repository first");
    const root = currentWorkspace.root;
    const service = getAgentService();
    const run = (await service.list(root)).find((item) => item.id === id);
    if (!run || run.status !== "review" || service.isRunning())
      throw new Error(
        "Choose a pending review after the current agent finishes",
      );
    const decision = await dialog.showMessageBox(applicationWindow!, {
      type: "question",
      message: "Archive this review without applying its pending changes?",
      detail: `${run.changes.length} pending file change(s) will not be applied. Previously applied files are unaffected. The isolated workspace and a full review copy are retained locally; no source files are deleted.`,
      buttons: ["Cancel", "Archive without applying"],
      defaultId: 0,
      cancelId: 0,
    });
    if (decision.response !== 1)
      throw new Error("Archive canceled. The review is still available.");
    if (currentWorkspace?.root !== root)
      throw new Error("The active workspace changed");
    return service.archive(root, id);
  });
  handleDesktop("agent:apply", async (_event, id: string, paths: string[]) => {
    if (!currentWorkspace) throw new Error("Open a repository first");
    if (applyingAgentChanges)
      throw new Error("A review is already being applied");
    const root = currentWorkspace.root;
    const run = (await getAgentService().list(root)).find(
      (item) => item.id === id,
    );
    if (
      !run ||
      run.status !== "review" ||
      !Array.isArray(paths) ||
      !paths.length ||
      paths.some((file) => !run.changes.some((change) => change.path === file))
    )
      throw new Error("Select files from a completed review");
    if (paths.some((file) => dirtyPaths.has(file)))
      throw new Error(
        "Save or close unsaved edits in the selected files before applying",
      );
    applyingAgentChanges = true;
    try {
      const decision = await dialog.showMessageBox(applicationWindow!, {
        type: "warning",
        message: `Apply ${paths.length} reviewed change(s) to the original project?`,
        detail: `${root}\n\n${paths.join("\n")}\n\nA recovery copy is saved before changing the original files.`,
        buttons: ["Cancel", "Apply selected changes"],
        defaultId: 0,
        cancelId: 0,
      });
      if (decision.response !== 1)
        throw new Error("Apply canceled. The review is still available.");
      if (
        currentWorkspace?.root !== root ||
        paths.some((file) => dirtyPaths.has(file))
      )
        throw new Error("The workspace or editor changed while reviewing");
      const result = await getAgentService().apply(root, id, paths);
      await updateArchitecture(root);
      applicationWindow?.webContents.send("workspace:changed", { root, paths });
      return result;
    } finally {
      applyingAgentChanges = false;
    }
  });
  handleDesktop("tasks:list", async () => listTasks(currentWorkspace?.root));
  handleDesktop("providers:status", () => providerStatus());
  handleDesktop(
    "providers:save-api-key",
    async (_event, provider: ApiProviderId, key: string) =>
      saveApiKey(provider, key),
  );
  handleDesktop(
    "providers:remove-api-key",
    async (_event, provider: ApiProviderId) => removeApiKey(provider),
  );
  handleDesktop("cua:status", () => currentCuaStatus());
  handleDesktop("cua:connect", () => connectCua());
  handleDesktop("cua:disconnect", () => disconnectCua());
  handleDesktop("cua:list-windows", async () => {
    const result = await cuaRequest("tools/call", {
      name: "list_windows",
      arguments: {},
    });
    return JSON.stringify(result, null, 2);
  });
  handleDesktop(
    "terminal:create",
    (_event, options: { cwd?: string; cols?: number; rows?: number }) =>
      createTerminalSession(options),
  );
  handleDesktop("execution:catalog", () =>
    currentWorkspace
      ? executionCatalog(currentWorkspace.root)
      : { tasks: [], launches: [], warnings: [] },
  );
  handleDesktop(
    "execution:configure",
    async (_event, kind: "launch" | "tasks", activeFile?: string) => {
      if (!currentWorkspace || !["launch", "tasks"].includes(kind))
        throw new Error("Choose a project configuration");
      const root = currentWorkspace.root;
      for (const folder of [".witch", ".vscode"]) {
        const candidate = await resolveWorkspacePath(
          root,
          folder + "/" + kind + ".json",
          true,
        );
        if ((await fs.stat(candidate).catch(() => null))?.isFile())
          return folder + "/" + kind + ".json";
      }
      const directory = await resolveWorkspacePath(root, ".witch", true);
      await fs.mkdir(directory, { recursive: true });
      const program =
        activeFile && /\.[cm]?js$/i.test(activeFile) ? activeFile : "index.js";
      if (activeFile && program === activeFile)
        await resolveWorkspacePath(root, activeFile);
      const contents =
        kind === "launch"
          ? {
              version: "0.2.0",
              configurations: [
                {
                  type: "node",
                  request: "launch",
                  name: "Debug project",
                  program: "${workspaceFolder}/" + program,
                  stopOnEntry: true,
                },
              ],
            }
          : {
              version: "2.0.0",
              tasks: [
                {
                  label: "Run active file",
                  type: "process",
                  command: "node",
                  args: ["${file}"],
                },
              ],
            };
      await fs.writeFile(
        path.join(directory, kind + ".json"),
        JSON.stringify(contents, null, 2) + "\n",
        { flag: "wx" },
      );
      return ".witch/" + kind + ".json";
    },
  );
  handleDesktop(
    "terminal:run-task",
    async (_event, id: string, activeFile?: string) => {
      if (!currentWorkspace) throw new Error("Open a project first");
      if (executionBusy)
        throw new Error("Another execution request is pending");
      if (dirtyPaths.size)
        throw new Error("Save or close unsaved files before running a task");
      executionBusy = true;
      try {
        const root = currentWorkspace.root;
        const task = (await executionCatalog(root)).tasks.find(
          (item) => item.id === id,
        );
        if (!task)
          throw new Error(
            "This task no longer exists in the project configuration",
          );
        const resolved = await resolveTask(root, task, activeFile);
        const choice = await dialog.showMessageBox(applicationWindow!, {
          type: "warning",
          message: `Run ${task.label}?`,
          detail: `${resolved.shellCommand}\n\nWorking directory: ${resolved.cwd}\n\nThis is a local process with your user permissions, not an agent sandbox. Only run code you trust.`,
          buttons: ["Cancel", "Run task"],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response !== 1) throw new Error("Task canceled");
        if (currentWorkspace?.root !== root || dirtyPaths.size)
          throw new Error("The workspace changed while confirming");
        return createTerminalSession({}, resolved);
      } finally {
        executionBusy = false;
      }
    },
  );
  handleDesktop("debug:status", () => getDebugger().status());
  handleDesktop("debug:breakpoints", () =>
    currentWorkspace
      ? getDebugger().loadBreakpoints(currentWorkspace.root)
      : [],
  );
  handleDesktop(
    "debug:set-breakpoints",
    (_event, file: string, lines: number[]) => {
      if (!currentWorkspace) throw new Error("Open a project first");
      return getDebugger().setBreakpoints(currentWorkspace.root, file, lines);
    },
  );
  handleDesktop(
    "debug:start",
    async (_event, id: string | null, activeFile?: string) => {
      if (!currentWorkspace) throw new Error("Open a project first");
      if (executionBusy || getDebugger().isRunning())
        throw new Error("Stop the current debug session first");
      if (dirtyPaths.size)
        throw new Error("Save or close unsaved files before debugging");
      executionBusy = true;
      try {
        const root = currentWorkspace.root;
        const launch = id
          ? (await executionCatalog(root)).launches.find(
              (item) => item.id === id,
            )
          : {
              id: "active",
              name: "Debug active file",
              source: "active editor",
              program: activeFile || "",
              args: [],
              stopOnEntry: true,
            };
        if (!launch) throw new Error("Launch configuration no longer exists");
        const resolved = await resolveLaunch(root, launch, activeFile);
        const choice = await dialog.showMessageBox(applicationWindow!, {
          type: "warning",
          message: `Debug ${resolved.name}?`,
          detail: `Program: ${resolved.program}\nArguments: ${JSON.stringify(resolved.args)}\nWorking directory: ${resolved.cwd}\n\nThe program runs locally with your user permissions. Only run code you trust.`,
          buttons: ["Cancel", "Start debugger"],
          defaultId: 0,
          cancelId: 0,
        });
        if (choice.response !== 1) throw new Error("Debug start canceled");
        if (currentWorkspace?.root !== root || dirtyPaths.size)
          throw new Error("The workspace changed while confirming");
        return getDebugger().start(root, resolved);
      } finally {
        executionBusy = false;
      }
    },
  );
  handleDesktop("debug:action", (_event, action: DebugAction) =>
    getDebugger().action(action),
  );
  handleDesktop("debug:variables", (_event, objectId: string) =>
    getDebugger().variables(objectId),
  );
  handleDesktop("terminal:list", () =>
    [...terminalSnapshots.values()]
      .filter(
        (session) =>
          session.root === currentWorkspace?.root &&
          terminalSessions.has(session.id),
      )
      .map(({ id, cwd, shell }) => ({ id, cwd, shell })),
  );
  handleDesktop("terminal:attach", (_event, id: string) => {
    const session = terminalSnapshots.get(id);
    if (
      !session ||
      session.root !== currentWorkspace?.root ||
      !terminalSessions.has(id)
    )
      throw new Error("Terminal session is no longer available");
    return { ...session };
  });
  handleDesktop("terminal:write", (_event, id: string, data: string) =>
    terminalSessions.get(id)?.write(data),
  );
  handleDesktop(
    "terminal:resize",
    (_event, id: string, cols: number, rows: number) =>
      terminalSessions
        .get(id)
        ?.resize(
          Math.max(2, Math.min(500, Math.trunc(cols || 80))),
          Math.max(2, Math.min(200, Math.trunc(rows || 24))),
        ),
  );
  handleDesktop("terminal:close", (_event, id: string) =>
    terminalSessions.get(id)?.kill(),
  );
  app.on("activate", () => {
    if (!shutdownStarted && BrowserWindow.getAllWindows().length === 0)
      createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  quitRequested = true;
});
// before-quit precedes the unsaved-change confirmation: do not stop work when the user cancels.
app.on("will-quit", (event) => {
  if (shutdownComplete) return;
  event.preventDefault();
  if (shutdownStarted) return;
  shutdownStarted = true;
  acceptingSessionUpdates = false;
  void (async () => {
    repositoryAnalysis.dispose();
    searchController?.abort(new Error("Witch is shutting down"));
    if (watcherTimer) clearTimeout(watcherTimer);
    terminalSessions.forEach((session) => {
      try {
        session.kill();
      } catch (error) {
        console.error("Terminal shutdown failed", error);
      }
    });
    terminalSessions.clear();
    terminalSnapshots.clear();
    disconnectCua();
    const cleanup = await Promise.allSettled([
      debugService?.stop(),
      agentService?.stop(),
      languageService?.stop(),
      workspaceWatcher?.close(),
    ]);
    // No new IPC is accepted. Let already accepted operations settle before
    // waiting for their durable writes, including editor/session metadata.
    await Promise.allSettled([...pendingDesktopCalls]);
    cleanup.push(
      ...(await Promise.allSettled([
        sessionStore?.flush(),
        settingsService?.flush(),
        providerKeyStore?.flush(),
        historyStore?.flush(),
        debugService?.flush(),
      ])),
    );
    for (const result of cleanup)
      if (result.status === "rejected")
        console.error("Witch shutdown cleanup failed", result.reason);
  })()
    .catch((error) => console.error("Witch shutdown failed", error))
    .finally(() => {
      shutdownComplete = true;
      // Do not re-enter Electron's native quit loop from a will-quit microtask.
      setImmediate(() => app.quit());
    });
});
