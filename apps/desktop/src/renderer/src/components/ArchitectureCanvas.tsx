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
import "@xyflow/react/dist/style.css";
import "./architecture.css";

function ComponentCard({ data, selected }: NodeProps<CardNode>) {
  const Icon =
    data.kind === "module"
      ? Box
      : data.kind === "external"
        ? Package
        : FileCode2;
  return (
    <div
      className={`architecture-card ${selected ? "is-selected" : ""} ${data.changed ? "has-changed" : ""} ${data.traced ? "is-traced" : ""} ${data.dimmed ? "is-dimmed" : ""}`}
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
            title="Drag this component into the chat"
            aria-label={`Drag ${data.label} to chat`}
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
        {data.kind === "module"
          ? `${data.count} files`
          : data.kind === "external"
            ? "External dependency"
            : `${data.symbols} symbols`}
        {data.changed && <span>updated</span>}
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
}: {
  graph: ArchitectureGraph | null;
  busy: boolean;
  onAnalyze: () => void;
  onOpenFile: (path: string, line?: number) => void;
  onAttach: (context: ComponentContext) => void;
}) {
  const [scope, setScope] = useState<"modules" | "files">("modules");
  const [module, setModule] = useState<string | null>(null);
  const [external, setExternal] = useState(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<CardNode | null>(null);
  const [relationSelection, setRelationSelection] = useState<Edge | null>(null);
  const [trace, setTrace] = useState<ArchitectureTrace | null>(null);
  const [routeStart, setRouteStart] = useState<CardNode | null>(null);
  const [traceNotice, setTraceNotice] = useState("");
  const flow = useRef<ReactFlowInstance<CardNode, Edge> | null>(null);
  const layoutKey = `${graph?.workspaceRoot}|${scope}|${module}|${external}|${query}`;
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
    setModule(null);
    setQuery("");
    setSelection(null);
    setRelationSelection(null);
    setTrace(null);
    setRouteStart(null);
    setTraceNotice("");
  }, [graph?.workspaceRoot]);
  const view = useMemo(
    () =>
      graph
        ? buildView(graph, scope, module, external, query, changed)
        : { nodes: [], edges: [], total: 0, totalEdges: 0 },
    [
      graph?.revision,
      graph?.workspaceRoot,
      scope,
      module,
      external,
      query,
      changed,
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
    setSelection((previous) =>
      !reset && previous
        ? view.nodes.find((node) => node.id === previous.id) || null
        : null,
    );
    if (reset)
      requestAnimationFrame(() => {
        void flow.current?.fitView({ padding: 0.22 });
      });
  }, [view, layoutKey]);
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
        </div>
        <label className="graph-search">
          <Search size={13} />
          <input
            aria-label="Find architecture component"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a component…"
          />
        </label>
        <label className="external-toggle">
          <input
            type="checkbox"
            checked={external}
            onChange={(event) => setExternal(event.target.checked)}
          />{" "}
          Dependencies
        </label>
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
                `${trace?.mode} · ${trace?.nodeIds.length || 0} components · ${trace?.edgeIds.length || 0} authored relations`}
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
          <Network size={52} className="constellation-mark" />
          <span className="eyebrow">A map grounded in your source</span>
          <h1>See how the pieces connect</h1>
          <p>
            Open a project to map its modules, imports and components. Bring any
            component into the conversation to explore or change it.
          </p>
          <button
            className="primary-action"
            onClick={onAnalyze}
            disabled={busy}
          >
            {busy ? "Reading the source…" : "Generate architecture"}
          </button>
        </div>
      ) : (
        <div className="graph-stage">
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
                    : `No authored downstream route from ${routeStart.data.label} to ${node.data.label}`,
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
              const evidence = relationsForEdge(graph, edge)[0]?.evidence[0];
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
            <span className="live-dot" /> {graph.scannedFiles} files ·{" "}
            {graph.edges.length} source relations · verified IR{" "}
            {graph.validation.sourceBackedEdges}/{graph.validation.edgeCount} ·{" "}
            {graph.revision.slice(0, 8)}
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
              <GripVertical size={14} /> Add component to chat
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
            {selection.data.paths.length} source files · {related.length} import
            relations
          </p>
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
                  {edge.from.split("/").at(-1)} → {edge.to.split("/").at(-1)}
                </span>
                <small>
                  {edge.evidence[0].path}:{edge.evidence[0].line}
                </small>
              </button>
            ))}
          </div>
        </aside>
      )}
      {relationSelection && (
        <aside className="component-details relationship-details">
          <header>
            <div>
              <span className="eyebrow">Connection evidence</span>
              <h3>
                {relationSelection.source.replace(/^module:/, "")} →{" "}
                {relationSelection.target.replace(/^module:/, "")}
              </h3>
            </div>
            <button
              onClick={() => setRelationSelection(null)}
              aria-label="Close connection details"
            >
              ×
            </button>
          </header>
          <p>
            {selectedRelations.reduce((count, edge) => count + edge.count, 0)}{" "}
            imports / re-exports from actual source. Select an evidence line to
            open its file.
          </p>
          <div className="component-relations">
            {selectedRelations.slice(0, 50).flatMap((edge) =>
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
