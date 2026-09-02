import { contextBridge, ipcRenderer } from "electron";
import type { ArchitectureGraph } from "../shared/architecture";
import type { Range } from "../shared/language";
import type { AgentRequest, AgentEvent } from "../shared/agent";
import type { DebugState, DebugAction } from "../shared/execution";
import type { Preferences, SettingsSnapshot } from "../shared/settings";
import type { SessionUpdate } from "../shared/session";
import type { RemoteProfileSnapshot, SshProfileDraft } from "../shared/remote";
import type { WorkspaceToolingSnapshot } from "../shared/tooling";
import type { RuntimeTraceSession } from "../shared/runtime-trace";

function subscribe<T>(channel: string, listener: (event: T) => void) {
  const wrapped = (_event: Electron.IpcRendererEvent, payload: T) =>
    listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld("witch", {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    save: (preferences: Preferences) =>
      ipcRenderer.invoke("settings:save", preferences),
    importExtension: () => ipcRenderer.invoke("settings:import-extension"),
    toggleExtension: (id: string, enabled: boolean) =>
      ipcRenderer.invoke("settings:toggle-extension", id, enabled),
    removeExtension: (id: string) =>
      ipcRenderer.invoke("settings:remove-extension", id),
    onChanged: (listener: (snapshot: SettingsSnapshot) => void) =>
      subscribe("settings:changed", listener),
  },
  execution: {
    catalog: () => ipcRenderer.invoke("execution:catalog"),
    configure: (kind: "launch" | "tasks", activeFile?: string) =>
      ipcRenderer.invoke("execution:configure", kind, activeFile),
  },
  trace: {
    list: () => ipcRenderer.invoke("trace:list"),
    get: (id: string) => ipcRenderer.invoke("trace:get", id),
    start: (id: string, activeFile?: string) =>
      ipcRenderer.invoke("trace:start", id, activeFile),
    stop: (id: string) => ipcRenderer.invoke("trace:stop", id),
    onUpdated: (listener: (session: RuntimeTraceSession) => void) =>
      subscribe("trace:updated", listener),
  },
  tooling: {
    status: () => ipcRenderer.invoke("tooling:status"),
    selectPython: (id: string | null, root?: string) =>
      ipcRenderer.invoke("tooling:select-python", id, root),
    onChanged: (listener: (snapshot: WorkspaceToolingSnapshot) => void) =>
      subscribe("tooling:changed", listener),
  },
  debug: {
    status: () => ipcRenderer.invoke("debug:status"),
    breakpoints: () => ipcRenderer.invoke("debug:breakpoints"),
    setBreakpoints: (path: string, lines: number[]) =>
      ipcRenderer.invoke("debug:set-breakpoints", path, lines),
    start: (id: string | null, activeFile?: string) =>
      ipcRenderer.invoke("debug:start", id, activeFile),
    action: (action: DebugAction) => ipcRenderer.invoke("debug:action", action),
    variables: (objectId: string) =>
      ipcRenderer.invoke("debug:variables", objectId),
    onState: (listener: (state: DebugState) => void) =>
      subscribe("debug:state", listener),
  },
  workspace: {
    session: (root: string) => ipcRenderer.invoke("workspace:session", root),
    saveSession: (session: SessionUpdate) =>
      ipcRenderer.invoke("workspace:save-session", session),
    open: () => ipcRenderer.invoke("workspace:open"),
    current: () => ipcRenderer.invoke("workspace:current"),
    recent: () => ipcRenderer.invoke("workspace:recent"),
    openRecent: (root: string) =>
      ipcRenderer.invoke("workspace:open-recent", root),
    files: () => ipcRenderer.invoke("workspace:files"),
    entries: () => ipcRenderer.invoke("workspace:entries"),
    dirty: (paths: string[], root?: string) =>
      ipcRenderer.invoke("workspace:dirty", paths, root),
    readDocument: (path: string, root?: string) =>
      ipcRenderer.invoke("workspace:read-document", path, root),
    onChanged: (listener: (event: { root: string; paths: string[] }) => void) =>
      subscribe("workspace:changed", listener),
    onWarning: (listener: (message: string) => void) =>
      subscribe("workspace:warning", listener),
    readFile: (filePath: string) =>
      ipcRenderer.invoke("workspace:read-file", filePath),
    writeFile: (
      filePath: string,
      content: string,
      expectedHash?: string,
      root?: string,
    ) =>
      ipcRenderer.invoke(
        "workspace:write-file",
        filePath,
        content,
        expectedHash,
        root,
      ),
    createFile: (filePath: string, content?: string, root?: string) =>
      ipcRenderer.invoke("workspace:create-file", filePath, content, root),
    createFolder: (filePath: string, root?: string) =>
      ipcRenderer.invoke("workspace:create-folder", filePath, root),
    move: (sourcePath: string, destinationPath: string, root?: string) =>
      ipcRenderer.invoke("workspace:move", sourcePath, destinationPath, root),
    delete: (filePath: string, confirmed: boolean, root?: string) =>
      ipcRenderer.invoke("workspace:delete", filePath, confirmed, root),
    search: (query: string, root?: string) =>
      ipcRenderer.invoke("workspace:search", query, root),
    cancelSearch: () => ipcRenderer.invoke("workspace:cancel-search"),
    gitStatus: () => ipcRenderer.invoke("workspace:git-status"),
  },
  analysis: {
    start: () => ipcRenderer.invoke("analysis:start"),
    clearIndex: () => ipcRenderer.invoke("analysis:clear-index"),
    compose: (
      request: import("../shared/semantic-composer").SemanticComposerRequest,
    ) => ipcRenderer.invoke("analysis:compose", request),
    snapshots: () => ipcRenderer.invoke("analysis:snapshots"),
    current: () => ipcRenderer.invoke("analysis:current"),
    delta: (snapshotId: string) =>
      ipcRenderer.invoke("analysis:delta", snapshotId),
    export: (format: "json" | "html") =>
      ipcRenderer.invoke("analysis:export", format),
    onUpdated: (listener: (graph: ArchitectureGraph) => void) =>
      subscribe("analysis:updated", listener),
    onError: (listener: (error: string) => void) =>
      subscribe("analysis:error", listener),
  },
  agent: {
    status: () => ipcRenderer.invoke("agent:status"),
    list: () => ipcRenderer.invoke("agent:list"),
    start: (request: AgentRequest) =>
      ipcRenderer.invoke("agent:start", request),
    resume: (id: string, prompt: string) =>
      ipcRenderer.invoke("agent:resume", id, prompt),
    fork: (
      id: string,
      providerId: AgentRequest["providerId"],
      prompt: string,
    ) => ipcRenderer.invoke("agent:fork", id, providerId, prompt),
    stop: () => ipcRenderer.invoke("agent:stop"),
    apply: (id: string, paths: string[]) =>
      ipcRenderer.invoke("agent:apply", id, paths),
    archive: (id: string) => ipcRenderer.invoke("agent:archive", id),
    restore: (id: string) => ipcRenderer.invoke("agent:restore", id),
    onEvent: (listener: (event: AgentEvent) => void) =>
      subscribe("agent:event", listener),
  },
  lsp: {
    status: () => ipcRenderer.invoke("lsp:status"),
    open: (path: string, content: string, root?: string) =>
      ipcRenderer.invoke("lsp:open", path, content, root),
    change: (path: string, content: string, root?: string) =>
      ipcRenderer.invoke("lsp:change", path, content, root),
    close: (path: string, root?: string) =>
      ipcRenderer.invoke("lsp:close", path, root),
    completion: (path: string, position: LspPosition, root?: string) =>
      ipcRenderer.invoke("lsp:completion", path, position, root),
    hover: (path: string, position: LspPosition, root?: string) =>
      ipcRenderer.invoke("lsp:hover", path, position, root),
    signatureHelp: (
      path: string,
      position: LspPosition,
      context?: import("../shared/language").SignatureContext,
      root?: string,
    ) =>
      ipcRenderer.invoke("lsp:signature-help", path, position, context, root),
    resolveCompletion: (id: string) =>
      ipcRenderer.invoke("lsp:resolve-completion", id),
    definition: (path: string, position: LspPosition, root?: string) =>
      ipcRenderer.invoke("lsp:definition", path, position, root),
    references: (path: string, position: LspPosition, root?: string) =>
      ipcRenderer.invoke("lsp:references", path, position, root),
    symbols: (path: string, root?: string) =>
      ipcRenderer.invoke("lsp:symbols", path, root),
    rename: (
      path: string,
      position: LspPosition,
      name: string,
      root?: string,
    ) => ipcRenderer.invoke("lsp:rename", path, position, name, root),
    codeActions: (path: string, range: Range, root?: string) =>
      ipcRenderer.invoke("lsp:code-actions", path, range, root),
    resolveAction: (id: string) => ipcRenderer.invoke("lsp:resolve-action", id),
    onStatus: (listener: (status: LspStatus) => void) =>
      subscribe("lsp:status", listener),
    onDiagnostics: (
      listener: (event: {
        language?: import("../shared/language").LanguageProviderId;
        path: string;
        diagnostics: LspDiagnostic[];
      }) => void,
    ) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        payload: {
          language?: import("../shared/language").LanguageProviderId;
          path: string;
          diagnostics: LspDiagnostic[];
        },
      ) => listener(payload);
      ipcRenderer.on("lsp:diagnostics", wrapped);
      return () => ipcRenderer.removeListener("lsp:diagnostics", wrapped);
    },
  },
  tasks: { list: () => ipcRenderer.invoke("tasks:list") },
  providers: {
    status: () => ipcRenderer.invoke("providers:status"),
    connectCli: (provider: "codex" | "claude") =>
      ipcRenderer.invoke("providers:connect-cli", provider),
    saveApiKey: (provider: ApiProviderId, key: string) =>
      ipcRenderer.invoke("providers:save-api-key", provider, key),
    removeApiKey: (provider: ApiProviderId) =>
      ipcRenderer.invoke("providers:remove-api-key", provider),
  },
  cua: {
    status: () => ipcRenderer.invoke("cua:status"),
    connect: () => ipcRenderer.invoke("cua:connect"),
    disconnect: () => ipcRenderer.invoke("cua:disconnect"),
    listWindows: () => ipcRenderer.invoke("cua:list-windows"),
  },
  remote: {
    list: () => ipcRenderer.invoke("remote:list"),
    status: () => ipcRenderer.invoke("remote:status"),
    saveProfile: (profile: SshProfileDraft) =>
      ipcRenderer.invoke("remote:save-profile", profile),
    removeProfile: (id: string) =>
      ipcRenderer.invoke("remote:remove-profile", id),
    onChanged: (listener: (snapshot: RemoteProfileSnapshot) => void) =>
      subscribe("remote:changed", listener),
  },
  terminal: {
    list: () => ipcRenderer.invoke("terminal:list"),
    attach: (id: string) => ipcRenderer.invoke("terminal:attach", id),
    runTask: (id: string, activeFile?: string) =>
      ipcRenderer.invoke("terminal:run-task", id, activeFile),
    onExit: (listener: (event: { id: string; exitCode: number }) => void) =>
      subscribe("terminal:exit", listener),
    create: (options: {
      cwd?: string;
      cols?: number;
      rows?: number;
      remoteProfileId?: string;
    }) => ipcRenderer.invoke("terminal:create", options),
    write: (id: string, data: string) =>
      ipcRenderer.invoke("terminal:write", id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke("terminal:resize", id, cols, rows),
    close: (id: string) => ipcRenderer.invoke("terminal:close", id),
    onData: (
      listener: (event: import("../shared/execution").TerminalData) => void,
    ) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        payload: import("../shared/execution").TerminalData,
      ) => listener(payload);
      ipcRenderer.on("terminal:data", wrapped);
      return () => ipcRenderer.removeListener("terminal:data", wrapped);
    },
  },
});
