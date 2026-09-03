import type { ArchitectureGraph, ComponentContext } from "./architecture";
import {
  analyzeGraphImpact,
  buildGraphIntelligenceIndex,
  createArchitectureBrief,
  projectGraphCommunities,
  queryArchitectureGraph,
  type GraphImpactReceipt,
  type GraphQueryReceipt,
} from "./graph-intelligence";
import { buildArchitectureMetaGraph } from "./graph-meta";

export type AgentGraphToolId =
  "witch.graph.query" | "witch.graph.impact" | "witch.graph.brief";

export type AgentGraphToolDescriptor = {
  id: AgentGraphToolId;
  purpose: string;
  inputContract: string;
  outputContract: string;
  availability: "preflight" | "post-change";
};

export type AgentGraphContextReceipt = {
  contract: "witch.agent-graph-context/v1";
  delivery: "preflight-context";
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  selectedNodeIds: string[];
  tools: AgentGraphToolDescriptor[];
  query: GraphQueryReceipt;
  brief: {
    summary: ReturnType<typeof createArchitectureBrief>["summary"];
    communities: Array<{
      id: string;
      label: string;
      members: number;
      hubIds: string[];
      cohesion: number;
    }>;
    hubs: ReturnType<typeof createArchitectureBrief>["hubs"];
    questions: ReturnType<typeof createArchitectureBrief>["questions"];
    warnings: string[];
  };
  /** Optional for persisted v1 receipts created before multi-resolution maps. */
  meta?: {
    contract: "witch.graph-meta/v1";
    revision: string;
    levels: string[];
    counts: Record<string, number>;
    rootChildren: Array<{
      id: string;
      label: string;
      memberCount: number;
      sourcePaths: string[];
    }>;
    warnings: string[];
  };
  /** Optional for persisted v1 receipts created before the overlay shipped. */
  experience?: AgentExperienceOverlayReceipt;
  boundary: string;
};

export type AgentExperienceOutcome = "useful" | "dead-end" | "corrected";

export type AgentExperienceRecord = {
  contract: "witch.agent-experience/v1";
  id: string;
  runId: string;
  outcome: AgentExperienceOutcome;
  sourceRevision: string;
  semanticRevision?: string;
  subjectNodeIds: string[];
  evidence: Array<{
    path: string;
    expectedSourceHash: string | null;
  }>;
  reason: string;
  createdAt: string;
};

export type AgentExperienceReading = {
  record: AgentExperienceRecord;
  freshness: "fresh" | "stale" | "unknown";
  mismatchedPaths: string[];
};

export type AgentExperienceOverlayReceipt = {
  contract: "witch.agent-experience-overlay/v1";
  sourceRevision: string;
  included: AgentExperienceRecord[];
  staleRecordIds: string[];
  unknownRecordIds: string[];
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function isAgentExperienceRecord(
  value: unknown,
): value is AgentExperienceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<AgentExperienceRecord>;
  return (
    record.contract === "witch.agent-experience/v1" &&
    typeof record.id === "string" &&
    record.id.length > 0 &&
    record.id.length <= 200 &&
    typeof record.runId === "string" &&
    record.runId.length > 0 &&
    record.runId.length <= 200 &&
    ["useful", "dead-end", "corrected"].includes(String(record.outcome)) &&
    typeof record.sourceRevision === "string" &&
    record.sourceRevision.length > 0 &&
    record.sourceRevision.length <= 1_000 &&
    (record.semanticRevision === undefined ||
      (typeof record.semanticRevision === "string" &&
        record.semanticRevision.length > 0 &&
        record.semanticRevision.length <= 1_000)) &&
    Array.isArray(record.subjectNodeIds) &&
    record.subjectNodeIds.length <= 200 &&
    record.subjectNodeIds.every(
      (id) => typeof id === "string" && id.length > 0 && id.length <= 10_000,
    ) &&
    Array.isArray(record.evidence) &&
    record.evidence.length <= 200 &&
    record.evidence.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.path === "string" &&
        item.path.length > 0 &&
        item.path.length <= 32_000 &&
        (item.expectedSourceHash === null ||
          SHA256_PATTERN.test(String(item.expectedSourceHash))),
    ) &&
    typeof record.reason === "string" &&
    record.reason.length > 0 &&
    record.reason.length <= 1_000 &&
    typeof record.createdAt === "string" &&
    Number.isFinite(Date.parse(record.createdAt))
  );
}

