import type { ArchitectureNode, SourceEvidence } from "./architecture";
import type {
  KnowledgeDiagnostic,
  KnowledgeGraph,
  KnowledgeValidationReceipt,
} from "./knowledge";
import type { SemanticGraph } from "./semantic";

export type KnowledgeGraphDraft = Omit<KnowledgeGraph, "validation">;

const NODE_KINDS = new Set([
  "decision",
  "rfc",
  "manifest",
  "package",
  "dependency",
  "configuration",
  "federation-repository",
  "federation-mapping",
]);
const RELATION_KINDS = new Set([
  "documented-in",
  "declared-in",
  "depends-on",
  "configures",
  "documents",
  "describes",
  "supersedes",
  "evidenced-by",
]);
const TRUST_LEVELS = new Set(["verified", "authored", "inferred"]);
const STATUSES = new Set(["accepted", "provisional", "superseded"]);
const PROVENANCE_SOURCES = new Set([
  "manifest",
  "configuration",
  "architecture-document",
]);

const evidenceKey = (evidence: SourceEvidence) =>
  `${evidence.path}:${String(evidence.line).padStart(12, "0")}:${evidence.hash}:${evidence.excerpt || ""}`;

function push(
  diagnostics: KnowledgeDiagnostic[],
  code: string,
  severity: KnowledgeDiagnostic["severity"],
  subject: string,
  message: string,
) {
  diagnostics.push({ code, severity, subject, message });
}

