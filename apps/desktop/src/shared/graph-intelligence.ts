import type { ArchitectureGraph, SourceEvidence } from "./architecture";

export type GraphIntelligenceTrust =
  "verified" | "authored" | "inferred" | "observed";

export type GraphIntelligenceStatus =
  | "accepted"
  | "provisional"
  | "corroborated"
  | "conflicting"
  | "stale"
  | "superseded";

export type GraphIntelligenceNode = {
  id: string;
  label: string;
  kind: string;
  origin: "source" | "semantic" | "knowledge";
  trust: GraphIntelligenceTrust;
  status: GraphIntelligenceStatus;
  confidence: number;
  path?: string;
  line?: number;
  description?: string;
  evidence: SourceEvidence[];
};

export type GraphIntelligenceRelation = {
  id: string;
  sourceRelationId: string;
  from: string;
  to: string;
  kind: string;
  origin: "source" | "semantic" | "behavior" | "knowledge" | "projection";
  trust: GraphIntelligenceTrust;
  status: GraphIntelligenceStatus;
  confidence: number;
  evidence: SourceEvidence[];
};

export type GraphIntelligenceIndex = {
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  knowledgeRevision?: string;
  nodes: GraphIntelligenceNode[];
  relations: GraphIntelligenceRelation[];
};

export type GraphQueryRequest = {
  query: string;
  /** Stable graph ids selected by the user or another audited subsystem. */
  seedNodeIds?: string[];
  depth?: number;
  tokenBudget?: number;
  maxSeeds?: number;
  direction?: "upstream" | "downstream" | "both";
  trust?: GraphIntelligenceTrust[];
  kinds?: string[];
  relationKinds?: string[];
};

export type GraphQueryNode = GraphIntelligenceNode & {
  score: number;
  depth: number;
  reasons: string[];
};

export type GraphQueryAmbiguity = {
  term: string;
  candidateIds: string[];
  message: string;
};

export type GraphQueryReceipt = {
  contract: "witch.graph-query/v1";
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  knowledgeRevision?: string;
  query: string;
  normalizedQuery: string;
  direction: "upstream" | "downstream" | "both";
  depth: number;
  tokenBudget: number;
  estimatedTokens: number;
  seeds: GraphQueryNode[];
  nodes: GraphQueryNode[];
  relations: GraphIntelligenceRelation[];
  ambiguities: GraphQueryAmbiguity[];
  truncated: boolean;
  omittedNodes: number;
  omittedRelations: number;
  notices: string[];
};

export type GraphCommunity = {
  id: string;
  label: string;
  trust: "derived";
  memberIds: string[];
  memberSignature: string;
  hubIds: string[];
  cohesion: number;
  internalRelations: number;
  externalRelations: number;
};

export type GraphCommunityReceipt = {
  contract: "witch.graph-community/v1";
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  knowledgeRevision?: string;
  algorithm: "deterministic-modularity-local-moving";
  seed: 0;
  resolution: number;
  communities: GraphCommunity[];
  isolatedNodeIds: string[];
  warnings: string[];
};

export type GraphImpactRequest = {
  changedNodeIds?: string[];
  changedPaths?: string[];
  maxDepth?: number;
};

export type GraphImpactNode = GraphIntelligenceNode & {
  depth: number;
  relationPath: string[];
};

export type GraphImpactReceipt = {
  contract: "witch.graph-impact/v1";
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  knowledgeRevision?: string;
  maxDepth: number;
  changed: GraphIntelligenceNode[];
  affected: GraphImpactNode[];
  components: GraphImpactNode[];
  workflows: GraphImpactNode[];
  suggestedTestPaths: string[];
  risk: {
    score: number;
    level: "low" | "medium" | "high" | "critical";
    reasons: string[];
  };
  unresolvedInputs: string[];
  truncated: boolean;
};

export type ArchitectureBrief = {
  contract: "witch.architecture-brief/v1";
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  knowledgeRevision?: string;
  summary: {
    files: number;
    nodes: number;
    relations: number;
    verifiedRelations: number;
    inferredRelations: number;
    observedRelations: number;
    deepCoveragePercent?: number;
  };
  knowledge?: {
    decisions: number;
    packages: number;
    configurations: number;
    relations: number;
  };
  communities: GraphCommunity[];
  hubs: Array<{ nodeId: string; label: string; degree: number }>;
  bridges: Array<{
    nodeId: string;
    label: string;
    communityIds: string[];
    degree: number;
  }>;
  cycles: Array<{ nodeIds: string[]; relationIds: string[] }>;
  questions: Array<{
    id: string;
    subjectId: string;
    prompt: string;
    reason: string;
  }>;
  warnings: string[];
};

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "for",
  "from",
  "how",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "where",
  "which",
  "with",
  "그",
  "및",
  "어떤",
  "어떻게",
  "에서",
  "으로",
  "있는",
  "하는",
]);

const relationWeight: Record<string, number> = {
  calls: 1.5,
  executes: 1.5,
  precedes: 1.45,
  "branches-to": 1.4,
  retries: 1.4,
  "routes-to": 1.35,
  overrides: 1.3,
  implements: 1.25,
  extends: 1.2,
  "depends-on": 1.1,
  configures: 1.15,
  documents: 0.7,
  describes: 0.7,
  supersedes: 0.8,
  "declared-in": 0.25,
  "documented-in": 0.2,
  imports: 1,
  emits: 1,
  subscribes: 1,
  contains: 0.35,
  defines: 0.3,
  "evidenced-by": 0.15,
};

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\\/g, "/").trim();