export type GraphImpactReviewNode = {
  id: string;
  label: string;
  kind: string;
  path?: string;
  depth: number;
  relationPath: string[];
};

export type GraphImpactChange = {
  path: string;
  before: string | null;
  after: string | null;
};

export type ChangedGraphNodeResolution = {
  nodeIds: string[];
  unresolvedPaths: string[];
  lineRanges: Array<{ path: string; start: number; end: number }>;
};

/** Bounded impact evidence safe to persist in an immutable Engineering Run event. */
export type GraphImpactReviewReceipt = {
  contract: "witch.graph-impact-review/v1";
  sourceContract: "witch.graph-impact/v1";
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  knowledgeRevision?: string;
  maxDepth: number;
  changedPaths: string[];
  changedNodeIds: string[];
  affectedCount: number;
  affectedNodes: GraphImpactReviewNode[];
  omittedAffected: number;
  componentIds: string[];
  workflowIds: string[];
  suggestedTestPaths: string[];
  risk: GraphImpactReceipt["risk"];
  unresolvedInputs: string[];
  truncated: boolean;
};

export const agentGraphTools: AgentGraphToolDescriptor[] = [
  {
    id: "witch.graph.query",
    purpose: "Retrieve bounded source-grounded neighborhoods for a task.",
    inputContract: "GraphQueryRequest",
    outputContract: "witch.graph-query/v1",
    availability: "preflight",
  },
  {
    id: "witch.graph.brief",
    purpose: "Summarize communities, hubs, coverage, and open questions.",
    inputContract: "ArchitectureGraph",
    outputContract: "witch.architecture-brief/v1",
    availability: "preflight",
  },
  {
    id: "witch.graph.impact",
    purpose: "Map changed paths to typed downstream impact and test evidence.",
    inputContract: "GraphImpactRequest",
    outputContract: "witch.graph-impact-review/v1",
    availability: "post-change",
  },
];

export function createAgentGraphContext(
  graph: ArchitectureGraph,
  prompt: string,
  contexts: ComponentContext[],
  experiences: AgentExperienceRecord[] = [],
): AgentGraphContextReceipt {
  const selectedNodeIds = [
    ...new Set(contexts.flatMap((item) => [item.nodeId, ...item.paths])),
  ]
    .sort()
    .slice(0, 20);
  const query = queryArchitectureGraph(graph, {
    query: prompt,
    seedNodeIds: selectedNodeIds,
    direction: "both",
    depth: 2,
    tokenBudget: 2_400,
    maxSeeds: 12,
  });
  const communities = projectGraphCommunities(graph);
  const brief = createArchitectureBrief(graph, communities);
  const meta = buildArchitectureMetaGraph(graph, communities);
  const metaNodes = new Map(meta.nodes.map((node) => [node.id, node]));
  const metaRoot = metaNodes.get(meta.rootId)!;
  const experience = createAgentExperienceOverlay(graph, experiences);
  return {
    contract: "witch.agent-graph-context/v1",
    delivery: "preflight-context",
    sourceRevision: graph.revision,
    ...(graph.semantic ? { semanticRevision: graph.semantic.revision } : {}),
    ...(graph.behavior ? { behaviorRevision: graph.behavior.revision } : {}),
    selectedNodeIds,
    tools: agentGraphTools.map((tool) => ({ ...tool })),
    query,
    brief: {
      summary: { ...brief.summary },
      communities: brief.communities.slice(0, 10).map((community) => ({
        id: community.id,
        label: community.label,
        members: community.memberIds.length,
        hubIds: community.hubIds.slice(0, 3),
        cohesion: community.cohesion,
      })),
      hubs: brief.hubs.slice(0, 10).map((hub) => ({ ...hub })),
      questions: brief.questions.slice(0, 10).map((question) => ({
        ...question,
      })),
      warnings: brief.warnings.slice(0, 12),
    },
    meta: {
      contract: "witch.graph-meta/v1",
      revision: meta.revision,
      levels: [...meta.levels],
      counts: Object.fromEntries(
        meta.levels.map((level) => [
          level,
          meta.nodes.filter((node) => node.level === level).length,
        ]),
      ),
      rootChildren: metaRoot.childIds
        .map((id) => metaNodes.get(id))
        .filter((node): node is NonNullable<typeof node> => Boolean(node))
        .sort(
          (left, right) =>
            right.memberCount - left.memberCount ||
            left.id.localeCompare(right.id),
        )
        .slice(0, 12)
        .map((node) => ({
          id: node.id,
          label: node.label,
          memberCount: node.memberCount,
          sourcePaths: node.sourcePaths.slice(0, 8),
        })),
      warnings: meta.diagnostics.map((item) => item.message).slice(0, 8),
    },
    experience,
    boundary:
      "Witch computed these deterministic, read-only receipts before provider execution. They are shared context, not live tool access and not authority to mutate the source workspace.",
  };
}

