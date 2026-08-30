import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type {
  ArchitectureGraph,
  ArchitectureNode,
  ComponentContext,
} from "../../../shared/architecture";
import { componentContext } from "../../../shared/architecture";
import type { SourceNeighborhoodProjection } from "../../../shared/architecture-projection";
import type { SemanticNode } from "../../../shared/semantic";

export type ArchitectureScope = "modules" | "files" | "focus" | "semantics";
export type SemanticLens =
  "overview" | "components" | "workflows" | "calls" | "questions" | "verified";
export type CardKind =
  | "module"
  | "file"
  | "external"
  | "system"
  | "component"
  | "workflow"
  | "workflow-step"
  | "symbol"
  | "external-system";

export type CardData = {
  label: string;
  subtitle: string;
  paths: string[];
  kind: CardKind;
  count: number;
  symbols: number;
  context: ComponentContext;
  changed: boolean;
  dimmed: boolean;
  traced: boolean;
  semanticId?: string;
  trust?: "verified" | "inferred" | "authored";
  status?: string;
  confidence?: number;
  description?: string;
  questions?: number;
} & Record<string, unknown>;
export type CardNode = Node<CardData, "component">;

export function buildView(
  graph: ArchitectureGraph,
  scope: ArchitectureScope,
  module: string | null,
  external: boolean,
  query: string,
  changed: Set<string>,
  projection: SourceNeighborhoodProjection | null = null,
  semanticLens: SemanticLens = "overview",
) {
  if (scope === "semantics")
    return buildSemanticView(graph, external, query, changed, semanticLens);
  const projectedIds = new Set(projection?.nodes.map((node) => node.id) || []);
  const candidates = graph.nodes
    .filter(
      (node) =>
        (external || node.kind !== "external") &&
        (!module || node.module === module || node.kind === "external") &&
        (scope !== "focus" || projectedIds.has(node.id)),
    )
    .sort((a, b) => {
      if (scope !== "focus" || !projection) return 0;
      if (a.id === projection.focus.id) return -1;
      if (b.id === projection.focus.id) return 1;
      return a.id.localeCompare(b.id);
    });
  const groups = new Map<string, ArchitectureNode[]>();
  for (const node of candidates) {
    const id =
      scope === "modules" && node.kind !== "external"
        ? `module:${node.module}`
        : node.id;
    const group = groups.get(id);
    if (group) group.push(node);
    else groups.set(id, [node]);
  }
  const visible = [...groups.entries()]
    .filter(
      ([, group]) =>
        scope === "focus" ||
        !query ||
        group.some((node) =>
          `${node.path} ${node.module} ${node.label} ${node.symbols.map((symbol) => symbol.name).join(" ")}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        ),
    )
    .slice(0, 220);
  const nodes: CardNode[] = visible.map(([id, group]) => {
    const first = group[0];
    const kind = id.startsWith("module:") ? "module" : first.kind;
    const label = kind === "module" ? first.module : first.label;
    const paths = group.flatMap((node) => (node.path ? [node.path] : []));
    return {
      id,
      type: "component",
      position: { x: 0, y: 0 },
      data: {
        label,
        kind,
        paths,
        count: group.length,
        symbols: group.reduce((total, node) => total + node.symbols.length, 0),
        subtitle:
          kind === "module"
            ? paths
                .slice(0, 2)
                .map((path) => path.split("/").at(-1))
                .join(" · ")
            : first.path || first.label,
        context: componentContext(id, label, paths, graph.revision),
        changed: paths.some((path) => changed.has(path)),
        dimmed: false,
        traced: false,
      },
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  const lookup = new Map(graph.nodes.map((node) => [node.id, node]));
  const projectedEdges = new Set(projection?.edgeIds || []);
  const edgesByPair = new Map<string, Edge>();
  for (const relation of graph.edges) {
    if (scope === "focus" && !projectedEdges.has(relation.id)) continue;
    const sourceNode = lookup.get(relation.from),
      targetNode = lookup.get(relation.to);
    if (!sourceNode || !targetNode) continue;
    const source =
      scope === "modules" && sourceNode.kind !== "external"
        ? `module:${sourceNode.module}`
        : sourceNode.id;
    const target =
      scope === "modules" && targetNode.kind !== "external"
        ? `module:${targetNode.module}`
        : targetNode.id;
    if (source === target || !ids.has(source) || !ids.has(target)) continue;
    const id = `${source}→${target}`;
    const previous = edgesByPair.get(id);
    if (previous) {
      previous.data!.count = Number(previous.data!.count) + relation.count;
      previous.label = String(previous.data!.count);
    } else
      edgesByPair.set(id, {
        id,
        source,
        target,
        type: "smoothstep",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#9579bb" },
        label: String(relation.count),
        data: { count: relation.count },
        style: { stroke: "#78618f", strokeWidth: 1.4 },
        labelStyle: { fill: "#d4c2e9", fontSize: 10 },
        labelBgStyle: { fill: "#21162d" },
      });
  }
  const edges = [...edgesByPair.values()]
    .sort(
      (a, b) =>
        Number(b.data?.count) - Number(a.data?.count) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 600);
  const layout = new dagre.graphlib.Graph()
    .setDefaultEdgeLabel(() => ({}))
    .setGraph({
      rankdir: "LR",
      ranksep: 100,
      nodesep: 45,
      marginx: 45,
      marginy: 45,
    });
  nodes.forEach((node) => layout.setNode(node.id, { width: 222, height: 117 }));
  edges.forEach((edge) => layout.setEdge(edge.source, edge.target));
  dagre.layout(layout);
  nodes.forEach((node) => {
    const position = layout.node(node.id);
    node.position = { x: position.x - 111, y: position.y - 58 };
  });
  return {
    nodes,
    edges,
    total: groups.size,
    totalEdges:
      scope === "focus" && projection
        ? projection.edgeIds.length
        : edgesByPair.size,
  };
}

function semanticPaths(graph: ArchitectureGraph, node: SemanticNode) {
  if (node.kind === "system")
    return graph.nodes.flatMap((item) => (item.path ? [item.path] : []));
  if (node.kind === "component")
    return graph.nodes
      .filter((item) => item.module === node.label && item.path)
      .map((item) => item.path!);
  return [...new Set(node.evidence.map((item) => item.path))];
}

export function buildSemanticView(
  graph: ArchitectureGraph,
  external: boolean,
  query: string,
  changed: Set<string>,
  lens: SemanticLens = "overview",
) {
  const semantic = graph.semantic;
  if (!semantic) return { nodes: [], edges: [], total: 0, totalEdges: 0 };
  const normalized = query.toLowerCase();
  const available = semantic.nodes.filter(
    (node) => external || node.kind !== "external-system",
  );
  const allowed = new Set<string>();
  if (lens === "overview")
    available
      .filter((node) =>
        ["system", "component", "workflow", "workflow-step"].includes(
          node.kind,
        ),
      )
      .forEach((node) => allowed.add(node.id));
  if (lens === "components")
    available
      .filter((node) => ["system", "component", "file"].includes(node.kind))
      .forEach((node) => allowed.add(node.id));
  if (lens === "workflows") {
    available
      .filter((node) => ["workflow", "workflow-step"].includes(node.kind))
      .forEach((node) => allowed.add(node.id));
    for (const relation of semantic.relations)
      if (allowed.has(relation.from) || allowed.has(relation.to)) {
        allowed.add(relation.from);
        allowed.add(relation.to);
      }
  }
  if (lens === "calls")
    semantic.relations
      .filter((relation) => relation.kind === "calls")
      .forEach((relation) => {
        allowed.add(relation.from);
        allowed.add(relation.to);
      });
  if (lens === "questions") {
    semantic.questions
      .filter((question) => question.status === "open")
      .forEach((question) => allowed.add(question.subjectId));
    for (const relation of semantic.relations)
      if (allowed.has(relation.from) || allowed.has(relation.to)) {
        allowed.add(relation.from);
        allowed.add(relation.to);
      }
  }
  if (lens === "verified") {
    available
      .filter((node) => node.trust !== "inferred")
      .forEach((node) => allowed.add(node.id));
    semantic.claims
      .filter((claim) => claim.trust === "authored")
      .forEach((claim) => allowed.add(claim.subjectId));
  }
  const candidates = available.filter(
    (node) =>
      allowed.has(node.id) &&
      (!normalized ||
        `${node.label} ${node.kind} ${node.description || ""} ${node.path || ""}`
          .toLowerCase()
          .includes(normalized)),
  );
  const preferred = candidates.slice(0, 220);
  const visible = new Set(preferred.map((node) => node.id));
  const nodes: CardNode[] = preferred.map((node) => {
    const paths = semanticPaths(graph, node);
    return {
      id: node.id,
      type: "component",
      position: { x: 0, y: 0 },
      data: {
        label: node.label,
        subtitle: node.description || node.path || node.kind,
        paths,
        kind: node.kind as CardKind,
        count: semantic.relations.filter(
          (relation) => relation.from === node.id || relation.to === node.id,
        ).length,
        symbols: node.kind === "symbol" ? 1 : 0,
        context: componentContext(
          node.id,
          node.label,
          paths,
          graph.revision,
          node.evidence[0]?.line,
          {
            kind: node.kind,
            trust: node.trust,
            status: node.status,
            confidence: node.confidence,
          },
        ),
        changed: paths.some((path) => changed.has(path)),
        dimmed: false,
        traced: false,
        semanticId: node.id,
        trust: node.trust,
        status: node.status,
        confidence: node.confidence,
        description: node.description,
        questions: semantic.questions.filter(
          (question) =>
            question.subjectId === node.id && question.status === "open",
        ).length,
      },
    };
  });
  const trustColor = {
    verified: "#78ba9a",
    inferred: "#a477d3",
    authored: "#c6a56b",
  };
  const relevantRelations = semantic.relations.filter(
    (relation) => visible.has(relation.from) && visible.has(relation.to),
  );
  const edges: Edge[] = relevantRelations.slice(0, 600).map((relation) => ({
    id: relation.id,
    source: relation.from,
    target: relation.to,
    type: "smoothstep",
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: trustColor[relation.trust],
    },
    label: relation.kind,
    data: { count: 1, semantic: true },
    style: {
      stroke: trustColor[relation.trust],
      strokeWidth: relation.status === "conflicting" ? 2.2 : 1.35,
      strokeDasharray: relation.trust === "inferred" ? "5 4" : undefined,
    },
    labelStyle: { fill: "#d4c2e9", fontSize: 9 },
    labelBgStyle: { fill: "#21162d" },
  }));
  const layout = new dagre.graphlib.Graph()
    .setDefaultEdgeLabel(() => ({}))
    .setGraph({
      rankdir: "LR",
      ranksep: 110,
      nodesep: 52,
      marginx: 45,
      marginy: 45,
    });
  nodes.forEach((node) => layout.setNode(node.id, { width: 222, height: 132 }));
  edges.forEach((edge) => layout.setEdge(edge.source, edge.target));
  dagre.layout(layout);
  nodes.forEach((node) => {
    const position = layout.node(node.id);
    node.position = { x: position.x - 111, y: position.y - 66 };
  });
  return {
    nodes,
    edges,
    total: candidates.length,
    totalEdges: relevantRelations.length,
  };
}

export function relationsForEdge(
  graph: ArchitectureGraph,
  edge: Pick<Edge, "source" | "target">,
) {
  const matches = (node: ArchitectureNode, id: string) =>
    id.startsWith("module:") ? node.module === id.slice(7) : node.id === id;
  const sources = new Set(
    graph.nodes
      .filter((node) => matches(node, edge.source))
      .map((node) => node.id),
  );
  const targets = new Set(
    graph.nodes
      .filter((node) => matches(node, edge.target))
      .map((node) => node.id),
  );
  return graph.edges.filter(
    (relation) => sources.has(relation.from) && targets.has(relation.to),
  );
}
