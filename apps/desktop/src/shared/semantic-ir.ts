import type { ArchitectureNode, SourceEvidence } from "./architecture";
import type {
  SemanticClaim,
  SemanticDiagnostic,
  SemanticGraph,
  SemanticOpenQuestion,
  SemanticValidationReceipt,
} from "./semantic";

export type SemanticGraphDraft = Omit<SemanticGraph, "validation">;

const evidenceKey = (evidence: SourceEvidence) =>
  `${evidence.path}:${evidence.line}:${evidence.endLine || evidence.line}:${evidence.hash}:${evidence.excerpt || ""}`;

function diagnostic(
  diagnostics: SemanticDiagnostic[],
  code: string,
  severity: SemanticDiagnostic["severity"],
  subject: string,
  message: string,
) {
  diagnostics.push({ code, severity, subject, message });
}

function validConfidence(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function validateEvidence(
  diagnostics: SemanticDiagnostic[],
  subject: string,
  evidence: SourceEvidence[],
  sources: Map<string, ArchitectureNode>,
) {
  for (const item of evidence) {
    if (
      !item.path ||
      !Number.isSafeInteger(item.line) ||
      item.line < 1 ||
      !item.hash
    )
      diagnostic(
        diagnostics,
        "SEMANTIC_EVIDENCE_INVALID",
        "error",
        subject,
        "Evidence requires a path, positive line, and content hash",
      );
    const source = sources.get(item.path);
    if (sources.size && !source)
      diagnostic(
        diagnostics,
        "SEMANTIC_EVIDENCE_SOURCE_MISSING",
        "error",
        subject,
        `Evidence source ${item.path} is not in the architecture graph`,
      );
    else if (source?.hash && source.hash !== item.hash)
      diagnostic(
        diagnostics,
        "SEMANTIC_EVIDENCE_HASH_MISMATCH",
        "error",
        subject,
        `Evidence for ${item.path} is stale`,
      );
  }
}

export function validateSemanticGraph(
  graph: SemanticGraphDraft | SemanticGraph,
  sourceNodes: ArchitectureNode[] = [],
): SemanticValidationReceipt {
  const diagnostics: SemanticDiagnostic[] = [];
  const sources = new Map(
    sourceNodes
      .filter((node) => node.kind === "file" && node.path)
      .map((node) => [node.path!, node]),
  );
  const nodes = new Set<string>();
  const relations = new Set<string>();
  const claims = new Set<string>();
  let verifiedCount = 0;
  let provisionalCount = 0;
  let evidenceCount = 0;

  if (graph.schemaVersion !== 1 || graph.contract !== "witch.semantic/v1")
    diagnostic(
      diagnostics,
      "SEMANTIC_SCHEMA_UNSUPPORTED",
      "error",
      "document",
      "The semantic graph must use witch.semantic/v1",
    );
  if (!graph.workspaceRoot || !graph.sourceRevision || !graph.revision)
    diagnostic(
      diagnostics,
      "SEMANTIC_IDENTITY_MISSING",
      "error",
      "document",
      "Workspace, source revision, and semantic revision are required",
    );

  for (const node of graph.nodes) {
    if (!node.id || nodes.has(node.id))
      diagnostic(
        diagnostics,
        node.id ? "SEMANTIC_NODE_DUPLICATE" : "SEMANTIC_NODE_ID_MISSING",
        "error",
        node.id || "node",
        "Semantic node ids must be present and unique",
      );
    nodes.add(node.id);
    if (!validConfidence(node.confidence))
      diagnostic(
        diagnostics,
        "SEMANTIC_CONFIDENCE_INVALID",
        "error",
        node.id,
        "Confidence must be between zero and one",
      );
    if (node.trust === "verified" && node.status !== "accepted")
      diagnostic(
        diagnostics,
        "SEMANTIC_VERIFIED_STATUS_INVALID",
        "error",
        node.id,
        "Verified facts must be accepted",
      );
    if (node.trust === "inferred" && node.status === "accepted")
      diagnostic(
        diagnostics,
        "SEMANTIC_INFERENCE_NOT_PROVISIONAL",
        "error",
        node.id,
        "Inferred nodes cannot silently become accepted facts",
      );
    if (node.trust === "verified") verifiedCount++;
    if (node.status === "provisional" || node.status === "conflicting")
      provisionalCount++;
    evidenceCount += node.evidence.length;
    validateEvidence(diagnostics, node.id, node.evidence, sources);
  }

  for (const relation of graph.relations) {
    if (!relation.id || relations.has(relation.id))
      diagnostic(
        diagnostics,
        relation.id
          ? "SEMANTIC_RELATION_DUPLICATE"
          : "SEMANTIC_RELATION_ID_MISSING",
        "error",
        relation.id || "relation",
        "Semantic relation ids must be present and unique",
      );
    relations.add(relation.id);
    if (!nodes.has(relation.from) || !nodes.has(relation.to))
      diagnostic(
        diagnostics,
        "SEMANTIC_RELATION_ENDPOINT_MISSING",
        "error",
        relation.id,
        "Semantic relations must connect existing nodes",
      );
    if (!validConfidence(relation.confidence))
      diagnostic(
        diagnostics,
        "SEMANTIC_CONFIDENCE_INVALID",
        "error",
        relation.id,
        "Confidence must be between zero and one",
      );
    if (relation.trust === "verified" && relation.status !== "accepted")
      diagnostic(
        diagnostics,
        "SEMANTIC_VERIFIED_STATUS_INVALID",
        "error",
        relation.id,
        "Verified facts must be accepted",
      );
    if (relation.trust === "verified") verifiedCount++;
    if (relation.status === "provisional" || relation.status === "conflicting")
      provisionalCount++;
    evidenceCount += relation.evidence.length;
    validateEvidence(diagnostics, relation.id, relation.evidence, sources);
  }

  for (const claim of graph.claims) {
    if (!claim.id || claims.has(claim.id))
      diagnostic(
        diagnostics,
        claim.id ? "SEMANTIC_CLAIM_DUPLICATE" : "SEMANTIC_CLAIM_ID_MISSING",
        "error",
        claim.id || "claim",
        "Semantic claim ids must be present and unique",
      );
    claims.add(claim.id);
    if (!nodes.has(claim.subjectId))
      diagnostic(
        diagnostics,
        "SEMANTIC_CLAIM_SUBJECT_MISSING",
        "error",
        claim.id,
        `Claim subject ${claim.subjectId} does not exist`,
      );
    if (!claim.value.trim() || !claim.reason.trim())
      diagnostic(
        diagnostics,
        "SEMANTIC_CLAIM_EMPTY",
        "error",
        claim.id,
        "Claims require a value and reason",
      );
    if (!validConfidence(claim.confidence))
      diagnostic(
        diagnostics,
        "SEMANTIC_CONFIDENCE_INVALID",
        "error",
        claim.id,
        "Confidence must be between zero and one",
      );
    if (claim.trust === "inferred" && claim.status === "accepted")
      diagnostic(
        diagnostics,
        "SEMANTIC_INFERENCE_NOT_PROVISIONAL",
        "error",
        claim.id,
        "Inferred claims cannot silently become accepted facts",
      );
    if (claim.trust === "verified") verifiedCount++;
    if (claim.status === "provisional" || claim.status === "conflicting")
      provisionalCount++;
    evidenceCount += claim.evidence.length;
    validateEvidence(diagnostics, claim.id, claim.evidence, sources);
  }

  const questionIds = new Set<string>();
  for (const question of graph.questions) {
    if (!question.id || questionIds.has(question.id))
      diagnostic(
        diagnostics,
        question.id
          ? "SEMANTIC_QUESTION_DUPLICATE"
          : "SEMANTIC_QUESTION_ID_MISSING",
        "error",
        question.id || "question",
        "Question ids must be present and unique",
      );
    questionIds.add(question.id);
    if (!nodes.has(question.subjectId))
      diagnostic(
        diagnostics,
        "SEMANTIC_QUESTION_SUBJECT_MISSING",
        "error",
        question.id,
        "Question subject does not exist",
      );
    if (question.claimIds.some((id) => !claims.has(id)))
      diagnostic(
        diagnostics,
        "SEMANTIC_QUESTION_CLAIM_MISSING",
        "error",
        question.id,
        "Question references an unknown claim",
      );
    if (!question.recommendation || question.options.length < 2)
      diagnostic(
        diagnostics,
        "SEMANTIC_QUESTION_OPTIONS_INVALID",
        "error",
        question.id,
        "Open questions require a recommendation and at least two options",
      );
    evidenceCount += question.evidence.length;
    validateEvidence(diagnostics, question.id, question.evidence, sources);
  }

  diagnostics.sort(
    (a, b) =>
      a.severity.localeCompare(b.severity) ||
      a.code.localeCompare(b.code) ||
      a.subject.localeCompare(b.subject) ||
      a.message.localeCompare(b.message),
  );
  return {
    contract: "witch.semantic/v1",
    valid: !diagnostics.some((item) => item.severity === "error"),
    revision: graph.revision,
    nodeCount: graph.nodes.length,
    relationCount: graph.relations.length,
    claimCount: graph.claims.length,
    questionCount: graph.questions.length,
    verifiedCount,
    provisionalCount,
    evidenceCount,
    diagnostics,
  };
}

const sortEvidence = (evidence: SourceEvidence[]) =>
  [...evidence].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b)));

