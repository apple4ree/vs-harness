import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type NodeProps,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  buildView,
  groupWorkflowCatalogCards,
  isSupportWorkflowNode,
  relationsForEdge,
  selectWorkflowCatalogNodes,
  shouldUseWorkflowCatalogGrid,
  type CardData,
  type CardNode,
  type ArchitectureScope,
  type GraphDensity,
  type SemanticLens,
  type RuntimeViewOptions,
  type WorkflowViewMode,
} from "./architecture-view";
import {
  Box,
  FileCode2,
  GripVertical,
  Layers3,
  Search,
  ArrowUpRight,
  Network,
  Package,
  ChevronLeft,
  Maximize2,
  LocateFixed,
  ShieldCheck,
  TriangleAlert,
  Sparkles,
  RefreshCw,
  Gauge,
  LayoutGrid,
  Activity,
  Square,
} from "lucide-react";
import {
  COMPONENT_DRAG_TYPE,
  type ArchitectureGraph,
  type ComponentContext,
} from "../../../shared/architecture";
import {
  traceArchitectureReach,
  traceArchitectureRoute,
  type ArchitectureTrace,
} from "../../../shared/architecture-navigation";
import { projectSourceNeighborhood } from "../../../shared/architecture-projection";
import constellationAtmosphere from "../assets/witch-constellation-atmosphere.png";
import { emptyVisualQualityReceipt } from "./architecture-visual-quality";
import type {
  SemanticComposerProviderId,
  SemanticComposerRequest,
} from "../../../shared/semantic-composer";
import type { ProjectTask } from "../../../shared/execution";
import type {
  RuntimeObservedRelation,
  RuntimeTraceMode,
  RuntimeTraceSession,
} from "../../../shared/runtime-trace";
import {
  compareRuntimeTrace,
  observedRuntimeRelations,
} from "../../../shared/runtime-trace-ir";
import "@xyflow/react/dist/style.css";
import "./architecture.css";

