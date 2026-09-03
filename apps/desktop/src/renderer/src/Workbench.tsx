import { useEffect, useMemo, useRef, useState } from "react";
import { ArchitectureCanvas } from "./components/ArchitectureCanvas";
import { ChatPanel } from "./components/ChatPanel";
import { SourceEditor, type OpenDocument } from "./components/SourceEditor";
import { ProjectExplorer } from "./components/ProjectExplorer";
import { TerminalPanel } from "./components/TerminalPanel";
import { DebugPanel } from "./components/DebugPanel";
import { PanelDivider } from "./components/PanelDivider";
import { ArchitectureDeltaDialog } from "./components/ArchitectureDeltaDialog";
import {
  DEFAULT_LAYOUT,
  fitLayout,
  PANEL_LIMITS,
  type PanelLayout,
} from "../../shared/layout";
import { SettingsDialog, CommandPalette } from "./components/SettingsDialog";
import {
  DEFAULT_PREFERENCES,
  shortcutMatches,
  type SettingsSnapshot,
  type CommandId,
} from "../../shared/settings";
import { monaco } from "./components/editor-runtime";
import type { DebugState, Breakpoint } from "../../shared/execution";
import type { WorkspaceToolingSnapshot } from "../../shared/tooling";
import { ReviewDialog, type ReviewFile } from "./components/ReviewDialog";
import {
  FileActionDialog,
  ProviderDialog,
  QuickOpenDialog,
  WorkspaceSearchDialog,
  type FileAction,
  type FileActionKind,
} from "./components/WorkspaceDialogs";
import type { ComponentContext } from "../../shared/architecture";
import type { SemanticComposerRequest } from "../../shared/semantic-composer";
import type {
  CodeAction,
  DocumentSymbol,
  Position,
  Range,
  RefactorPreview,
} from "../../shared/language";
import "./styles.css";
import "./workbench.css";
import "./themes.css";
import "./astral-theme.css";

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function isLanguageFile(file: string) {
  return /\.(?:[cm]?[jt]sx?|pyi?|rs)$/i.test(file);
}

