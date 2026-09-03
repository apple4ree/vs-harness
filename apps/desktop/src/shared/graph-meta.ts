import type { ArchitectureGraph, SourceEvidence } from "./architecture";
import {
  buildGraphIntelligenceIndex,
  projectGraphCommunities,
  type GraphCommunityReceipt,
  type GraphIntelligenceNode,
  type GraphIntelligenceRelation,
} from "./graph-intelligence";

export type ArchitectureMetaLevel =
  "system" | "community" | "component" | "workflow" | "symbol";

export type ArchitectureMetaAssignment =
  | "workspace-root"
  | "community-detection"
  | "semantic-node"
  | "explicit-containment"
  | "path-affinity"
  | "community-fallback";

export type ArchitectureMetaNode = {
  id: string;
  label: string;
  level: ArchitectureMetaLevel;
  parentId?: string;
  sourceNodeId?: string;
  communityId?: string;
  assignment: ArchitectureMetaAssignment;
  trust: "derived";
  memberCount: number;
  /** Deterministic preview; memberCount remains authoritative when truncated. */
  memberIds: string[];
  membersTruncated: boolean;
  childIds: string[];
  sourcePaths: string[];
  hubIds: string[];
  kindCounts: Record<string, number>;
};

export type ArchitectureMetaEdge = {
  id: string;
  level: Exclude<ArchitectureMetaLevel, "system">;
  from: string;
  to: string;
  relationCount: number;
  relationKinds: string[];
  sourceRelationIds: string[];
  omittedRelations: number;
  averageConfidence: number;
  trustCounts: Partial<
    Record<"verified" | "authored" | "inferred" | "observed", number>
  >;
  evidence: SourceEvidence[];
};

export type ArchitectureMetaDiagnostic = {
  code: string;
  severity: "error" | "warning";
  subject: string;
  message: string;
};

export type ArchitectureMetaValidation = {
  contract: "witch.graph-meta/v1";
  valid: boolean;
  revision: string;
  nodeCount: number;
  edgeCount: number;
  evidenceCount: number;
  diagnostics: ArchitectureMetaDiagnostic[];
};

export type ArchitectureMetaGraph = {
  contract: "witch.graph-meta/v1";
  algorithm: "deterministic-community-hierarchy";
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  knowledgeRevision?: string;
  revision: string;
  rootId: string;
  levels: ArchitectureMetaLevel[];
  nodes: ArchitectureMetaNode[];
  edges: ArchitectureMetaEdge[];
  diagnostics: ArchitectureMetaDiagnostic[];
  validation: ArchitectureMetaValidation;
};

type MutableMetaNode = Omit<
  ArchitectureMetaNode,
  | "memberCount"
  | "memberIds"
  | "membersTruncated"
  | "childIds"
  | "sourcePaths"
  | "hubIds"
  | "kindCounts"
> & {
  members: Set<string>;
  children: Set<string>;
  paths: Set<string>;
  hubs: Set<string>;
};

const LEVELS: ArchitectureMetaLevel[] = [
  "system",
  "community",
  "component",
  "workflow",
  "symbol",
];
const MEMBER_PREVIEW_LIMIT = 160;
const SOURCE_PATH_LIMIT = 40;
const EDGE_SOURCE_LIMIT = 80;
const EDGE_EVIDENCE_LIMIT = 8;
const MAX_META_NODES = 12_000;
const MAX_META_EDGES = 20_000;
const COMPONENT_KINDS = new Set(["component", "module", "package"]);
const SYMBOL_KINDS = new Set(["symbol", "workflow-step"]);

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableRevision(value: string) {
  return `meta-${["0", "1", "2", "3"]
    .map((salt) => stableHash(`${salt}\0${value}`))
    .join("")}`;
}

function metaRevision(input: {
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  knowledgeRevision?: string;
  nodes: ArchitectureMetaNode[];
  edges: ArchitectureMetaEdge[];
}) {
  return stableRevision(JSON.stringify(input));
}

const metaId = (level: ArchitectureMetaLevel, sourceId: string) =>
  `meta:${level}:${sourceId}`;

function evidenceKey(evidence: SourceEvidence) {
  return `${evidence.path}:${evidence.line}:${evidence.endLine || evidence.line}:${evidence.hash}`;
}