function terms(value: string) {
  return normalize(value)
    .split(/[^\p{L}\p{N}_.$:/-]+/gu)
    .flatMap((part) => part.split(/[.$:/_-]+/g))
    .filter((part) => part.length > 1 && !STOP_WORDS.has(part));
}

function evidenceKey(item: SourceEvidence) {
  return `${item.path}:${item.line}:${item.endLine || item.line}:${item.hash}:${item.excerpt || ""}`;
}

function mergeEvidence(...groups: SourceEvidence[][]) {
  const found = new Map<string, SourceEvidence>();
  for (const item of groups.flat()) found.set(evidenceKey(item), item);
  return [...found.values()].sort((left, right) =>
    evidenceKey(left).localeCompare(evidenceKey(right)),
  );
}

function assertGraph(graph: ArchitectureGraph) {
  if (!graph.validation.valid)
    throw new Error(
      "Graph Intelligence requires a validated architecture graph",
    );
  if (
    graph.semantic &&
    (!graph.semantic.validation.valid ||
      graph.semantic.sourceRevision !== graph.revision)
  )
    throw new Error(
      "Graph Intelligence cannot use an invalid or stale semantic graph",
    );
  if (
    graph.behavior &&
    (!graph.behavior.validation.valid ||
      graph.behavior.sourceRevision !== graph.revision ||
      graph.behavior.semanticRevision !== graph.semantic?.revision)
  )
    throw new Error(
      "Graph Intelligence cannot use an invalid or stale behavior graph",
    );
  if (
    graph.knowledge &&
    (!graph.knowledge.validation.valid ||
      graph.knowledge.sourceRevision !== graph.revision ||
      graph.knowledge.semanticRevision !== graph.semantic?.revision)
  )
    throw new Error(
      "Graph Intelligence cannot use invalid or stale architecture knowledge",
    );
}

