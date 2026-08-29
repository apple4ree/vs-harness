import type {
  ArchitectureEdge,
  ArchitectureGraph,
  ArchitectureNode,
} from "./architecture";
import { createHash } from "node:crypto";

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type ArchitectureDeltaCollection<T> = {
  total: number;
  items: T[];
  truncated: boolean;
};

export type ArchitectureNodeSummary = Pick<
  ArchitectureNode,
  "id" | "label" | "kind" | "path" | "module" | "language" | "hash"
> & { symbolCount: number };

export type ArchitectureNodeChange = {
  id: string;
  before: ArchitectureNodeSummary;
  after: ArchitectureNodeSummary;
  fields: string[];
};

export type ArchitectureEdgeSummary = Pick<
  ArchitectureEdge,
  "id" | "from" | "to" | "kind" | "count"
> & { evidenceCount: number; evidenceFingerprint: string };

export type ArchitectureEdgeChange = {
  id: string;
  before: ArchitectureEdgeSummary;
  after: ArchitectureEdgeSummary;
  fields: string[];
};

export type ArchitectureDelta = {
  contract: "witch.architecture-delta/v1";
  workspaceRoot: string;
  base: {
    revision: string;
    generatedAt: string;
    nodeCount: number;
    edgeCount: number;
  };
  head: {
    revision: string;
    generatedAt: string;
    nodeCount: number;
    edgeCount: number;
  };
  summary: {
    addedNodes: number;
    removedNodes: number;
    changedNodes: number;
    addedEdges: number;
    removedEdges: number;
    changedEdges: number;
  };
  nodes: {
    added: ArchitectureDeltaCollection<ArchitectureNodeSummary>;
    removed: ArchitectureDeltaCollection<ArchitectureNodeSummary>;
    changed: ArchitectureDeltaCollection<ArchitectureNodeChange>;
  };
  edges: {
    added: ArchitectureDeltaCollection<ArchitectureEdgeSummary>;
    removed: ArchitectureDeltaCollection<ArchitectureEdgeSummary>;
    changed: ArchitectureDeltaCollection<ArchitectureEdgeChange>;
  };
};

function collection<T>(
  items: T[],
  limit: number,
): ArchitectureDeltaCollection<T> {
  return {
    total: items.length,
    items: items.slice(0, limit),
    truncated: items.length > limit,
  };
}

function nodeSummary(node: ArchitectureNode): ArchitectureNodeSummary {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    ...(node.path ? { path: node.path } : {}),
    module: node.module,
    language: node.language,
    hash: node.hash,
    symbolCount: node.symbols.length,
  };
}

function edgeSummary(edge: ArchitectureEdge): ArchitectureEdgeSummary {
  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    count: edge.count,
    evidenceCount: edge.evidence.length,
    evidenceFingerprint: fingerprint(edge.evidence),
  };
}

function changedFields<T extends Record<string, unknown>>(before: T, after: T) {
  return Object.keys({ ...before, ...after })
    .filter(
      (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
    )
    .sort((a, b) => a.localeCompare(b));
}

/** Compare two validated readings without inferring risk, impact, or runtime behavior. */
export function compareArchitectureGraphs(
  base: ArchitectureGraph,
  head: ArchitectureGraph,
  previewLimit = 500,
): ArchitectureDelta {
  if (!base.validation.valid || !head.validation.valid)
    throw new Error("Architecture delta requires two validated IR documents");
  if (base.workspaceRoot !== head.workspaceRoot)
    throw new Error("Architecture delta requires readings from one workspace");
  if (
    !Number.isSafeInteger(previewLimit) ||
    previewLimit < 1 ||
    previewLimit > 5_000
  )
    throw new Error(
      "Architecture delta preview limit must be between 1 and 5000",
    );

  const baseNodes = new Map(base.nodes.map((node) => [node.id, node]));
  const headNodes = new Map(head.nodes.map((node) => [node.id, node]));
  const addedNodes = head.nodes
    .filter((node) => !baseNodes.has(node.id))
    .map(nodeSummary);
  const removedNodes = base.nodes
    .filter((node) => !headNodes.has(node.id))
    .map(nodeSummary);
  const changedNodes = head.nodes.flatMap((node) => {
    const previous = baseNodes.get(node.id);
    if (!previous) return [];
    const before = nodeSummary(previous);
    const after = nodeSummary(node);
    const fields = changedFields(before, after);
    return fields.length ? [{ id: node.id, before, after, fields }] : [];
  });

  const baseEdges = new Map(base.edges.map((edge) => [edge.id, edge]));
  const headEdges = new Map(head.edges.map((edge) => [edge.id, edge]));
  const addedEdges = head.edges
    .filter((edge) => !baseEdges.has(edge.id))
    .map(edgeSummary);
  const removedEdges = base.edges
    .filter((edge) => !headEdges.has(edge.id))
    .map(edgeSummary);
  const changedEdges = head.edges.flatMap((edge) => {
    const previous = baseEdges.get(edge.id);
    if (!previous) return [];
    const before = edgeSummary(previous);
    const after = edgeSummary(edge);
    const fields = changedFields(before, after);
    return fields.length ? [{ id: edge.id, before, after, fields }] : [];
  });

  return {
    contract: "witch.architecture-delta/v1",
    workspaceRoot: head.workspaceRoot,
    base: {
      revision: base.revision,
      generatedAt: base.generatedAt,
      nodeCount: base.nodes.length,
      edgeCount: base.edges.length,
    },
    head: {
      revision: head.revision,
      generatedAt: head.generatedAt,
      nodeCount: head.nodes.length,
      edgeCount: head.edges.length,
    },
    summary: {
      addedNodes: addedNodes.length,
      removedNodes: removedNodes.length,
      changedNodes: changedNodes.length,
      addedEdges: addedEdges.length,
      removedEdges: removedEdges.length,
      changedEdges: changedEdges.length,
    },
    nodes: {
      added: collection(addedNodes, previewLimit),
      removed: collection(removedNodes, previewLimit),
      changed: collection(changedNodes, previewLimit),
    },
    edges: {
      added: collection(addedEdges, previewLimit),
      removed: collection(removedEdges, previewLimit),
      changed: collection(changedEdges, previewLimit),
    },
  };
}