function relationRank(relation: GraphIntelligenceRelation) {
  const trust = { authored: 4, verified: 3, observed: 2, inferred: 1 }[
    relation.trust
  ];
  return trust * 10 + relation.confidence;
}

function bestOwner(
  childId: string,
  allowedParents: ReadonlySet<string>,
  relations: GraphIntelligenceRelation[],
) {
  return relations
    .filter(
      (relation) =>
        relation.to === childId &&
        allowedParents.has(relation.from) &&
        (relation.kind === "contains" || relation.kind === "defines"),
    )
    .sort(
      (left, right) =>
        relationRank(right) - relationRank(left) ||
        left.from.localeCompare(right.from) ||
        left.id.localeCompare(right.id),
    )[0]?.from;
}

function uniquePathOwner(
  node: GraphIntelligenceNode,
  candidates: GraphIntelligenceNode[],
) {
  if (!node.path) return undefined;
  const matches = candidates
    .filter((candidate) => candidate.path === node.path)
    .sort((left, right) => left.id.localeCompare(right.id));
  return matches.length === 1 ? matches[0].id : undefined;
}

function addMutableNode(
  target: Map<string, MutableMetaNode>,
  node: Omit<MutableMetaNode, "members" | "children" | "paths" | "hubs">,
  source?: GraphIntelligenceNode,
) {
  const value: MutableMetaNode = {
    ...node,
    members: new Set(source ? [source.id] : []),
    children: new Set(),
    paths: new Set(source?.path ? [source.path] : []),
    hubs: new Set(),
  };
  target.set(value.id, value);
  return value;
}

function attach(
  nodes: Map<string, MutableMetaNode>,
  parentId: string,
  childId: string,
) {
  const parent = nodes.get(parentId);
  const child = nodes.get(childId);
  if (!parent || !child) return;
  child.parentId = parentId;
  parent.children.add(childId);
}

type EdgeAccumulator = {
  level: Exclude<ArchitectureMetaLevel, "system">;
  from: string;
  to: string;
  relationKinds: Set<string>;
  sourceRelationIds: string[];
  confidenceTotal: number;
  relationCount: number;
  trustCounts: ArchitectureMetaEdge["trustCounts"];
  evidence: Map<string, SourceEvidence>;
};

function aggregateEdges(
  relations: GraphIntelligenceRelation[],
  level: EdgeAccumulator["level"],
  owner: ReadonlyMap<string, string>,
) {
  const accumulators = new Map<string, EdgeAccumulator>();
  for (const relation of relations) {
    const from = owner.get(relation.from);
    const to = owner.get(relation.to);
    if (!from || !to || from === to) continue;
    const key = `${level}\0${from}\0${to}`;
    const entry = accumulators.get(key) || {
      level,
      from,
      to,
      relationKinds: new Set<string>(),
      sourceRelationIds: [],
      confidenceTotal: 0,
      relationCount: 0,
      trustCounts: {},
      evidence: new Map<string, SourceEvidence>(),
    };
    entry.relationCount++;
    entry.confidenceTotal += relation.confidence;
    entry.relationKinds.add(relation.kind);
    if (entry.sourceRelationIds.length < EDGE_SOURCE_LIMIT)
      entry.sourceRelationIds.push(relation.id);
    entry.trustCounts[relation.trust] =
      (entry.trustCounts[relation.trust] || 0) + 1;
    for (const evidence of relation.evidence)
      if (entry.evidence.size < EDGE_EVIDENCE_LIMIT)
        entry.evidence.set(evidenceKey(evidence), evidence);
    accumulators.set(key, entry);
  }
  return [...accumulators.values()].map((entry) => ({
    id: `meta-edge:${stableHash(`${entry.level}\0${entry.from}\0${entry.to}`)}`,
    level: entry.level,
    from: entry.from,
    to: entry.to,
    relationCount: entry.relationCount,
    relationKinds: [...entry.relationKinds].sort(),
    sourceRelationIds: [...entry.sourceRelationIds].sort(),
    omittedRelations: Math.max(
      0,
      entry.relationCount - entry.sourceRelationIds.length,
    ),
    averageConfidence:
      Math.round((entry.confidenceTotal / entry.relationCount) * 1_000) / 1_000,
    trustCounts: entry.trustCounts,
    evidence: [...entry.evidence.values()].sort((left, right) =>
      evidenceKey(left).localeCompare(evidenceKey(right)),
    ),
  }));
}

