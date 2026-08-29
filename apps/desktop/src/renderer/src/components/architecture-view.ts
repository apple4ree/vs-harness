import type { Node, Edge } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import type {
  ArchitectureGraph,
  ArchitectureNode,
  ComponentContext,
} from "../../../shared/architecture";
import { componentContext } from "../../../shared/architecture";

export type CardData = {
  label: string;
  subtitle: string;
  paths: string[];
  kind: "module" | "file" | "external";
  count: number;
  symbols: number;
  context: ComponentContext;
  changed: boolean;
  dimmed: boolean;
} & Record<string, unknown>;
export type CardNode = Node<CardData, "component">;

export function buildView(
  graph: ArchitectureGraph,
  scope: "modules" | "files",
  module: string | null,
  external: boolean,
  query: string,
  changed: Set<string>,
) {
  const candidates = graph.nodes.filter(
    (node) =>
      (external || node.kind !== "external") &&
      (!module || node.module === module || node.kind === "external"),
  );
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
      },
    };
  });
  const ids = new Set(nodes.map((node) => node.id));
  const lookup = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesByPair = new Map<string, Edge>();
  for (const relation of graph.edges) {
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
  return { nodes, edges, total: groups.size, totalEdges: edgesByPair.size };
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