function ComponentCard({ data, selected }: NodeProps<CardNode>) {
  const Icon =
    data.kind === "system"
      ? Network
      : data.kind === "module" || data.kind === "component"
        ? Box
        : data.kind === "external" || data.kind === "external-system"
          ? Package
          : data.kind === "workflow"
            ? Layers3
            : data.kind === "workflow-step"
              ? LocateFixed
              : FileCode2;
  return (
    <div
      className={`architecture-card ${data.sequence ? "is-sequence" : ""} ${data.workflowSummary ? "is-workflow-summary" : ""} ${data.workflowSummary?.support ? "is-support-workflow" : ""} ${selected ? "is-selected" : ""} ${data.changed ? "has-changed" : ""} ${data.traced ? "is-traced" : ""} ${data.dimmed ? "is-dimmed" : ""} ${data.trust ? `semantic-${data.trust}` : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="architecture-card-top">
        <span>
          <Icon size={14} /> {data.kind}
        </span>
        {data.paths.length > 0 && (
          <button
            className="nodrag context-drag"
            draggable
            title="Drag this source-backed context into the Agent conversation"
            aria-label={`Drag ${data.label} context to chat`}
            onDragStart={(event) => {
              event.dataTransfer.setData(
                COMPONENT_DRAG_TYPE,
                JSON.stringify(data.context),
              );
              event.dataTransfer.setData("text/plain", data.label);
              event.dataTransfer.effectAllowed = "copy";
            }}
          >
            <GripVertical size={16} />
          </button>
        )}
      </div>
      <strong title={data.label}>{data.label}</strong>
      <small title={data.subtitle}>{data.subtitle}</small>
      <footer>
        {data.workflowSummary ? (
          <>
            <span>{data.workflowSummary.steps} steps</span>
            <span>{data.workflowSummary.branches} branches</span>
            {data.workflowSummary.retries > 0 && (
              <span>{data.workflowSummary.retries} retries</span>
            )}
          </>
        ) : data.semanticId ? (
          `${data.trust} · ${data.status}`
        ) : data.kind === "module" ? (
          `${data.count} files`
        ) : data.kind === "external" ? (
          "External dependency"
        ) : (
          `${data.symbols} symbols`
        )}
        {data.behaviorSummary && (
          <>
            <span>{data.behaviorSummary.inputs.length} inputs</span>
            <span>{data.behaviorSummary.outputs.length} outputs</span>
            {data.behaviorSummary.sideEffects.length > 0 && (
              <span>{data.behaviorSummary.sideEffects.length} effects</span>
            )}
          </>
        )}
        {data.changed && <span>updated</span>}
        {Boolean(data.questions) && <span>{data.questions} question</span>}
      </footer>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { component: ComponentCard };

export function ArchitectureCanvas({
  graph,
  busy,
  onAnalyze,
  onClearIndex,
  onOpenFile,
  onAttach,
  onExport,
  composerProviders,
  compositionBusy,
  onCompose,
  activeFile,
  revealRequest,
}: {
  graph: ArchitectureGraph | null;
  busy: boolean;
  onAnalyze: () => void;
  onClearIndex: () => void;
  onOpenFile: (path: string, line?: number) => void;
  onAttach: (context: ComponentContext) => void;
  onExport: (format: "json" | "html") => void;
  composerProviders: Array<{
    id: SemanticComposerProviderId;
    label: string;
    available: boolean;
    detail: string;
  }>;
  compositionBusy: boolean;
  onCompose: (request: SemanticComposerRequest) => Promise<boolean>;
  activeFile?: string | null;
  revealRequest?: number;
}) {
  const [scope, setScope] = useState<ArchitectureScope>("semantics");
  const [density, setDensity] = useState<GraphDensity>("readable");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [composerProvider, setComposerProvider] =
    useState<SemanticComposerProviderId>("codex");
  const [composerModel, setComposerModel] = useState("");
  const [semanticLens, setSemanticLens] = useState<SemanticLens>("overview");
  const [componentFocus, setComponentFocus] = useState<string | null>(null);
  const [workflowFocus, setWorkflowFocus] = useState<string | null>(null);
  const [workflowViewMode, setWorkflowViewMode] =
    useState<WorkflowViewMode>("graph");
  const [collapseWorkflowBranches, setCollapseWorkflowBranches] =
    useState(false);
  const [workflowCatalogExpanded, setWorkflowCatalogExpanded] = useState(false);
  const [showSupportWorkflows, setShowSupportWorkflows] = useState(false);
  const [module, setModule] = useState<string | null>(null);
  const [external, setExternal] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<CardNode | null>(null);
  const [relationSelection, setRelationSelection] = useState<Edge | null>(null);
  const [trace, setTrace] = useState<ArchitectureTrace | null>(null);
  const [routeStart, setRouteStart] = useState<CardNode | null>(null);
  const [traceNotice, setTraceNotice] = useState("");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeTraceMode>("static");
  const [runtimeSessions, setRuntimeSessions] = useState<RuntimeTraceSession[]>(
    [],
  );
  const [runtimeSessionId, setRuntimeSessionId] = useState("");
  const [runtimeTasks, setRuntimeTasks] = useState<ProjectTask[]>([]);
  const [runtimeTaskId, setRuntimeTaskId] = useState("");
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeNotice, setRuntimeNotice] = useState("");
  const flow = useRef<ReactFlowInstance<CardNode, Edge> | null>(null);
  const projection = useMemo(
    () =>
      graph && activeFile
        ? projectSourceNeighborhood(graph, activeFile, external)
        : null,
    [graph?.revision, graph?.workspaceRoot, activeFile, external],
  );
  const selectedRuntimeSession =
    runtimeSessions.find((session) => session.id === runtimeSessionId) || null;
  const runtimeCompatible = Boolean(
    graph?.semantic &&
    selectedRuntimeSession?.sourceRevision === graph.revision &&
    selectedRuntimeSession.semanticRevision === graph.semantic.revision &&
    selectedRuntimeSession.validation.valid,
  );
  const runtimeObservedRelations = useMemo(
    () =>
      selectedRuntimeSession && runtimeCompatible
        ? observedRuntimeRelations(selectedRuntimeSession)
        : [],
    [selectedRuntimeSession?.revision, runtimeCompatible],
  );
  const runtimeComparison = useMemo(
    () =>
      compareRuntimeTrace(
        graph?.behavior?.relations || [],
        runtimeObservedRelations,
      ),
    [graph?.behavior?.revision, runtimeObservedRelations],
  );
  const runtimeView = useMemo<RuntimeViewOptions>(
    () => ({
      mode: runtimeMode,
      observedRelations: runtimeObservedRelations,
      matchedStaticIds: new Set(runtimeComparison.matchedStaticIds),
      matchedObservedIds: new Set(runtimeComparison.matchedObservedIds),
    }),
    [runtimeMode, runtimeObservedRelations, runtimeComparison],
  );
  const layoutKey = `${graph?.workspaceRoot}|${scope}|${density}|${semanticLens}|${componentFocus}|${workflowFocus}|${workflowViewMode}|${collapseWorkflowBranches}|${workflowCatalogExpanded}|${showSupportWorkflows}|${module}|${external}|${query}|${runtimeMode}|${selectedRuntimeSession?.revision || "no-trace"}|${scope === "focus" ? projection?.focus.id || "missing" : ""}`;
  const previousLayout = useRef("");
  const previous = useRef<ArchitectureGraph | null>(null);
  useEffect(() => {
    if (
      composerProviders.some(
        (provider) => provider.id === composerProvider && provider.available,
      )
    )
      return;
    setComposerProvider(
      composerProviders.find((provider) => provider.available)?.id || "rules",
    );
  }, [composerProvider, composerProviders]);
  useEffect(() => {
    let canceled = false;
    if (!graph?.workspaceRoot) {
      setRuntimeSessions([]);
      setRuntimeTasks([]);
      return;
    }
    void Promise.all([
      window.witch.execution.catalog(),
      window.witch.trace.list(),
    ])
      .then(([catalog, sessions]) => {
        if (canceled) return;
        setRuntimeTasks(catalog.tasks);
        setRuntimeTaskId((current) =>
          catalog.tasks.some((task) => task.id === current)
            ? current
            : catalog.tasks[0]?.id || "",
        );
        setRuntimeSessions(sessions);
        setRuntimeSessionId((current) => {
          if (sessions.some((session) => session.id === current))
            return current;
          const compatible = sessions.find(
            (session) =>
              session.sourceRevision === graph.revision &&
              session.semanticRevision === graph.semantic?.revision,
          );
          return compatible?.id || sessions[0]?.id || "";
        });
      })
      .catch((error) => {
        if (!canceled) setRuntimeNotice(String(error));
      });
    return () => {
      canceled = true;
    };
  }, [graph?.workspaceRoot, graph?.revision, graph?.semantic?.revision]);
  useEffect(
    () =>
      window.witch.trace.onUpdated((session) => {
        if (session.workspaceRoot !== graph?.workspaceRoot) return;
        setRuntimeSessions((current) =>
          [session, ...current.filter((item) => item.id !== session.id)].sort(
            (left, right) => right.startedAt.localeCompare(left.startedAt),
          ),
        );
        setRuntimeSessionId((current) => current || session.id);
      }),
    [graph?.workspaceRoot],
  );
  const changed = useMemo(() => {
    const old = new Map(
      previous.current?.nodes.map((node) => [node.id, node.hash]),
    );
    const sameWorkspace =
      previous.current?.workspaceRoot === graph?.workspaceRoot;
    const result = new Set(
      graph?.nodes
        .filter(
          (node) =>
            sameWorkspace && node.path && old.get(node.id) !== node.hash,
        )
        .map((node) => node.id),
    );
    previous.current = graph;
    return result;
  }, [graph?.revision, graph?.workspaceRoot]);
  useEffect(() => {
    setScope(graph?.semantic ? "semantics" : "modules");
    setDensity("readable");
    setQualityOpen(false);
    setCoverageOpen(false);
    setSemanticLens("overview");
    setComponentFocus(null);
    setWorkflowFocus(null);
    setWorkflowViewMode("graph");
    setCollapseWorkflowBranches(false);
    setWorkflowCatalogExpanded(false);
    setShowSupportWorkflows(false);
    setModule(null);
    setQuery("");
    setSelection(null);
    setRelationSelection(null);
    setTrace(null);
    setRouteStart(null);
    setTraceNotice("");
    setRuntimeMode("static");
    setRuntimeSessionId("");
    setRuntimeTaskId("");
    setRuntimeNotice("");
  }, [graph?.workspaceRoot]);
  const workflows = useMemo(() => {
    return selectWorkflowCatalogNodes(graph?.semantic?.nodes || []).sort(
      (left, right) =>
        Number(isSupportWorkflowNode(left)) -
          Number(isSupportWorkflowNode(right)) ||
        left.label.localeCompare(right.label),
    );
  }, [graph?.semantic?.revision]);
  useEffect(() => {
    if (
      workflowFocus &&
      !workflows.some((workflow) => workflow.id === workflowFocus)
    )
      setWorkflowFocus(null);
  }, [workflowFocus, workflows]);
  const openWorkflow = (id: string) => {
    setSemanticLens("workflows");
    setWorkflowFocus(id);
    setComponentFocus(null);
    setWorkflowViewMode("sequence");
    setCollapseWorkflowBranches(true);
    setSelection(null);
    setRelationSelection(null);
  };
  const revealActiveFile = () => {
    if (!projection) return;
    setScope("focus");
    setModule(null);
    setQuery("");
    setRelationSelection(null);
    setTrace(null);
    setRouteStart(null);
    setTraceNotice("");
  };
  const previousReveal = useRef(revealRequest || 0);
  useEffect(() => {
    if (!revealRequest || revealRequest === previousReveal.current) return;
    previousReveal.current = revealRequest;
    revealActiveFile();
  }, [revealRequest, projection?.focus.id]);
  const view = useMemo(
    () =>
      graph
        ? buildView(
            graph,
            scope,
            module,
            external,
            query,
            changed,
            projection,
            semanticLens,
            {
              focusId: workflowFocus,
              componentFocusId: componentFocus,
              mode: workflowViewMode,
              collapseBranches: collapseWorkflowBranches,
              catalogLimit:
                query || workflowCatalogExpanded || density === "complete"
                  ? 200
                  : 12,
              includeSupport: showSupportWorkflows,
            },
            density,
            runtimeView,
          )
        : {
            nodes: [],
            edges: [],
            total: 0,
            totalEdges: 0,
            quality: emptyVisualQualityReceipt(),
            workflowCatalog: undefined,
            projection: {
              density: "readable" as const,
              omittedNodes: 0,
              omittedEdges: 0,
              qualityRemovedEdges: 0,
            },
          },
    [
      graph?.revision,
      graph?.workspaceRoot,
      scope,
      density,
      module,
      external,
      query,
      changed,
      projection,
      semanticLens,
      componentFocus,
      workflowFocus,
      workflowViewMode,
      collapseWorkflowBranches,
      workflowCatalogExpanded,
      showSupportWorkflows,
      runtimeView,
    ],
  );
  const workflowCatalogGroups = useMemo(
    () => groupWorkflowCatalogCards(view.nodes),
    [view.nodes],
  );
  const groupedWorkflowCatalog =
    scope === "semantics" &&
    semanticLens === "workflows" &&
    !workflowFocus &&
    shouldUseWorkflowCatalogGrid(view.workflowCatalog, view.quality.status, {
      expanded: workflowCatalogExpanded || Boolean(query),
      includeSupport: showSupportWorkflows,
    });
  useEffect(() => {
    if (groupedWorkflowCatalog) setQualityOpen(false);
  }, [groupedWorkflowCatalog]);
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  useEffect(() => {
    const reset = previousLayout.current !== layoutKey;
    previousLayout.current = layoutKey;
    setNodes((previous) => {
      if (reset) return view.nodes;
      const positions = new Map(previous.map((node) => [node.id, node]));
      return view.nodes.map((node) => {
        const prior = positions.get(node.id);
        return prior
          ? { ...node, position: prior.position, selected: prior.selected }
          : node;
      });
    });
    setEdges(view.edges);
    setRelationSelection((previous) =>
      !reset && previous
        ? view.edges.find((edge) => edge.id === previous.id) || null
        : null,
    );
    setSelection((previous) => {
      if (reset)
        return scope === "focus" && projection
          ? view.nodes.find((node) => node.id === projection.focus.id) || null
          : null;
      return previous
        ? view.nodes.find((node) => node.id === previous.id) || null
        : null;
    });
    if (reset)
      requestAnimationFrame(() => {
        void flow.current?.fitView({ padding: 0.22 });
      });
  }, [view, layoutKey, scope, projection]);
  useEffect(() => {
    setTrace(null);
    setRouteStart(null);
    setTraceNotice("");
  }, [layoutKey]);
  const neighbors = new Set(selection ? [selection.id] : []);
  if (selection)
    for (const edge of edges) {
      if (edge.source === selection.id) neighbors.add(edge.target);
      if (edge.target === selection.id) neighbors.add(edge.source);
    }
  const tracedNodes = new Set(trace?.nodeIds || []);
  if (routeStart) tracedNodes.add(routeStart.id);
  const tracedEdges = new Set(trace?.edgeIds || []);
  const tracing = Boolean(trace || routeStart);
  const displayedNodes = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      traced: tracedNodes.has(node.id),
      dimmed: tracing
        ? !tracedNodes.has(node.id)
        : Boolean(selection && !neighbors.has(node.id)),
    },
  }));
  const displayedEdges = edges.map((edge) => {
    if (!tracing) return edge;
    const active = tracedEdges.has(edge.id);
    return {
      ...edge,
      animated: active,
      style: {
        ...edge.style,
        stroke: active ? "#d3a4ff" : "#4a3a59",
        strokeWidth: active ? 2.4 : 1,
        opacity: active ? 1 : 0.18,
      },
    };
  });
  const selectedPaths = new Set(selection?.data.paths || []);
  const selectedFiles =
    graph?.nodes.filter((node) => selectedPaths.has(node.id)) || [];
  const related =
    graph?.edges.filter(
      (edge) => selectedPaths.has(edge.from) || selectedPaths.has(edge.to),
    ) || [];
  const selectedRelations =
    graph && relationSelection
      ? relationsForEdge(graph, relationSelection)
      : [];
  const selectedSemanticNode = selection?.data.semanticId
    ? graph?.semantic?.nodes.find(
        (node) => node.id === selection.data.semanticId,
      ) || null
    : null;
  const selectedSemanticClaims = selectedSemanticNode
    ? graph?.semantic?.claims.filter(
        (claim) => claim.subjectId === selectedSemanticNode.id,
      ) || []
    : [];
  const selectedSemanticQuestions = selectedSemanticNode
    ? graph?.semantic?.questions.filter(
        (question) => question.subjectId === selectedSemanticNode.id,
      ) || []
    : [];
  const selectedSemanticRelations = selectedSemanticNode
    ? graph?.semantic?.relations.filter(
        (relation) =>
          relation.from === selectedSemanticNode.id ||
          relation.to === selectedSemanticNode.id,
      ) || []
    : [];
  const selectedSemanticRelation = relationSelection
    ? graph?.semantic?.relations.find(
        (relation) => relation.id === relationSelection.id,
      ) || null
    : null;
  const visibleBehaviorRelations =
    runtimeMode === "observed"
      ? runtimeObservedRelations
      : runtimeMode === "compare"
        ? [...(graph?.behavior?.relations || []), ...runtimeObservedRelations]
        : graph?.behavior?.relations || [];
  const selectedBehaviorRelations = selectedSemanticNode
    ? visibleBehaviorRelations.filter(
        (relation) =>
          relation.from === selectedSemanticNode.id ||
          relation.to === selectedSemanticNode.id,
      )
    : [];
  const selectedBehaviorRelation = relationSelection
    ? visibleBehaviorRelations.find(
        (relation) => relation.id === relationSelection.id,
      ) || null
    : null;
  const selectedObservedRelation =
    selectedBehaviorRelation?.trust === "observed"
      ? (selectedBehaviorRelation as RuntimeObservedRelation)
      : null;
  const selectedBehaviorValue = selectedBehaviorRelation?.valueId
    ? graph?.behavior?.values.find(
        (value) => value.id === selectedBehaviorRelation.valueId,
      ) || null
    : null;
  const selectedWorkflowBehavior = selectedSemanticNode
    ? graph?.behavior?.workflows.find(
        (summary) => summary.workflowId === selectedSemanticNode.id,
      ) || null
    : null;
  const semanticLabels = useMemo(
    () => new Map(graph?.semantic?.nodes.map((node) => [node.id, node.label])),
    [graph?.semantic?.revision],
  );
  const selectedNeighborhood = useMemo(
    () =>
      graph && selection?.data.kind === "file"
        ? projectSourceNeighborhood(graph, selection.id, external)
        : null,
    [graph?.revision, graph?.workspaceRoot, selection?.id, external],
  );
  const labels = useMemo(
    () => new Map(graph?.nodes.map((node) => [node.id, node.label])),
    [graph?.revision, graph?.workspaceRoot],
  );
  const startRuntimeTrace = async () => {
    if (!runtimeTaskId || runtimeBusy) return;
    setRuntimeBusy(true);
    setRuntimeNotice("");
    try {
      const result = await window.witch.trace.start(
        runtimeTaskId,
        activeFile || undefined,
      );
      setRuntimeSessions((current) => [
        result.trace,
        ...current.filter((session) => session.id !== result.trace.id),
      ]);
      setRuntimeSessionId(result.trace.id);
      setRuntimeMode("observed");
    } catch (error) {
      setRuntimeNotice(String(error));
    } finally {
      setRuntimeBusy(false);
    }
  };
  const stopRuntimeTrace = async () => {
    if (!selectedRuntimeSession || runtimeBusy) return;
    setRuntimeBusy(true);
    setRuntimeNotice("");
    try {
      const session = await window.witch.trace.stop(selectedRuntimeSession.id);
      if (session)
        setRuntimeSessions((current) => [
          session,
          ...current.filter((item) => item.id !== session.id),
        ]);
    } catch (error) {
      setRuntimeNotice(String(error));
    } finally {
      setRuntimeBusy(false);
    }
  };
  return (
    <div className="architecture-workspace">
      <div className="architecture-toolbar">
        <div className="graph-scope">
          <button
            className={scope === "modules" ? "active" : ""}
            onClick={() => {
              setScope("modules");
              setModule(null);
            }}
          >
            <Layers3 size={14} /> Modules
          </button>
          <button
            className={scope === "files" ? "active" : ""}
            onClick={() => setScope("files")}
          >
            <FileCode2 size={14} /> Files
          </button>
          <button
            className={scope === "semantics" ? "active" : ""}
            disabled={!graph?.semantic}
            title="Explore verified facts and provisional system, component, and workflow meaning"
            onClick={() => {
              setScope("semantics");
              setModule(null);
              setSelection(null);
              setRelationSelection(null);
              setComponentFocus(null);
            }}
          >
            <Network size={14} /> Meaning
          </button>
          <button
            className={scope === "focus" ? "active" : ""}
            disabled={!projection}
            title={
              projection
                ? `Show direct source relations for ${projection.focus.path}`
                : "Open an analyzed source file to focus it"
            }
            aria-label="Focus active file"
            onClick={revealActiveFile}
          >
            <LocateFixed size={14} /> Focus
          </button>
        </div>
        <label className="graph-search">
          <Search size={13} />
          <input
            aria-label="Find architecture component"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              scope === "focus"
                ? "Focused view follows the active source file"
                : scope === "semantics"
                  ? "Find a system, workflow, component, or symbol…"
                  : "Find a component…"
            }
            disabled={scope === "focus"}
          />
        </label>
        {scope === "semantics" && (
          <select
            className="semantic-lens"
            aria-label="Meaning lens"
            value={semanticLens}
            onChange={(event) => {
              setSemanticLens(event.target.value as SemanticLens);
              setComponentFocus(null);
              setWorkflowFocus(null);
              setWorkflowCatalogExpanded(false);
              setShowSupportWorkflows(false);
            }}
          >
            <option value="overview">Meaning · Overview</option>
            <option value="components">Components · Boundaries</option>
            <option value="workflows">Workflows · Control flow</option>
            <option value="calls">Calls · Symbols</option>
            <option value="types">Types · Hierarchy</option>
            <option value="data">Data · State access</option>
            <option value="behavior">Behavior · Data flow</option>
            <option value="frameworks">Frameworks · Routes & tasks</option>
            <option value="questions">Questions · Conflicts</option>
            <option value="verified">Verified / Authored</option>
          </select>
        )}
        <label className="external-toggle">
          <input
            type="checkbox"
            checked={external}
            onChange={(event) => setExternal(event.target.checked)}
          />{" "}
          Dependencies
        </label>
        <select
          className="graph-density"
          aria-label="Graph detail"
          value={density}
          onChange={(event) => setDensity(event.target.value as GraphDensity)}
          disabled={scope === "focus"}
          title="Readable keeps a verified visual backbone; Complete keeps the full selected scope"
        >
          <option value="readable">Readable backbone</option>
          <option value="complete">Complete map</option>
        </select>
        <button
          className={`graph-quality-status is-${groupedWorkflowCatalog ? "grouped" : view.quality.status}`}
          aria-expanded={qualityOpen}
          aria-label={
            groupedWorkflowCatalog
              ? "Workflow catalog uses grouped layout"
              : "Open visual quality diagnostics"
          }
          title={
            groupedWorkflowCatalog
              ? "Grouped catalog preserves readable card sizes; open a workflow to validate its focused graph"
              : `${view.quality.profile} visual validation: ${view.quality.errors} errors, ${view.quality.warnings} warnings`
          }
          onClick={() => setQualityOpen((open) => !open)}
          disabled={!graph || groupedWorkflowCatalog}
        >
          {groupedWorkflowCatalog ? (
            <LayoutGrid size={14} />
          ) : view.quality.status === "pass" ? (
            <ShieldCheck size={14} />
          ) : (
            <TriangleAlert size={14} />
          )}
          {groupedWorkflowCatalog ? "Grouped" : view.quality.status}
        </button>
        <select
          className="graph-export"
          aria-label="Export architecture"
          value=""
          disabled={!graph}
          onChange={(event) => {
            const format = event.target.value;
            if (format === "json" || format === "html") onExport(format);
          }}
        >
          <option value="">Export…</option>
          <option value="html">Interactive HTML</option>
          <option value="json">Validated IR JSON</option>
        </select>
        <button
          className="graph-arrange"
          disabled={!graph || groupedWorkflowCatalog}
          title={
            groupedWorkflowCatalog
              ? "Component groups already preserve readable card sizes"
              : "Arrange the graph and fit the view"
          }
          aria-label="Arrange graph"
          onClick={() => {
            setNodes(view.nodes);
            requestAnimationFrame(() => {
              void flow.current?.fitView({ padding: 0.22 });
            });
          }}
        >
          <Maximize2 size={14} />
        </button>
      </div>
      {graph?.coverage && (
        <>
          <div className="analysis-coverage-bar">
            <button
              className="analysis-coverage-summary"
              aria-expanded={coverageOpen}
              onClick={() => setCoverageOpen((open) => !open)}
            >
              <Gauge size={14} />
              <strong>
                {graph.coverage.deepFiles}/{graph.coverage.indexedFiles} deep
              </strong>
              <span>
                {graph.coverage.indexedFiles
                  ? Math.round(
                      (graph.coverage.deepFiles / graph.coverage.indexedFiles) *
                        100,
                    )
                  : 0}
                % semantic coverage
              </span>
              {graph.coverage.fileOnlyFiles > 0 && (
                <span className="is-file-only">
                  {graph.coverage.fileOnlyFiles} file-only
                </span>
              )}
              {graph.coverage.limits.length > 0 && (
                <span className="is-limited">
                  {graph.coverage.limits.length} limits reached
                </span>
              )}
            </button>
            <div className="analysis-language-chips">
              {graph.coverage.languages.slice(0, 6).map((language) => (
                <span
                  key={language.language}
                  className={`is-${language.mode}`}
                  title={`${language.indexedFiles} indexed · ${language.deepFiles} deep · ${language.fileOnlyFiles} file-only · ${language.skippedFiles} skipped`}
                >
                  {language.language} {language.deepFiles}/
                  {language.indexedFiles}
                </span>
              ))}
            </div>
            {graph.frameworks &&
              graph.frameworks.validation.detectionCount > 0 && (
                <span className="analysis-framework-summary">
                  {graph.frameworks.validation.detectionCount} framework
                  detections · {graph.frameworks.validation.candidateCount}{" "}
                  candidates
                </span>
              )}
            <button
              className="analysis-index-rebuild"
              disabled={busy}
              title="Delete this project's local parsed-symbol cache and rebuild it from source"
              onClick={onClearIndex}
            >
              <RefreshCw size={13} /> {busy ? "Indexing…" : "Rebuild index"}
            </button>
          </div>
          {coverageOpen && (
            <section className="analysis-coverage-panel">
              <header>
                <div>
                  <span>Indexed</span>
                  <strong>{graph.coverage.indexedFiles}</strong>
                </div>
                <div>
                  <span>Deep analysis</span>
                  <strong>{graph.coverage.deepFiles}</strong>
                </div>
                <div>
                  <span>File-level only</span>
                  <strong>{graph.coverage.fileOnlyFiles}</strong>
                </div>
                <div>
                  <span>Skipped</span>
                  <strong>{graph.coverage.skippedFiles}</strong>
                </div>
                <div>
                  <span>Incremental cache</span>
                  <strong>
                    {graph.coverage.cache.memoryHits} memory ·{" "}
                    {graph.coverage.cache.persistentHits} disk
                  </strong>
                </div>
              </header>
              <div className="analysis-coverage-languages">
                {graph.coverage.languages.map((language) => (
                  <div key={language.language}>
                    <strong>{language.language}</strong>
                    <span>{language.mode}</span>
                    <span>{language.indexedFiles} indexed</span>
                    <span>{language.deepFiles} deep</span>
                    <span>{language.fileOnlyFiles} file-only</span>
                    <span>{language.skippedFiles} skipped</span>
                  </div>
                ))}
              </div>
              {graph.frameworks &&
                graph.frameworks.validation.detectionCount > 0 && (
                  <div className="analysis-framework-coverage">
                    <strong>Framework adapters</strong>
                    <div className="analysis-framework-items">
                      {graph.frameworks.coverage
                        .filter(
                          (item) =>
                            item.detectedFiles ||
                            item.candidateCount ||
                            item.excludedCount,
                        )
                        .map((item) => (
                          <div key={item.framework}>
                            <strong>{item.framework}</strong>
                            <span>{item.detectedFiles} detected files</span>
                            <span>{item.candidateCount} candidates</span>
                            <span>{item.excludedCount} excluded</span>
                            {item.limitReached && <span>limit reached</span>}
                          </div>
                        ))}
                    </div>
                    {graph.frameworks.diagnostics.length > 0 && (
                      <div className="analysis-framework-diagnostics">
                        {graph.frameworks.diagnostics
                          .slice(0, 12)
                          .map((diagnostic) => (
                            <p key={`${diagnostic.code}:${diagnostic.subject}`}>
                              <TriangleAlert size={12} />
                              <span>
                                <strong>{diagnostic.framework}</strong> ·{" "}
                                {diagnostic.message} · {diagnostic.subject}
                              </span>
                            </p>
                          ))}
                      </div>
                    )}
                  </div>
                )}
              {graph.coverage.limits.length > 0 && (
                <div className="analysis-coverage-limits">
                  {graph.coverage.limits.map((limit) => (
                    <p key={limit.code}>
                      <TriangleAlert size={12} />
                      <span>
                        <strong>{limit.code}</strong> · {limit.message}
                      </span>
                    </p>
                  ))}
                </div>
              )}
              <footer>
                File-only languages remain visible as repository structure but
                do not claim symbol, call, or workflow semantics.
              </footer>
            </section>
          )}
        </>
      )}
      {graph?.semantic &&
        graph.behavior &&
        scope === "semantics" &&
        semanticLens === "behavior" && (
          <section className="runtime-trace-bar" aria-label="Runtime trace">
            <div className="runtime-trace-heading">
              <Activity size={14} />
              <strong>Optional Runtime Trace</strong>
              <span>
                explicit Task · structural events only · values stored 0
              </span>
            </div>
            <div
              className="runtime-trace-modes"
              role="group"
              aria-label="Runtime trace lens"
            >
              {(["static", "observed", "compare"] as const).map((mode) => (
                <button
                  key={mode}
                  className={runtimeMode === mode ? "active" : ""}
                  disabled={mode !== "static" && !runtimeCompatible}
                  onClick={() => setRuntimeMode(mode)}
                >
                  {mode[0].toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
            <label>
              <span>Task</span>
              <select
                aria-label="Runtime trace task"
                value={runtimeTaskId}
                disabled={
                  runtimeBusy ||
                  Boolean(selectedRuntimeSession?.status === "running")
                }
                onChange={(event) => setRuntimeTaskId(event.target.value)}
              >
                {runtimeTasks.length === 0 && (
                  <option value="">No configured Task</option>
                )}
                {runtimeTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="runtime-trace-action"
              disabled={
                !runtimeTaskId ||
                runtimeBusy ||
                selectedRuntimeSession?.status === "running"
              }
              onClick={() => void startRuntimeTrace()}
            >
              <Activity size={13} /> {runtimeBusy ? "Waiting…" : "Run & trace"}
            </button>
            {runtimeSessions.length > 0 && (
              <label>
                <span>Reading</span>
                <select
                  aria-label="Runtime trace reading"
                  value={runtimeSessionId}
                  onChange={(event) => setRuntimeSessionId(event.target.value)}
                >
                  {runtimeSessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.taskLabel} · {session.status} ·{" "}
                      {new Date(session.startedAt).toLocaleTimeString()}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedRuntimeSession?.status === "running" && (
              <button
                className="runtime-trace-stop"
                disabled={runtimeBusy}
                onClick={() => void stopRuntimeTrace()}
              >
                <Square size={12} /> Stop
              </button>
            )}
            {selectedRuntimeSession && (
              <div
                className={`runtime-trace-receipt ${runtimeCompatible ? "is-current" : "is-stale"}`}
              >
                <span>{selectedRuntimeSession.events.length} events</span>
                <span>{runtimeObservedRelations.length} observed calls</span>
                <span>{runtimeComparison.matchedCount} matched</span>
                <span>{runtimeComparison.staticOnlyCount} static-only</span>
                <span>{runtimeComparison.observedOnlyCount} observed-only</span>
                {!runtimeCompatible && (
                  <strong>stale source reading · overlay disabled</strong>
                )}
              </div>
            )}
            {runtimeNotice && (
              <p className="runtime-trace-notice">{runtimeNotice}</p>
            )}
          </section>
        )}
      {graph && (
        <div className="semantic-composer-bar">
          <span className="semantic-composer-title">
            <Sparkles size={14} /> Semantic Composer
          </span>
          <select
            aria-label="Semantic Composer provider"
            value={composerProvider}
            disabled={compositionBusy}
            onChange={(event) =>
              setComposerProvider(
                event.target.value as SemanticComposerProviderId,
              )
            }
          >
            {composerProviders.map((provider) => (
              <option
                key={provider.id}
                value={provider.id}
                disabled={!provider.available}
              >
                {provider.label}
                {!provider.available ? " · unavailable" : ""}
              </option>
            ))}
          </select>
          {(composerProvider === "openai" ||
            composerProvider === "anthropic") && (
            <input
              aria-label="Semantic Composer model"
              value={composerModel}
              disabled={compositionBusy}
              onChange={(event) => setComposerModel(event.target.value)}
              placeholder={
                composerProvider === "openai"
                  ? "Default: gpt-5.4-mini"
                  : "Default: claude-sonnet-4-6"
              }
            />
          )}
          <button
            className="semantic-compose-action"
            disabled={compositionBusy}
            title={
              composerProviders.find(
                (provider) => provider.id === composerProvider,
              )?.detail
            }
            onClick={async () => {
              const composed = await onCompose({
                provider: composerProvider,
                ...(composerModel.trim()
                  ? { model: composerModel.trim() }
                  : {}),
                focus:
                  scope === "semantics" && semanticLens === "workflows"
                    ? "workflow"
                    : "architecture",
                maxComponents: 12,
                fallbackToRules: true,
              });
              if (composed) {
                setScope("semantics");
                setSemanticLens("components");
                setComponentFocus(null);
                setDensity("readable");
              }
            }}
          >
            {compositionBusy ? "Composing…" : "Compose meaning"}
          </button>
          {graph.composition ? (
            <span
              className={`semantic-composer-receipt ${graph.composition.fallback ? "is-warning" : ""}`}
              title={`${graph.composition.rejectedCount} rejected unsupported suggestion(s) · ${graph.composition.promptHash.slice(0, 12)} prompt audit`}
            >
              {graph.composition.provider}
              {graph.composition.fallback ? " → rules fallback" : ""} ·{" "}
              {graph.composition.componentCount} components ·{" "}
              {graph.composition.relationCount} relations · audited
            </span>
          ) : (
            <span className="semantic-composer-hint">
              AI receives bounded structure metadata, never stored API keys.
            </span>
          )}
        </div>
      )}
      {scope === "semantics" && semanticLens === "workflows" && (
        <div className="workflow-projection-bar">
          <span>{workflowFocus ? "Workflow detail" : "Workflow catalog"}</span>
          <div className="workflow-view-controls">
            <select
              aria-label="Workflow focus"
              value={workflowFocus || ""}
              onChange={(event) => {
                if (event.target.value) openWorkflow(event.target.value);
                else setWorkflowFocus(null);
              }}
            >
              <option value="">Workflow catalog</option>
              {workflows.map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {isSupportWorkflowNode(workflow) ? "[support] " : ""}
                  {workflow.label}
                </option>
              ))}
            </select>
            {workflowFocus ? (
              <>
                <select
                  aria-label="Workflow view mode"
                  value={workflowViewMode}
                  onChange={(event) =>
                    setWorkflowViewMode(event.target.value as WorkflowViewMode)
                  }
                >
                  <option value="graph">Graph</option>
                  <option value="sequence">Sequence</option>
                </select>
                <button
                  className={collapseWorkflowBranches ? "active" : ""}
                  aria-pressed={collapseWorkflowBranches}
                  aria-label="Collapse workflow branches"
                  title="Hide branch-only steps while keeping guards and convergence visible"
                  onClick={() =>
                    setCollapseWorkflowBranches((collapsed) => !collapsed)
                  }
                >
                  {collapseWorkflowBranches
                    ? "Expand branches"
                    : "Collapse branches"}
                </button>
              </>
            ) : (
              <>
                <label className="workflow-support-toggle">
                  <input
                    type="checkbox"
                    checked={showSupportWorkflows}
                    onChange={(event) => {
                      setShowSupportWorkflows(event.target.checked);
                      if (event.target.checked)
                        setWorkflowCatalogExpanded(true);
                    }}
                  />
                  Show support ({view.workflowCatalog?.support || 0})
                </label>
                {(view.workflowCatalog?.hidden || 0) > 0 && (
                  <button
                    aria-label="Expand workflow catalog"
                    onClick={() => setWorkflowCatalogExpanded(true)}
                  >
                    Show {view.workflowCatalog?.hidden} more
                  </button>
                )}
                {workflowCatalogExpanded && !query && (
                  <button
                    aria-label="Collapse workflow catalog"
                    onClick={() => setWorkflowCatalogExpanded(false)}
                  >
                    Show first 12
                  </button>
                )}
              </>
            )}
          </div>
          <small>
            {workflowFocus
              ? "Static sequence · runtime branch choice remains unobserved"
              : `${view.workflowCatalog?.production || 0} production · ${view.workflowCatalog?.support || 0} support · open a summary to inspect steps`}
          </small>
        </div>
      )}
      {(trace || routeStart || traceNotice) && (
        <div className="graph-trace-bar" role="status">
          <span>
            {routeStart
              ? `Route from ${routeStart.data.label} · choose a downstream destination`
              : traceNotice ||
                `${trace?.mode} · ${trace?.nodeIds.length || 0} components · ${trace?.edgeIds.length || 0} ${scope === "semantics" ? "visible meaning" : "authored"} relations`}
          </span>
          <button
            onClick={() => {
              setTrace(null);
              setRouteStart(null);
              setTraceNotice("");
            }}
          >
            Clear trace
          </button>
        </div>
      )}
      {module && (
        <div className="graph-breadcrumb">
          <button
            onClick={() => {
              setModule(null);
              setScope("modules");
            }}
          >
            <ChevronLeft size={13} /> All modules
          </button>
          <span>{module}</span>
        </div>
      )}
      {scope === "semantics" && componentFocus && (
        <div className="graph-breadcrumb">
          <button
            onClick={() => {
              setComponentFocus(null);
              setSemanticLens("overview");
            }}
          >
            <ChevronLeft size={13} /> Meaning overview
          </button>
          <span>
            {graph?.semantic?.nodes.find((node) => node.id === componentFocus)
              ?.label || "Component"}
          </span>
        </div>
      )}
      {scope === "semantics" &&
        semanticLens === "workflows" &&
        workflowFocus && (
          <div className="graph-breadcrumb">
            <button
              aria-label="Back to workflow catalog"
              onClick={() => {
                setWorkflowFocus(null);
                setWorkflowViewMode("graph");
                setCollapseWorkflowBranches(false);
                setSelection(null);
                setRelationSelection(null);
              }}
            >
              <ChevronLeft size={13} /> Workflow catalog
            </button>
            <span>
              {graph?.semantic?.nodes.find((node) => node.id === workflowFocus)
                ?.label || "Workflow"}
            </span>
          </div>
        )}
      <div className="architecture-graph-region">
      {!graph ? (
        <div className="empty-state">
          <img
            className="architecture-atmosphere architecture-atmosphere-empty"
            src={constellationAtmosphere}
            alt=""
            aria-hidden="true"
          />
          <div className="architecture-empty-copy">
            <Network size={52} className="constellation-mark" />
            <span className="eyebrow">A map grounded in your source</span>
            <h1>See how the pieces connect</h1>
            <p>
              Open a project to map its modules, imports and components. Bring
              any component into the conversation to explore or change it.
            </p>
            <button
              className="primary-action"
              onClick={onAnalyze}
              disabled={busy}
            >
              {busy ? "Reading the source…" : "Generate architecture"}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`graph-stage ${groupedWorkflowCatalog ? "is-workflow-catalog" : ""}`}
        >
          <img
            className="architecture-atmosphere architecture-atmosphere-canvas"
            src={constellationAtmosphere}
            alt=""
            aria-hidden="true"
          />
          {scope === "focus" && projection && (
            <div className="source-focus-banner" role="status">
              <LocateFixed size={14} />
              <div>
                <strong>{projection.focus.path}</strong>
                <span>
                  {projection.incoming.length} imported-by ·{" "}
                  {projection.outgoing.length} imports ·{" "}
                  {projection.evidenceCount} evidence lines
                </span>
              </div>
              <button onClick={() => onOpenFile(projection.focus.id)}>
                Open source
              </button>
            </div>
          )}
          {qualityOpen && !groupedWorkflowCatalog && (
            <aside
              className="graph-quality-panel"
              aria-label="Visual quality diagnostics"
            >
              <header>
                <div>
                  <span className="eyebrow">
                    {view.quality.profile} profile
                  </span>
                  <strong>Visual validation · {view.quality.status}</strong>
                </div>
                <button
                  aria-label="Close visual quality diagnostics"
                  onClick={() => setQualityOpen(false)}
                >
                  ×
                </button>
              </header>
              <p>
                {view.quality.nodeCount} nodes · {view.quality.edgeCount}{" "}
                connections · {view.quality.errors} errors ·{" "}
                {view.quality.warnings} warnings
              </p>
              {view.quality.diagnostics.length ? (
                <ul>
                  {view.quality.diagnostics
                    .slice(0, 8)
                    .map((diagnostic, index) => (
                      <li key={`${diagnostic.code}:${index}`}>
                        <span className={diagnostic.severity}>
                          {diagnostic.severity}
                        </span>
                        <div>
                          <code>{diagnostic.code}</code>
                          <small>{diagnostic.message}</small>
                        </div>
                      </li>
                    ))}
                </ul>
              ) : (
                <div className="graph-quality-pass">
                  No node overlap, edge-through-node, crossing, corridor, or
                  short-segment diagnostics.
                </div>
              )}
              {(view.projection.omittedNodes > 0 ||
                view.projection.omittedEdges > 0) && (
                <footer>
                  Readable projection kept the strongest source-backed backbone
                  and omitted {view.projection.omittedNodes} cards /{" "}
                  {view.projection.omittedEdges} connections from this view.
                  Complete map remains available.
                  {view.projection.qualityRemovedEdges > 0 &&
                    ` ${view.projection.qualityRemovedEdges} connection${view.projection.qualityRemovedEdges === 1 ? " was" : "s were"} removed after visual collision validation.`}
                </footer>
              )}
            </aside>
          )}
          {view.nodes.length === 0 && (
            <div className="graph-lens-empty" role="status">
              <strong>
                {semanticLens === "calls" && scope === "semantics"
                  ? "No source-resolved symbol calls"
                  : semanticLens === "types" && scope === "semantics"
                    ? "No source-resolved type hierarchy"
                    : semanticLens === "data" && scope === "semantics"
                      ? "No source-resolved state access"
                      : semanticLens === "behavior" && scope === "semantics"
                        ? "No source-resolved behavior flow"
                        : semanticLens === "frameworks" && scope === "semantics"
                          ? "No verified framework registrations"
                          : semanticLens === "questions" &&
                              scope === "semantics"
                            ? "No open questions"
                            : "No matching graph items"}
              </strong>
              <span>
                {semanticLens === "calls" && scope === "semantics"
                  ? "TypeScript compiler calls and conservative Python/Rust static bindings appear here. Dynamic dispatch stays excluded."
                  : semanticLens === "types" && scope === "semantics"
                    ? "Internal extends, implements, and overrides relations appear here with source evidence."
                    : semanticLens === "data" && scope === "semantics"
                      ? "Internal module-variable reads and writes resolved by the TypeScript compiler appear here."
                      : semanticLens === "behavior" && scope === "semantics"
                        ? "Direct argument, return, and state flows appear here. Dynamic dispatch and ambiguous bindings stay excluded."
                        : semanticLens === "frameworks" && scope === "semantics"
                          ? "Explicit FastAPI, LangGraph, Celery, Express, NestJS, Next.js, Axum, and Tokio routes or tasks appear here. Dynamic registration stays excluded with a diagnostic."
                          : query
                            ? "Clear or change the graph search."
                            : "This lens has no source-grounded items in the current reading."}
              </span>
            </div>
          )}
          {groupedWorkflowCatalog ? (
            <div
              className="workflow-catalog-grid"
              aria-label="Workflows grouped by component"
            >
              <header className="workflow-catalog-intro">
                <div>
                  <span className="eyebrow">Summary-first map</span>
                  <strong>
                    {view.workflowCatalog?.visible || 0} workflows across{" "}
                    {workflowCatalogGroups.length} component
                    {workflowCatalogGroups.length === 1 ? "" : "s"}
                  </strong>
                </div>
                <small>
                  Cards stay at reading size. Select a workflow to open its
                  branch and retry sequence.
                </small>
              </header>
              {workflowCatalogGroups.map((group) => (
                <details className="workflow-catalog-group" key={group.id} open>
                  <summary>
                    <span>
                      <Box size={14} /> {group.label}
                    </span>
                    <small>{group.workflows.length} workflows</small>
                  </summary>
                  <div className="workflow-catalog-items">
                    {group.workflows.map((workflow) => {
                      const summary = workflow.data.workflowSummary!;
                      return (
                        <button
                          className={`workflow-catalog-item ${summary.support ? "is-support" : ""}`}
                          key={workflow.id}
                          onClick={() => openWorkflow(workflow.id)}
                          title={`Open ${workflow.data.label} sequence`}
                        >
                          <span className="workflow-catalog-item-kind">
                            <Layers3 size={13} />
                            {summary.support ? "Support" : "Production"}
                          </span>
                          <strong>{workflow.data.label}</strong>
                          <small title={workflow.data.paths[0]}>
                            {workflow.data.paths[0] || workflow.data.subtitle}
                          </small>
                          <footer>
                            <span>{summary.steps} steps</span>
                            <span>{summary.branches} branches</span>
                            {summary.retries > 0 && (
                              <span>{summary.retries} retries</span>
                            )}
                            <ArrowUpRight size={13} />
                          </footer>
                        </button>
                      );
                    })}
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <ReactFlow
              nodes={displayedNodes}
              edges={displayedEdges}
              onInit={(instance) => {
                flow.current = instance;
              }}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              fitView
              fitViewOptions={{ padding: 0.22 }}
              minZoom={0.12}
              maxZoom={1.8}
              nodesConnectable={false}
              onNodeClick={(_event, node) => {
                if (routeStart && node.id !== routeStart.id) {
                  const result = traceArchitectureRoute(
                    edges,
                    routeStart.id,
                    node.id,
                  );
                  setTrace(result);
                  setTraceNotice(
                    result
                      ? `route · ${routeStart.data.label} → ${node.data.label}`
                      : `No ${scope === "semantics" ? "visible meaning" : "authored"} downstream route from ${routeStart.data.label} to ${node.data.label}`,
                  );
                  setRouteStart(null);
                  setSelection(node);
                  setRelationSelection(null);
                  return;
                }
                setSelection(node);
                setRelationSelection(null);
              }}
              onEdgeClick={(_event, edge) => {
                setRelationSelection(edge);
                setSelection(null);
              }}
              onEdgeDoubleClick={(_event, edge) => {
                const evidence =
                  graph.semantic?.relations.find(
                    (relation) => relation.id === edge.id,
                  )?.evidence[0] ||
                  relationsForEdge(graph, edge)[0]?.evidence[0];
                if (evidence) onOpenFile(evidence.path, evidence.line);
              }}
              onNodeDoubleClick={(_event, node) => {
                if (node.data.kind === "module") {
                  setModule(node.data.label);
                  setScope("files");
                } else if (
                  scope === "semantics" &&
                  node.data.kind === "component"
                ) {
                  setSemanticLens("components");
                  setComponentFocus(node.id);
                  setWorkflowFocus(null);
                  setSelection(null);
                } else if (
                  scope === "semantics" &&
                  node.data.kind === "workflow"
                ) {
                  openWorkflow(node.id);
                } else if (node.data.paths[0]) onOpenFile(node.data.paths[0]);
              }}
              onPaneClick={() => {
                setSelection(null);
                setRelationSelection(null);
              }}
              colorMode="dark"
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#352447" gap={24} size={1} />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) =>
                  node.type === "component" &&
                  (node.data as CardData).kind === "external"
                    ? "#526b85"
                    : "#7955a9"
                }
                maskColor="#0d0917cc"
              />
            </ReactFlow>
          )}
          <div className="graph-metrics">
            <span className="live-dot" />
            {scope === "semantics" && graph.semantic ? (
              <>
                {view.workflowCatalog
                  ? `${view.workflowCatalog.visible}/${view.workflowCatalog.eligible} workflow summaries · ${view.nodes.length} catalog cards`
                  : `${view.total} ${semanticLens} nodes · ${view.totalEdges} lens relations`}{" "}
                · {graph.semantic.nodes.length} total ·{" "}
                {graph.semantic.validation.verifiedCount} verified ·{" "}
                {graph.semantic.validation.provisionalCount} provisional ·{" "}
                {
                  graph.semantic.questions.filter(
                    (question) => question.status === "open",
                  ).length
                }{" "}
                open questions · {graph.semantic.revision.slice(0, 8)}
                {semanticLens === "behavior" && graph.behavior
                  ? runtimeMode === "static"
                    ? ` · ${graph.behavior.validation.relationCount} static behavior relations · ${graph.behavior.validation.verifiedCount} verified · ${graph.behavior.validation.inferredCount} inferred`
                    : ` · ${runtimeObservedRelations.length} observed calls · ${runtimeComparison.matchedCount} matched · values stored 0`
                  : ""}
                {semanticLens === "frameworks" && graph.frameworks
                  ? ` · ${graph.frameworks.validation.candidateCount} framework candidates · ${graph.frameworks.validation.excludedCount} excluded · ${graph.frameworks.validation.detectionCount} detections`
                  : ""}
              </>
            ) : (
              <>
                {graph.scannedFiles} files · {graph.edges.length} source
                relations · verified IR {graph.validation.sourceBackedEdges}/
                {graph.validation.edgeCount} · visual {view.quality.status} ·{" "}
                {graph.revision.slice(0, 8)}
              </>
            )}
            {!view.workflowCatalog && view.total > view.nodes.length && (
              <span>
                {" "}
                · showing {view.nodes.length}/{view.total}; narrow the search
              </span>
            )}
            {!view.workflowCatalog && view.totalEdges > view.edges.length && (
              <span>
                {" "}
                · {view.edges.length}/{view.totalEdges} connections drawn;
                strongest first
              </span>
            )}
          </div>
        </div>
      )}
      {selection && (
        <aside className="component-details">
          <header>
            <div>
              <span className="eyebrow">{selection.data.kind} evidence</span>
              <h3>{selection.data.label}</h3>
            </div>
            <button
              onClick={() => setSelection(null)}
              aria-label="Close component details"
            >
              ×
            </button>
          </header>
          {selection.data.paths.length > 0 && (
            <button
              className="attach-component"
              onClick={() => onAttach(selection.data.context)}
            >
              <GripVertical size={14} /> Add to Agent context
            </button>
          )}
          {selectedSemanticNode?.kind === "component" && (
            <button
              className="semantic-drill-action"
              onClick={() => {
                setSemanticLens("components");
                setComponentFocus(selectedSemanticNode.id);
                setWorkflowFocus(null);
                setSelection(null);
              }}
            >
              Explore component files
            </button>
          )}
          {selectedSemanticNode?.kind === "workflow" && (
            <button
              className="semantic-drill-action"
              onClick={() => {
                openWorkflow(selectedSemanticNode.id);
              }}
            >
              Explore workflow steps
            </button>
          )}
          <div className="trace-actions">
            <button
              onClick={() => {
                setTrace(
                  traceArchitectureReach(edges, selection.id, "upstream"),
                );
                setRouteStart(null);
                setTraceNotice("");
              }}
            >
              Trace upstream
            </button>
            <button
              onClick={() => {
                setTrace(
                  traceArchitectureReach(edges, selection.id, "downstream"),
                );
                setRouteStart(null);
                setTraceNotice("");
              }}
            >
              Trace downstream
            </button>
            <button
              onClick={() => {
                setTrace(null);
                setRouteStart(selection);
                setTraceNotice("");
                setSelection(null);
              }}
            >
              Start route
            </button>
          </div>
          <p>
            {selection.data.paths.length} source file
            {selection.data.paths.length === 1 ? "" : "s"} ·{" "}
            {selectedSemanticNode
              ? `${selectedSemanticRelations.length} semantic · ${selectedBehaviorRelations.length} behavior relations`
              : `${related.length} source relations`}
          </p>
          {selectedSemanticNode && (
            <div className="semantic-inspector">
              <div className="semantic-trust-row">
                <span
                  className={`semantic-trust ${selectedSemanticNode.trust}`}
                >
                  {selectedSemanticNode.trust}
                </span>
                <span>{selectedSemanticNode.status}</span>
                <span>
                  {Math.round(selectedSemanticNode.confidence * 100)}%
                  confidence
                </span>
              </div>
              {selectedSemanticNode.description && (
                <p>{selectedSemanticNode.description}</p>
              )}
              {selectedSemanticNode.stepKind && (
                <p className="semantic-step-kind">
                  Workflow step · {selectedSemanticNode.stepKind}
                </p>
              )}
              {selectedWorkflowBehavior && (
                <section className="behavior-workflow-summary">
                  <h4>Workflow behavior</h4>
                  <div>
                    <strong>Inputs</strong>
                    <span>
                      {selectedWorkflowBehavior.inputs.join(" · ") ||
                        "No direct static input binding"}
                    </span>
                  </div>
                  <div>
                    <strong>Outputs</strong>
                    <span>
                      {selectedWorkflowBehavior.outputs.join(" · ") ||
                        "No direct static return binding"}
                    </span>
                  </div>
                  <div>
                    <strong>Side effects</strong>
                    <span>
                      {selectedWorkflowBehavior.sideEffects.join(" · ") ||
                        "No source-backed static side effect"}
                    </span>
                  </div>
                </section>
              )}
              {selectedSemanticRelations.length > 0 && (
                <>
                  <h4>
                    Reasoning links{" "}
                    <span>{selectedSemanticRelations.length}</span>
                  </h4>
                  <div className="component-relations semantic-reasoning">
                    {selectedSemanticRelations.slice(0, 30).map((relation) => {
                      const outgoing =
                        relation.from === selectedSemanticNode.id;
                      const peer = outgoing ? relation.to : relation.from;
                      const evidence = relation.evidence[0];
                      return (
                        <button
                          key={relation.id}
                          disabled={!evidence}
                          onClick={() =>
                            evidence && onOpenFile(evidence.path, evidence.line)
                          }
                        >
                          <span>
                            {outgoing ? "→" : "←"} {relation.kind} ·{" "}
                            {semanticLabels.get(peer) || peer}
                          </span>
                          <small>
                            {relation.trust} · {relation.status} ·{" "}
                            {Math.round(relation.confidence * 100)}%
                          </small>
                          {relation.description && (
                            <small>{relation.description}</small>
                          )}
                          {evidence && (
                            <code>
                              {evidence.path}:{evidence.line}
                              {evidence.excerpt ? ` · ${evidence.excerpt}` : ""}
                            </code>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {selectedBehaviorRelations.length > 0 && (
                <>
                  <h4>
                    Behavior flow{" "}
                    <span>{selectedBehaviorRelations.length}</span>
                  </h4>
                  <div className="component-relations behavior-reasoning">
                    {selectedBehaviorRelations.slice(0, 30).map((relation) => {
                      const outgoing =
                        relation.from === selectedSemanticNode.id;
                      const peer = outgoing ? relation.to : relation.from;
                      const evidence = relation.evidence[0];
                      const value = graph?.behavior?.values.find(
                        (item) => item.id === relation.valueId,
                      );
                      return (
                        <button
                          key={relation.id}
                          onClick={() =>
                            evidence && onOpenFile(evidence.path, evidence.line)
                          }
                        >
                          <span>
                            {outgoing ? "→" : "←"} {relation.kind} ·{" "}
                            {semanticLabels.get(peer) || peer}
                          </span>
                          <small>
                            {relation.trust} · {relation.status} ·{" "}
                            {Math.round(relation.confidence * 100)}%
                          </small>
                          {value && <small>{value.label}</small>}
                          {evidence ? (
                            <code>
                              {evidence.path}:{evidence.line}
                              {evidence.excerpt ? ` · ${evidence.excerpt}` : ""}
                            </code>
                          ) : (
                            <code>
                              runtime structural event · no value payload
                            </code>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {selectedSemanticClaims.length > 0 && (
                <>
                  <h4>
                    Semantic claims <span>{selectedSemanticClaims.length}</span>
                  </h4>
                  <div className="semantic-claims">
                    {selectedSemanticClaims.map((claim) => (
                      <section key={claim.id} className={claim.status}>
                        <header>
                          <strong>{claim.key}</strong>
                          <span>
                            {claim.trust} · {claim.status}
                          </span>
                        </header>
                        <p>{claim.value}</p>
                        <small>{claim.reason}</small>
                      </section>
                    ))}
                  </div>
                </>
              )}
              {selectedSemanticQuestions.map((question) => (
                <section className="semantic-question" key={question.id}>
                  <strong>Open question</strong>
                  <p>{question.prompt}</p>
                  <small>Recommended for now: {question.recommendation}</small>
                  <ul>
                    {question.options.map((option) => (
                      <li key={option}>{option}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <div className="component-source-list">
            {selectedFiles.slice(0, 50).map((file) => (
              <section key={file.id}>
                <button onClick={() => onOpenFile(file.id)}>
                  <FileCode2 size={13} />
                  <span>{file.id}</span>
                  <ArrowUpRight size={12} />
                </button>
                {file.symbols
                  .filter((symbol) => symbol.exported)
                  .slice(0, 8)
                  .map((symbol) => (
                    <button
                      className="component-symbol"
                      key={symbol.id}
                      onClick={() => onOpenFile(file.id, symbol.line)}
                    >
                      <span>{symbol.kind}</span>
                      {symbol.name}
                      <small>L{symbol.line}</small>
                    </button>
                  ))}
              </section>
            ))}
          </div>
          {selectedFiles.length > 50 && (
            <p>
              Showing 50/{selectedFiles.length} files. Use the Files view or
              Quick open to reach the others.
            </p>
          )}
          {selectedNeighborhood ? (
            <div className="source-neighborhood-board">
              <h4>
                Imported by <span>{selectedNeighborhood.incoming.length}</span>
              </h4>
              <div className="component-relations">
                {selectedNeighborhood.incoming.slice(0, 30).map((edge) => (
                  <button
                    key={edge.id}
                    onClick={() =>
                      onOpenFile(edge.evidence[0].path, edge.evidence[0].line)
                    }
                  >
                    <span>{labels.get(edge.from) || edge.from}</span>
                    <small>
                      {edge.evidence[0].path}:{edge.evidence[0].line} ·{" "}
                      {edge.kind}
                    </small>
                    {edge.evidence[0].excerpt && (
                      <code>{edge.evidence[0].excerpt}</code>
                    )}
                  </button>
                ))}
                {!selectedNeighborhood.incoming.length && (
                  <p className="empty-relation">No authored imports found.</p>
                )}
              </div>
              <h4>
                Imports <span>{selectedNeighborhood.outgoing.length}</span>
              </h4>
              <div className="component-relations">
                {selectedNeighborhood.outgoing.slice(0, 30).map((edge) => (
                  <button
                    key={edge.id}
                    onClick={() =>
                      onOpenFile(edge.evidence[0].path, edge.evidence[0].line)
                    }
                  >
                    <span>{labels.get(edge.to) || edge.to}</span>
                    <small>
                      {edge.evidence[0].path}:{edge.evidence[0].line} ·{" "}
                      {edge.kind}
                    </small>
                    {edge.evidence[0].excerpt && (
                      <code>{edge.evidence[0].excerpt}</code>
                    )}
                  </button>
                ))}
                {!selectedNeighborhood.outgoing.length && (
                  <p className="empty-relation">No authored imports found.</p>
                )}
              </div>
              <p className="projection-boundary">
                Direct static source relations only. Runtime order, data flow,
                and impact are not inferred.
              </p>
            </div>
          ) : (
            <>
              <h4>Source relations</h4>
              <div className="component-relations">
                {related.slice(0, 30).map((edge) => (
                  <button
                    key={edge.id}
                    onClick={() =>
                      onOpenFile(edge.evidence[0].path, edge.evidence[0].line)
                    }
                  >
                    <span>
                      {edge.from.split("/").at(-1)} →{" "}
                      {edge.to.split("/").at(-1)}
                    </span>
                    <small>
                      {edge.evidence[0].path}:{edge.evidence[0].line}
                    </small>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>
      )}
      {relationSelection && (
        <aside className="component-details relationship-details">
          <header>
            <div>
              <span className="eyebrow">Connection evidence</span>
              <h3>
                {selectedBehaviorRelation || selectedSemanticRelation
                  ? semanticLabels.get(
                      (selectedBehaviorRelation || selectedSemanticRelation)!
                        .from,
                    ) ||
                    (selectedBehaviorRelation || selectedSemanticRelation)!.from
                  : relationSelection.source.replace(/^module:/, "")}{" "}
                →{" "}
                {selectedBehaviorRelation || selectedSemanticRelation
                  ? semanticLabels.get(
                      (selectedBehaviorRelation || selectedSemanticRelation)!
                        .to,
                    ) ||
                    (selectedBehaviorRelation || selectedSemanticRelation)!.to
                  : relationSelection.target.replace(/^module:/, "")}
              </h3>
            </div>
            <button
              onClick={() => setRelationSelection(null)}
              aria-label="Close connection details"
            >
              ×
            </button>
          </header>
          {selectedBehaviorRelation ? (
            <>
              <p>
                {selectedBehaviorRelation.kind} ·{" "}
                {selectedBehaviorRelation.trust} ·{" "}
                {selectedBehaviorRelation.status} ·{" "}
                {Math.round(selectedBehaviorRelation.confidence * 100)}%
                confidence.{" "}
                {selectedBehaviorRelation.trust === "observed"
                  ? "This relation was observed from explicit structural markers; no arguments or return values were stored."
                  : "This is a static behavior overlay, not an observed runtime trace."}
              </p>
              {selectedObservedRelation && (
                <p>
                  Observed {selectedObservedRelation.observationCount} time
                  {selectedObservedRelation.observationCount === 1
                    ? ""
                    : "s"} · {selectedObservedRelation.totalDurationMs} ms
                  aggregate duration
                </p>
              )}
              {selectedBehaviorValue && (
                <p>
                  Value · {selectedBehaviorValue.label}
                  {selectedBehaviorValue.shape
                    ? ` · ${selectedBehaviorValue.shape}`
                    : ""}
                </p>
              )}
              <p>
                Provenance · {selectedBehaviorRelation.provenance.analyzer} ·{" "}
                {selectedBehaviorRelation.provenance.policy}
              </p>
              {selectedBehaviorRelation.provenance.framework && (
                <p>
                  Framework · {selectedBehaviorRelation.provenance.framework} ·
                  rule {selectedBehaviorRelation.provenance.ruleId} · candidate{" "}
                  {selectedBehaviorRelation.provenance.candidateId}
                </p>
              )}
            </>
          ) : selectedSemanticRelation ? (
            <>
              <p>
                {selectedSemanticRelation.kind} ·{" "}
                {selectedSemanticRelation.trust}
                {" · "}
                {selectedSemanticRelation.status} ·{" "}
                {Math.round(selectedSemanticRelation.confidence * 100)}%
                confidence. Select its evidence to open the source.
              </p>
              {selectedSemanticRelation.description && (
                <p>{selectedSemanticRelation.description}</p>
              )}
            </>
          ) : (
            <p>
              {selectedRelations.reduce((count, edge) => count + edge.count, 0)}{" "}
              imports / re-exports from actual source. Select an evidence line
              to open its file.
            </p>
          )}
          <div className="component-relations">
            {(selectedBehaviorRelation
              ? [selectedBehaviorRelation]
              : selectedSemanticRelation
                ? [selectedSemanticRelation]
                : selectedRelations.slice(0, 50)
            ).flatMap((edge) =>
              edge.evidence.slice(0, 4).map((evidence, index) => (
                <button
                  key={`${edge.id}:${index}`}
                  onClick={() => onOpenFile(evidence.path, evidence.line)}
                >
                  <span>
                    {edge.from} → {edge.to}
                  </span>
                  <small>
                    {evidence.path}:{evidence.line} · {edge.kind}
                  </small>
                  <code>{evidence.excerpt}</code>
                </button>
              )),
            )}
          </div>
          {selectedBehaviorRelation &&
            selectedBehaviorRelation.evidence.length === 0 && (
              <p>
                Runtime evidence is tied to semantic symbol IDs and the trace
                receipt. Source values and ordinary terminal output were not
                persisted.
              </p>
            )}
          {selectedRelations.length > 50 && (
            <p>
              Showing evidence for 50/{selectedRelations.length} source
              relations.
            </p>
          )}
        </aside>
      )}
      </div>
      {graph && graph.warnings.length > 0 && (
        <details className="graph-warnings">
          <summary>
            {graph.warnings.length} unresolved or skipped sources
            {graph.truncated ? " · file index truncated" : ""}
          </summary>
          {graph.warnings.map((warning, index) => (
            <div key={index}>{warning}</div>
          ))}
        </details>
      )}
    </div>
  );
}
