import type { ArchitectureGraph, SourceEvidence } from "./architecture";
import { buildArchitectureMetaGraph } from "./graph-meta";

export type FederationCandidate = {
  workspaceRoot: string;
  workspaceName: string;
  snapshotId: string;
  sourceRevision: string;
  generatedAt: string;
  lastOpenedAt: string;
  nodeCount: number;
  edgeCount: number;
};

export type FederationInput = {
  graph: ArchitectureGraph;
  workspaceName?: string;
  snapshotId?: string;
  role: "active" | "snapshot";
};

export type FederationRepository = {
  id: string;
  workspaceRoot: string;
  workspaceName: string;
  role: "active" | "snapshot";
  snapshotId?: string;
  sourceRevision: string;
  semanticRevision?: string;
  behaviorRevision?: string;
  knowledgeRevision?: string;
  metaRevision: string;
  repositoryKey?: string;
  generatedAt: string;
  counts: {
    files: number;
    components: number;
    workflows: number;
    symbols: number;
    packages: number;
    dependencies: number;
    communities: number;
  };
  packageNames: string[];
  dependencyNames: string[];
  topCommunities: Array<{
    id: string;
    label: string;
    memberCount: number;
    sourcePaths: string[];
  }>;
};

export type FederationEvidence = SourceEvidence & {
  repositoryId: string;
  role: "dependency-declaration" | "package-declaration";
};

export type FederationLink = {
  id: string;
  from: string;
  to: string;
  kind: "depends-on";
  ecosystem: "npm" | "python" | "cargo";
  packageName: string;
  trust: "inferred" | "authored";
  status: "provisional" | "conflicting" | "resolved";
  confidence: number;
  resolutionSource?: "repository-manifest" | "user-approval";
  resolutionId?: string;
  evidence: FederationEvidence[];
};

export type FederationQuestion = {
  id: string;
  kind: "ambiguous-provider" | "authored-mismatch";
  subjectRepositoryId: string;
  ecosystem: "npm" | "python" | "cargo";
  packageName: string;
  prompt: string;
  recommendation: string;
  candidateRepositoryIds: string[];
  authoredProviderKeys?: string[];
  status: "open";
};

export type FederationApproval = {
  contract: "witch.federation-approval/v1";
  id: string;
  decision: "approve-provider";
  questionId: string;
  federationRevision: string;
  subjectWorkspaceRoot: string;
  subjectSourceRevision: string;
  providerWorkspaceRoot: string;
  providerSourceRevision: string;
  ecosystem: "npm" | "python" | "cargo";
  packageName: string;
  decidedAt: string;
};

export type FederationApprovalRequest = {
  snapshotIds: string[];
  federationRevision: string;
  questionId: string;
  providerRepositoryId: string;
};

export type FederationApprovalHistoryEntry = {
  approval: FederationApproval;
  status: "active" | "revoked";
  revokedAt?: string;
};

export type FederationDiagnostic = {
  code: string;
  severity: "error" | "warning";
  subject: string;
  message: string;
};

export type FederationValidation = {
  contract: "witch.graph-federation/v1";
  valid: boolean;
  revision: string;
  repositoryCount: number;
  linkCount: number;
  questionCount: number;
  evidenceCount: number;
  diagnostics: FederationDiagnostic[];
};

export type ArchitectureFederation = {
  contract: "witch.graph-federation/v1";
  algorithm: "exact-package-identity-v1";
  revision: string;
  generatedAt: string;
  repositories: FederationRepository[];
  links: FederationLink[];
  questions: FederationQuestion[];
  approvals: FederationApproval[];
  diagnostics: FederationDiagnostic[];
  validation: FederationValidation;
};

