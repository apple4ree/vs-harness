import type {
  ArchitectureEdge,
  ArchitectureGraph,
  ArchitectureNode,
} from "./architecture";
import { validateArchitectureGraph } from "./architecture-ir";

export type SourceNeighborhoodProjection = {
  contract: "witch.architecture-projection/v1";
  kind: "source-neighborhood";
  revision: string;
  focus: ArchitectureNode;
  nodes: ArchitectureNode[];
  incoming: ArchitectureEdge[];
  outgoing: ArchitectureEdge[];
  edgeIds: string[];
  evidenceCount: number;
};

function assertValidated(graph: ArchitectureGraph) {
  const receipt = validateArchitectureGraph(graph);
  if (
    !graph.validation.valid ||
    graph.validation.contract !== "witch.architecture/v1" ||
    graph.validation.revision !== graph.revision ||
    graph.validation.nodeCount !== graph.nodes.length ||
    graph.validation.edgeCount !== graph.edges.length ||
    !receipt.valid
  )
    throw new Error("A source projection requires validated architecture IR");
}

/**
 * Project one source file and its directly authored import relations. This is
 * deliberately not a runtime call, sequence, data-flow, or impact view.
 */
export function projectSourceNeighborhood(
  graph: ArchitectureGraph,
  sourcePath: string,
  includeExternal = false,
): SourceNeighborhoodProjection | null {
  assertValidated(graph);
  const focus = graph.nodes.find(
    (node) =>
      node.kind === "file" &&
      (node.id === sourcePath || node.path === sourcePath),
  );
  if (!focus) return null;

  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const allowed = (nodeId: string) => {
    const node = nodesById.get(nodeId);
    return Boolean(node && (includeExternal || node.kind !== "external"));
  };
  const incoming = graph.edges.filter(
    (edge) => edge.to === focus.id && allowed(edge.from),
  );
  const outgoing = graph.edges.filter(
    (edge) => edge.from === focus.id && allowed(edge.to),
  );
  const edgeIds = [...incoming, ...outgoing]
    .map((edge) => edge.id)
    .sort((a, b) => a.localeCompare(b));
  const nodeIds = new Set([focus.id]);
  for (const edge of incoming) nodeIds.add(edge.from);
  for (const edge of outgoing) nodeIds.add(edge.to);
  const nodes = [
    focus,
    ...[...nodeIds]
      .filter((id) => id !== focus.id)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => nodesById.get(id)!),
  ];

  return {
    contract: "witch.architecture-projection/v1",
    kind: "source-neighborhood",
    revision: graph.revision,
    focus,
    nodes,
    incoming,
    outgoing,
    edgeIds,
    evidenceCount: [...incoming, ...outgoing].reduce(
      (total, edge) => total + edge.evidence.length,
      0,
    ),
  };
}