/** Build one read-only typed multi-relation index without mutating source IR. */
export function buildGraphIntelligenceIndex(
  graph: ArchitectureGraph,
): GraphIntelligenceIndex {
  assertGraph(graph);
  const nodes = new Map<string, GraphIntelligenceNode>();
  for (const node of graph.nodes) {
    nodes.set(node.id, {
      id: node.id,
      label: node.label,
      kind: node.kind === "external" ? "external-system" : "file",
      origin: "source",
      trust: "verified",
      status: "accepted",
      confidence: 1,
      ...(node.path ? { path: node.path } : {}),
      ...(node.evidence[0]?.line ? { line: node.evidence[0].line } : {}),
      evidence: [...node.evidence],
    });
  }
  if (graph.semantic) {
    for (const node of graph.semantic.nodes) {
      const existing = nodes.get(node.id);
      nodes.set(node.id, {
        id: node.id,
        label: node.label,
        kind: node.kind,
        origin: "semantic",
        trust: node.trust,
        status: node.status,
        confidence: node.confidence,
        ...(node.path || existing?.path
          ? { path: node.path || existing?.path }
          : {}),
        ...(node.evidence[0]?.line || existing?.line
          ? { line: node.evidence[0]?.line || existing?.line }
          : {}),
        ...(node.description ? { description: node.description } : {}),
        evidence: mergeEvidence(existing?.evidence || [], node.evidence),
      });
    }
  }
  for (const node of graph.knowledge?.nodes || []) {
    nodes.set(node.id, {
      id: node.id,
      label: node.label,
      kind: node.kind,
      origin: "knowledge",
      trust: node.trust,
      status: node.status,
      confidence: node.confidence,
      ...(node.path ? { path: node.path } : {}),
      ...(node.evidence[0]?.line ? { line: node.evidence[0].line } : {}),
      ...(node.description ? { description: node.description } : {}),
      evidence: [...node.evidence],
    });
  }

  const relations: GraphIntelligenceRelation[] = graph.edges.map((edge) => ({
    id: `source:${edge.id}`,
    sourceRelationId: edge.id,
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    origin: "source",
    trust: "verified",
    status: "accepted",
    confidence: 1,
    evidence: [...edge.evidence],
  }));
  for (const relation of graph.semantic?.relations || [])
    relations.push({
      id: `semantic:${relation.id}`,
      sourceRelationId: relation.id,
      from: relation.from,
      to: relation.to,
      kind: relation.kind,
      origin: "semantic",
      trust: relation.trust,
      status: relation.status,
      confidence: relation.confidence,
      evidence: [...relation.evidence],
    });
  for (const relation of graph.behavior?.relations || [])
    relations.push({
      id: `behavior:${relation.id}`,
      sourceRelationId: relation.id,
      from: relation.from,
      to: relation.to,
      kind: relation.kind,
      origin: "behavior",
      trust: relation.trust,
      status: relation.status,
      confidence: relation.confidence,
      evidence: [...relation.evidence],
    });
  for (const relation of graph.knowledge?.relations || [])
    relations.push({
      id: `knowledge:${relation.id}`,
      sourceRelationId: relation.id,
      from: relation.from,
      to: relation.to,
      kind: relation.kind,
      origin: "knowledge",
      trust: relation.trust,
      status: relation.status,
      confidence: relation.confidence,
      evidence: [...relation.evidence],
    });
  for (const node of graph.semantic?.nodes || []) {
    if (!node.sourceNodeId || node.sourceNodeId === node.id) continue;
    if (!nodes.has(node.sourceNodeId)) continue;
    relations.push({
      id: `projection:${node.id}:evidenced-by:${node.sourceNodeId}`,
      sourceRelationId: `${node.id}:evidenced-by:${node.sourceNodeId}`,
      from: node.id,
      to: node.sourceNodeId,
      kind: "evidenced-by",
      origin: "projection",
      trust: node.trust,
      status: node.status,
      confidence: node.confidence,
      evidence: [...node.evidence],
    });
  }

  return {
    sourceRevision: graph.revision,
    ...(graph.semantic ? { semanticRevision: graph.semantic.revision } : {}),
    ...(graph.behavior ? { behaviorRevision: graph.behavior.revision } : {}),
    ...(graph.knowledge ? { knowledgeRevision: graph.knowledge.revision } : {}),
    nodes: [...nodes.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    relations: relations
      .filter((relation) => nodes.has(relation.from) && nodes.has(relation.to))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function scoreNode(
  node: GraphIntelligenceNode,
  query: string,
  queryTerms: string[],
  documentFrequency: Map<string, number>,
  documentCount: number,
) {
  const label = normalize(node.label);
  const id = normalize(node.id);
  const path = normalize(node.path || "");
  const description = normalize(node.description || "");
  const labelTerms = new Set(terms(node.label));
  let score = 0;
  const reasons: string[] = [];
  if (query && label === query) {
    score += 60;
    reasons.push("exact label");
  } else if (query && label.startsWith(query)) {
    score += 25;
    reasons.push("label prefix");
  } else if (query && label.includes(query)) {
    score += 15;
    reasons.push("label contains query");
  }
  if (query && id === query) {
    score += 50;
    reasons.push("exact id");
  } else if (query && (id.includes(query) || path.includes(query))) {
    score += 12;
    reasons.push("id or path match");
  }
  for (const term of queryTerms) {
    const idf =
      1 +
      Math.log((documentCount + 1) / ((documentFrequency.get(term) || 0) + 1));
    let termScore = 0;
    if (labelTerms.has(term)) termScore = 12;
    else if ([...labelTerms].some((candidate) => candidate.startsWith(term)))
      termScore = 7;
    else if (label.includes(term)) termScore = 4;
    if (id.includes(term) || path.includes(term)) termScore += 4;
    if (description.includes(term)) termScore += 2;
    if (termScore) {
      score += termScore * idf;
      reasons.push(`term: ${term}`);
    }
  }
  return { score: Math.round(score * 100) / 100, reasons };
}

function estimateNodeTokens(node: GraphIntelligenceNode) {
  const evidence = node.evidence
    .slice(0, 2)
    .map((item) => `${item.path}:${item.line} ${item.excerpt || ""}`)
    .join(" ");
  return Math.max(
    10,
    Math.ceil(
      `${node.id} ${node.label} ${node.kind} ${node.path || ""} ${node.description || ""} ${evidence}`
        .length / 4,
    ),
  );
}

function estimateRelationTokens(relation: GraphIntelligenceRelation) {
  const evidence = relation.evidence[0];
  return Math.max(
    7,
    Math.ceil(
      `${relation.from} ${relation.kind} ${relation.to} ${evidence?.path || ""}:${evidence?.line || ""}`
        .length / 4,
    ),
  );
}

/** Create a bounded, auditable graph context packet. It does not synthesize an answer. */
export function queryArchitectureGraph(
  graph: ArchitectureGraph,
  request: GraphQueryRequest,
): GraphQueryReceipt {
  const index = buildGraphIntelligenceIndex(graph);
  const normalizedQuery = normalize(request.query);
  const queryTerms = [...new Set(terms(request.query))];
  const depth = Math.max(0, Math.min(6, Math.floor(request.depth ?? 2)));
  const tokenBudget = Math.max(
    128,
    Math.min(32_000, Math.floor(request.tokenBudget ?? 2_000)),
  );
  const maxSeeds = Math.max(1, Math.min(20, Math.floor(request.maxSeeds ?? 5)));
  const direction = request.direction || "both";
  const allowedTrust = request.trust ? new Set(request.trust) : null;
  const allowedKinds = request.kinds ? new Set(request.kinds) : null;
  const allowedRelations = request.relationKinds
    ? new Set(request.relationKinds)
    : null;
  const candidateNodes = index.nodes.filter(
    (node) =>
      (!allowedTrust || allowedTrust.has(node.trust)) &&
      (!allowedKinds || allowedKinds.has(node.kind)),
  );
  const frequency = new Map<string, number>();
  for (const node of candidateNodes) {
    const found = new Set(
      terms(
        `${node.label} ${node.id} ${node.path || ""} ${node.description || ""}`,
      ),
    );
    for (const term of queryTerms)
      if (found.has(term)) frequency.set(term, (frequency.get(term) || 0) + 1);
  }
  const ranked = candidateNodes
    .map((node) => ({
      node,
      ...scoreNode(
        node,
        normalizedQuery,
        queryTerms,
        frequency,
        candidateNodes.length,
      ),
    }))
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.node.confidence - left.node.confidence ||
        left.node.id.localeCompare(right.node.id),
    );
  const candidateById = new Map(candidateNodes.map((node) => [node.id, node]));
  const unresolvedSeeds: string[] = [];
  const explicitSeeds = [...new Set(request.seedNodeIds || [])]
    .sort()
    .flatMap((id) => {
      const node = candidateById.get(id);
      if (!node) {
        unresolvedSeeds.push(id);
        return [];
      }
      return [{ node, score: 100, reasons: ["explicit seed"] }];
    });
  const explicitIds = new Set(explicitSeeds.map((item) => item.node.id));
  const seedItems = [
    ...explicitSeeds,
    ...ranked.filter((item) => !explicitIds.has(item.node.id)),
  ].slice(0, maxSeeds);
  const seedIds = new Set(seedItems.map((item) => item.node.id));
  const exactCandidates = candidateNodes
    .filter(
      (node) => normalize(node.label) === normalizedQuery && normalizedQuery,
    )
    .map((node) => node.id)
    .sort();
  const ambiguities: GraphQueryAmbiguity[] =
    exactCandidates.length > 1
      ? [
          {
            term: request.query,
            candidateIds: exactCandidates,
            message: `${exactCandidates.length} nodes have the exact label; use a path or stable id to disambiguate.`,
          },
        ]
      : [];

  const relations = index.relations.filter(
    (relation) =>
      (!allowedRelations || allowedRelations.has(relation.kind)) &&
      (!allowedTrust || allowedTrust.has(relation.trust)),
  );
  const adjacent = new Map<
    string,
    Array<{ nodeId: string; relation: GraphIntelligenceRelation }>
  >();
  const addAdjacent = (
    from: string,
    nodeId: string,
    relation: GraphIntelligenceRelation,
  ) => {
    const items = adjacent.get(from) || [];
    items.push({ nodeId, relation });
    adjacent.set(from, items);
  };
  for (const relation of relations) {
    if (direction !== "upstream")
      addAdjacent(relation.from, relation.to, relation);
    if (direction !== "downstream")
      addAdjacent(relation.to, relation.from, relation);
  }
  for (const items of adjacent.values())
    items.sort(
      (left, right) =>
        left.relation.id.localeCompare(right.relation.id) ||
        left.nodeId.localeCompare(right.nodeId),
    );

  const reached = new Map<string, number>();
  const reachedRelations = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [];
  for (const seed of seedItems) {
    reached.set(seed.node.id, 0);
    queue.push({ id: seed.node.id, depth: 0 });
  }
  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= depth) continue;
    for (const next of adjacent.get(current.id) || []) {
      reachedRelations.add(next.relation.id);
      const nextDepth = current.depth + 1;
      const previous = reached.get(next.nodeId);
      if (previous !== undefined && previous <= nextDepth) continue;
      reached.set(next.nodeId, nextDepth);
      queue.push({ id: next.nodeId, depth: nextDepth });
    }
  }

  const nodeById = new Map(index.nodes.map((node) => [node.id, node]));
  const scoreById = new Map(
    [...ranked, ...explicitSeeds].map((item) => [item.node.id, item]),
  );
  const orderedReached = [...reached]
    .map(([id, nodeDepth]) => {
      const node = nodeById.get(id)!;
      const match = scoreById.get(id);
      return {
        ...node,
        score: match?.score || 0,
        depth: nodeDepth,
        reasons: match?.reasons || (nodeDepth ? ["graph neighbor"] : []),
      } satisfies GraphQueryNode;
    })
    .sort(
      (left, right) =>
        Number(!seedIds.has(left.id)) - Number(!seedIds.has(right.id)) ||
        left.depth - right.depth ||
        right.score - left.score ||
        left.id.localeCompare(right.id),
    );

  const selectedNodes: GraphQueryNode[] = [];
  const selectedIds = new Set<string>();
  let estimatedTokens = 0;
  for (const node of orderedReached) {
    const cost = estimateNodeTokens(node);
    if (
      estimatedTokens + cost > tokenBudget &&
      !seedIds.has(node.id) &&
      selectedNodes.length
    )
      continue;
    selectedNodes.push(node);
    selectedIds.add(node.id);
    estimatedTokens += cost;
  }
  const relationCandidates = relations.filter(
    (relation) =>
      reachedRelations.has(relation.id) &&
      selectedIds.has(relation.from) &&
      selectedIds.has(relation.to),
  );
  const selectedRelations: GraphIntelligenceRelation[] = [];
  for (const relation of relationCandidates) {
    const cost = estimateRelationTokens(relation);
    if (estimatedTokens + cost > tokenBudget) continue;
    selectedRelations.push(relation);
    estimatedTokens += cost;
  }
  const omittedNodes = orderedReached.length - selectedNodes.length;
  const omittedRelations = relationCandidates.length - selectedRelations.length;
  const budgetExceeded = estimatedTokens > tokenBudget;
  const truncated = omittedNodes > 0 || omittedRelations > 0 || budgetExceeded;
  const notices: string[] = [];
  if (!normalizedQuery && !seedItems.length)
    notices.push(
      "Enter a symbol, path, component, workflow, or responsibility.",
    );
  else if (!seedItems.length)
    notices.push("No graph node matched the query in the selected filters.");
  if (unresolvedSeeds.length)
    notices.push(
      `${unresolvedSeeds.length} explicit seed node${unresolvedSeeds.length === 1 ? " was" : "s were"} not present in this graph revision.`,
    );
  if (ambiguities.length)
    notices.push(
      "An exact label is ambiguous; no candidate was silently selected.",
    );
  if (truncated)
    notices.push(
      budgetExceeded && !omittedNodes && !omittedRelations
        ? "Seed evidence alone exceeds the requested token budget and was retained explicitly."
        : `The token budget omitted ${omittedNodes} nodes and ${omittedRelations} relations.`,
    );

  return {
    contract: "witch.graph-query/v1",
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
    query: request.query,
    normalizedQuery,
    direction,
    depth,
    tokenBudget,
    estimatedTokens,
    seeds: selectedNodes.filter((node) => seedIds.has(node.id)),
    nodes: selectedNodes,
    relations: selectedRelations,
    ambiguities,
    truncated,
    omittedNodes,
    omittedRelations,
    notices,
  };
}