const MAX_REPOSITORIES = 12;
const MAX_LINKS = 500;
const MAX_EVIDENCE_PER_LINK = 12;
const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function canonicalIsoTime(value: string) {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function hash(value: string) {
  let result = 0x811c9dc5;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function revision(value: string) {
  return `federation-${["0", "1", "2", "3"]
    .map((salt) => hash(`${salt}\0${value}`))
    .join("")}`;
}

function repositoryId(root: string) {
  return `repository:${revision(root.replaceAll("\\", "/").toLowerCase()).slice(11)}`;
}

function normalizedPackage(
  value: string,
  ecosystem: FederationLink["ecosystem"],
) {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  // PEP 503 equates runs of hyphen, underscore, and dot. npm and Cargo
  // identities retain those separators, so a visually similar name cannot
  // become a cross-repository link in those ecosystems.
  return ecosystem === "python"
    ? normalized.replace(/[-_.]+/g, "-")
    : normalized;
}

function packageKey(ecosystem: FederationLink["ecosystem"], name: string) {
  return `${ecosystem}:${normalizedPackage(name, ecosystem)}`;
}

function diagnostic(
  diagnostics: FederationDiagnostic[],
  code: string,
  severity: FederationDiagnostic["severity"],
  subject: string,
  message: string,
) {
  diagnostics.push({ code, severity, subject, message });
}

function graphHashes(graph: ArchitectureGraph) {
  return new Map(
    graph.nodes
      .filter((node) => node.kind === "file" && node.path)
      .map((node) => [node.path!, node.hash]),
  );
}

function declarationEvidenceKey(
  repositoryId: string,
  kind: "package" | "dependency",
  ecosystem: FederationLink["ecosystem"],
  packageName: string,
  evidence: SourceEvidence,
) {
  return [
    repositoryId,
    kind,
    ecosystem,
    normalizedPackage(packageName, ecosystem),
    evidence.path,
    evidence.line,
    evidence.hash,
  ].join("\0");
}

function federationRevision(input: {
  repositories: FederationRepository[];
  links: FederationLink[];
  questions: FederationQuestion[];
  approvals: FederationApproval[];
}) {
  return revision(JSON.stringify(input));
}

export function validateArchitectureFederation(
  federation:
    Omit<ArchitectureFederation, "validation"> | ArchitectureFederation,
  inputs: FederationInput[],
): FederationValidation {
  const diagnostics = [...federation.diagnostics];
  const repositories = new Map(
    federation.repositories.map((repository) => [repository.id, repository]),
  );
  const inputByRepository = new Map(
    inputs.map((input) => [repositoryId(input.graph.workspaceRoot), input]),
  );
  const hashesByRepository = new Map(
    inputs.map((input) => [
      repositoryId(input.graph.workspaceRoot),
      graphHashes(input.graph),
    ]),
  );
  const declarationEvidence = new Set<string>();
  for (const input of inputs) {
    const id = repositoryId(input.graph.workspaceRoot);
    for (const node of input.graph.knowledge?.nodes || [])
      if (
        (node.kind === "package" || node.kind === "dependency") &&
        node.ecosystem
      )
        for (const evidence of node.evidence)
          declarationEvidence.add(
            declarationEvidenceKey(
              id,
              node.kind,
              node.ecosystem,
              node.label,
              evidence,
            ),
          );
  }
  const ids = new Set<string>();
  const roots = new Set<string>();
  const linkIds = new Set<string>();
  let evidenceCount = 0;
  if (federation.contract !== "witch.graph-federation/v1")
    diagnostic(
      diagnostics,
      "FEDERATION_CONTRACT_INVALID",
      "error",
      "document",
      "Federation must use witch.graph-federation/v1.",
    );
  if (
    federation.repositories.length < 1 ||
    federation.repositories.length > MAX_REPOSITORIES ||
    federation.links.length > MAX_LINKS
  )
    diagnostic(
      diagnostics,
      "FEDERATION_BOUND_EXCEEDED",
      "error",
      "document",
      "Federation exceeds its repository or link safety bound.",
    );
  if (
    federation.repositories.filter((repository) => repository.role === "active")
      .length !== 1
  )
    diagnostic(
      diagnostics,
      "FEDERATION_ACTIVE_REPOSITORY_INVALID",
      "error",
      "document",
      "Federation requires exactly one active repository.",
    );
  const expectedRevision = federationRevision({
    repositories: federation.repositories,
    links: federation.links,
    questions: federation.questions,
    approvals: federation.approvals,
  });
  if (expectedRevision !== federation.revision)
    diagnostic(
      diagnostics,
      "FEDERATION_REVISION_MISMATCH",
      "error",
      "document",
      "Federation content does not match its deterministic revision.",
    );
  for (const repository of federation.repositories) {
    const input = inputByRepository.get(repository.id);
    const inputRepositoryKeys = [
      ...new Set(
        (input?.graph.knowledge?.nodes || [])
          .filter(
            (node) =>
              node.kind === "federation-repository" && node.repositoryKey,
          )
          .map((node) => node.repositoryKey!),
      ),
    ].sort();
    const expectedRepositoryKey =
      inputRepositoryKeys.length === 1 ? inputRepositoryKeys[0] : undefined;
    if (
      ids.has(repository.id) ||
      roots.has(repository.workspaceRoot) ||
      !input ||
      input.graph.workspaceRoot !== repository.workspaceRoot
    )
      diagnostic(
        diagnostics,
        "FEDERATION_REPOSITORY_INVALID",
        "error",
        repository.id,
        "Repositories require unique ids, unique roots, and a matching validated input.",
      );
    ids.add(repository.id);
    roots.add(repository.workspaceRoot);
    if (
      input &&
      (repository.sourceRevision !== input.graph.revision ||
        repository.semanticRevision !== input.graph.semantic?.revision ||
        repository.behaviorRevision !== input.graph.behavior?.revision ||
        repository.knowledgeRevision !== input.graph.knowledge?.revision ||
        repository.metaRevision !==
          buildArchitectureMetaGraph(input.graph).revision ||
        repository.role !== input.role ||
        repository.snapshotId !== input.snapshotId ||
        repository.repositoryKey !== expectedRepositoryKey)
    )
      diagnostic(
        diagnostics,
        "FEDERATION_REPOSITORY_STALE",
        "error",
        repository.id,
        "A repository summary is not bound to its exact graph revisions.",
      );
  }
  for (const link of federation.links) {
    if (!link.id || linkIds.has(link.id))
      diagnostic(
        diagnostics,
        "FEDERATION_LINK_ID_INVALID",
        "error",
        link.id || "link",
        "Federation link ids must be present and unique.",
      );
    linkIds.add(link.id);
    if (
      !repositories.has(link.from) ||
      !repositories.has(link.to) ||
      link.from === link.to ||
      !link.packageName
    )
      diagnostic(
        diagnostics,
        "FEDERATION_LINK_INVALID",
        "error",
        link.id,
        "Federation links require distinct repository endpoints and a package identity.",
      );
    const resolutionNode = inputByRepository
      .get(link.from)
      ?.graph.knowledge?.nodes.find((node) => node.id === link.resolutionId);
    const targetRepository = repositories.get(link.to);
    const manifestResolutionValid =
      link.resolutionSource === "repository-manifest" &&
      resolutionNode?.kind === "federation-mapping" &&
      resolutionNode.ecosystem === link.ecosystem &&
      normalizedPackage(resolutionNode.label, link.ecosystem) ===
        normalizedPackage(link.packageName, link.ecosystem) &&
      resolutionNode.providerRepositoryKey === targetRepository?.repositoryKey;
    const approval = federation.approvals.find(
      (candidate) => candidate.id === link.resolutionId,
    );
    const sourceRepository = repositories.get(link.from);
    const approvalResolutionValid =
      link.resolutionSource === "user-approval" &&
      approval?.contract === "witch.federation-approval/v1" &&
      approval.decision === "approve-provider" &&
      approval.questionId &&
      approval.subjectWorkspaceRoot === sourceRepository?.workspaceRoot &&
      approval.subjectSourceRevision === sourceRepository?.sourceRevision &&
      approval.providerWorkspaceRoot === targetRepository?.workspaceRoot &&
      approval.providerSourceRevision === targetRepository?.sourceRevision &&
      approval.ecosystem === link.ecosystem &&
      normalizedPackage(approval.packageName, approval.ecosystem) ===
        normalizedPackage(link.packageName, link.ecosystem);
    if (
      (link.status === "resolved" &&
        (link.trust !== "authored" ||
          !link.resolutionId ||
          (!manifestResolutionValid && !approvalResolutionValid))) ||
      (link.status !== "resolved" &&
        (link.resolutionId !== undefined ||
          link.resolutionSource !== undefined)) ||
      !["provisional", "conflicting", "resolved"].includes(link.status) ||
      !["inferred", "authored"].includes(link.trust)
    )
      diagnostic(
        diagnostics,
        "FEDERATION_LINK_RESOLUTION_INVALID",
        "error",
        link.id,
        "Resolved links require an exact source-authored mapping or revision-bound explicit approval.",
      );
    if (!link.evidence.length || link.evidence.length > MAX_EVIDENCE_PER_LINK)
      diagnostic(
        diagnostics,
        "FEDERATION_EVIDENCE_INVALID",
        "error",
        link.id,
        "A federation link requires bounded evidence from both repositories.",
      );
    const roles = new Set(link.evidence.map((item) => item.role));
    if (
      !roles.has("dependency-declaration") ||
      !roles.has("package-declaration")
    )
      diagnostic(
        diagnostics,
        "FEDERATION_EVIDENCE_ROLE_MISSING",
        "error",
        link.id,
        "Both dependency and target package declarations are required.",
      );
    for (const evidence of link.evidence) {
      evidenceCount++;
      const input = inputByRepository.get(evidence.repositoryId);
      const expectedRepositoryId =
        evidence.role === "dependency-declaration" ? link.from : link.to;
      const expectedKind =
        evidence.role === "dependency-declaration" ? "dependency" : "package";
      if (
        !input ||
        evidence.repositoryId !== expectedRepositoryId ||
        hashesByRepository.get(evidence.repositoryId)?.get(evidence.path) !==
          evidence.hash ||
        !Number.isSafeInteger(evidence.line) ||
        evidence.line < 1 ||
        !declarationEvidence.has(
          declarationEvidenceKey(
            evidence.repositoryId,
            expectedKind,
            link.ecosystem,
            link.packageName,
            evidence,
          ),
        )
      )
        diagnostic(
          diagnostics,
          "FEDERATION_EVIDENCE_STALE",
          "error",
          link.id,
          `Federated evidence for ${evidence.path} is missing or stale.`,
        );
    }
  }
  const approvalIds = new Set<string>();
  for (const approval of federation.approvals) {
    if (
      approval.contract !== "witch.federation-approval/v1" ||
      approval.decision !== "approve-provider" ||
      !approval.id ||
      !UUID.test(approval.id) ||
      approvalIds.has(approval.id) ||
      !approval.questionId ||
      !approval.federationRevision ||
      !canonicalIsoTime(approval.decidedAt) ||
      !federation.links.some(
        (link) =>
          link.status === "resolved" &&
          link.resolutionSource === "user-approval" &&
          link.resolutionId === approval.id,
      )
    )
      diagnostic(
        diagnostics,
        "FEDERATION_APPROVAL_INVALID",
        "error",
        approval.id || "approval",
        "Applied approvals must be unique, complete, and bound to one resolved link.",
      );
    approvalIds.add(approval.id);
  }
  for (const question of federation.questions) {
    const candidates = [...new Set(question.candidateRepositoryIds)].sort();
    if (
      !repositories.has(question.subjectRepositoryId) ||
      candidates.some((id) => !repositories.has(id)) ||
      (question.kind === "ambiguous-provider" && candidates.length < 2) ||
      (question.kind === "authored-mismatch" &&
        !question.authoredProviderKeys?.length)
    )
      diagnostic(
        diagnostics,
        "FEDERATION_QUESTION_INVALID",
        "error",
        question.id,
        "Federation questions require a valid source, bounded candidates, and authored keys for mapping mismatches.",
      );
  }
  if (federation.repositories.length === 1)
    diagnostic(
      diagnostics,
      "FEDERATION_SINGLE_REPOSITORY",
      "warning",
      federation.repositories[0]?.id || "document",
      "Select at least one snapshot-backed repository to compare system boundaries.",
    );
  diagnostics.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.subject.localeCompare(right.subject) ||
      left.message.localeCompare(right.message),
  );
  return {
    contract: "witch.graph-federation/v1",
    valid: !diagnostics.some((item) => item.severity === "error"),
    revision: federation.revision,
    repositoryCount: federation.repositories.length,
    linkCount: federation.links.length,
    questionCount: federation.questions.length,
    evidenceCount,
    diagnostics,
  };
}

/**
 * Federate immutable repository readings without merging their local node id
 * spaces. Cross-repository links are inferred only from exact ecosystem and
 * normalized package identity matches.
 */
export function buildArchitectureFederation(
  rawInputs: FederationInput[],
  options: { approvals?: FederationApproval[] } = {},
): ArchitectureFederation {
  if (!rawInputs.length) throw new Error("Federation requires one graph");
  if (rawInputs.length > MAX_REPOSITORIES)
    throw new Error(
      `Federation supports at most ${MAX_REPOSITORIES} repositories`,
    );
  const inputs = [...rawInputs].sort((left, right) => {
    if (left.role !== right.role) return left.role === "active" ? -1 : 1;
    return left.graph.workspaceRoot.localeCompare(right.graph.workspaceRoot);
  });
  if (inputs.filter((input) => input.role === "active").length !== 1)
    throw new Error("Federation requires exactly one active repository");
  const roots = new Set<string>();
  for (const input of inputs) {
    if (!input.graph.validation.valid)
      throw new Error("Federation requires validated architecture readings");
    if (input.graph.integrity?.status === "fallback")
      throw new Error(
        "Federation cannot use a quarantined architecture reading",
      );
    const key = input.graph.workspaceRoot.toLowerCase();
    if (roots.has(key))
      throw new Error("Federation repository roots must be unique");
    roots.add(key);
  }
  const diagnostics: FederationDiagnostic[] = [];
  const inputById = new Map(
    inputs.map((input) => [repositoryId(input.graph.workspaceRoot), input]),
  );
  const repositories: FederationRepository[] = [];
  const packages = new Map<
    string,
    Array<{
      repositoryId: string;
      label: string;
      evidence: SourceEvidence[];
    }>
  >();
  const dependencies: Array<{
    repositoryId: string;
    ecosystem: "npm" | "python" | "cargo";
    label: string;
    evidence: SourceEvidence[];
  }> = [];
  const repositoryKeys = new Map<string, string[]>();
  const authoredMappings = new Map<
    string,
    Array<{
      id: string;
      ecosystem: "npm" | "python" | "cargo";
      packageName: string;
      providerRepositoryKey: string;
    }>
  >();

  for (const input of inputs) {
    const graph = input.graph;
    const id = repositoryId(graph.workspaceRoot);
    const meta = buildArchitectureMetaGraph(graph);
    const metaNodes = new Map(meta.nodes.map((node) => [node.id, node]));
    const metaRoot = metaNodes.get(meta.rootId)!;
    const packageNodes = (graph.knowledge?.nodes || []).filter(
      (node) =>
        node.kind === "package" &&
        node.ecosystem &&
        !/^requirements(?:[-_.][^/]*)?\.txt$/i.test(
          node.path?.replaceAll("\\", "/").split("/").at(-1) || "",
        ),
    );
    const dependencyNodes = (graph.knowledge?.nodes || []).filter(
      (node) => node.kind === "dependency" && node.ecosystem,
    );
    const keys = [
      ...new Set(
        (graph.knowledge?.nodes || [])
          .filter(
            (node) =>
              node.kind === "federation-repository" && node.repositoryKey,
          )
          .map((node) => node.repositoryKey!),
      ),
    ].sort();
    repositoryKeys.set(id, keys);
    const mappings = (graph.knowledge?.nodes || [])
      .filter(
        (node) =>
          node.kind === "federation-mapping" &&
          node.ecosystem &&
          node.providerRepositoryKey,
      )
      .map((node) => ({
        id: node.id,
        ecosystem: node.ecosystem!,
        packageName: node.label,
        providerRepositoryKey: node.providerRepositoryKey!,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    authoredMappings.set(id, mappings);
    if (keys.length > 1)
      diagnostic(
        diagnostics,
        "FEDERATION_REPOSITORY_KEY_AMBIGUOUS",
        "warning",
        id,
        "Repository declares more than one authored federation identity.",
      );
    for (const node of packageNodes) {
      const key = packageKey(node.ecosystem!, node.label);
      const entries = packages.get(key) || [];
      entries.push({
        repositoryId: id,
        label: node.label,
        evidence: node.evidence,
      });
      packages.set(key, entries);
    }
    for (const node of dependencyNodes)
      dependencies.push({
        repositoryId: id,
        ecosystem: node.ecosystem!,
        label: node.label,
        evidence: node.evidence,
      });
    const semantic = graph.semantic?.nodes || [];
    repositories.push({
      id,
      workspaceRoot: graph.workspaceRoot,
      workspaceName:
        input.workspaceName ||
        graph.workspaceRoot.replaceAll("\\", "/").split("/").at(-1) ||
        "Repository",
      role: input.role,
      ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
      sourceRevision: graph.revision,
      ...(graph.semantic ? { semanticRevision: graph.semantic.revision } : {}),
      ...(graph.behavior ? { behaviorRevision: graph.behavior.revision } : {}),
      ...(graph.knowledge
        ? { knowledgeRevision: graph.knowledge.revision }
        : {}),
      metaRevision: meta.revision,
      ...(keys.length === 1 ? { repositoryKey: keys[0] } : {}),
      generatedAt: graph.generatedAt,
      counts: {
        files: graph.nodes.filter((node) => node.kind === "file").length,
        components: semantic.filter((node) =>
          ["component", "module", "package"].includes(node.kind),
        ).length,
        workflows: semantic.filter((node) => node.kind === "workflow").length,
        symbols: semantic.filter((node) =>
          ["symbol", "workflow-step"].includes(node.kind),
        ).length,
        packages: packageNodes.length,
        dependencies: dependencyNodes.length,
        communities: metaRoot.childIds.length,
      },
      packageNames: packageNodes
        .map((node) => node.label)
        .sort()
        .slice(0, 80),
      dependencyNames: dependencyNodes
        .map((node) => node.label)
        .sort()
        .slice(0, 160),
      topCommunities: metaRoot.childIds
        .map((childId) => metaNodes.get(childId))
        .filter((node): node is NonNullable<typeof node> => Boolean(node))
        .sort(
          (left, right) =>
            right.memberCount - left.memberCount ||
            left.id.localeCompare(right.id),
        )
        .slice(0, 8)
        .map((node) => ({
          id: node.id,
          label: node.label,
          memberCount: node.memberCount,
          sourcePaths: node.sourcePaths.slice(0, 6),
        })),
    });
  }

  const links: FederationLink[] = [];
  const questions: FederationQuestion[] = [];
  const appliedApprovals = new Map<string, FederationApproval>();
  for (const dependency of dependencies.sort(
    (left, right) =>
      left.repositoryId.localeCompare(right.repositoryId) ||
      left.ecosystem.localeCompare(right.ecosystem) ||
      left.label.localeCompare(right.label),
  )) {
    const targets = new Map<string, SourceEvidence[]>();
    for (const target of packages.get(
      packageKey(dependency.ecosystem, dependency.label),
    ) || []) {
      if (target.repositoryId === dependency.repositoryId) continue;
      targets.set(target.repositoryId, [
        ...(targets.get(target.repositoryId) || []),
        ...target.evidence,
      ]);
    }
    const targetIds = [...targets.keys()].sort();
    const matchingMappings = (
      authoredMappings.get(dependency.repositoryId) || []
    ).filter(
      (mapping) =>
        mapping.ecosystem === dependency.ecosystem &&
        normalizedPackage(mapping.packageName, mapping.ecosystem) ===
          normalizedPackage(dependency.label, dependency.ecosystem),
    );
    const authoredProviderKeys = [
      ...new Set(
        matchingMappings.map((mapping) => mapping.providerRepositoryKey),
      ),
    ].sort();
    const authoredTargets = targetIds.filter((targetId) =>
      (repositoryKeys.get(targetId) || []).some((key) =>
        authoredProviderKeys.includes(key),
      ),
    );
    const authoredResolved =
      authoredProviderKeys.length === 1 && authoredTargets.length === 1;
    const sourceInput = inputById.get(dependency.repositoryId)!;
    const expectedQuestionId = `federation-question:${hash(`${dependency.repositoryId}\0${dependency.ecosystem}\0${normalizedPackage(dependency.label, dependency.ecosystem)}`)}`;
    const applicableApprovals = (options.approvals || [])
      .filter(
        (approval) =>
          approval.contract === "witch.federation-approval/v1" &&
          UUID.test(approval.id) &&
          approval.decision === "approve-provider" &&
          approval.questionId === expectedQuestionId &&
          canonicalIsoTime(approval.decidedAt) &&
          approval.subjectWorkspaceRoot === sourceInput.graph.workspaceRoot &&
          approval.subjectSourceRevision === sourceInput.graph.revision &&
          approval.ecosystem === dependency.ecosystem &&
          normalizedPackage(approval.packageName, approval.ecosystem) ===
            normalizedPackage(dependency.label, dependency.ecosystem) &&
          targetIds.some((targetId) => {
            const target = inputById.get(targetId)!;
            return (
              target.graph.workspaceRoot === approval.providerWorkspaceRoot &&
              target.graph.revision === approval.providerSourceRevision
            );
          }),
      )
      .sort(
        (left, right) =>
          right.decidedAt.localeCompare(left.decidedAt) ||
          right.id.localeCompare(left.id),
      );
    const approval = !matchingMappings.length
      ? applicableApprovals[0]
      : undefined;
    const approvedTarget = approval
      ? targetIds.find((targetId) => {
          const target = inputById.get(targetId)!;
          return (
            target.graph.workspaceRoot === approval.providerWorkspaceRoot &&
            target.graph.revision === approval.providerSourceRevision
          );
        })
      : undefined;
    const approvalResolved = Boolean(approval && approvedTarget);
    const questionCandidates = [
      ...new Set([
        ...targetIds,
        ...[...repositoryKeys]
          .filter(([, keys]) =>
            keys.some((key) => authoredProviderKeys.includes(key)),
          )
          .map(([repositoryId]) => repositoryId)
          .filter((repositoryId) => repositoryId !== dependency.repositoryId),
      ]),
    ].sort();
    if (matchingMappings.length && !authoredResolved)
      questions.push({
        id: `federation-question:${hash(`${dependency.repositoryId}\0${dependency.ecosystem}\0${normalizedPackage(dependency.label, dependency.ecosystem)}\0authored`)}`,
        kind: "authored-mismatch",
        subjectRepositoryId: dependency.repositoryId,
        ecosystem: dependency.ecosystem,
        packageName: dependency.label,
        prompt: `Authored provider ${authoredProviderKeys.join(" / ")} does not resolve uniquely for ${dependency.label}.`,
        recommendation:
          "Keep package candidates unresolved until repository identities and the authored mapping agree.",
        candidateRepositoryIds: questionCandidates,
        authoredProviderKeys,
        status: "open",
      });
    else if (!authoredResolved && !approvalResolved && targetIds.length > 1)
      questions.push({
        id: expectedQuestionId,
        kind: "ambiguous-provider",
        subjectRepositoryId: dependency.repositoryId,
        ecosystem: dependency.ecosystem,
        packageName: dependency.label,
        prompt: `Which repository provides ${dependency.label} for this workspace?`,
        recommendation:
          "Keep every exact-name candidate conflicting until an authored federation mapping or explicit approval selects one target.",
        candidateRepositoryIds: targetIds,
        status: "open",
      });
    const visibleTargetIds = authoredResolved
      ? authoredTargets
      : approvalResolved
        ? [approvedTarget!]
        : targetIds;
    if (approvalResolved) appliedApprovals.set(approval!.id, approval!);
    for (const targetId of visibleTargetIds) {
      const evidence: FederationEvidence[] = [
        ...dependency.evidence
          .map((item) => ({
            ...item,
            repositoryId: dependency.repositoryId,
            role: "dependency-declaration" as const,
          }))
          .sort(
            (left, right) =>
              left.path.localeCompare(right.path) || left.line - right.line,
          )
          .slice(0, MAX_EVIDENCE_PER_LINK / 2),
        ...(targets.get(targetId) || [])
          .map((item) => ({
            ...item,
            repositoryId: targetId,
            role: "package-declaration" as const,
          }))
          .sort(
            (left, right) =>
              left.path.localeCompare(right.path) || left.line - right.line,
          )
          .slice(0, MAX_EVIDENCE_PER_LINK / 2),
      ]
        .sort(
          (left, right) =>
            left.repositoryId.localeCompare(right.repositoryId) ||
            left.path.localeCompare(right.path) ||
            left.line - right.line,
        )
        .slice(0, MAX_EVIDENCE_PER_LINK);
      links.push({
        id: `federation-link:${hash(`${dependency.repositoryId}\0${targetId}\0${dependency.ecosystem}\0${normalizedPackage(dependency.label, dependency.ecosystem)}`)}`,
        from: dependency.repositoryId,
        to: targetId,
        kind: "depends-on",
        ecosystem: dependency.ecosystem,
        packageName: dependency.label,
        trust: authoredResolved || approvalResolved ? "authored" : "inferred",
        status:
          authoredResolved || approvalResolved
            ? "resolved"
            : targetIds.length > 1 || matchingMappings.length
              ? "conflicting"
              : "provisional",
        confidence:
          authoredResolved || approvalResolved
            ? authoredResolved
              ? 1
              : 0.98
            : targetIds.length > 1 || matchingMappings.length
              ? 0.45
              : 0.86,
        ...(authoredResolved
          ? {
              resolutionSource: "repository-manifest" as const,
              resolutionId: matchingMappings.find((mapping) =>
                authoredProviderKeys.includes(mapping.providerRepositoryKey),
              )!.id,
            }
          : approvalResolved
            ? {
                resolutionSource: "user-approval" as const,
                resolutionId: approval!.id,
              }
            : {}),
        evidence,
      });
    }
  }
  if (links.length > MAX_LINKS) {
    diagnostic(
      diagnostics,
      "FEDERATION_LINK_LIMIT_REACHED",
      "warning",
      "document",
      `Federation retained ${MAX_LINKS}/${links.length} cross-repository links.`,
    );
    links.length = MAX_LINKS;
  }
  repositories.sort((left, right) => {
    if (left.role !== right.role) return left.role === "active" ? -1 : 1;
    return left.id.localeCompare(right.id);
  });
  links.sort((left, right) => left.id.localeCompare(right.id));
  questions.sort((left, right) => left.id.localeCompare(right.id));
  const approvals = [...appliedApprovals.values()].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const computedRevision = federationRevision({
    repositories,
    links,
    questions,
    approvals,
  });
  const draft: Omit<ArchitectureFederation, "validation"> = {
    contract: "witch.graph-federation/v1",
    algorithm: "exact-package-identity-v1",
    revision: computedRevision,
    generatedAt: inputs
      .map((input) => input.graph.generatedAt)
      .sort()
      .at(-1)!,
    repositories,
    links,
    questions,
    approvals,
    diagnostics,
  };
  const validation = validateArchitectureFederation(draft, inputs);
  if (!validation.valid) {
    const details = validation.diagnostics
      .filter((item) => item.severity === "error")
      .slice(0, 8)
      .map((item) => `${item.code} (${item.subject}): ${item.message}`)
      .join("; ");
    throw new Error(`Architecture federation validation failed: ${details}`);
  }
  return { ...draft, validation };
}