function materializeNode(
  node: MutableMetaNode,
  underlying: ReadonlyMap<string, GraphIntelligenceNode>,
): ArchitectureMetaNode {
  const members = [...node.members].sort();
  const kindCounts: Record<string, number> = {};
  for (const id of members) {
    const kind = underlying.get(id)?.kind || "unknown";
    kindCounts[kind] = (kindCounts[kind] || 0) + 1;
  }
  return {
    id: node.id,
    label: node.label,
    level: node.level,
    ...(node.parentId ? { parentId: node.parentId } : {}),
    ...(node.sourceNodeId ? { sourceNodeId: node.sourceNodeId } : {}),
    ...(node.communityId ? { communityId: node.communityId } : {}),
    assignment: node.assignment,
    trust: "derived",
    memberCount: members.length,
    memberIds: members.slice(0, MEMBER_PREVIEW_LIMIT),
    membersTruncated: members.length > MEMBER_PREVIEW_LIMIT,
    childIds: [...node.children].sort(),
    sourcePaths: [...node.paths].sort().slice(0, SOURCE_PATH_LIMIT),
    hubIds: [...node.hubs].sort().slice(0, 8),
    kindCounts,
  };
}

function diagnostic(
  diagnostics: ArchitectureMetaDiagnostic[],
  code: string,
  severity: ArchitectureMetaDiagnostic["severity"],
  subject: string,
  message: string,
) {
  diagnostics.push({ code, severity, subject, message });
}

export function validateArchitectureMetaGraph(
  meta: Omit<ArchitectureMetaGraph, "validation"> | ArchitectureMetaGraph,
  source: ArchitectureGraph,
): ArchitectureMetaValidation {
  const diagnostics = [...meta.diagnostics];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const nodes = new Map(meta.nodes.map((node) => [node.id, node]));
  const hashes = new Map(
    source.nodes
      .filter((node) => node.path)
      .map((node) => [node.path!, node.hash]),
  );
  let evidenceCount = 0;
  if (
    meta.contract !== "witch.graph-meta/v1" ||
    meta.sourceRevision !== source.revision
  )
    diagnostic(
      diagnostics,
      "META_IDENTITY_INVALID",
      "error",
      "document",
      "The meta graph contract and source revision must match its architecture graph.",
    );
  const expectedRevision = metaRevision({
    sourceRevision: meta.sourceRevision,
    semanticRevision: meta.semanticRevision,
    behaviorRevision: meta.behaviorRevision,
    knowledgeRevision: meta.knowledgeRevision,
    nodes: meta.nodes,
    edges: meta.edges,
  });
  if (meta.revision !== expectedRevision)
    diagnostic(
      diagnostics,
      "META_REVISION_MISMATCH",
      "error",
      "document",
      "The meta graph content does not match its deterministic revision.",
    );
  if (
    meta.semanticRevision !== source.semantic?.revision ||
    meta.behaviorRevision !== source.behavior?.revision ||
    meta.knowledgeRevision !== source.knowledge?.revision
  )
    diagnostic(
      diagnostics,
      "META_OVERLAY_STALE",
      "error",
      "document",
      "The meta graph is bound to stale semantic or knowledge input.",
    );
  if (meta.nodes.length > MAX_META_NODES || meta.edges.length > MAX_META_EDGES)
    diagnostic(
      diagnostics,
      "META_BOUND_EXCEEDED",
      "error",
      "document",
      "The meta graph exceeds its deterministic safety bounds.",
    );
  if (!nodes.has(meta.rootId) || nodes.get(meta.rootId)?.level !== "system")
    diagnostic(
      diagnostics,
      "META_ROOT_INVALID",
      "error",
      meta.rootId,
      "The meta graph requires one system root.",
    );
  for (const node of meta.nodes) {
    if (!node.id || nodeIds.has(node.id))
      diagnostic(
        diagnostics,
        "META_NODE_ID_INVALID",
        "error",
        node.id || "node",
        "Meta node ids must be present and unique.",
      );
    nodeIds.add(node.id);
    if (node.memberCount < node.memberIds.length || !node.label.trim())
      diagnostic(
        diagnostics,
        "META_NODE_CONTENT_INVALID",
        "error",
        node.id,
        "Meta nodes require a label and a consistent member preview.",
      );
    if (node.id !== meta.rootId) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      const expectedLevel = LEVELS[LEVELS.indexOf(node.level) - 1];
      if (
        !parent ||
        parent.level !== expectedLevel ||
        !parent.childIds.includes(node.id)
      )
        diagnostic(
          diagnostics,
          "META_PARENT_INVALID",
          "error",
          node.id,
          "Every non-root node requires a reciprocal parent at the preceding level.",
        );
    }
    for (const childId of node.childIds)
      if (nodes.get(childId)?.parentId !== node.id)
        diagnostic(
          diagnostics,
          "META_CHILD_INVALID",
          "error",
          node.id,
          `Child ${childId} does not point back to its parent.`,
        );
  }
  for (const edge of meta.edges) {
    if (!edge.id || edgeIds.has(edge.id))
      diagnostic(
        diagnostics,
        "META_EDGE_ID_INVALID",
        "error",
        edge.id || "edge",
        "Meta edge ids must be present and unique.",
      );
    edgeIds.add(edge.id);
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to || from.level !== edge.level || to.level !== edge.level)
      diagnostic(
        diagnostics,
        "META_EDGE_ENDPOINT_INVALID",
        "error",
        edge.id,
        "Aggregated edges must connect existing nodes at their declared level.",
      );
    if (edge.from === edge.to || edge.relationCount < 1)
      diagnostic(
        diagnostics,
        "META_EDGE_CONTENT_INVALID",
        "error",
        edge.id,
        "Aggregated edges require distinct endpoints and at least one relation.",
      );
    for (const evidence of edge.evidence) {
      evidenceCount++;
      if (
        !hashes.has(evidence.path) ||
        hashes.get(evidence.path) !== evidence.hash
      )
        diagnostic(
          diagnostics,
          "META_EVIDENCE_STALE",
          "error",
          edge.id,
          `Aggregated evidence for ${evidence.path} is missing or stale.`,
        );
    }
  }
  diagnostics.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.subject.localeCompare(right.subject) ||
      left.message.localeCompare(right.message),
  );
  return {
    contract: "witch.graph-meta/v1",
    valid: !diagnostics.some((item) => item.severity === "error"),
    revision: meta.revision,
    nodeCount: meta.nodes.length,
    edgeCount: meta.edges.length,
    evidenceCount,
    diagnostics,
  };
}