function hashIds(ids: string[]) {
  let hash = 0x811c9dc5;
  for (const character of ids.join("\u0000")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function communityCandidates(index: GraphIntelligenceIndex) {
  const semantic = index.nodes.filter((node) => node.origin === "semantic");
  const pool = semantic.length ? semantic : index.nodes;
  return pool.filter(
    (node) => node.kind !== "open-question" && node.kind !== "artifact",
  );
}

/** Deterministic structural communities. This derived lens is never authored truth. */
export function projectGraphCommunities(
  graph: ArchitectureGraph,
  options: { resolution?: number } = {},
): GraphCommunityReceipt {
  const index = buildGraphIntelligenceIndex(graph);
  const resolution = Math.max(0.25, Math.min(3, options.resolution ?? 1));
  const candidates = communityCandidates(index);
  const ids = new Set(candidates.map((node) => node.id));
  const pairWeights = new Map<string, number>();
  const neighbors = new Map<string, Map<string, number>>();
  const addNeighbor = (from: string, to: string, weight: number) => {
    const row = neighbors.get(from) || new Map<string, number>();
    row.set(to, (row.get(to) || 0) + weight);
    neighbors.set(from, row);
  };
  for (const relation of index.relations) {
    if (!ids.has(relation.from) || !ids.has(relation.to)) continue;
    if (relation.from === relation.to) continue;
    const pair = [relation.from, relation.to].sort();
    const key = `${pair[0]}\u0000${pair[1]}`;
    const trustFactor =
      relation.trust === "verified" || relation.trust === "observed"
        ? 1
        : relation.trust === "authored"
          ? 0.95
          : 0.72;
    const weight =
      (relationWeight[relation.kind] || 0.8) *
      Math.max(0.1, relation.confidence) *
      trustFactor;
    pairWeights.set(key, (pairWeights.get(key) || 0) + weight);
  }
  for (const [key, weight] of pairWeights) {
    const [left, right] = key.split("\u0000");
    addNeighbor(left, right, weight);
    addNeighbor(right, left, weight);
  }
  const orderedIds = candidates.map((node) => node.id).sort();
  const degree = new Map(
    orderedIds.map((id) => [
      id,
      [...(neighbors.get(id)?.values() || [])].reduce(
        (total, weight) => total + weight,
        0,
      ),
    ]),
  );
  const m2 = [...degree.values()].reduce((total, value) => total + value, 0);
  const membership = new Map(orderedIds.map((id) => [id, id]));
  const totals = new Map(orderedIds.map((id) => [id, degree.get(id) || 0]));
  if (m2 > 0) {
    for (let iteration = 0; iteration < 32; iteration++) {
      let moved = false;
      for (const id of orderedIds) {
        const current = membership.get(id)!;
        const nodeDegree = degree.get(id) || 0;
        totals.set(current, (totals.get(current) || 0) - nodeDegree);
        const weightByCommunity = new Map<string, number>();
        for (const [neighbor, weight] of neighbors.get(id) || []) {
          const community = membership.get(neighbor)!;
          weightByCommunity.set(
            community,
            (weightByCommunity.get(community) || 0) + weight,
          );
        }
        weightByCommunity.set(current, weightByCommunity.get(current) || 0);
        let best = current;
        let bestGain = 0;
        for (const community of [...weightByCommunity.keys()].sort()) {
          const gain =
            (weightByCommunity.get(community) || 0) -
            (resolution * nodeDegree * (totals.get(community) || 0)) / m2;
          if (
            gain > bestGain + 1e-9 ||
            (Math.abs(gain - bestGain) <= 1e-9 &&
              community === current &&
              best !== current) ||
            (Math.abs(gain - bestGain) <= 1e-9 &&
              best !== current &&
              community.localeCompare(best) < 0)
          ) {
            best = community;
            bestGain = gain;
          }
        }
        membership.set(id, best);
        totals.set(best, (totals.get(best) || 0) + nodeDegree);
        if (best !== current) moved = true;
      }
      if (!moved) break;
    }
  }
  const groups = new Map<string, string[]>();
  for (const id of orderedIds) {
    const community = membership.get(id)!;
    const members = groups.get(community) || [];
    members.push(id);
    groups.set(community, members);
  }
  const nodeById = new Map(index.nodes.map((node) => [node.id, node]));
  const kindPriority: Record<string, number> = {
    component: 8,
    workflow: 7,
    module: 6,
    package: 5,
    system: 4,
    "workflow-step": 3,
    symbol: 2,
    file: 1,
  };
  const communities = [...groups.values()].map((members) => {
    members.sort();
    const memberSet = new Set(members);
    const ranked = [...members].sort((left, right) => {
      const leftNode = nodeById.get(left)!;
      const rightNode = nodeById.get(right)!;
      return (
        (kindPriority[rightNode.kind] || 0) -
          (kindPriority[leftNode.kind] || 0) ||
        (degree.get(right) || 0) - (degree.get(left) || 0) ||
        left.localeCompare(right)
      );
    });
    let internalRelations = 0;
    let externalRelations = 0;
    let internalWeight = 0;
    let externalWeight = 0;
    for (const [key, weight] of pairWeights) {
      const [left, right] = key.split("\u0000");
      const leftInside = memberSet.has(left);
      const rightInside = memberSet.has(right);
      if (leftInside && rightInside) {
        internalRelations++;
        internalWeight += weight;
      } else if (leftInside || rightInside) {
        externalRelations++;
        externalWeight += weight;
      }
    }
    const memberSignature = hashIds(members);
    return {
      id: `community:${memberSignature}`,
      label: nodeById.get(ranked[0])?.label || "Unnamed community",
      trust: "derived" as const,
      memberIds: members,
      memberSignature,
      hubIds: ranked.slice(0, 3),
      cohesion:
        internalWeight + externalWeight
          ? Math.round(
              (internalWeight / (internalWeight + externalWeight)) * 1000,
            ) / 1000
          : 0,
      internalRelations,
      externalRelations,
    };
  });
  communities.sort(
    (left, right) =>
      right.memberIds.length - left.memberIds.length ||
      left.memberSignature.localeCompare(right.memberSignature),
  );
  const isolatedNodeIds = orderedIds.filter((id) => !(degree.get(id) || 0));
  const warnings: string[] = [];
  if (!graph.semantic)
    warnings.push(
      "Communities use the source import graph because no validated semantic graph is available.",
    );
  if (communities.length === 1 && candidates.length > 8)
    warnings.push(
      "The selected relation projection formed one broad community; inspect relation weights or authored boundaries.",
    );
  return {
    contract: "witch.graph-community/v1",
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
    algorithm: "deterministic-modularity-local-moving",
    seed: 0,
    resolution,
    communities,
    isolatedNodeIds,
    warnings,
  };
}

const reverseImpactKinds = new Set([
  "contains",
  "defines",
  "calls",
  "imports",
  "depends-on",
  "reads",
  "reads-state",
  "observes",
  "subscribes",
  "implements",
  "extends",
  "overrides",
  "consumes",
  "declared-in",
  "documented-in",
]);
const forwardImpactKinds = new Set([
  "precedes",
  "branches-to",
  "retries",
  "routes-to",
  "emits",
  "executes",
  "passes",
  "returns",
  "produces",
  "writes",
  "writes-state",
  "persists",
  "publishes",
  "spawns",
  "raises",
  "handles",
  "configures",
  "documents",
  "describes",
  "supersedes",
]);

/** Propagate changes according to typed relation semantics and retain every route. */
export function analyzeGraphImpact(
  graph: ArchitectureGraph,
  request: GraphImpactRequest,
): GraphImpactReceipt {
  const index = buildGraphIntelligenceIndex(graph);
  const maxDepth = Math.max(1, Math.min(8, Math.floor(request.maxDepth ?? 3)));
  const nodeById = new Map(index.nodes.map((node) => [node.id, node]));
  const changedIds = new Set<string>();
  const unresolvedInputs: string[] = [];
  for (const id of request.changedNodeIds || []) {
    if (nodeById.has(id)) changedIds.add(id);
    else unresolvedInputs.push(id);
  }
  for (const inputPath of request.changedPaths || []) {
    const wanted = normalize(inputPath);
    const matches = index.nodes.filter(
      (node) =>
        normalize(node.path || "") === wanted ||
        node.evidence.some((item) => normalize(item.path) === wanted),
    );
    if (!matches.length) unresolvedInputs.push(inputPath);
    for (const node of matches) changedIds.add(node.id);
  }
  const transitions = new Map<
    string,
    Array<{ nodeId: string; relationId: string }>
  >();
  const add = (from: string, nodeId: string, relationId: string) => {
    const items = transitions.get(from) || [];
    items.push({ nodeId, relationId });
    transitions.set(from, items);
  };
  for (const relation of index.relations) {
    if (reverseImpactKinds.has(relation.kind))
      add(relation.to, relation.from, relation.id);
    if (forwardImpactKinds.has(relation.kind))
      add(relation.from, relation.to, relation.id);
  }
  for (const items of transitions.values())
    items.sort(
      (left, right) =>
        left.relationId.localeCompare(right.relationId) ||
        left.nodeId.localeCompare(right.nodeId),
    );
  const reached = new Map<string, { depth: number; relationPath: string[] }>();
  const queue: string[] = [];
  for (const id of [...changedIds].sort()) {
    reached.set(id, { depth: 0, relationPath: [] });
    queue.push(id);
  }
  let truncated = false;
  const limit = 2_000;
  while (queue.length) {
    const current = queue.shift()!;
    const currentState = reached.get(current)!;
    if (currentState.depth >= maxDepth) continue;
    for (const transition of transitions.get(current) || []) {
      const nextDepth = currentState.depth + 1;
      const previous = reached.get(transition.nodeId);
      if (previous && previous.depth <= nextDepth) continue;
      if (reached.size >= limit) {
        truncated = true;
        break;
      }
      reached.set(transition.nodeId, {
        depth: nextDepth,
        relationPath: [...currentState.relationPath, transition.relationId],
      });
      queue.push(transition.nodeId);
    }
    if (truncated) break;
  }
  const changed = [...changedIds]
    .map((id) => nodeById.get(id)!)
    .sort((left, right) => left.id.localeCompare(right.id));
  const affected = [...reached]
    .filter(([id]) => !changedIds.has(id))
    .map(([id, state]) => ({
      ...nodeById.get(id)!,
      ...state,
    }))
    .sort(
      (left, right) =>
        left.depth - right.depth || left.id.localeCompare(right.id),
    );
  const components = affected.filter((node) => node.kind === "component");
  const workflows = affected.filter((node) => node.kind === "workflow");
  const suggestedTestPaths = [
    ...new Set(
      affected
        .flatMap((node) => [
          node.path,
          ...node.evidence.map((item) => item.path),
        ])
        .filter((item): item is string => Boolean(item))
        .filter((item) =>
          /(^|\/)(tests?|specs?|__tests__)(\/|$)|[._-](test|spec)\./i.test(
            item.replace(/\\/g, "/"),
          ),
        ),
    ),
  ].sort();
  const score = Math.min(
    100,
    changed.length * 2 +
      affected.length * 3 +
      components.length * 7 +
      workflows.length * 9 +
      Math.max(0, ...affected.map((node) => node.depth)) * 4,
  );
  const level =
    score >= 75
      ? "critical"
      : score >= 50
        ? "high"
        : score >= 25
          ? "medium"
          : "low";
  const reasons = [
    `${changed.length} changed graph nodes resolve from the input.`,
    `${affected.length} nodes are reachable through typed impact propagation.`,
    `${workflows.length} workflows and ${components.length} components are affected.`,
  ];
  if (!suggestedTestPaths.length)
    reasons.push(
      "No affected test path was found in the current graph reading.",
    );
  if (truncated)
    reasons.push(`Impact traversal stopped at the ${limit}-node safety bound.`);
  return {
    contract: "witch.graph-impact/v1",
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
    maxDepth,
    changed,
    affected,
    components,
    workflows,
    suggestedTestPaths,
    risk: { score, level, reasons },
    unresolvedInputs: [...new Set(unresolvedInputs)].sort(),
    truncated,
  };
}

function directedCycles(index: GraphIntelligenceIndex) {
  const ignored = new Set([
    "contains",
    "defines",
    "evidenced-by",
    "declared-in",
    "documented-in",
  ]);
  const relations = index.relations.filter(
    (relation) => !ignored.has(relation.kind),
  );
  const adjacent = new Map<string, string[]>();
  for (const relation of relations) {
    const items = adjacent.get(relation.from) || [];
    items.push(relation.to);
    adjacent.set(relation.from, items);
  }
  for (const [id, items] of adjacent)
    adjacent.set(id, [...new Set(items)].sort());
  let position = 0;
  const positions = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const active = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string) => {
    positions.set(id, position);
    low.set(id, position);
    position++;
    stack.push(id);
    active.add(id);
    for (const next of adjacent.get(id) || []) {
      if (!positions.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (active.has(next))
        low.set(id, Math.min(low.get(id)!, positions.get(next)!));
    }
    if (low.get(id) !== positions.get(id)) return;
    const component: string[] = [];
    while (stack.length) {
      const member = stack.pop()!;
      active.delete(member);
      component.push(member);
      if (member === id) break;
    }
    component.sort();
    if (
      component.length > 1 ||
      relations.some((relation) => relation.from === id && relation.to === id)
    )
      components.push(component);
  };
  for (const node of index.nodes) if (!positions.has(node.id)) visit(node.id);
  return components
    .map((nodeIds) => {
      const ids = new Set(nodeIds);
      return {
        nodeIds,
        relationIds: relations
          .filter((relation) => ids.has(relation.from) && ids.has(relation.to))
          .map((relation) => relation.id)
          .sort(),
      };
    })
    .sort(
      (left, right) =>
        right.nodeIds.length - left.nodeIds.length ||
        left.nodeIds.join("\u0000").localeCompare(right.nodeIds.join("\u0000")),
    )
    .slice(0, 20);
}

/** Deterministic architecture summary used by UI and future provider adapters. */
export function createArchitectureBrief(
  graph: ArchitectureGraph,
  projectedCommunities?: GraphCommunityReceipt,
): ArchitectureBrief {
  const index = buildGraphIntelligenceIndex(graph);
  const communityReceipt =
    projectedCommunities || projectGraphCommunities(graph);
  if (
    communityReceipt.sourceRevision !== index.sourceRevision ||
    communityReceipt.semanticRevision !== index.semanticRevision ||
    communityReceipt.behaviorRevision !== index.behaviorRevision ||
    communityReceipt.knowledgeRevision !== index.knowledgeRevision
  )
    throw new Error(
      "Architecture brief requires a community receipt from the same graph revisions",
    );
  const degree = new Map(index.nodes.map((node) => [node.id, 0]));
  for (const relation of index.relations) {
    degree.set(relation.from, (degree.get(relation.from) || 0) + 1);
    degree.set(relation.to, (degree.get(relation.to) || 0) + 1);
  }
  const nodeById = new Map(index.nodes.map((node) => [node.id, node]));
  const semanticHubIds = new Set(
    index.nodes
      .filter((node) => node.origin === "semantic")
      .map((node) => node.id),
  );
  const hubs = [...degree]
    .filter(([id]) => !semanticHubIds.size || semanticHubIds.has(id))
    .filter(([, value]) => value > 0)
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .slice(0, 12)
    .map(([nodeId, nodeDegree]) => ({
      nodeId,
      label: nodeById.get(nodeId)?.label || nodeId,
      degree: nodeDegree,
    }));
  const membership = new Map<string, string>();
  for (const community of communityReceipt.communities)
    for (const id of community.memberIds) membership.set(id, community.id);
  const neighborCommunities = new Map<string, Set<string>>();
  for (const relation of index.relations) {
    const fromCommunity = membership.get(relation.from);
    const toCommunity = membership.get(relation.to);
    if (!fromCommunity || !toCommunity || fromCommunity === toCommunity)
      continue;
    const from = neighborCommunities.get(relation.from) || new Set<string>();
    from.add(toCommunity);
    neighborCommunities.set(relation.from, from);
    const to = neighborCommunities.get(relation.to) || new Set<string>();
    to.add(fromCommunity);
    neighborCommunities.set(relation.to, to);
  }
  const bridges = [...neighborCommunities]
    .filter(([, communities]) => communities.size > 0)
    .map(([nodeId, communities]) => ({
      nodeId,
      label: nodeById.get(nodeId)?.label || nodeId,
      communityIds: [...communities].sort(),
      degree: degree.get(nodeId) || 0,
    }))
    .sort(
      (left, right) =>
        right.communityIds.length - left.communityIds.length ||
        right.degree - left.degree ||
        left.nodeId.localeCompare(right.nodeId),
    )
    .slice(0, 12);
  const questions: ArchitectureBrief["questions"] = [];
  for (const question of graph.semantic?.questions || []) {
    if (question.status !== "open") continue;
    questions.push({
      id: question.id,
      subjectId: question.subjectId,
      prompt: question.prompt,
      reason: "Open semantic question retained by the validated graph.",
    });
  }
  for (const relation of index.relations) {
    if (relation.status !== "conflicting" && relation.status !== "stale")
      continue;
    questions.push({
      id: `intelligence:${relation.status}:${relation.id}`,
      subjectId: relation.from,
      prompt: `Should ${relation.kind} from ${nodeById.get(relation.from)?.label || relation.from} to ${nodeById.get(relation.to)?.label || relation.to} remain in the current architecture?`,
      reason: `The relation is ${relation.status} and requires authored or runtime corroboration.`,
    });
  }
  questions.sort(
    (left, right) =>
      left.id.localeCompare(right.id) ||
      left.subjectId.localeCompare(right.subjectId),
  );
  const warnings = [
    ...graph.warnings,
    ...communityReceipt.warnings,
    ...(graph.coverage?.limits.map((limit) => limit.message) || []),
    ...(graph.knowledge?.diagnostics.map((item) => item.message) || []),
  ];
  if (!graph.semantic)
    warnings.push(
      "No semantic graph is available; the brief is limited to files and imports.",
    );
  const relations = index.relations;
  return {
    contract: "witch.architecture-brief/v1",
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
    summary: {
      files: graph.nodes.filter((node) => node.kind === "file").length,
      nodes: index.nodes.length,
      relations: relations.length,
      verifiedRelations: relations.filter(
        (relation) => relation.trust === "verified",
      ).length,
      inferredRelations: relations.filter(
        (relation) => relation.trust === "inferred",
      ).length,
      observedRelations: relations.filter(
        (relation) => relation.trust === "observed",
      ).length,
      ...(graph.coverage
        ? {
            deepCoveragePercent: graph.coverage.indexedFiles
              ? Math.round(
                  (graph.coverage.deepFiles / graph.coverage.indexedFiles) *
                    100,
                )
              : 0,
          }
        : {}),
    },
    ...(graph.knowledge
      ? {
          knowledge: {
            decisions: graph.knowledge.validation.decisionCount,
            packages: graph.knowledge.validation.packageCount,
            configurations: graph.knowledge.validation.configurationCount,
            relations: graph.knowledge.validation.relationCount,
          },
        }
      : {}),
    communities: communityReceipt.communities,
    hubs,
    bridges,
    cycles: directedCycles(index),
    questions,
    warnings: [...new Set(warnings)].sort(),
  };
}