export function finalizeSemanticGraph(
  draft: SemanticGraphDraft,
  sourceNodes: ArchitectureNode[] = [],
): SemanticGraph {
  const graph: SemanticGraphDraft = {
    ...draft,
    nodes: [...draft.nodes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((node) => ({ ...node, evidence: sortEvidence(node.evidence) })),
    relations: [...draft.relations]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((relation) => ({
        ...relation,
        evidence: sortEvidence(relation.evidence),
      })),
    claims: [...draft.claims]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((claim) => ({ ...claim, evidence: sortEvidence(claim.evidence) })),
    questions: [...draft.questions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((question) => ({
        ...question,
        claimIds: [...new Set(question.claimIds)].sort(),
        options: [...new Set(question.options)],
        evidence: sortEvidence(question.evidence),
      })),
    revisions: [...draft.revisions]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-25)
      .map((revision) => ({
        ...revision,
        changedIds: [...new Set(revision.changedIds)].sort(),
      })),
  };
  const validation = validateSemanticGraph(graph, sourceNodes);
  if (!validation.valid) {
    const details = validation.diagnostics
      .filter((item) => item.severity === "error")
      .slice(0, 8)
      .map((item) => `${item.code} (${item.subject}): ${item.message}`)
      .join("; ");
    throw new Error(`Semantic IR validation failed: ${details}`);
  }
  return { ...graph, validation };
}

export function reconcileSemanticClaims(
  inferred: SemanticClaim[],
  authored: SemanticClaim[],
): { claims: SemanticClaim[]; questions: SemanticOpenQuestion[] } {
  const claims = inferred.map((claim) => ({ ...claim }));
  const questions: SemanticOpenQuestion[] = [];
  const index = new Map(
    claims.map((claim) => [`${claim.subjectId}:${claim.key}`, claim]),
  );
  for (const authoredClaim of authored) {
    const key = `${authoredClaim.subjectId}:${authoredClaim.key}`;
    const inferredClaim = index.get(key);
    if (!inferredClaim) {
      claims.push(authoredClaim);
      continue;
    }
    if (inferredClaim.value.trim() === authoredClaim.value.trim()) {
      inferredClaim.status = "corroborated";
      claims.push({ ...authoredClaim, status: "corroborated" });
      continue;
    }
    inferredClaim.status = "conflicting";
    claims.push({ ...authoredClaim, status: "conflicting" });
    questions.push({
      id: `question:${inferredClaim.id}:${authoredClaim.id}`,
      subjectId: inferredClaim.subjectId,
      claimIds: [inferredClaim.id, authoredClaim.id],
      prompt: `The inferred ${inferredClaim.key} conflicts with the authored description. Which should define the active model?`,
      recommendation: inferredClaim.value,
      options: [inferredClaim.value, authoredClaim.value],
      status: "open",
      evidence: [...inferredClaim.evidence, ...authoredClaim.evidence],
    });
  }
  return { claims, questions };
}
