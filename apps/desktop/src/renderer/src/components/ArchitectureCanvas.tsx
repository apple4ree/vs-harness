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
  relationsForEdge,
  type CardData,
  type CardNode,
  type ArchitectureScope,
  type SemanticLens,
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
      className={`architecture-card ${selected ? "is-selected" : ""} ${data.changed ? "has-changed" : ""} ${data.traced ? "is-traced" : ""} ${data.dimmed ? "is-dimmed" : ""} ${data.trust ? `semantic-${data.trust}` : ""}`}
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
        {data.semanticId
          ? `${data.trust} · ${data.status}`
          : data.kind === "module"
            ? `${data.count} files`
            : data.kind === "external"
              ? "External dependency"
              : `${data.symbols} symbols`}
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
  onOpenFile,
  onAttach,
  onExport,
  activeFile,
  revealRequest,
}: {
  graph: ArchitectureGraph | null;
  busy: boolean;
  onAnalyze: () => void;
  onOpenFile: (path: string, line?: number) => void;
  onAttach: (context: ComponentContext) => void;
  onExport: (format: "json" | "html") => void;
  activeFile?: string | null;
  revealRequest?: number;
}) {
  const [scope, setScope] = useState<ArchitectureScope>("modules");
  const [semanticLens, setSemanticLens] = useState<SemanticLens>("overview");
  const [module, setModule] = useState<string | null>(null);
  const [external, setExternal] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<CardNode | null>(null);
  const [relationSelection, setRelationSelection] = useState<Edge | null>(null);
  const [trace, setTrace] = useState<ArchitectureTrace | null>(null);
  const [routeStart, setRouteStart] = useState<CardNode | null>(null);
  const [traceNotice, setTraceNotice] = useState("");
  const flow = useRef<ReactFlowInstance<CardNode, Edge> | null>(null);
  const projection = useMemo(
    () =>
      graph && activeFile
        ? projectSourceNeighborhood(graph, activeFile, external)
        : null,
    [graph?.revision, graph?.workspaceRoot, activeFile, external],
  );
  const layoutKey = `${graph?.workspaceRoot}|${scope}|${semanticLens}|${module}|${external}|${query}|${scope === "focus" ? projection?.focus.id || "missing" : ""}`;
  const previousLayout = useRef("");
  const previous = useRef<ArchitectureGraph | null>(null);
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
    setScope("modules");
    setSemanticLens("overview");
    setModule(null);
    setQuery("");
    setSelection(null);
    setRelationSelection(null);
    setTrace(null);
    setRouteStart(null);
    setTraceNotice("");
  }, [graph?.workspaceRoot]);
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
          )
        : { nodes: [], edges: [], total: 0, totalEdges: 0 },
    [
      graph?.revision,
      graph?.workspaceRoot,
      scope,
      module,
      external,
      query,
      changed,
      projection,
      semanticLens,
    ],
  );
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
            onChange={(event) =>
              setSemanticLens(event.target.value as SemanticLens)
            }
          >
            <option value="overview">Meaning · Overview</option>
            <option value="components">Components · Boundaries</option>
            <option value="workflows">Workflows · Control flow</option>
            <option value="calls">Calls · Symbols</option>
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
          disabled={!graph}
          title="Arrange the graph and fit the view"
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
        <div className="graph-stage">
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
          {view.nodes.length === 0 && (
            <div className="graph-lens-empty" role="status">
              <strong>
                {semanticLens === "calls" && scope === "semantics"
                  ? "No source-resolved symbol calls"
                  : semanticLens === "questions" && scope === "semantics"
                    ? "No open questions"
                    : "No matching graph items"}
              </strong>
              <span>
                {semanticLens === "calls" && scope === "semantics"
                  ? "TypeScript compiler calls and conservative Python/Rust static bindings appear here. Dynamic dispatch stays excluded."
                  : query
                    ? "Clear or change the graph search."
                    : "This lens has no source-grounded items in the current reading."}
              </span>
            </div>
          )}
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
                )?.evidence[0] || relationsForEdge(graph, edge)[0]?.evidence[0];
              if (evidence) onOpenFile(evidence.path, evidence.line);
            }}
            onNodeDoubleClick={(_event, node) => {
              if (node.data.kind === "module") {
                setModule(node.data.label);
                setScope("files");
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
          <div className="graph-metrics">
            <span className="live-dot" />
            {scope === "semantics" && graph.semantic ? (
              <>
                {view.total} {semanticLens} nodes · {view.totalEdges} lens
                relations · {graph.semantic.nodes.length} total ·{" "}
                {graph.semantic.validation.verifiedCount} verified ·{" "}
                {graph.semantic.validation.provisionalCount} provisional ·{" "}
                {
                  graph.semantic.questions.filter(
                    (question) => question.status === "open",
                  ).length
                }{" "}
                open questions · {graph.semantic.revision.slice(0, 8)}
              </>
            ) : (
              <>
                {graph.scannedFiles} files · {graph.edges.length} source
                relations · verified IR {graph.validation.sourceBackedEdges}/
                {graph.validation.edgeCount} · {graph.revision.slice(0, 8)}
              </>
            )}
            {view.total > view.nodes.length && (
              <span>
                {" "}
                · showing {view.nodes.length}/{view.total}; narrow the search
              </span>
            )}
            {view.totalEdges > view.edges.length && (
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
              ? `${selectedSemanticRelations.length} semantic relations`
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
                {selectedSemanticRelation
                  ? semanticLabels.get(selectedSemanticRelation.from) ||
                    selectedSemanticRelation.from
                  : relationSelection.source.replace(/^module:/, "")}{" "}
                →{" "}
                {selectedSemanticRelation
                  ? semanticLabels.get(selectedSemanticRelation.to) ||
                    selectedSemanticRelation.to
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
          {selectedSemanticRelation ? (
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
            {(selectedSemanticRelation
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
          {selectedRelations.length > 50 && (
            <p>
              Showing evidence for 50/{selectedRelations.length} source
              relations.
            </p>
          )}
        </aside>
      )}
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