export function validateKnowledgeGraph(
  graph: KnowledgeGraphDraft | KnowledgeGraph,
  sourceNodes: ArchitectureNode[] = [],
  semantic?: SemanticGraph,
): KnowledgeValidationReceipt {
  const diagnostics = [...graph.diagnostics];
  const sources = new Map(
    sourceNodes
      .filter((node) => node.kind === "file" && node.path)
      .map((node) => [node.path!, node]),
  );
  const endpointIds = new Set([
    ...sourceNodes.map((node) => node.id),
    ...(semantic?.nodes.map((node) => node.id) || []),
  ]);
  const nodeIds = new Set<string>();
  const relationIds = new Set<string>();
  let evidenceCount = 0;

  if (graph.schemaVersion !== 1 || graph.contract !== "witch.knowledge/v1")
    push(
      diagnostics,
      "KNOWLEDGE_SCHEMA_UNSUPPORTED",
      "error",
      "document",
      "Architecture knowledge must use witch.knowledge/v1",
    );
  if (!graph.workspaceRoot || !graph.sourceRevision || !graph.revision)
    push(
      diagnostics,
      "KNOWLEDGE_IDENTITY_MISSING",
      "error",
      "document",
      "Workspace, source, and knowledge revisions are required",
    );
  if (semantic && graph.semanticRevision !== semantic.revision)
    push(
      diagnostics,
      "KNOWLEDGE_SEMANTIC_REVISION_MISMATCH",
      "error",
      "document",
      "Knowledge links were not produced from this semantic revision",
    );
  if (graph.nodes.length > 2_000 || graph.relations.length > 5_000)
    push(
      diagnostics,
      "KNOWLEDGE_BOUND_EXCEEDED",
      "error",
      "document",
      "Knowledge graph exceeds its deterministic safety bound",
    );

  const validateEvidence = (subject: string, evidence: SourceEvidence[]) => {
    if (!evidence.length)
      push(
        diagnostics,
        "KNOWLEDGE_EVIDENCE_MISSING",
        "error",
        subject,
        "Knowledge facts require source evidence",
      );
    for (const item of evidence) {
      evidenceCount++;
      const source = sources.get(item.path);
      if (
        !item.path ||
        !Number.isSafeInteger(item.line) ||
        item.line < 1 ||
        !item.hash
      )
        push(
          diagnostics,
          "KNOWLEDGE_EVIDENCE_INVALID",
          "error",
          subject,
          "Evidence requires a path, positive line, and source hash",
        );
      else if (!source)
        push(
          diagnostics,
          "KNOWLEDGE_EVIDENCE_SOURCE_MISSING",
          "error",
          subject,
          `Evidence source ${item.path} is outside the architecture graph`,
        );
      else if (source.hash !== item.hash)
        push(
          diagnostics,
          "KNOWLEDGE_EVIDENCE_HASH_MISMATCH",
          "error",
          subject,
          `Evidence for ${item.path} is stale`,
        );
    }
  };

  for (const node of graph.nodes) {
    if (!node.id || nodeIds.has(node.id))
      push(
        diagnostics,
        "KNOWLEDGE_NODE_ID_INVALID",
        "error",
        node.id || "node",
        "Knowledge node ids must be present and unique",
      );
    nodeIds.add(node.id);
    endpointIds.add(node.id);
    if (!NODE_KINDS.has(node.kind))
      push(
        diagnostics,
        "KNOWLEDGE_NODE_KIND_INVALID",
        "error",
        node.id,
        `Unsupported knowledge node kind: ${node.kind}`,
      );
    if (!TRUST_LEVELS.has(node.trust) || !STATUSES.has(node.status))
      push(
        diagnostics,
        "KNOWLEDGE_NODE_STATE_INVALID",
        "error",
        node.id,
        "Knowledge trust and status must use the v1 vocabulary",
      );
    if (
      !PROVENANCE_SOURCES.has(node.provenance?.source) ||
      !node.provenance?.extractor ||
      !node.provenance?.ruleId
    )
      push(
        diagnostics,
        "KNOWLEDGE_PROVENANCE_INVALID",
        "error",
        node.id,
        "Knowledge provenance requires a supported source, extractor, and rule id",
      );
    if (!node.label.trim() || node.label.length > 500)
      push(
        diagnostics,
        "KNOWLEDGE_NODE_LABEL_INVALID",
        "error",
        node.id,
        "Knowledge labels must be present and bounded",
      );
    if (
      !Number.isFinite(node.confidence) ||
      node.confidence < 0 ||
      node.confidence > 1
    )
      push(
        diagnostics,
        "KNOWLEDGE_CONFIDENCE_INVALID",
        "error",
        node.id,
        "Knowledge confidence must be between zero and one",
      );
    const repositoryKeyValid = (value: unknown) =>
      typeof value === "string" && /^[a-z0-9][a-z0-9._/-]{0,127}$/i.test(value);
    if (
      node.kind === "federation-repository" &&
      (!repositoryKeyValid(node.repositoryKey) ||
        node.repositoryKey !== node.label ||
        node.providerRepositoryKey !== undefined ||
        node.ecosystem !== undefined)
    )
      push(
        diagnostics,
        "KNOWLEDGE_FEDERATION_REPOSITORY_INVALID",
        "error",
        node.id,
        "Federation repository knowledge requires one matching stable repository key",
      );
    if (
      node.kind === "federation-mapping" &&
      (!repositoryKeyValid(node.providerRepositoryKey) ||
        node.repositoryKey !== undefined ||
        !node.ecosystem)
    )
      push(
        diagnostics,
        "KNOWLEDGE_FEDERATION_MAPPING_INVALID",
        "error",
        node.id,
        "Federation mapping knowledge requires an ecosystem and stable provider key",
      );
    if (
      node.kind !== "federation-repository" &&
      node.kind !== "federation-mapping" &&
      (node.repositoryKey !== undefined ||
        node.providerRepositoryKey !== undefined)
    )
      push(
        diagnostics,
        "KNOWLEDGE_FEDERATION_FIELD_INVALID",
        "error",
        node.id,
        "Federation identity fields are reserved for federation knowledge nodes",
      );
    for (const value of Object.values(node.rationale || {}))
      if (value.length > 600)
        push(
          diagnostics,
          "KNOWLEDGE_RATIONALE_UNBOUNDED",
          "error",
          node.id,
          "Rationale fields must be at most 600 characters",
        );
    validateEvidence(node.id, node.evidence);
  }

  for (const relation of graph.relations) {
    if (!relation.id || relationIds.has(relation.id))
      push(
        diagnostics,
        "KNOWLEDGE_RELATION_ID_INVALID",
        "error",
        relation.id || "relation",
        "Knowledge relation ids must be present and unique",
      );
    relationIds.add(relation.id);
    if (!RELATION_KINDS.has(relation.kind))
      push(
        diagnostics,
        "KNOWLEDGE_RELATION_KIND_INVALID",
        "error",
        relation.id,
        `Unsupported knowledge relation kind: ${relation.kind}`,
      );
    if (!TRUST_LEVELS.has(relation.trust) || !STATUSES.has(relation.status))
      push(
        diagnostics,
        "KNOWLEDGE_RELATION_STATE_INVALID",
        "error",
        relation.id,
        "Knowledge trust and status must use the v1 vocabulary",
      );
    if (
      !PROVENANCE_SOURCES.has(relation.provenance?.source) ||
      !relation.provenance?.extractor ||
      !relation.provenance?.ruleId
    )
      push(
        diagnostics,
        "KNOWLEDGE_PROVENANCE_INVALID",
        "error",
        relation.id,
        "Knowledge provenance requires a supported source, extractor, and rule id",
      );
    if (!endpointIds.has(relation.from) || !endpointIds.has(relation.to))
      push(
        diagnostics,
        "KNOWLEDGE_ENDPOINT_MISSING",
        "error",
        relation.id,
        "Knowledge relation endpoints must exist in source, semantic, or knowledge IR",
      );
    if (
      !Number.isFinite(relation.confidence) ||
      relation.confidence < 0 ||
      relation.confidence > 1
    )
      push(
        diagnostics,
        "KNOWLEDGE_CONFIDENCE_INVALID",
        "error",
        relation.id,
        "Knowledge confidence must be between zero and one",
      );
    validateEvidence(relation.id, relation.evidence);
  }

  diagnostics.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.subject.localeCompare(right.subject) ||
      left.message.localeCompare(right.message),
  );
  return {
    contract: "witch.knowledge/v1",
    valid: !diagnostics.some((item) => item.severity === "error"),
    revision: graph.revision,
    nodeCount: graph.nodes.length,
    relationCount: graph.relations.length,
    decisionCount: graph.nodes.filter(
      (node) => node.kind === "decision" || node.kind === "rfc",
    ).length,
    packageCount: graph.nodes.filter(
      (node) => node.kind === "package" || node.kind === "dependency",
    ).length,
    configurationCount: graph.nodes.filter(
      (node) => node.kind === "configuration" || node.kind === "manifest",
    ).length,
    evidenceCount,
    diagnostics,
  };
}

export function finalizeKnowledgeGraph(
  draft: KnowledgeGraphDraft,
  sourceNodes: ArchitectureNode[],
  semantic?: SemanticGraph,
): KnowledgeGraph {
  const graph: KnowledgeGraphDraft = {
    ...draft,
    nodes: [...draft.nodes]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((node) => ({
        ...node,
        evidence: [...node.evidence].sort((left, right) =>
          evidenceKey(left).localeCompare(evidenceKey(right)),
        ),
      })),
    relations: [...draft.relations]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((relation) => ({
        ...relation,
        evidence: [...relation.evidence].sort((left, right) =>
          evidenceKey(left).localeCompare(evidenceKey(right)),
        ),
      })),
    diagnostics: [...draft.diagnostics],
  };
  const validation = validateKnowledgeGraph(graph, sourceNodes, semantic);
  if (!validation.valid) {
    const details = validation.diagnostics
      .filter((item) => item.severity === "error")
      .slice(0, 8)
      .map((item) => `${item.code} (${item.subject}): ${item.message}`)
      .join("; ");
    throw new Error(`Knowledge IR validation failed: ${details}`);
  }
  return { ...graph, validation };
}