/** Compare only bounded source hashes; an unrelated graph revision does not stale evidence. */
export function evaluateAgentExperience(
  graph: ArchitectureGraph,
  record: AgentExperienceRecord,
): AgentExperienceReading {
  const current = new Map(
    graph.nodes
      .filter((node) => node.kind === "file" && node.path)
      .map((node) => [normalizedPath(node.path!), node.hash]),
  );
  if (!record.evidence.length)
    return { record, freshness: "unknown", mismatchedPaths: [] };
  const mismatchedPaths = record.evidence
    .filter((item) => {
      const actual = current.get(normalizedPath(item.path)) || null;
      return actual !== item.expectedSourceHash;
    })
    .map((item) => item.path)
    .sort();
  return {
    record,
    freshness: mismatchedPaths.length ? "stale" : "fresh",
    mismatchedPaths,
  };
}

export function createAgentExperienceOverlay(
  graph: ArchitectureGraph,
  records: AgentExperienceRecord[],
): AgentExperienceOverlayReceipt {
  const readings = records
    .filter(isAgentExperienceRecord)
    .slice(0, 100)
    .map((record) => evaluateAgentExperience(graph, record));
  return {
    contract: "witch.agent-experience-overlay/v1",
    sourceRevision: graph.revision,
    included: readings
      .filter((reading) => reading.freshness === "fresh")
      .map((reading) => structuredClone(reading.record))
      .slice(0, 12),
    staleRecordIds: readings
      .filter((reading) => reading.freshness === "stale")
      .map((reading) => reading.record.id)
      .sort(),
    unknownRecordIds: readings
      .filter((reading) => reading.freshness === "unknown")
      .map((reading) => reading.record.id)
      .sort(),
  };
}

const normalizedPath = (value: string) =>
  value.normalize("NFKC").replace(/\\/g, "/").toLocaleLowerCase("en-US");

function changedLineRange(change: GraphImpactChange) {
  const before = (change.before || "").replace(/\r\n/g, "\n").split("\n");
  const after = (change.after || "").replace(/\r\n/g, "\n").split("\n");
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  const start = Math.max(1, prefix + 1);
  return {
    start,
    end: Math.max(start, before.length - suffix),
  };
}