/**
 * Build a deterministic, read-only hierarchy over semantic evidence. Community
 * and fallback ownership are navigation aids only; authored boundaries remain
 * distinguishable in the underlying graph.
 */
export function buildArchitectureMetaGraph(
  graph: ArchitectureGraph,
  communityReceipt?: GraphCommunityReceipt,
): ArchitectureMetaGraph {
  const index = buildGraphIntelligenceIndex(graph);
  const communities = communityReceipt || projectGraphCommunities(graph);
  if (
    communities.sourceRevision !== index.sourceRevision ||
    communities.semanticRevision !== index.semanticRevision ||
    communities.behaviorRevision !== index.behaviorRevision ||
    communities.knowledgeRevision !== index.knowledgeRevision
  )
    throw new Error(
      "Architecture meta graph requires a community receipt from the same graph revisions",
    );
  const diagnostics: ArchitectureMetaDiagnostic[] = communities.warnings.map(
    (message, index) => ({
      code: "META_COMMUNITY_WARNING",
      severity: "warning",
      subject: `community:${index}`,
      message,
    }),
  );
  const underlying = new Map(index.nodes.map((node) => [node.id, node]));
  const semanticNodes = index.nodes
    .filter((node) => node.origin === "semantic")
    .sort((left, right) => left.id.localeCompare(right.id));
  const systems = semanticNodes.filter((node) => node.kind === "system");
  const componentNodes = semanticNodes.filter((node) =>
    COMPONENT_KINDS.has(node.kind),
  );
  const workflowNodes = semanticNodes.filter(
    (node) => node.kind === "workflow",
  );
  const symbolNodes = semanticNodes.filter((node) =>
    SYMBOL_KINDS.has(node.kind),
  );
  const rootSource = systems[0];
  const rootId = metaId(
    "system",
    rootSource?.id || stableHash(graph.workspaceRoot),
  );
  const nodes = new Map<string, MutableMetaNode>();
  const root = addMutableNode(
    nodes,
    {
      id: rootId,
      label:
        rootSource?.label ||
        graph.workspaceRoot.replaceAll("\\", "/").split("/").at(-1) ||
        "Workspace",
      level: "system",
      ...(rootSource ? { sourceNodeId: rootSource.id } : {}),
      assignment: "workspace-root",
      trust: "derived",
    },
    rootSource,
  );
  const structuralIds = new Set(
    [...systems, ...componentNodes, ...workflowNodes, ...symbolNodes].map(
      (node) => node.id,
    ),
  );
  for (const id of structuralIds) root.members.add(id);

  const communityMembership = new Map<string, string>();
  for (const community of communities.communities) {
    const relevant = community.memberIds.filter(
      (id) => structuralIds.has(id) && underlying.get(id)?.kind !== "system",
    );
    if (!relevant.length) continue;
    const id = metaId("community", community.memberSignature);
    const value = addMutableNode(nodes, {
      id,
      label: community.label,
      level: "community",
      parentId: rootId,
      communityId: community.id,
      assignment: "community-detection",
      trust: "derived",
    });
    for (const member of relevant) {
      value.members.add(member);
      communityMembership.set(member, id);
      const path = underlying.get(member)?.path;
      if (path) value.paths.add(path);
    }
    for (const hub of community.hubIds) value.hubs.add(hub);
    attach(nodes, rootId, id);
  }
  const fallbackCommunityId = metaId("community", "unassigned");
  const ensureFallbackCommunity = () => {
    if (!nodes.has(fallbackCommunityId)) {
      addMutableNode(nodes, {
        id: fallbackCommunityId,
        label: "Unassigned structure",
        level: "community",
        parentId: rootId,
        assignment: "community-fallback",
        trust: "derived",
      });
      attach(nodes, rootId, fallbackCommunityId);
    }
    return fallbackCommunityId;
  };
  if (!nodes.get(rootId)?.children.size && structuralIds.size)
    ensureFallbackCommunity();

  const componentMetaBySource = new Map<string, string>();
  for (const source of componentNodes) {
    const communityId =
      communityMembership.get(source.id) || ensureFallbackCommunity();
    const id = metaId("component", source.id);
    addMutableNode(
      nodes,
      {
        id,
        label: source.label,
        level: "component",
        parentId: communityId,
        sourceNodeId: source.id,
        communityId,
        assignment: "semantic-node",
        trust: "derived",
      },
      source,
    );
    componentMetaBySource.set(source.id, id);
    attach(nodes, communityId, id);
  }

  const syntheticComponentByCommunity = new Map<string, string>();
  const ensureComponent = (communityId: string) => {
    const existing = syntheticComponentByCommunity.get(communityId);
    if (existing) return existing;
    const community = nodes.get(communityId);
    const id = metaId("component", `derived:${communityId}`);
    addMutableNode(nodes, {
      id,
      label: `${community?.label || "Community"} · unassigned`,
      level: "component",
      parentId: communityId,
      communityId,
      assignment: "community-fallback",
      trust: "derived",
    });
    syntheticComponentByCommunity.set(communityId, id);
    attach(nodes, communityId, id);
    return id;
  };

  const componentSourceIds = new Set(componentNodes.map((node) => node.id));
  const workflowMetaBySource = new Map<string, string>();
  const componentOwner = new Map<string, string>(componentMetaBySource);
  for (const source of workflowNodes) {
    const explicit = bestOwner(source.id, componentSourceIds, index.relations);
    const pathOwner = explicit
      ? undefined
      : uniquePathOwner(source, componentNodes);
    const communityId =
      communityMembership.get(explicit || pathOwner || source.id) ||
      communityMembership.get(source.id) ||
      ensureFallbackCommunity();
    const owner = explicit || pathOwner;
    const componentId = owner
      ? componentMetaBySource.get(owner) || ensureComponent(communityId)
      : ensureComponent(communityId);
    const id = metaId("workflow", source.id);
    addMutableNode(
      nodes,
      {
        id,
        label: source.label,
        level: "workflow",
        parentId: componentId,
        sourceNodeId: source.id,
        communityId,
        assignment: explicit
          ? "explicit-containment"
          : pathOwner
            ? "path-affinity"
            : "community-fallback",
        trust: "derived",
      },
      source,
    );
    workflowMetaBySource.set(source.id, id);
    componentOwner.set(source.id, componentId);
    attach(nodes, componentId, id);
  }

  const syntheticWorkflowByComponent = new Map<string, string>();
  const ensureWorkflow = (componentId: string, communityId: string) => {
    const existing = syntheticWorkflowByComponent.get(componentId);
    if (existing) return existing;
    const component = nodes.get(componentId);
    const id = metaId("workflow", `derived:${componentId}`);
    addMutableNode(nodes, {
      id,
      label: `${component?.label || "Component"} · symbols`,
      level: "workflow",
      parentId: componentId,
      communityId,
      assignment: "community-fallback",
      trust: "derived",
    });
    syntheticWorkflowByComponent.set(componentId, id);
    attach(nodes, componentId, id);
    return id;
  };

  const workflowSourceIds = new Set(workflowNodes.map((node) => node.id));
  const symbolOwner = new Map<string, string>();
  const workflowOwner = new Map<string, string>(workflowMetaBySource);
  for (const source of symbolNodes) {
    const explicitWorkflow = bestOwner(
      source.id,
      workflowSourceIds,
      index.relations,
    );
    const pathWorkflow = explicitWorkflow
      ? undefined
      : uniquePathOwner(source, workflowNodes);
    const explicitComponent = bestOwner(
      source.id,
      componentSourceIds,
      index.relations,
    );
    const pathComponent = explicitComponent
      ? undefined
      : uniquePathOwner(source, componentNodes);
    const knownWorkflow = explicitWorkflow || pathWorkflow;
    const knownComponent = explicitComponent || pathComponent;
    const communityId =
      communityMembership.get(knownWorkflow || knownComponent || source.id) ||
      communityMembership.get(source.id) ||
      ensureFallbackCommunity();
    const componentId = knownWorkflow
      ? componentOwner.get(knownWorkflow) || ensureComponent(communityId)
      : knownComponent
        ? componentMetaBySource.get(knownComponent) ||
          ensureComponent(communityId)
        : ensureComponent(communityId);
    const workflowId = knownWorkflow
      ? workflowMetaBySource.get(knownWorkflow) ||
        ensureWorkflow(componentId, communityId)
      : ensureWorkflow(componentId, communityId);
    const id = metaId("symbol", source.id);
    addMutableNode(
      nodes,
      {
        id,
        label: source.label,
        level: "symbol",
        parentId: workflowId,
        sourceNodeId: source.id,
        communityId,
        assignment:
          explicitWorkflow || explicitComponent
            ? "explicit-containment"
            : pathWorkflow || pathComponent
              ? "path-affinity"
              : "community-fallback",
        trust: "derived",
      },
      source,
    );
    symbolOwner.set(source.id, id);
    workflowOwner.set(source.id, workflowId);
    componentOwner.set(source.id, componentId);
    attach(nodes, workflowId, id);
  }

  const communityOwner = new Map<string, string>();
  for (const [sourceId, communityId] of communityMembership)
    communityOwner.set(sourceId, communityId);
  for (const source of [...componentNodes, ...workflowNodes, ...symbolNodes])
    if (!communityOwner.has(source.id))
      communityOwner.set(source.id, ensureFallbackCommunity());

  // Fold descendant paths and members upward without turning the derived
  // ownership choice into a semantic claim.
  for (const level of ["workflow", "component", "community"] as const) {
    const current = [...nodes.values()].filter((node) => node.level === level);
    for (const parent of current)
      for (const childId of parent.children) {
        const child = nodes.get(childId)!;
        for (const member of child.members) parent.members.add(member);
        for (const path of child.paths) parent.paths.add(path);
      }
  }
  for (const communityId of root.children) {
    const community = nodes.get(communityId)!;
    for (const path of community.paths) root.paths.add(path);
  }

  let materialized = [...nodes.values()]
    .map((node) => materializeNode(node, underlying))
    .sort(
      (left, right) =>
        LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level) ||
        left.id.localeCompare(right.id),
    );
  if (materialized.length > MAX_META_NODES) {
    diagnostic(
      diagnostics,
      "META_NODE_LIMIT_REACHED",
      "warning",
      "document",
      `Meta projection retained ${MAX_META_NODES}/${materialized.length} nodes.`,
    );
    materialized = materialized.slice(0, MAX_META_NODES);
  }
  const retained = new Set(materialized.map((node) => node.id));
  materialized = materialized.map((node) => ({
    ...node,
    childIds: node.childIds.filter((id) => retained.has(id)),
  }));

  let edges = [
    ...aggregateEdges(index.relations, "community", communityOwner),
    ...aggregateEdges(index.relations, "component", componentOwner),
    ...aggregateEdges(index.relations, "workflow", workflowOwner),
    ...aggregateEdges(index.relations, "symbol", symbolOwner),
  ]
    .filter((edge) => retained.has(edge.from) && retained.has(edge.to))
    .sort(
      (left, right) =>
        LEVELS.indexOf(left.level) - LEVELS.indexOf(right.level) ||
        left.id.localeCompare(right.id),
    );
  if (edges.length > MAX_META_EDGES) {
    diagnostic(
      diagnostics,
      "META_EDGE_LIMIT_REACHED",
      "warning",
      "document",
      `Meta projection retained ${MAX_META_EDGES}/${edges.length} edges.`,
    );
    edges = edges.slice(0, MAX_META_EDGES);
  }
  if (!semanticNodes.length)
    diagnostic(
      diagnostics,
      "META_SEMANTIC_INPUT_MISSING",
      "warning",
      rootId,
      "No semantic hierarchy is available; the map contains only the workspace root.",
    );
  if (syntheticComponentByCommunity.size || syntheticWorkflowByComponent.size)
    diagnostic(
      diagnostics,
      "META_FALLBACK_OWNERSHIP",
      "warning",
      rootId,
      "Some nodes use derived fallback groups because explicit containment was unavailable.",
    );
  const revision = metaRevision({
    sourceRevision: index.sourceRevision,
    semanticRevision: index.semanticRevision,
    behaviorRevision: index.behaviorRevision,
    knowledgeRevision: index.knowledgeRevision,
    nodes: materialized,
    edges,
  });
  const draft: Omit<ArchitectureMetaGraph, "validation"> = {
    contract: "witch.graph-meta/v1",
    algorithm: "deterministic-community-hierarchy",
    sourceRevision: index.sourceRevision,
    ...(index.semanticRevision
      ? { semanticRevision: index.semanticRevision }
      : {}),
    ...(index.behaviorRevision
      ? { behaviorRevision: index.behaviorRevision }
      : {}),
    ...(index.knowledgeRevision
      ? { knowledgeRevision: index.knowledgeRevision }
      : {}),
    revision,
    rootId,
    levels: [...LEVELS],
    nodes: materialized,
    edges,
    diagnostics,
  };
  const validation = validateArchitectureMetaGraph(draft, graph);
  if (!validation.valid) {
    const details = validation.diagnostics
      .filter((item) => item.severity === "error")
      .slice(0, 8)
      .map((item) => `${item.code} (${item.subject}): ${item.message}`)
      .join("; ");
    throw new Error(`Architecture meta graph validation failed: ${details}`);
  }
  return { ...draft, validation };
}