export function Workbench() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [tabs, setTabs] = useState<OpenDocument[]>([]);
  const [sessionRoot, setSessionRoot] = useState<string | null>(null);
  const [recoveryWarning, setRecoveryWarning] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [explorerSelection, setExplorerSelection] = useState<string | null>(
    null,
  );
  const [view, setView] = useState<"architecture" | "source">("architecture");
  const [architectureReveal, setArchitectureReveal] = useState(0);
  const [lineTarget, setLineTarget] = useState<number | null>(null);
  const [graph, setGraph] = useState<ArchitectureGraph | null>(null);
  const [graphBusy, setGraphBusy] = useState(false);
  const [compositionBusy, setCompositionBusy] = useState(false);
  const [contexts, setContexts] = useState<ComponentContext[]>([]);
  const [recentProjects, setRecentProjects] = useState<ProjectRecord[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [delta, setDelta] = useState<ArchitectureDelta | null>(null);
  const [deltaBusy, setDeltaBusy] = useState<string | null>(null);
  const [legacyTasks, setLegacyTasks] = useState<TaskRecord[]>([]);
  const [legacySummary, setLegacySummary] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResult, setSearchResult] = useState<WorkspaceSearch | null>(
    null,
  );
  const [searching, setSearching] = useState(false);
  const searchSequence = useRef(0);
  const [fileAction, setFileAction] = useState<FileAction | null>(null);
  const [fileBusy, setFileBusy] = useState(false);
  const [status, setStatus] = useState(
    "Open a project to explore its architecture, source, and local tools.",
  );
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [providersOpen, setProvidersOpen] = useState(false);
  const [settings, setSettings] = useState<SettingsSnapshot>({
    preferences: DEFAULT_PREFERENCES,
    extensions: [],
    warnings: [],
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const preferences = settings.preferences;
  const [panelLayout, setPanelLayout] = useState<PanelLayout>({
    ...DEFAULT_LAYOUT,
  });
  const panelLayoutRef = useRef(panelLayout);
  const workbenchRef = useRef<HTMLDivElement>(null);
  const [workbenchSize, setWorkbenchSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight - 76,
  });
  const fittedLayout = fitLayout(
    panelLayout,
    workbenchSize.width,
    workbenchSize.height,
  );
  const maximumTerminal = Math.min(
    PANEL_LIMITS.terminal[1],
    Math.max(120, workbenchSize.height - 250),
  );
  function changePanel(key: keyof PanelLayout, value: number, commit = false) {
    const next = { ...panelLayoutRef.current, [key]: value };
    panelLayoutRef.current = next;
    setPanelLayout(next);
    if (commit)
      void window.witch.settings
        .save({ ...preferences, layout: next })
        .catch((error) => setStatus(errorText(error)));
  }
  useEffect(() => {
    panelLayoutRef.current = preferences.layout;
    setPanelLayout(preferences.layout);
  }, [preferences.layout]);
  useEffect(() => {
    const element = workbenchRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const width = element.clientWidth,
        height = element.clientHeight;
      setWorkbenchSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const snippets = useMemo(
    () =>
      settings.extensions
        .filter((extension) => extension.enabled)
        .flatMap((extension) => extension.snippets),
    [settings.extensions],
  );
  const [debugState, setDebugState] = useState<DebugState>({
    root: null,
    status: "idle",
    frames: [],
    output: "",
    breakpoints: [],
  });
  const [breakpoints, setBreakpoints] = useState<Breakpoint[]>([]);
  const [lsp, setLsp] = useState<LspStatus | null>(null);
  const [tooling, setTooling] = useState<WorkspaceToolingSnapshot | null>(null);
  const [toolingBusy, setToolingBusy] = useState(false);
  const [outline, setOutline] = useState<DocumentSymbol[]>([]);
  const [diagnostics, setDiagnostics] = useState<
    Record<string, LspDiagnostic[]>
  >({});
  const [locations, setLocations] = useState<{
    title: string;
    items: LspLocation[];
  } | null>(null);
  const [rename, setRename] = useState<{
    path: string;
    position: Position;
    name: string;
  } | null>(null);
  const [actions, setActions] = useState<CodeAction[] | null>(null);
  const [refactor, setRefactor] = useState<RefactorPreview | null>(null);
  const [diskReview, setDiskReview] = useState<
    (ReviewFile & { hash: string }) | null
  >(null);
  const [cua, setCua] = useState<CuaStatus | null>(null);
  const [cuaOpen, setCuaOpen] = useState(false);
  const [cuaBusy, setCuaBusy] = useState(false);
  const [desktopEvidence, setDesktopEvidence] = useState("");
  const rootRef = useRef<string | undefined>(undefined);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(selectedFile);
  activeRef.current = selectedFile;
  const readSequence = useRef(0);
  const sessionReady = useRef<string | null>(null);
  const saving = useRef(new Set<string>());
  const openingProject = useRef(false);
  const activeTab = tabs.find((tab) => tab.path === selectedFile) || null;
  const mappedGraphFiles = useMemo(
    () =>
      new Set(
        graph?.nodes
          .filter((node) => node.kind === "file")
          .flatMap((node) => [node.id, ...(node.path ? [node.path] : [])]) ||
          [],
      ),
    [graph?.revision, graph?.workspaceRoot],
  );
  const activeFileMapped = Boolean(
    selectedFile && mappedGraphFiles.has(selectedFile),
  );
  const files = useMemo(
    () => entries.filter((entry) => entry.kind === "file"),
    [entries],
  );
  const matchingFiles = useMemo(
    () =>
      files.filter((file) =>
        file.path.toLowerCase().includes(query.toLowerCase()),
      ),
    [files, query],
  );
  const filtered = matchingFiles.slice(0, 150);
  const quickFiles = useMemo(
    () =>
      files
        .filter((file) =>
          file.path.toLowerCase().includes(quickQuery.toLowerCase()),
        )
        .slice(0, 100),
    [files, quickQuery],
  );
  const problems = Object.entries(diagnostics).flatMap(([path, items]) =>
    items.map((item) => ({ path, ...item })),
  );
  useEffect(() => {
    let disposed = false;
    let changed = false;
    const off = window.witch.settings.onChanged((snapshot) => {
      changed = true;
      setSettings(snapshot);
    });
    void window.witch.settings
      .get()
      .then((snapshot) => {
        if (!disposed && !changed) setSettings(snapshot);
      })
      .catch((reason) => setStatus(errorText(reason)));
    return () => {
      disposed = true;
      off();
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
    monaco.editor.setTheme(`witch-${preferences.theme}`);
  }, [preferences.theme]);
  useEffect(() => {
    if (!preferences.autoSave) return;
    const pending = tabs.filter(
      (tab) => tab.content !== tab.savedContent && !tab.conflict,
    );
    if (!pending.length) return;
    const timeout = window.setTimeout(() => {
      for (const tab of pending) {
        const latest = tabsRef.current.find((item) => item.path === tab.path);
        if (latest && !latest.conflict && latest.content === tab.content)
          void saveDocument(tab.path);
      }
    }, preferences.autoSaveDelay);
    return () => window.clearTimeout(timeout);
  }, [tabs, preferences.autoSave, preferences.autoSaveDelay]);

  async function refreshEntries() {
    const root = rootRef.current;
    const listing = await window.witch.workspace.entries();
    if (root !== rootRef.current) return;
    setEntries(listing.entries);
    if (listing.truncated)
      setStatus(
        "Explorer is limited to 20,000 entries. Open a narrower project folder.",
      );
  }
  useEffect(() => {
    const root = workspace?.root;
    let disposed = false;
    setDebugState({
      root: root || null,
      status: "idle",
      frames: [],
      output: "",
      breakpoints: [],
    });
    setBreakpoints([]);
    if (root) {
      void window.witch.debug
        .breakpoints()
        .then((points) => {
          if (!disposed) setBreakpoints(points);
        })
        .catch((reason) => setStatus(errorText(reason)));
      void window.witch.debug
        .status()
        .then((state) => {
          if (!disposed && state.root === root) setDebugState(state);
        })
        .catch(() => undefined);
    }
    const off = window.witch.debug.onState((state) => {
      if (state.root !== root) return;
      setDebugState(state);
      setBreakpoints(state.breakpoints);
      if (state.status === "paused" && state.frames[0]?.path)
        void selectFile(state.frames[0].path, state.frames[0].line);
    });
    return () => {
      disposed = true;
      off();
    };
  }, [workspace?.root]);
  async function toggleBreakpoint(path: string, line: number) {
    try {
      const current = breakpoints
        .filter((item) => item.path === path)
        .map((item) => item.line);
      setBreakpoints(
        await window.witch.debug.setBreakpoints(
          path,
          current.includes(line)
            ? current.filter((value) => value !== line)
            : [...current, line],
        ),
      );
    } catch (reason) {
      setStatus(errorText(reason));
    }
  }
  async function configureExecution(kind: "launch" | "tasks") {
    try {
      const file = await window.witch.execution.configure(
        kind,
        selectedFile || undefined,
      );
      await refreshEntries();
      await selectFile(file);
    } catch (reason) {
      setStatus(errorText(reason));
    }
  }
  async function refreshHistory() {
    const root = rootRef.current;
    const [projects, nextSnapshots, tasks] = await Promise.all([
      window.witch.workspace.recent(),
      window.witch.analysis.snapshots(),
      window.witch.tasks.list(),
    ]);
    setRecentProjects(projects);
    if (root !== rootRef.current) return;
    setSnapshots(nextSnapshots);
    setLegacyTasks(tasks);
  }
  async function analyze() {
    const root = rootRef.current;
    if (!root) {
      setStatus("Open a project first.");
      return;
    }
    setGraphBusy(true);
    try {
      const result = await window.witch.analysis.start();
      if (root !== rootRef.current) return;
      setGraph(result);
      if (result.snapshot)
        setSnapshots((previous) =>
          [
            result.snapshot!,
            ...previous.filter((item) => item.id !== result.snapshot!.id),
          ].slice(0, 20),
        );
      if (result.integrity?.status === "fallback") {
        setStatus(
          `Analysis guard: quarantined ${result.integrity.candidateRevision.slice(0, 8)} after unexplained graph loss; showing last-known-good ${result.revision.slice(0, 8)}.`,
        );
        return;
      }
      setStatus(
        `Structure indexed: ${result.coverage?.deepFiles ?? result.scannedFiles}/${result.coverage?.indexedFiles ?? result.scannedFiles} deep files · ${result.edges.length} evidence-backed relations · ${result.revision.slice(0, 8)}`,
      );
    } catch (reason) {
      if (root === rootRef.current)
        setStatus(`Structure analysis: ${errorText(reason)}`);
    } finally {
      if (root === rootRef.current) setGraphBusy(false);
    }
  }
  async function clearAnalysisIndex() {
    const root = rootRef.current;
    if (!root || graphBusy) return;
    setGraphBusy(true);
    try {
      const result = await window.witch.analysis.clearIndex();
      if (root !== rootRef.current) return;
      setGraph(result);
      setStatus(
        `Local analysis index rebuilt · ${result.coverage?.deepFiles ?? result.scannedFiles} deep files · ${result.revision.slice(0, 8)}`,
      );
    } catch (reason) {
      if (root === rootRef.current)
        setStatus(`Rebuild analysis index: ${errorText(reason)}`);
    } finally {
      if (root === rootRef.current) setGraphBusy(false);
    }
  }
  async function acceptAnalysisCandidate(candidateRevision: string) {
    const root = rootRef.current;
    if (!root || graphBusy) return;
    setGraphBusy(true);
    try {
      const result =
        await window.witch.analysis.acceptCandidate(candidateRevision);
      if (root !== rootRef.current) return;
      setGraph(result);
      setStatus(
        `Architecture baseline accepted explicitly · ${result.nodes.length} nodes · ${result.revision.slice(0, 8)}.`,
      );
    } catch (reason) {
      if (root === rootRef.current)
        setStatus(`Accept architecture candidate: ${errorText(reason)}`);
    } finally {
      if (root === rootRef.current) setGraphBusy(false);
    }
  }
  async function composeMeaning(request: SemanticComposerRequest) {
    const root = rootRef.current;
    if (!root || !graph || compositionBusy) return false;
    setCompositionBusy(true);
    try {
      const result = await window.witch.analysis.compose(request);
      if (root !== rootRef.current) return false;
      setGraph(result.graph);
      setStatus(
        `Semantic composition: ${result.receipt.componentCount} components · ${result.receipt.relationCount} relations · ${result.receipt.workflowCount} workflows · ${result.receipt.provider}${result.receipt.fallback ? " → rules fallback" : ""}.`,
      );
      return true;
    } catch (reason) {
      if (root === rootRef.current)
        setStatus(`Semantic Composer: ${errorText(reason)}`);
      return false;
    } finally {
      if (root === rootRef.current) setCompositionBusy(false);
    }
  }
  async function compareSnapshot(snapshot: Snapshot) {
    const root = rootRef.current;
    if (!root || deltaBusy) return;
    setDeltaBusy(snapshot.id);
    try {
      const comparison = await window.witch.analysis.delta(snapshot.id);
      if (root !== rootRef.current) return;
      setDelta(comparison);
      setView("architecture");
      const total = Object.values(comparison.summary).reduce(
        (sum, count) => sum + count,
        0,
      );
      setStatus(
        `Architecture delta: ${total} exact authored change${total === 1 ? "" : "s"}.`,
      );
    } catch (reason) {
      if (root === rootRef.current)
        setStatus(`Architecture delta: ${errorText(reason)}`);
    } finally {
      if (root === rootRef.current) setDeltaBusy(null);
    }
  }
  async function exportArchitecture(format: "json" | "html") {
    try {
      const target = await window.witch.analysis.export(format);
      if (target)
        setStatus(`Architecture ${format.toUpperCase()} exported to ${target}`);
    } catch (reason) {
      setStatus(`Architecture export: ${errorText(reason)}`);
    }
  }
  async function loadWorkspace(next: Workspace) {
    const changedRoot = next.root !== rootRef.current;
    if (changedRoot) {
      sessionReady.current = null;
      setSessionRoot(null);
      setRecoveryWarning("");
      rootRef.current = next.root;
      tabsRef.current = [];
      setTabs([]);
      setSelectedFile(null);
      setExplorerSelection(null);
      setGraph(null);
      setDelta(null);
      setDeltaBusy(null);
      setContexts([]);
      setDiagnostics({});
      setLocations(null);
      setRefactor(null);
      setDiskReview(null);
      setSearchResult(null);
      setView("architecture");
      setLineTarget(null);
    }
    setWorkspace(next);
    if (changedRoot) await restoreSession(next.root);
    await Promise.all([refreshEntries(), refreshHistory()]);
    await analyze();
  }
  async function restoreSession(root: string) {
    try {
      const { session, warning } = await window.witch.workspace.session(root);
      if (root !== rootRef.current) return;
      if (warning) setRecoveryWarning(warning);
      const restored: OpenDocument[] = [];
      for (const item of session?.documents || []) {
        try {
          const disk = await window.witch.workspace.readDocument(
            item.path,
            root,
          );
          if (root !== rootRef.current) return;
          if (item.draft && item.draft.content !== disk.content)
            restored.push({
              path: item.path,
              ...item.draft,
              conflict:
                item.draft.hash === disk.hash
                  ? "Recovered unsaved edits. Save explicitly to keep them."
                  : "Recovered unsaved edits; this file also changed on disk.",
            });
          else
            restored.push({
              path: item.path,
              content: disk.content,
              savedContent: disk.content,
              hash: disk.hash,
            });
        } catch {
          if (item.draft)
            restored.push({
              path: item.path,
              ...item.draft,
              conflict:
                "Recovered unsaved edits; the original file is no longer readable. Copy this buffer before closing it.",
            });
        }
      }
      if (root !== rootRef.current) return;
      setTabs((current) => [
        ...current,
        ...restored.filter(
          (item) => !current.some((tab) => tab.path === item.path),
        ),
      ]);
      const active =
        restored.find((item) => item.path === session?.activePath)?.path ||
        restored[0]?.path;
      if (active) {
        setSelectedFile(active);
        setExplorerSelection(active);
        setView(session?.view || "source");
      }
      if (restored.some((item) => item.conflict))
        setRecoveryWarning(
          "Unsaved editor buffers were recovered. Review them and save explicitly; recovery never auto-saves over your source.",
        );
    } catch (reason) {
      setRecoveryWarning(`Editor recovery: ${errorText(reason)}`);
    } finally {
      if (root === rootRef.current) {
        sessionReady.current = root;
        setSessionRoot(root);
      }
    }
  }
  useEffect(() => {
    if (!sessionRoot || sessionRoot !== rootRef.current) return;
    const timer = window.setTimeout(() => {
      void window.witch.workspace
        .saveSession({
          root: sessionRoot,
          activePath: selectedFile,
          view,
          documents: tabs.map((tab) => ({
            path: tab.path,
            ...(tab.content !== tab.savedContent
              ? {
                  draft: {
                    content: tab.content,
                    savedContent: tab.savedContent,
                    hash: tab.hash,
                  },
                }
              : {}),
          })),
        })
        .catch((reason) =>
          setRecoveryWarning(
            `Recovery snapshot could not be saved: ${errorText(reason)}`,
          ),
        );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [tabs, selectedFile, view, sessionRoot]);
  async function openWorkspace(root?: string) {
    if (openingProject.current || fileBusy || saving.current.size) {
      setStatus("Wait for the current file or project operation to finish.");
      return;
    }
    openingProject.current = true;
    try {
      const next = root
        ? await window.witch.workspace.openRecent(root)
        : await window.witch.workspace.open();
      if (next) await loadWorkspace(next);
    } catch (reason) {
      setStatus(errorText(reason));
    } finally {
      openingProject.current = false;
    }
  }
  async function refreshChanged(root: string, paths: string[]) {
    if (root !== rootRef.current) return;
    await refreshEntries();
    await Promise.all(
      tabsRef.current
        .filter((tab) =>
          paths.some(
            (path) => path === tab.path || tab.path.startsWith(`${path}/`),
          ),
        )
        .map(async (previous) => {
          try {
            const disk = await window.witch.workspace.readDocument(
              previous.path,
              root,
            );
            if (root !== rootRef.current) return;
            setTabs((current) =>
              current.map((tab) => {
                if (tab.path !== previous.path || disk.hash === tab.hash)
                  return tab;
                if (
                  tab.content !== tab.savedContent &&
                  tab.content !== disk.content
                )
                  return {
                    ...tab,
                    conflict: "This file changed outside the editor.",
                  };
                return {
                  ...tab,
                  content: disk.content,
                  savedContent: disk.content,
                  hash: disk.hash,
                  conflict: undefined,
                };
              }),
            );
          } catch (reason) {
            if (root === rootRef.current)
              setTabs((current) =>
                current.map((tab) =>
                  tab.path === previous.path
                    ? {
                        ...tab,
                        conflict:
                          "The file was removed or is no longer readable.",
                      }
                    : tab,
                ),
              );
          }
        }),
    );
  }
  useEffect(() => {
    void window.witch.workspace
      .current()
      .then((current) => (current ? loadWorkspace(current) : refreshHistory()))
      .catch((reason) => setStatus(errorText(reason)));
    void window.witch.providers
      .status()
      .then(setProviders)
      .catch((reason) => setStatus(errorText(reason)));
    void window.witch.cua
      .status()
      .then(setCua)
      .catch(() => undefined);
    void window.witch.lsp
      .status()
      .then(setLsp)
      .catch(() => undefined);
    const subscriptions = [
      window.witch.analysis.onUpdated((next) => {
        if (next.workspaceRoot === rootRef.current) setGraph(next);
      }),
      window.witch.analysis.onError((error) =>
        setStatus(`Analysis: ${error}. The last successful graph is retained.`),
      ),
      window.witch.workspace.onChanged(({ root, paths }) => {
        void refreshChanged(root, paths).catch((reason) =>
          setStatus(errorText(reason)),
        );
      }),
      window.witch.workspace.onWarning(setRecoveryWarning),
      window.witch.lsp.onStatus(setLsp),
      window.witch.tooling.onChanged((snapshot) => {
        if (snapshot.root === rootRef.current) setTooling(snapshot);
      }),
      window.witch.lsp.onDiagnostics(({ path, diagnostics: items }) =>
        setDiagnostics((previous) => ({ ...previous, [path]: items })),
      ),
    ];
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, []);
  useEffect(() => {
    let disposed = false;
    setTooling(null);
    if (workspace?.root)
      void window.witch.tooling
        .status()
        .then((snapshot) => {
          if (!disposed && snapshot?.root === rootRef.current)
            setTooling(snapshot);
        })
        .catch((reason) => {
          if (!disposed) setStatus(`Toolchains: ${errorText(reason)}`);
        });
    return () => {
      disposed = true;
    };
  }, [workspace?.root]);
  useEffect(() => {
    void window.witch.workspace
      .dirty(
        tabs
          .filter((tab) => tab.content !== tab.savedContent)
          .map((tab) => tab.path),
        rootRef.current,
      )
      .catch((reason) => setStatus(errorText(reason)));
    const languageRoot = rootRef.current;
    const timer = setTimeout(() => {
      for (const tab of tabs)
        if (isLanguageFile(tab.path))
          void window.witch.lsp
            .change(tab.path, tab.content, languageRoot)
            .catch((reason) =>
              setStatus(`Language service: ${errorText(reason)}`),
            );
    }, 300);
    return () => clearTimeout(timer);
  }, [tabs]);
  useEffect(() => {
    const tab = activeTab;
    const root = rootRef.current;
    if (!tab || !isLanguageFile(tab.path)) {
      setOutline([]);
      return;
    }
    let disposed = false;
    const timer = setTimeout(() => {
      void window.witch.lsp
        .symbols(tab.path, root)
        .then((symbols) => {
          const current = tabsRef.current.find(
            (candidate) => candidate.path === tab.path,
          );
          if (
            !disposed &&
            root === rootRef.current &&
            current?.content === tab.content
          )
            setOutline(symbols);
        })
        .catch(() => {
          if (!disposed) setOutline([]);
        });
    }, 500);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [activeTab?.path, activeTab?.content]);
  async function selectFile(path: string, line?: number) {
    const root = rootRef.current;
    if (root && sessionReady.current !== root) {
      setStatus("Restoring the editor session…");
      return;
    }
    const sequence = ++readSequence.current;
    setExplorerSelection(path);
    try {
      if (!tabsRef.current.some((tab) => tab.path === path)) {
        const file = await window.witch.workspace.readDocument(path, root);
        if (root !== rootRef.current) return;
        setTabs((previous) =>
          previous.some((tab) => tab.path === path)
            ? previous
            : [
                ...previous,
                {
                  path,
                  content: file.content,
                  savedContent: file.content,
                  hash: file.hash,
                },
              ],
        );
      }
      if (sequence !== readSequence.current) return;
      setSelectedFile(path);
      setLineTarget(line || null);
      setView("source");
      setStatus(path);
    } catch (reason) {
      setStatus(errorText(reason));
    }
  }
  function changeDocument(path: string, content: string) {
    setTabs((previous) =>
      previous.map((tab) => (tab.path === path ? { ...tab, content } : tab)),
    );
  }
  async function saveDocument(path: string) {
    const tab = tabsRef.current.find((item) => item.path === path);
    const root = rootRef.current;
    if (
      !tab ||
      tab.content === tab.savedContent ||
      saving.current.has(path) ||
      openingProject.current
    )
      return;
    saving.current.add(path);
    try {
      const saved = await window.witch.workspace.writeFile(
        path,
        tab.content,
        tab.hash,
        root,
      );
      if (root !== rootRef.current) return;
      const nextTabs = tabsRef.current.map((item) =>
        item.path === path
          ? {
              ...item,
              savedContent: tab.content,
              hash: saved.hash,
              conflict: undefined,
            }
          : item,
      );
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
      setStatus(`${path} saved. The structure map updates automatically.`);
    } catch (reason) {
      if (root !== rootRef.current) return;
      setStatus(errorText(reason));
      const nextTabs = tabsRef.current.map((item) =>
        item.path === path
          ? {
              ...item,
              conflict:
                "Save could not complete. Check the disk version before retrying.",
            }
          : item,
      );
      tabsRef.current = nextTabs;
      setTabs(nextTabs);
    } finally {
      saving.current.delete(path);
    }
  }
  async function saveActive() {
    if (activeRef.current) await saveDocument(activeRef.current);
  }
  async function saveAll() {
    const root = rootRef.current;
    for (const tab of tabsRef.current) {
      if (root !== rootRef.current || openingProject.current) return;
      await saveDocument(tab.path);
    }
  }
  function closeTab(path: string) {
    const tab = tabsRef.current.find((item) => item.path === path);
    if (
      tab &&
      tab.content !== tab.savedContent &&
      !window.confirm(`Discard unsaved changes in ${path}?`)
    )
      return;
    const remaining = tabsRef.current.filter((item) => item.path !== path);
    setTabs(remaining);
    void window.witch.lsp.close(path, rootRef.current).catch(() => undefined);
    if (selectedFile === path) setSelectedFile(remaining.at(-1)?.path || null);
  }
  async function reviewDisk(path: string) {
    const root = rootRef.current;
    try {
      const disk = await window.witch.workspace.readDocument(path, root);
      if (root !== rootRef.current) return;
      const tab = tabsRef.current.find((item) => item.path === path);
      if (tab)
        setDiskReview({
          path,
          before: tab.content,
          after: disk.content,
          hash: disk.hash,
        });
    } catch (reason) {
      setStatus(errorText(reason));
    }
  }
  async function syncDocuments(root = rootRef.current) {
    for (const tab of tabsRef.current)
      if (isLanguageFile(tab.path))
        await window.witch.lsp.change(tab.path, tab.content, root);
  }
  async function findLocations(
    kind: "definition" | "references",
    path: string,
    position: Position,
  ) {
    const root = rootRef.current;
    try {
      await syncDocuments(root);
      const items = await window.witch.lsp[kind](path, position, root);
      if (root !== rootRef.current) return;
      if (!items.length) {
        setStatus(`No ${kind} found.`);
        return;
      }
      if (kind === "definition" && items.length === 1)
        await selectFile(items[0].path, items[0].start.line + 1);
      else setLocations({ title: `${items.length} ${kind}`, items });
    } catch (reason) {
      setStatus(errorText(reason));
    }
  }
  async function renameSymbol() {
    if (!rename) return;
    const root = rootRef.current;
    try {
      await syncDocuments(root);
      const preview = await window.witch.lsp.rename(
        rename.path,
        rename.position,
        rename.name,
        root,
      );
      if (root !== rootRef.current) return;
      setRefactor(preview);
      setRename(null);
    } catch (reason) {
      setStatus(errorText(reason));
    }
  }
  async function codeActions(path: string, range: Range) {
    const root = rootRef.current;
    try {
      await syncDocuments(root);
      const results = await window.witch.lsp.codeActions(path, range, root);
      if (root !== rootRef.current) return;
      if (!results.length)
        setStatus("No code actions are available for this selection.");
      else setActions(results);
    } catch (reason) {
      setStatus(errorText(reason));
    }
  }
  async function applyRefactor(paths: string[]) {
    if (!refactor) return;
    const root = rootRef.current;
    const prepared: OpenDocument[] = [];
    for (const change of refactor.changes.filter((item) =>
      paths.includes(item.path),
    )) {
      const tab = tabsRef.current.find((item) => item.path === change.path);
      const disk =
        tab || (await window.witch.workspace.readDocument(change.path, root));
      if (disk.content !== change.before)
        throw new Error(
          `${change.path} changed after preview. Request the refactor again.`,
        );
      prepared.push(
        tab
          ? { ...tab, content: change.after }
          : {
              path: change.path,
              content: change.after,
              savedContent: disk.content,
              hash: disk.hash,
            },
      );
    }
    if (root !== rootRef.current) throw new Error("Workspace changed");
    setTabs((previous) => [
      ...previous.map(
        (tab) => prepared.find((item) => item.path === tab.path) || tab,
      ),
      ...prepared.filter(
        (item) => !previous.some((tab) => tab.path === item.path),
      ),
    ]);
    setStatus(
      `${prepared.length} refactored buffer(s) opened. Review and Save All to write them to disk.`,
    );
  }
  function startFileAction(kind: FileActionKind, explicit?: string) {
    if (!workspace) return;
    const source = explicit || explorerSelection || undefined;
    if (["rename", "move", "delete"].includes(kind) && !source) {
      setStatus("Select a file or folder first.");
      return;
    }
    const directory =
      entries.find((entry) => entry.path === source)?.kind === "directory";
    const parent = source
      ? directory
        ? `${source}/`
        : source.includes("/")
          ? source.slice(0, source.lastIndexOf("/") + 1)
          : ""
      : "";
    setFileAction({
      kind,
      source,
      initialPath:
        kind === "create-file"
          ? `${parent}untitled.ts`
          : kind === "create-folder"
            ? `${parent}new-folder`
            : source || "",
    });
  }
  async function performFileAction(destination: string) {
    if (!fileAction || fileBusy || openingProject.current) return;
    const root = rootRef.current;
    const action = fileAction;
    const target = destination.trim().replaceAll("\\", "/");
    const affected = action.kind === "delete" ? target : action.source;
    if (!target) return;
    if (
      ["rename", "move", "delete"].includes(action.kind) &&
      tabsRef.current.some(
        (tab) =>
          (tab.path === affected || tab.path.startsWith(`${affected}/`)) &&
          tab.content !== tab.savedContent,
      )
    ) {
      setStatus(
        "Save or close unsaved files inside this path before moving or deleting it.",
      );
      return;
    }
    setFileBusy(true);
    try {
      if (["rename", "move", "delete"].includes(action.kind))
        await window.witch.workspace.dirty(
          tabsRef.current
            .filter((tab) => tab.content !== tab.savedContent)
            .map((tab) => tab.path),
          root,
        );
      if (action.kind === "create-file")
        await window.witch.workspace.createFile(target, undefined, root);
      else if (action.kind === "create-folder")
        await window.witch.workspace.createFolder(target, root);
      else if (action.kind === "delete")
        await window.witch.workspace.delete(target, true, root);
      else await window.witch.workspace.move(action.source!, target, root);
      if (root !== rootRef.current) return;
      if (["rename", "move", "delete"].includes(action.kind)) {
        const includes = (path: string) =>
          path === affected || path.startsWith(`${affected}/`);
        for (const tab of tabsRef.current.filter((tab) => includes(tab.path)))
          void window.witch.lsp.close(tab.path, root).catch(() => undefined);
        if (action.kind === "delete") {
          setTabs((previous) => previous.filter((tab) => !includes(tab.path)));
          if (selectedFile && includes(selectedFile)) setSelectedFile(null);
        } else {
          setTabs((previous) =>
            previous.map((tab) =>
              includes(tab.path)
                ? { ...tab, path: target + tab.path.slice(affected!.length) }
                : tab,
            ),
          );
          if (selectedFile && includes(selectedFile))
            setSelectedFile(target + selectedFile.slice(affected!.length));
        }
        setDiagnostics({});
        try {
          const nextPoints = await window.witch.debug.breakpoints();
          if (root !== rootRef.current) return;
          setBreakpoints(nextPoints);
        } catch (reason) {
          setRecoveryWarning(
            `The file operation completed, but saved breakpoints could not be refreshed. ${errorText(reason)}`,
          );
        }
      }
      setFileAction(null);
      setExplorerSelection(action.kind === "delete" ? null : target);
      await refreshEntries();
      if (action.kind === "create-file") await selectFile(target);
      setStatus(
        action.kind === "delete"
          ? `${target} moved to the operating system’s trash. You can recover it there.`
          : `${target}: ${action.kind.replace("-", " ")} completed.`,
      );
    } catch (reason) {
      setStatus(errorText(reason));
    } finally {
      setFileBusy(false);
    }
  }
  async function search() {
    if (!searchQuery.trim()) return;
    const root = rootRef.current,
      sequence = ++searchSequence.current;
    setSearching(true);
    try {
      const result = await window.witch.workspace.search(searchQuery, root);
      if (root === rootRef.current && sequence === searchSequence.current)
        setSearchResult(result);
    } catch (reason) {
      if (root === rootRef.current && sequence === searchSequence.current)
        setStatus(errorText(reason));
    } finally {
      if (sequence === searchSequence.current) setSearching(false);
    }
  }
  function closeSearch() {
    searchSequence.current++;
    void window.witch.workspace.cancelSearch().catch(() => undefined);
    setSearching(false);
    setSearchOpen(false);
  }
  async function openProviders() {
    setProvidersOpen(true);
    try {
      setProviders(await window.witch.providers.status());
    } catch (reason) {
      setStatus(errorText(reason));
    }
  }
  async function cuaAction(action: "connect" | "disconnect" | "observe") {
    setCuaBusy(true);
    try {
      if (action === "observe")
        setDesktopEvidence(await window.witch.cua.listWindows());
      else setCua(await window.witch.cua[action]());
    } catch (reason) {
      setStatus(errorText(reason));
    } finally {
      setCuaBusy(false);
    }
  }
  function runCommand(command: CommandId) {
    if (command === "save") void saveActive();
    else if (command === "saveAll") void saveAll();
    else if (command === "quickOpen") {
      setQuickQuery("");
      setQuickOpen(true);
    } else if (command === "search") setSearchOpen(true);
    else if (command === "settings") setSettingsOpen(true);
    else if (command === "openProject") void openWorkspace();
    else if (command === "commandPalette") setPaletteOpen(true);
    else if (command === "structure") {
      setView("architecture");
      void analyze();
    }
  }
  const commandRef = useRef(runCommand);
  commandRef.current = runCommand;
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      // Preserve terminal shortcuts and modal text input; app commands apply to the workspace.
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[role="dialog"], .xterm')) {
        const command = (
          Object.keys(preferences.keybindings) as CommandId[]
        ).find((id) =>
          shortcutMatches(
            event,
            preferences.keybindings[id],
            /Mac/i.test(navigator.platform),
          ),
        );
        if (command) {
          event.preventDefault();
          event.stopPropagation();
          commandRef.current(command);
          return;
        }
      }
      if (event.key === "Escape") {
        setQuickOpen(false);
        setSearchOpen(false);
        setRename(null);
        setActions(null);
        setLocations(null);
      }
    };
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [preferences.keybindings]);
  function attach(context: ComponentContext) {
    setContexts((previous) =>
      [
        ...previous.filter((item) => item.nodeId !== context.nodeId),
        context,
      ].slice(-12),
    );
    setStatus(`${context.label} attached to the conversation.`);
  }

  return (
    <main className="witch-app">
      <header className="titlebar">
        <div className="brand">
          <span className="moon" aria-hidden="true" />
          <span>Witch</span>
          <em>code observatory</em>
        </div>
        <div className="title-project">
          {workspace?.name || "A quieter place to build."}
        </div>
        <div className="title-actions">
          <button
            className="quiet-title-action"
            onClick={() => setPaletteOpen(true)}
            title={preferences.keybindings.commandPalette}
          >
            Commands
          </button>
          <button
            className="quiet-title-action"
            onClick={() => setSettingsOpen(true)}
            title={preferences.keybindings.settings}
          >
            Settings
          </button>
          <button
            className="quiet-title-action"
            onClick={() => {
              setQuickQuery("");
              setQuickOpen(true);
            }}
          >
            Quick open
          </button>
          <button
            className="quiet-title-action"
            onClick={() => void openProviders()}
          >
            AI providers
          </button>
          <button
            className="primary-action"
            onClick={() => void openWorkspace()}
          >
            Open repository
          </button>
        </div>
      </header>
      {recoveryWarning && (
        <div className="recovery-notice" role="alert">
          <span>{recoveryWarning}</span>
          <button
            aria-label="Dismiss recovery notice"
            onClick={() => setRecoveryWarning("")}
          >
            ×
          </button>
        </div>
      )}
      <div
        className="workbench"
        ref={workbenchRef}
        style={{
          gridTemplateColumns: `${fittedLayout.left}px 4px minmax(320px, 1fr) 4px ${fittedLayout.right}px`,
        }}
      >
        <aside className="left-rail">
          <section>
            <h2>Project</h2>
            <div className="project-name" title={workspace?.root}>
              {workspace?.name || "No project open"}
              <small>{workspace?.root || "Local-first development"}</small>
            </div>
            {workspace && (
              <div className="explorer-actions">
                <button onClick={() => startFileAction("create-file")}>
                  + File
                </button>
                <button onClick={() => startFileAction("create-folder")}>
                  + Folder
                </button>
                <button
                  disabled={!explorerSelection}
                  onClick={() => startFileAction("rename")}
                >
                  Rename
                </button>
                <button
                  disabled={!explorerSelection}
                  onClick={() => startFileAction("move")}
                >
                  Move
                </button>
                <button
                  disabled={!explorerSelection}
                  onClick={() => startFileAction("delete")}
                >
                  Trash
                </button>
              </div>
            )}
            {workspace && (
              <ProjectExplorer
                key={workspace.root}
                entries={entries}
                selected={explorerSelection}
                onSelect={setExplorerSelection}
                onOpen={(path) => void selectFile(path)}
                onAction={startFileAction}
              />
            )}
          </section>
          <section>
            <h2>Navigate</h2>
            <button
              className={`nav-item ${view === "architecture" ? "active" : ""}`}
              onClick={() => setView("architecture")}
            >
              ✧ Constellation<small>Source-backed architecture</small>
            </button>
            <button className="nav-item" onClick={() => setSearchOpen(true)}>
              Search workspace
              <small>Text and symbols · {preferences.keybindings.search}</small>
            </button>
            <button className="nav-item" onClick={() => void saveAll()}>
              Save all<small>{preferences.keybindings.saveAll}</small>
            </button>
          </section>
          <section>
            <h2>Language intelligence</h2>
            <div className="language-provider-list">
              {(lsp?.providers || []).map((provider) => (
                <p
                  className={`language-provider ${provider.connected ? "connected" : provider.installed ? "ready" : "missing"}`}
                  key={provider.id}
                  title={provider.message}
                >
                  <span>
                    {provider.connected ? "●" : provider.installed ? "○" : "×"}
                  </span>
                  {provider.label}
                  {!provider.installed && " — not installed"}
                </p>
              ))}
              {!lsp?.providers?.length && (
                <p className="rail-note">Language services start on demand.</p>
              )}
            </div>
            <label className="python-environment-picker">
              <span>Python environment</span>
              <select
                aria-label="Python environment"
                value={tooling?.python.selectedId || ""}
                disabled={
                  !workspace ||
                  toolingBusy ||
                  !tooling?.python.candidates.length
                }
                title={tooling?.python.message}
                onChange={(event) => {
                  const id = event.target.value || null;
                  const root = rootRef.current;
                  if (!root) return;
                  setToolingBusy(true);
                  void window.witch.tooling
                    .selectPython(id, root)
                    .then((snapshot) => {
                      if (snapshot.root === rootRef.current) {
                        setTooling(snapshot);
                        const active = snapshot.python.candidates.find(
                          (item) => item.id === snapshot.python.activeId,
                        );
                        setStatus(
                          active
                            ? `Python environment: ${active.label}`
                            : snapshot.python.message,
                        );
                      }
                    })
                    .catch((reason) =>
                      setStatus(`Toolchains: ${errorText(reason)}`),
                    )
                    .finally(() => setToolingBusy(false));
                }}
              >
                <option value="">
                  Auto
                  {tooling?.python.selection === "automatic"
                    ? ` · ${tooling.python.candidates.find((item) => item.id === tooling.python.activeId)?.label || "detect"}`
                    : ""}
                </option>
                {tooling?.python.candidates.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.label}
                  </option>
                ))}
              </select>
              <small>
                {tooling?.python.candidates.find(
                  (item) => item.id === tooling.python.activeId,
                )?.source || "No interpreter detected"}
              </small>
            </label>
            {!!tooling?.warnings.length && (
              <p className="rail-note">{tooling.warnings.join(" ")}</p>
            )}
            <details className="problems-list">
              <summary>{problems.length} diagnostics</summary>
              {problems.map((problem, index) => (
                <button
                  key={`${problem.path}:${index}`}
                  onClick={() =>
                    void selectFile(problem.path, problem.start.line + 1)
                  }
                >
                  <strong>
                    {problem.severity === 1 ? "●" : "▲"} {problem.path}:
                    {problem.start.line + 1}
                  </strong>
                  <span>{problem.message}</span>
                </button>
              ))}
            </details>
            <details className="problems-list outline-list" open>
              <summary>
                {outline.length} symbols
                {selectedFile ? ` · ${selectedFile.split("/").at(-1)}` : ""}
              </summary>
              {outline.map((symbol, index) => (
                <button
                  key={`${symbol.path}:${symbol.selectionRange.start.line}:${index}`}
                  style={{ paddingLeft: 10 + symbol.depth * 12 }}
                  title={symbol.detail || symbol.name}
                  onClick={() =>
                    void selectFile(
                      symbol.path,
                      symbol.selectionRange.start.line + 1,
                    )
                  }
                >
                  <strong>
                    <span aria-hidden="true">◇</span> {symbol.name}
                  </strong>
                  {symbol.detail && <span>{symbol.detail}</span>}
                </button>
              ))}
            </details>
          </section>
          <DebugPanel
            root={workspace?.root}
            activeFile={selectedFile}
            state={debugState}
            onNavigate={(path, line) => void selectFile(path, line)}
            onConfigure={() => void configureExecution("launch")}
            onError={setStatus}
          />
          <section>
            <h2>Recent projects</h2>
            {recentProjects.slice(0, 5).map((project) => (
              <button
                className="nav-item"
                key={project.root}
                onClick={() => void openWorkspace(project.root)}
              >
                {project.name}
                <small>{project.root}</small>
              </button>
            ))}
          </section>
          <section>
            <h2>Structure history</h2>
            <p className="rail-note">
              {snapshots[0]
                ? `${snapshots.length} saved readings · latest ${new Date(snapshots[0].createdAt).toLocaleTimeString()}`
                : "A snapshot is saved with each manual reading."}
            </p>
            {snapshots
              .filter((snapshot) => snapshot.revision !== graph?.revision)
              .slice(0, 3)
              .map((snapshot) => (
                <button
                  className="nav-item"
                  key={snapshot.id}
                  disabled={Boolean(deltaBusy)}
                  onClick={() => void compareSnapshot(snapshot)}
                >
                  {deltaBusy === snapshot.id ? "Comparing…" : "Compare reading"}
                  <small>
                    {new Date(snapshot.createdAt).toLocaleString()} ·{" "}
                    {snapshot.revision.slice(0, 8)}
                  </small>
                </button>
              ))}
          </section>
          {!!legacyTasks.length && (
            <section>
              <h2>Previous analyses</h2>
              {legacyTasks.slice(0, 3).map((task) => (
                <button
                  key={task.id}
                  className="nav-item"
                  onClick={() =>
                    setLegacySummary(task.summary || "No saved response")
                  }
                >
                  {task.status}
                  <small>{task.focusFile || "Project reading"}</small>
                </button>
              ))}
            </section>
          )}
          <section>
            <h2>Computer use</h2>
            <button className="nav-item" onClick={() => setCuaOpen(true)}>
              Desktop observation
              <small>
                {cua?.connected
                  ? "Connected · read-only"
                  : "Disconnected · optional"}
              </small>
            </button>
          </section>
        </aside>
        <PanelDivider
          label="Resize project panel"
          orientation="vertical"
          value={fittedLayout.left}
          minimum={160}
          maximum={Math.min(
            420,
            workbenchSize.width - fittedLayout.right - 328,
          )}
          defaultValue={220}
          onChange={(value) => changePanel("left", value)}
          onCommit={(value) => changePanel("left", value, true)}
        />
        <section className="center-pane">
          <header className="pane-toolbar">
            <div className="tabs">
              <button
                className={view === "architecture" ? "selected" : ""}
                onClick={() => setView("architecture")}
              >
                Constellation
              </button>
              <button
                className={view === "source" ? "selected" : ""}
                onClick={() => setView("source")}
              >
                Source {tabs.length > 0 && `· ${tabs.length}`}
              </button>
            </div>
            <div className="pane-actions">
              {view === "source" && activeFileMapped && (
                <button
                  className="reveal-map-action"
                  onClick={() => {
                    setArchitectureReveal((value) => value + 1);
                    setView("architecture");
                  }}
                >
                  Reveal in Constellation
                </button>
              )}
              <button
                className="analyze-action"
                onClick={() => void analyze()}
                disabled={graphBusy || !workspace}
              >
                {graphBusy ? "Reading…" : "Read structure"}
              </button>
            </div>
          </header>
          <div className="surface">
            <div className="workbench-view" hidden={view !== "architecture"}>
              <ArchitectureCanvas
                graph={graph}
                busy={graphBusy}
                onAnalyze={() => void analyze()}
                onClearIndex={() => void clearAnalysisIndex()}
                onAcceptCandidate={(revision) =>
                  void acceptAnalysisCandidate(revision)
                }
                onOpenFile={(path, line) => void selectFile(path, line)}
                onAttach={attach}
                onExport={(format) => void exportArchitecture(format)}
                composerProviders={[
                  {
                    id: "codex",
                    label: "Codex CLI",
                    available: Boolean(providers?.codex.authenticated),
                    detail:
                      providers?.codex.message || "Codex CLI is unavailable.",
                  },
                  {
                    id: "claude",
                    label: "Claude Code CLI",
                    available: Boolean(providers?.claude.authenticated),
                    detail:
                      providers?.claude.message ||
                      "Claude Code CLI is unavailable.",
                  },
                  {
                    id: "openai",
                    label: "OpenAI API",
                    available: Boolean(providers?.openaiApi.configured),
                    detail:
                      providers?.openaiApi.message ||
                      "OpenAI API key is not configured.",
                  },
                  {
                    id: "anthropic",
                    label: "Anthropic API",
                    available: Boolean(providers?.anthropicApi.configured),
                    detail:
                      providers?.anthropicApi.message ||
                      "Anthropic API key is not configured.",
                  },
                  {
                    id: "rules",
                    label: "Rules only",
                    available: true,
                    detail:
                      "Deterministic local fallback. No project metadata leaves this computer.",
                  },
                ]}
                compositionBusy={compositionBusy}
                onCompose={composeMeaning}
                activeFile={selectedFile}
                revealRequest={architectureReveal}
              />
            </div>
            <div className="workbench-view" hidden={view !== "source"}>
              <SourceEditor
                root={workspace?.root || ""}
                tabs={tabs}
                activeTab={activeTab}
                lineTarget={lineTarget}
                diagnostics={diagnostics}
                theme={preferences.theme}
                fontSize={preferences.fontSize}
                tabSize={preferences.tabSize}
                wordWrap={preferences.wordWrap}
                snippets={snippets}
                breakpoints={breakpoints}
                debugLocation={
                  debugState.status === "paused"
                    ? debugState.frames[0]
                    : undefined
                }
                onBreakpoint={(path, line) => void toggleBreakpoint(path, line)}
                onSelect={(path) => void selectFile(path)}
                onClose={closeTab}
                onChange={changeDocument}
                onSave={() => void saveActive()}
                onReload={(path) => void reviewDisk(path)}
                onError={setStatus}
                onDefinition={(path, position) =>
                  void findLocations("definition", path, position)
                }
                onReferences={(path, position) =>
                  void findLocations("references", path, position)
                }
                onRename={(path, position, name) =>
                  setRename({ path, position, name })
                }
                onActions={(path, range) => void codeActions(path, range)}
              />
            </div>
          </div>
          {locations && (
            <section className="locations-panel">
              <header>
                <strong>{locations.title}</strong>
                <button
                  onClick={() => setLocations(null)}
                  aria-label="Close references"
                >
                  ×
                </button>
              </header>
              {locations.items.map((item, index) => (
                <button
                  key={index}
                  onClick={() =>
                    void selectFile(item.path, item.start.line + 1)
                  }
                >
                  {item.path}
                  <span>
                    {item.start.line + 1}:{item.start.character + 1}
                  </span>
                </button>
              ))}
            </section>
          )}
          <TerminalPanel
            key={workspace?.root || "empty"}
            root={workspace?.root}
            activeFile={selectedFile || undefined}
            onConfigure={() => void configureExecution("tasks")}
            height={fittedLayout.terminal}
            maximumHeight={maximumTerminal}
            onHeightChange={(value) => changePanel("terminal", value)}
            onHeightCommit={(value) => changePanel("terminal", value, true)}
          />
        </section>
        <PanelDivider
          label="Resize chat panel"
          orientation="vertical"
          value={fittedLayout.right}
          minimum={240}
          maximum={Math.min(650, workbenchSize.width - fittedLayout.left - 328)}
          defaultValue={350}
          reverse
          onChange={(value) => changePanel("right", value)}
          onCommit={(value) => changePanel("right", value, true)}
        />
        <aside className="right-rail">
          <section className="file-section">
            <header>
              <h2>Grimoire pages</h2>
              <span>{files.length} files</span>
            </header>
            <input
              className="page-filter"
              aria-label="Filter visible files"
              placeholder="Find a page…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {matchingFiles.length > 150 && (
              <p className="file-limit-note">
                Showing 150 of {matchingFiles.length} matches. Filter to find
                more.
              </p>
            )}
            <div className="file-list">
              {filtered.map((file) => (
                <button
                  className={selectedFile === file.path ? "selected-file" : ""}
                  key={file.path}
                  title={file.path}
                  onClick={() => void selectFile(file.path)}
                >
                  {file.path}
                </button>
              ))}
              {!files.length && (
                <p className="empty">Your project’s source appears here.</p>
              )}
            </div>
          </section>
          <ChatPanel
            root={workspace?.root}
            graph={graph}
            attachments={contexts}
            onAttachments={setContexts}
            available={Boolean(providers?.codex.installed)}
            providerStatus={providers}
            onOpenFile={(path, line) => void selectFile(path, line)}
          />
        </aside>
      </div>
      <footer className="status-line" role="status" title={status}>
        <span>✦ {status}</span>
        <small>
          {tabs.filter((tab) => tab.content !== tab.savedContent).length}{" "}
          unsaved · {graph ? graph.revision.slice(0, 8) : "local"}
        </small>
      </footer>
      {settingsOpen && (
        <SettingsDialog
          snapshot={settings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {paletteOpen && (
        <CommandPalette
          preferences={preferences}
          onRun={runCommand}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {providersOpen && (
        <ProviderDialog
          providers={providers}
          onClose={() => setProvidersOpen(false)}
          onConnect={async (provider) => {
            setStatus(
              `Waiting for ${provider === "codex" ? "Codex" : "Claude Code"} browser sign-in…`,
            );
            setProviders(await window.witch.providers.connectCli(provider));
            setStatus(
              `${provider === "codex" ? "Codex" : "Claude Code"} is signed in and available to Witch.`,
            );
          }}
          onRefresh={async () => {
            setProviders(await window.witch.providers.status());
            setStatus("AI provider status refreshed.");
          }}
          onSave={async (provider, key) => {
            setProviders(
              await window.witch.providers.saveApiKey(provider, key),
            );
            setStatus("API key saved using operating-system secure storage.");
          }}
          onRemove={async (provider) => {
            setProviders(await window.witch.providers.removeApiKey(provider));
            setStatus("Stored key removed.");
          }}
        />
      )}
      {quickOpen && (
        <QuickOpenDialog
          files={quickFiles}
          query={quickQuery}
          onQueryChange={setQuickQuery}
          onClose={() => setQuickOpen(false)}
          onSelect={(path) => {
            void selectFile(path);
            setQuickOpen(false);
          }}
        />
      )}
      {searchOpen && (
        <WorkspaceSearchDialog
          query={searchQuery}
          result={searchResult}
          searching={searching}
          onQueryChange={setSearchQuery}
          onSearch={() => void search()}
          onClose={closeSearch}
          onSelect={(path, line) => {
            void selectFile(path, line);
            setSearchOpen(false);
          }}
        />
      )}
      {fileAction && (
        <FileActionDialog
          key={`${fileAction.kind}:${fileAction.source}`}
          action={fileAction}
          onClose={() => {
            if (!fileBusy) setFileAction(null);
          }}
          onSubmit={(path) => void performFileAction(path)}
        />
      )}
      {rename && (
        <div className="provider-backdrop">
          <form
            className="compact-dialog"
            role="dialog"
            aria-label="Rename symbol"
            onSubmit={(event) => {
              event.preventDefault();
              void renameSymbol();
            }}
          >
            <h2>Rename symbol</h2>
            <p>Changes across the project will be previewed first.</p>
            <input
              autoFocus
              aria-label="New symbol name"
              value={rename.name}
              onChange={(event) =>
                setRename({ ...rename, name: event.target.value })
              }
            />
            <footer>
              <button type="button" onClick={() => setRename(null)}>
                Cancel
              </button>
              <button className="primary-action" disabled={!rename.name.trim()}>
                Preview rename
              </button>
            </footer>
          </form>
        </div>
      )}
      {actions && (
        <div className="provider-backdrop">
          <section
            className="compact-dialog"
            role="dialog"
            aria-label="Code actions"
          >
            <h2>Code actions</h2>
            {actions.map((action) => (
              <button
                className="action-option"
                disabled={Boolean(action.disabled)}
                key={action.id}
                title={action.disabled}
                onClick={() => {
                  void window.witch.lsp
                    .resolveAction(action.id)
                    .then((result) => {
                      setActions(null);
                      setRefactor(result);
                    })
                    .catch((reason) => setStatus(errorText(reason)));
                }}
              >
                {action.title}
              </button>
            ))}
            <button onClick={() => setActions(null)}>Cancel</button>
          </section>
        </div>
      )}
      {refactor && (
        <ReviewDialog
          title={refactor.title}
          files={refactor.changes}
          description="Approve edits into editor buffers. Original files stay unchanged until you Save or Save All."
          applyLabel="Apply to editor buffers"
          onClose={() => setRefactor(null)}
          onApply={applyRefactor}
        />
      )}
      {diskReview && (
        <ReviewDialog
          title="Compare editor and disk"
          files={[diskReview]}
          description="Left: your current editor buffer. Right: the current file on disk. Loading the disk version replaces your buffer."
          applyLabel="Replace buffer with disk version"
          onClose={() => setDiskReview(null)}
          onApply={async () => {
            const latest = await window.witch.workspace.readDocument(
              diskReview.path,
            );
            if (latest.hash !== diskReview.hash)
              throw new Error(
                "The disk file changed again. Reopen this comparison.",
              );
            setTabs((previous) =>
              previous.map((tab) =>
                tab.path === diskReview.path
                  ? {
                      ...tab,
                      content: latest.content,
                      savedContent: latest.content,
                      hash: latest.hash,
                      conflict: undefined,
                    }
                  : tab,
              ),
            );
          }}
        />
      )}
      {delta && (
        <ArchitectureDeltaDialog
          delta={delta}
          onClose={() => setDelta(null)}
          onOpenFile={(path) => {
            setDelta(null);
            void selectFile(path);
          }}
        />
      )}
      {cuaOpen && (
        <div className="provider-backdrop">
          <section
            className="compact-dialog cua-dialog"
            role="dialog"
            aria-label="Desktop observation"
          >
            <h2>Desktop observation</h2>
            <p>{cua?.message || "Checking the optional CUA driver…"}</p>
            <p>
              Only window-list observation is enabled. Clicking, typing,
              clipboard access, and application control are not granted to the
              agent.
            </p>
            <footer>
              {cua?.connected ? (
                <>
                  <button
                    disabled={cuaBusy}
                    onClick={() => void cuaAction("observe")}
                  >
                    Observe windows
                  </button>
                  <button
                    disabled={cuaBusy}
                    onClick={() => void cuaAction("disconnect")}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  disabled={cuaBusy || !cua?.installed}
                  onClick={() => void cuaAction("connect")}
                >
                  Connect read-only
                </button>
              )}
              <button onClick={() => setCuaOpen(false)}>Close</button>
            </footer>
            {desktopEvidence && <pre>{desktopEvidence}</pre>}
          </section>
        </div>
      )}
      {legacySummary && (
        <div className="provider-backdrop">
          <section
            className="compact-dialog cua-dialog"
            role="dialog"
            aria-label="Previous analysis"
          >
            <h2>Previous analysis</h2>
            <pre>{legacySummary}</pre>
            <button onClick={() => setLegacySummary(null)}>Close</button>
          </section>
        </div>
      )}
    </main>
  );
}
