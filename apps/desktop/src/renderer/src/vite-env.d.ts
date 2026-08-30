/// <reference types="vite/client" />

declare global {
  type Workspace = {
    root: string;
    name: string;
    branch: string;
    status: string;
  };
  type FileEntry = { path: string; extension: string; size: number };
  type WorkspaceSearch = import("../../shared/search").WorkspaceSearch;
  type LspPosition = { line: number; character: number };
  type LspDiagnostic = {
    message: string;
    severity?: number;
    start: LspPosition;
    end: LspPosition;
    source?: string;
    code?: string | number;
  };
  type LspStatus = import("../../shared/language").LanguageStatus;
  type LspLocation = { path: string; start: LspPosition; end: LspPosition };
  type LspCompletion = import("../../shared/language").Completion;
  type GraphNode = import("../../shared/architecture").ArchitectureNode;
  type GraphEdge = import("../../shared/architecture").ArchitectureEdge;
  type ArchitectureGraph =
    import("../../shared/architecture").ArchitectureGraph;
  type ArchitectureDelta =
    import("../../shared/architecture-delta").ArchitectureDelta;
  type WorkspaceEntry =
    import("../../main/services/workspace-files").WorkspaceEntry;
  type Snapshot = import("../../shared/history").SnapshotMetadata;
  type ProjectRecord = import("../../shared/history").ProjectRecord;
  type TaskRecord = import("../../shared/history").TaskRecord;
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
  type ApiProviderId = "openai" | "anthropic";
  interface Window {
    witch: {
      settings: {
        get(): Promise<import("../../shared/settings").SettingsSnapshot>;
        save(
          preferences: import("../../shared/settings").Preferences,
        ): Promise<import("../../shared/settings").SettingsSnapshot>;
        importExtension(): Promise<
          import("../../shared/settings").SettingsSnapshot
        >;
        toggleExtension(
          id: string,
          enabled: boolean,
        ): Promise<import("../../shared/settings").SettingsSnapshot>;
        removeExtension(
          id: string,
        ): Promise<import("../../shared/settings").SettingsSnapshot>;
        onChanged(
          listener: (
            snapshot: import("../../shared/settings").SettingsSnapshot,
          ) => void,
        ): () => void;
      };
      execution: {
        catalog(): Promise<import("../../shared/execution").ExecutionCatalog>;
        configure(
          kind: "launch" | "tasks",
          activeFile?: string,
        ): Promise<string>;
      };
      debug: {
        status(): Promise<import("../../shared/execution").DebugState>;
        breakpoints(): Promise<import("../../shared/execution").Breakpoint[]>;
        setBreakpoints(
          path: string,
          lines: number[],
        ): Promise<import("../../shared/execution").Breakpoint[]>;
        start(
          id: string | null,
          activeFile?: string,
        ): Promise<import("../../shared/execution").DebugState>;
        action(
          action: import("../../shared/execution").DebugAction,
        ): Promise<import("../../shared/execution").DebugState>;
        variables(
          objectId: string,
        ): Promise<import("../../shared/execution").DebugVariable[]>;
        onState(
          listener: (
            state: import("../../shared/execution").DebugState,
          ) => void,
        ): () => void;
      };
      workspace: {
        session(
          root: string,
        ): Promise<import("../../shared/session").SessionSnapshot>;
        saveSession(
          session: import("../../shared/session").SessionUpdate,
        ): Promise<void>;
        open(): Promise<Workspace | null>;
        current(): Promise<Workspace | null>;
        recent(): Promise<ProjectRecord[]>;
        openRecent(root: string): Promise<Workspace>;
        files(): Promise<FileEntry[]>;
        entries(): Promise<{
          entries: WorkspaceEntry[];
          truncated: boolean;
          warnings: string[];
        }>;
        dirty(paths: string[], root?: string): Promise<void>;
        readDocument(
          path: string,
          root?: string,
        ): Promise<{ content: string; hash: string }>;
        onChanged(
          listener: (event: { root: string; paths: string[] }) => void,
        ): () => void;
        onWarning(listener: (message: string) => void): () => void;
        readFile(path: string): Promise<string>;
        writeFile(
          path: string,
          content: string,
          expectedHash?: string,
          root?: string,
        ): Promise<{ size: number; hash: string; gitStatus: string }>;
        createFile(
          path: string,
          content?: string,
          root?: string,
        ): Promise<Workspace>;
        createFolder(path: string, root?: string): Promise<Workspace>;
        move(
          sourcePath: string,
          destinationPath: string,
          root?: string,
        ): Promise<Workspace>;
        delete(
          path: string,
          confirmed: boolean,
          root?: string,
        ): Promise<Workspace>;
        search(query: string, root?: string): Promise<WorkspaceSearch>;
        cancelSearch(): Promise<void>;
        gitStatus(): Promise<string>;
      };
      analysis: {
        start(): Promise<ArchitectureGraph & { snapshot: Snapshot }>;
        snapshots(): Promise<Snapshot[]>;
        current(): Promise<ArchitectureGraph | null>;
        delta(snapshotId: string): Promise<ArchitectureDelta>;
        export(format: "json" | "html"): Promise<string | null>;
        onUpdated(listener: (graph: ArchitectureGraph) => void): () => void;
        onError(listener: (error: string) => void): () => void;
      };
      agent: {
        list(): Promise<import("../../shared/agent").AgentRun[]>;
        start(
          request: import("../../shared/agent").AgentRequest,
        ): Promise<import("../../shared/agent").AgentRun>;
        stop(): Promise<void>;
        apply(
          id: string,
          paths: string[],
        ): Promise<import("../../shared/agent").AgentRun>;
        archive(id: string): Promise<import("../../shared/agent").AgentRun>;
        onEvent(
          listener: (event: import("../../shared/agent").AgentEvent) => void,
        ): () => void;
      };
      lsp: {
        resolveCompletion(id: string): Promise<LspCompletion>;
        status(): Promise<LspStatus>;
        open(path: string, content: string, root?: string): Promise<void>;
        change(path: string, content: string, root?: string): Promise<void>;
        close(path: string, root?: string): Promise<void>;
        completion(
          path: string,
          position: LspPosition,
          root?: string,
        ): Promise<LspCompletion[]>;
        hover(
          path: string,
          position: LspPosition,
          root?: string,
        ): Promise<import("../../shared/language").HoverInfo | null>;
        signatureHelp(
          path: string,
          position: LspPosition,
          context?: import("../../shared/language").SignatureContext,
          root?: string,
        ): Promise<import("../../shared/language").SignatureHelpInfo | null>;
        definition(
          path: string,
          position: LspPosition,
          root?: string,
        ): Promise<LspLocation[]>;
        references(
          path: string,
          position: LspPosition,
          root?: string,
        ): Promise<LspLocation[]>;
        symbols(
          path: string,
          root?: string,
        ): Promise<import("../../shared/language").DocumentSymbol[]>;
        rename(
          path: string,
          position: LspPosition,
          name: string,
          root?: string,
        ): Promise<import("../../shared/language").RefactorPreview>;
        codeActions(
          path: string,
          range: import("../../shared/language").Range,
          root?: string,
        ): Promise<import("../../shared/language").CodeAction[]>;
        resolveAction(
          id: string,
        ): Promise<import("../../shared/language").RefactorPreview>;
        onStatus(listener: (status: LspStatus) => void): () => void;
        onDiagnostics(
          listener: (event: {
            language?: import("../../shared/language").LanguageProviderId;
            path: string;
            diagnostics: LspDiagnostic[];
          }) => void,
        ): () => void;
      };
      tasks: { list(): Promise<TaskRecord[]> };
      providers: {
        status(): Promise<ProviderStatus>;
        saveApiKey(
          provider: ApiProviderId,
          key: string,
        ): Promise<ProviderStatus>;
        removeApiKey(provider: ApiProviderId): Promise<ProviderStatus>;
      };
      cua: {
        status(): Promise<CuaStatus>;
        connect(): Promise<CuaStatus>;
        disconnect(): Promise<CuaStatus>;
        listWindows(): Promise<string>;
      };
      remote: {
        list(): Promise<import("../../shared/remote").RemoteProfileSnapshot>;
        status(): Promise<import("../../shared/remote").RemoteStatus>;
        saveProfile(
          profile: import("../../shared/remote").SshProfileDraft,
        ): Promise<import("../../shared/remote").RemoteProfileSnapshot>;
        removeProfile(
          id: string,
        ): Promise<import("../../shared/remote").RemoteProfileSnapshot>;
        onChanged(
          listener: (
            snapshot: import("../../shared/remote").RemoteProfileSnapshot,
          ) => void,
        ): () => void;
      };
      terminal: {
        list(): Promise<import("../../shared/execution").TerminalSummary[]>;
        attach(
          id: string,
        ): Promise<import("../../shared/execution").TerminalSnapshot>;
        runTask(
          id: string,
          activeFile?: string,
        ): Promise<import("../../shared/execution").TerminalSnapshot>;
        onExit(
          listener: (event: { id: string; exitCode: number }) => void,
        ): () => void;
        create(options: {
          cwd?: string;
          cols?: number;
          rows?: number;
          remoteProfileId?: string;
        }): Promise<import("../../shared/execution").TerminalSnapshot>;
        write(id: string, data: string): Promise<void>;
        resize(id: string, cols: number, rows: number): Promise<void>;
        close(id: string): Promise<void>;
        onData(
          listener: (
            event: import("../../shared/execution").TerminalData,
          ) => void,
        ): () => void;
      };
    };
  }
}

export {};