/** Select one bounded drill-down frame for UI or Agent presentation. */
export function projectArchitectureMetaFrame(
  meta: ArchitectureMetaGraph,
  focusId: string = meta.rootId,
  limit = 40,
) {
  if (!meta.validation.valid)
    throw new Error("Cannot project an invalid architecture meta graph");
  const nodes = new Map(meta.nodes.map((node) => [node.id, node]));
  const focus = nodes.get(focusId) || nodes.get(meta.rootId)!;
  const requested = Math.max(4, Math.min(80, Math.floor(limit)));
  const children = focus.childIds
    .map((id) => nodes.get(id))
    .filter((node): node is ArchitectureMetaNode => Boolean(node))
    .sort(
      (left, right) =>
        right.memberCount - left.memberCount || left.id.localeCompare(right.id),
    );
  const visible = children.slice(0, requested);
  const visibleIds = new Set(visible.map((node) => node.id));
  const edges = meta.edges.filter(
    (edge) =>
      edge.level === visible[0]?.level &&
      visibleIds.has(edge.from) &&
      visibleIds.has(edge.to),
  );
  const breadcrumbs: ArchitectureMetaNode[] = [];
  let cursor: ArchitectureMetaNode | undefined = focus;
  while (cursor) {
    breadcrumbs.unshift(cursor);
    cursor = cursor.parentId ? nodes.get(cursor.parentId) : undefined;
  }
  return {
    focus,
    breadcrumbs,
    nodes: visible,
    edges,
    omittedNodes: Math.max(0, children.length - visible.length),
    nextLevel: visible[0]?.level,
  };
}