/** Resolve a bounded diff to source-file and nearest source-grounded symbol ids. */
export function resolveChangedGraphNodes(
  graph: ArchitectureGraph,
  changes: GraphImpactChange[],
): ChangedGraphNodeResolution {
  const index = buildGraphIntelligenceIndex(graph);
  const nodeIds = new Set<string>();
  const unresolvedPaths: string[] = [];
  const lineRanges: ChangedGraphNodeResolution["lineRanges"] = [];
  for (const change of changes.slice(0, 500)) {
    const wanted = normalizedPath(change.path);
    const range = changedLineRange(change);
    lineRanges.push({ path: change.path, ...range });
    const candidates = index.nodes.filter(
      (node) =>
        normalizedPath(node.path || "") === wanted ||
        node.evidence.some(
          (evidence) => normalizedPath(evidence.path) === wanted,
        ),
    );
    const files = candidates.filter(
      (node) => node.kind === "file" && node.origin === "source",
    );
    for (const node of files) nodeIds.add(node.id);
    const symbols = candidates
      .filter(
        (node) =>
          node.origin === "semantic" &&
          ["symbol", "workflow-step"].includes(node.kind) &&
          Number.isSafeInteger(node.line),
      )
      .sort(
        (left, right) =>
          left.line! - right.line! || left.id.localeCompare(right.id),
      );
    const within = symbols.filter(
      (node) => node.line! >= range.start && node.line! <= range.end,
    );
    if (within.length) for (const node of within) nodeIds.add(node.id);
    else {
      const preceding = symbols.filter((node) => node.line! <= range.start);
      const ownerLine = Math.max(0, ...preceding.map((node) => node.line!));
      for (const node of preceding)
        if (node.line === ownerLine) nodeIds.add(node.id);
    }
    if (!files.length && !symbols.length) unresolvedPaths.push(change.path);
  }
  return {
    nodeIds: [...nodeIds].sort(),
    unresolvedPaths: [...new Set(unresolvedPaths)].sort(),
    lineRanges,
  };
}

export function createGraphImpactReview(
  graph: ArchitectureGraph,
  changes: GraphImpactChange[],
  maxDepth = 4,
): GraphImpactReviewReceipt {
  const paths = [...new Set(changes.map((change) => change.path))]
    .sort()
    .slice(0, 500);
  const resolution = resolveChangedGraphNodes(graph, changes);
  const impact = analyzeGraphImpact(graph, {
    changedNodeIds: resolution.nodeIds,
    maxDepth,
  });
  const affectedNodes = impact.affected.slice(0, 120).map((node) => ({
    id: node.id,
    label: node.label,
    kind: node.kind,
    ...(node.path ? { path: node.path } : {}),
    depth: node.depth,
    relationPath: node.relationPath.slice(0, 8),
  }));
  const omittedAffected = Math.max(
    0,
    impact.affected.length - affectedNodes.length,
  );
  return {
    contract: "witch.graph-impact-review/v1",
    sourceContract: impact.contract,
    sourceRevision: impact.sourceRevision,
    ...(impact.semanticRevision
      ? { semanticRevision: impact.semanticRevision }
      : {}),
    ...(impact.behaviorRevision
      ? { behaviorRevision: impact.behaviorRevision }
      : {}),
    ...(impact.knowledgeRevision
      ? { knowledgeRevision: impact.knowledgeRevision }
      : {}),
    maxDepth: impact.maxDepth,
    changedPaths: paths,
    changedNodeIds: impact.changed.map((node) => node.id).slice(0, 200),
    affectedCount: impact.affected.length,
    affectedNodes,
    omittedAffected,
    componentIds: impact.components.map((node) => node.id).slice(0, 80),
    workflowIds: impact.workflows.map((node) => node.id).slice(0, 80),
    suggestedTestPaths: impact.suggestedTestPaths.slice(0, 80),
    risk: {
      ...impact.risk,
      reasons: impact.risk.reasons.slice(0, 12),
    },
    unresolvedInputs: [
      ...new Set([...resolution.unresolvedPaths, ...impact.unresolvedInputs]),
    ]
      .sort()
      .slice(0, 200),
    truncated: impact.truncated || omittedAffected > 0,
  };
}
