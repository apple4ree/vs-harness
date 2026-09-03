import path from "node:path";
import type {
  ArchitectureNode,
  SourceEvidence,
} from "../../shared/architecture";
import type {
  KnowledgeDiagnostic,
  KnowledgeGraph,
  KnowledgeNode,
  KnowledgeProvenance,
  KnowledgeRelation,
} from "../../shared/knowledge";
import { finalizeKnowledgeGraph } from "../../shared/knowledge-ir";
import type { SemanticGraph } from "../../shared/semantic";
import { contentHash } from "./workspace-files";

export const KNOWLEDGE_ANALYZER_VERSION = "architecture-knowledge-v1";
const KNOWLEDGE_POLICY_VERSION = "source-authorship-v1";
const MAX_DEPENDENCIES = 1_200;

const normalized = (value: string) => value.replaceAll("\\", "/");
const lower = (value: string) => normalized(value).toLowerCase();
const bounded = (value: string, limit = 600) =>
  value.replace(/\s+/g, " ").trim().slice(0, limit);
const id = (kind: string, value: string) =>
  `knowledge:${kind}:${contentHash(`${kind}\0${value}`).slice(0, 24)}`;

const MANIFEST_NAMES = new Set([
  "package.json",
  "cargo.toml",
  "pyproject.toml",
]);

function isManifestPath(relative: string) {
  const name = path.posix.basename(lower(relative));
  return (
    MANIFEST_NAMES.has(name) || /^requirements(?:[-_.][^/]*)?\.txt$/.test(name)
  );
}

function isArchitectureDocumentPath(relative: string) {
  const file = lower(relative);
  const name = path.posix.basename(file);
  return (
    name.endsWith(".md") &&
    (/(^|\/)(?:docs?\/)?(?:adr|adrs|rfcs?|architecture\/decisions)(\/|$)/.test(
      file,
    ) ||
      /^(?:adr|rfc)[-_ ]?\d+.*\.md$/.test(name))
  );
}

export function isArchitectureKnowledgePath(relative: string) {
  const file = lower(relative);
  const name = path.posix.basename(file);
  if (file === ".witch/federation.json") return true;
  if (isManifestPath(relative)) return true;
  if (
    /^(?:tsconfig|jsconfig)(?:\.[^/]*)?\.json$/.test(name) ||
    /^(?:ruff|mypy|pytest|tox|rust-toolchain)(?:\.[^/]*)?\.(?:toml|ini|json)$/.test(
      name,
    ) ||
    /^(?:docker-)?compose(?:\.[^/]*)?\.ya?ml$/.test(name) ||
    file === ".cargo/config.toml" ||
    file.startsWith(".github/workflows/")
  )
    return true;
  return isArchitectureDocumentPath(relative);
}

type FederationManifestReading = {
  repositoryKey: string;
  repositoryLine: number;
  mappings: Array<{
    ecosystem: "npm" | "python" | "cargo";
    packageName: string;
    providerRepositoryKey: string;
    packageLine: number;
    providerLine: number;
  }>;
};

const validRepositoryKey = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9][a-z0-9._/-]{0,127}$/i.test(value);

function jsonStringLine(lines: string[], value: string) {
  const quoted = JSON.stringify(value);
  return lines.findIndex((line) => line.includes(quoted)) + 1 || 1;
}

function parseFederationManifest(
  content: string,
  lines: string[],
  diagnostics: KnowledgeDiagnostic[],
  file: string,
): FederationManifestReading | null {
  try {
    const value = JSON.parse(content);
    if (
      !value ||
      value.version !== 1 ||
      !validRepositoryKey(value.repositoryKey)
    ) {
      diagnostics.push({
        code: "KNOWLEDGE_FEDERATION_MANIFEST_INVALID",
        severity: "warning",
        subject: file,
        message:
          "Federation manifest requires version 1 and a bounded repositoryKey.",
      });
      return null;
    }
    if (value.mappings !== undefined && !Array.isArray(value.mappings)) {
      diagnostics.push({
        code: "KNOWLEDGE_FEDERATION_MAPPINGS_INVALID",
        severity: "warning",
        subject: file,
        message: "Federation mappings must be an array.",
      });
      return null;
    }
    const mappings: FederationManifestReading["mappings"] = [];
    const seen = new Set<string>();
    for (const candidate of (value.mappings || []).slice(0, 200)) {
      const ecosystem = candidate?.ecosystem;
      const packageName = candidate?.package;
      const providerRepositoryKey = candidate?.provider;
      if (
        !["npm", "python", "cargo"].includes(ecosystem) ||
        typeof packageName !== "string" ||
        !packageName.trim() ||
        packageName.length > 200 ||
        !validRepositoryKey(providerRepositoryKey)
      ) {
        diagnostics.push({
          code: "KNOWLEDGE_FEDERATION_MAPPING_OMITTED",
          severity: "warning",
          subject: file,
          message:
            "An invalid federation mapping was omitted; ecosystem, package, and provider are required.",
        });
        continue;
      }
      const key = `${ecosystem}\0${packageName.toLowerCase()}\0${providerRepositoryKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      mappings.push({
        ecosystem,
        packageName: packageName.trim(),
        providerRepositoryKey,
        packageLine: jsonStringLine(lines, packageName),
        providerLine: jsonStringLine(lines, providerRepositoryKey),
      });
    }
    if ((value.mappings || []).length > 200)
      diagnostics.push({
        code: "KNOWLEDGE_FEDERATION_MAPPING_LIMIT_REACHED",
        severity: "warning",
        subject: file,
        message: "Federation manifest retained the first 200 mappings.",
      });
    return {
      repositoryKey: value.repositoryKey,
      repositoryLine: jsonStringLine(lines, value.repositoryKey),
      mappings,
    };
  } catch (error) {
    diagnostics.push({
      code: "KNOWLEDGE_FEDERATION_MANIFEST_PARSE_FAILED",
      severity: "warning",
      subject: file,
      message: `Federation manifest was not parsed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

function provenance(
  source: KnowledgeProvenance["source"],
  ruleId: string,
): KnowledgeProvenance {
  return { source, extractor: KNOWLEDGE_ANALYZER_VERSION, ruleId };
}

function quotedValue(value: string) {
  return value
    .trim()
    .replace(/^['"]|['"],?$/g, "")
    .trim();
}

function dependencyName(value: string) {
  const clean = quotedValue(value)
    .split(";")[0]
    .trim()
    .replace(/^[-e]+\s+/, "");
  if (!clean || /^(?:https?|git\+|\.\.?\/)/i.test(clean)) return "";
  const match = clean.match(
    /^([A-Za-z0-9_.@/-]+?)(?:\[[^\]]+\])?(?=[<>=!~^\s]|$)/,
  );
  return bounded(match?.[1] || "", 200);
}

function lineEvidence(
  source: ArchitectureNode,
  lines: string[],
  line: number,
): SourceEvidence {
  return {
    path: source.path!,
    line: Math.max(1, line),
    hash: source.hash,
    excerpt: lines[Math.max(0, line - 1)]?.trim().slice(0, 300),
  };
}

function fileEvidence(source: ArchitectureNode, line = 1): SourceEvidence {
  return { path: source.path!, line: Math.max(1, line), hash: source.hash };
}

type PackageReading = {
  ecosystem: "npm" | "python" | "cargo";
  name: string;
  nameLine: number;
  dependencies: Array<{ name: string; line: number }>;
};

function parsePackageJson(
  content: string,
  lines: string[],
  diagnostics: KnowledgeDiagnostic[],
  file: string,
): PackageReading | null {
  try {
    const value = JSON.parse(content);
    const dependencies: Array<{ name: string; line: number }> = [];
    for (const section of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      const items = value?.[section];
      if (!items || typeof items !== "object" || Array.isArray(items)) continue;
      for (const name of Object.keys(items).sort()) {
        const quoted = JSON.stringify(name);
        const line = lines.findIndex((item) => item.includes(quoted)) + 1;
        dependencies.push({ name: bounded(name, 200), line: line || 1 });
      }
    }
    return {
      ecosystem: "npm",
      name:
        typeof value?.name === "string" && value.name.trim()
          ? bounded(value.name, 200)
          : path.posix.basename(path.posix.dirname(normalized(file))) ||
            "workspace",
      nameLine: lines.findIndex((line) => /^\s*"name"\s*:/.test(line)) + 1 || 1,
      dependencies,
    };
  } catch (error) {
    diagnostics.push({
      code: "KNOWLEDGE_MANIFEST_PARSE_FAILED",
      severity: "warning",
      subject: file,
      message: `package.json was not parsed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return null;
  }
}

function parseCargoToml(lines: string[], file: string): PackageReading {
  let section = "";
  let name =
    path.posix.basename(path.posix.dirname(normalized(file))) || "workspace";
  let nameLine = 1;
  const dependencies: PackageReading["dependencies"] = [];
  lines.forEach((text, index) => {
    const trimmed = text.replace(/\s+#.*$/, "").trim();
    const heading = trimmed.match(/^\[([^\]]+)\]$/);
    if (heading) {
      section = heading[1].toLowerCase();
      return;
    }
    const pair = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!pair) return;
    if (section === "package" && pair[1] === "name") {
      name = bounded(quotedValue(pair[2]), 200) || name;
      nameLine = index + 1;
    }
    if (
      /(^|\.)(?:dev-|build-)?dependencies$/.test(section) &&
      pair[1] !== "workspace"
    )
      dependencies.push({ name: bounded(pair[1], 200), line: index + 1 });
  });
  return { ecosystem: "cargo", name, nameLine, dependencies };
}

function parsePyproject(lines: string[], file: string): PackageReading {
  let section = "";
  let dependencyArray = false;
  let name =
    path.posix.basename(path.posix.dirname(normalized(file))) || "workspace";
  let nameLine = 1;
  const dependencies: PackageReading["dependencies"] = [];
  lines.forEach((text, index) => {
    const trimmed = text.replace(/\s+#.*$/, "").trim();
    const heading = trimmed.match(/^\[([^\]]+)\]$/);
    if (heading) {
      section = heading[1].toLowerCase();
      dependencyArray = false;
      return;
    }
    const pair = trimmed.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/);
    if (
      pair &&
      (section === "project" || section === "tool.poetry") &&
      pair[1] === "name"
    ) {
      name = bounded(quotedValue(pair[2]), 200) || name;
      nameLine = index + 1;
    }
    if (pair && section === "project" && pair[1] === "dependencies") {
      dependencyArray = true;
      for (const match of pair[2].matchAll(/["']([^"']+)["']/g)) {
        const dependency = dependencyName(match[1]);
        if (dependency)
          dependencies.push({ name: dependency, line: index + 1 });
      }
      if (pair[2].includes("]")) dependencyArray = false;
      return;
    }
    if (dependencyArray) {
      for (const match of trimmed.matchAll(/["']([^"']+)["']/g)) {
        const dependency = dependencyName(match[1]);
        if (dependency)
          dependencies.push({ name: dependency, line: index + 1 });
      }
      if (trimmed.includes("]")) dependencyArray = false;
    }
    if (
      pair &&
      (section === "tool.poetry.dependencies" ||
        section === "tool.poetry.group.dev.dependencies") &&
      pair[1].toLowerCase() !== "python"
    )
      dependencies.push({ name: bounded(pair[1], 200), line: index + 1 });
  });
  return { ecosystem: "python", name, nameLine, dependencies };
}

function parseRequirements(lines: string[], file: string): PackageReading {
  const dependencies: PackageReading["dependencies"] = [];
  lines.forEach((line, index) => {
    const value = line.replace(/\s+#.*$/, "").trim();
    if (!value || value.startsWith("-") || value.startsWith("#")) return;
    const name = dependencyName(value);
    if (name) dependencies.push({ name, line: index + 1 });
  });
  return {
    ecosystem: "python",
    name:
      path.posix.basename(path.posix.dirname(normalized(file))) || "workspace",
    nameLine: 1,
    dependencies,
  };
}

function packageReading(
  file: string,
  content: string,
  lines: string[],
  diagnostics: KnowledgeDiagnostic[],
) {
  const name = path.posix.basename(lower(file));
  if (name === "package.json")
    return parsePackageJson(content, lines, diagnostics, file);
  if (name === "cargo.toml") return parseCargoToml(lines, file);
  if (name === "pyproject.toml") return parsePyproject(lines, file);
  if (/^requirements(?:[-_.][^/]*)?\.txt$/.test(name))
    return parseRequirements(lines, file);
  return null;
}

function sectionValue(lines: string[], names: RegExp) {
  let active = false;
  for (let index = 0; index < lines.length; index++) {
    const heading = lines[index].match(/^#{2,6}\s+(.+?)\s*#*$/);
    if (heading) {
      active = names.test(heading[1].trim());
      continue;
    }
    if (!active) continue;
    const value = lines[index].trim();
    if (value && !value.startsWith("#"))
      return { value: bounded(value), line: index + 1 };
  }
  return null;
}

function documentReading(file: string, content: string) {
  const lines = content.split(/\r?\n/);
  const titleIndex = lines.findIndex((line) => /^#\s+\S/.test(line));
  const title = bounded(
    titleIndex >= 0
      ? lines[titleIndex].replace(/^#\s+/, "").replace(/\s+#+$/, "")
      : path.posix.basename(normalized(file), path.posix.extname(file)),
    500,
  );
  const context = sectionValue(lines, /^(?:context|problem|배경|문제)/i);
  const decision = sectionValue(lines, /^(?:decision|proposal|결정|제안)/i);
  const consequences = sectionValue(
    lines,
    /^(?:consequences|tradeoffs?|결과|영향|트레이드오프)/i,
  );
  const statusLine = lines.findIndex((line) =>
    /^(?:status|상태)\s*:\s*/i.test(line.trim()),
  );
  const statusText = statusLine >= 0 ? lines[statusLine].toLowerCase() : "";
  const status = /superseded|replaced|폐기|대체/.test(statusText)
    ? ("superseded" as const)
    : /draft|proposed|pending|초안|제안/.test(statusText)
      ? ("provisional" as const)
      : ("accepted" as const);
  const supersedes = lines
    .map((line, index) => ({ line, index }))
    .find(({ line }) => /^(?:supersedes|replaces|대체)\s*:/i.test(line.trim()));
  return {
    lines,
    title,
    titleLine: titleIndex + 1 || 1,
    status,
    rationaleLines: [context?.line, decision?.line, consequences?.line].filter(
      (line): line is number => Boolean(line),
    ),
    statusLine: statusLine + 1 || null,
    rationale: {
      ...(context ? { context: context.value } : {}),
      ...(decision ? { decision: decision.value } : {}),
      ...(consequences ? { consequences: consequences.value } : {}),
    },
    supersedes: supersedes
      ? {
          value: bounded(supersedes.line.split(":").slice(1).join(":"), 300),
          line: supersedes.index + 1,
        }
      : null,
  };
}

export function analyzeArchitectureKnowledge(input: {
  workspaceRoot: string;
  sourceRevision: string;
  generatedAt: string;
  nodes: ArchitectureNode[];
  semantic?: SemanticGraph;
  contents: ReadonlyMap<string, string>;
}): KnowledgeGraph {
  const sourceNodes = new Map(
    input.nodes
      .filter((node) => node.kind === "file" && node.path)
      .map((node) => [node.path!, node]),
  );
  const nodes = new Map<string, KnowledgeNode>();
  const relations = new Map<string, KnowledgeRelation>();
  const diagnostics: KnowledgeDiagnostic[] = [];
  const documents: Array<{
    node: KnowledgeNode;
    supersedes: { value: string; line: number } | null;
    lines: string[];
  }> = [];
  const system = input.semantic?.nodes.find((node) => node.kind === "system");

  const addRelation = (
    from: string,
    to: string,
    kind: KnowledgeRelation["kind"],
    evidence: SourceEvidence,
    trust: KnowledgeRelation["trust"],
    status: KnowledgeRelation["status"],
    confidence: number,
    source: KnowledgeProvenance["source"],
    ruleId: string,
    description?: string,
  ) => {
    const relationId = id(
      "relation",
      `${from}\0${kind}\0${to}\0${evidence.path}`,
    );
    relations.set(relationId, {
      id: relationId,
      from,
      to,
      kind,
      trust,
      status,
      confidence,
      ...(description ? { description } : {}),
      evidence: [evidence],
      provenance: provenance(source, ruleId),
    });
  };

  for (const [file, content] of [...input.contents].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const source = sourceNodes.get(file);
    if (!source || !isArchitectureKnowledgePath(file)) continue;
    const lines = content.split(/\r?\n/);
    const normalizedFile = normalized(file);
    const isDocument = isArchitectureDocumentPath(file);
    if (isDocument) {
      const reading = documentReading(file, content);
      const kind = /(^|\/)(?:rfcs?|rfc[-_ ]?\d)/i.test(lower(file))
        ? ("rfc" as const)
        : ("decision" as const);
      const nodeId = id(kind, normalizedFile);
      const evidence = lineEvidence(source, reading.lines, reading.titleLine);
      const node: KnowledgeNode = {
        id: nodeId,
        label: reading.title,
        kind,
        trust: "authored",
        status: reading.status,
        confidence: 1,
        path: file,
        description: `${kind === "rfc" ? "RFC" : "Architecture decision"} authored in ${file}`,
        ...(Object.keys(reading.rationale).length
          ? { rationale: reading.rationale }
          : {}),
        evidence: [
          evidence,
          ...reading.rationaleLines.map((line) =>
            lineEvidence(source, reading.lines, line),
          ),
          ...(reading.statusLine
            ? [lineEvidence(source, reading.lines, reading.statusLine)]
            : []),
        ],
        provenance: provenance("architecture-document", `${kind}-path-v1`),
      };
      nodes.set(nodeId, node);
      addRelation(
        nodeId,
        source.id,
        "documented-in",
        evidence,
        "authored",
        reading.status,
        1,
        "architecture-document",
        "document-source-v1",
      );
      if (system)
        addRelation(
          nodeId,
          system.id,
          "documents",
          evidence,
          "inferred",
          "provisional",
          0.72,
          "architecture-document",
          "document-system-convention-v1",
          "The architecture-document path convention suggests this document describes the analyzed system.",
        );
      documents.push({
        node,
        supersedes: reading.supersedes,
        lines: reading.lines,
      });
      continue;
    }

    const reading = packageReading(file, content, lines, diagnostics);
    const federationReading =
      lower(file) === ".witch/federation.json"
        ? parseFederationManifest(content, lines, diagnostics, file)
        : null;
    const manifest = isManifestPath(file);
    const kind = manifest ? ("manifest" as const) : ("configuration" as const);
    const nodeId = id(kind, normalizedFile);
    const evidence = fileEvidence(source);
    nodes.set(nodeId, {
      id: nodeId,
      label: path.posix.basename(normalizedFile),
      kind,
      trust: "verified",
      status: "accepted",
      confidence: 1,
      path: file,
      description: manifest
        ? `Package manifest detected at ${file}`
        : `Project configuration detected at ${file}`,
      evidence: [evidence],
      provenance: provenance(
        manifest ? "manifest" : "configuration",
        manifest ? "known-manifest-path-v1" : "known-config-path-v1",
      ),
    });
    addRelation(
      nodeId,
      source.id,
      "evidenced-by",
      evidence,
      "verified",
      "accepted",
      1,
      manifest ? "manifest" : "configuration",
      "knowledge-source-v1",
    );
    if (system)
      addRelation(
        nodeId,
        system.id,
        manifest ? "describes" : "configures",
        evidence,
        "inferred",
        "provisional",
        0.72,
        manifest ? "manifest" : "configuration",
        "knowledge-system-convention-v1",
      );
    if (federationReading) {
      const repositoryId = id(
        "federation-repository",
        federationReading.repositoryKey,
      );
      const repositoryEvidence = lineEvidence(
        source,
        lines,
        federationReading.repositoryLine,
      );
      nodes.set(repositoryId, {
        id: repositoryId,
        label: federationReading.repositoryKey,
        kind: "federation-repository",
        trust: "authored",
        status: "accepted",
        confidence: 1,
        path: file,
        repositoryKey: federationReading.repositoryKey,
        description: `Stable federation identity authored in ${file}`,
        evidence: [repositoryEvidence],
        provenance: provenance("configuration", "federation-repository-v1"),
      });
      addRelation(
        repositoryId,
        nodeId,
        "declared-in",
        repositoryEvidence,
        "authored",
        "accepted",
        1,
        "configuration",
        "federation-repository-v1",
      );
      for (const mapping of federationReading.mappings) {
        const mappingId = id(
          "federation-mapping",
          `${mapping.ecosystem}:${mapping.packageName}:${mapping.providerRepositoryKey}`,
        );
        const packageEvidence = lineEvidence(
          source,
          lines,
          mapping.packageLine,
        );
        const providerEvidence = lineEvidence(
          source,
          lines,
          mapping.providerLine,
        );
        nodes.set(mappingId, {
          id: mappingId,
          label: mapping.packageName,
          kind: "federation-mapping",
          trust: "authored",
          status: "accepted",
          confidence: 1,
          path: file,
          ecosystem: mapping.ecosystem,
          providerRepositoryKey: mapping.providerRepositoryKey,
          description: `Use ${mapping.providerRepositoryKey} as the ${mapping.ecosystem} provider`,
          evidence: [packageEvidence, providerEvidence],
          provenance: provenance("configuration", "federation-mapping-v1"),
        });
        addRelation(
          mappingId,
          nodeId,
          "declared-in",
          packageEvidence,
          "authored",
          "accepted",
          1,
          "configuration",
          "federation-mapping-v1",
        );
      }
      continue;
    }
    if (!reading) continue;

    const packageId = id(
      "package",
      `${reading.ecosystem}:${reading.name}:${normalizedFile}`,
    );
    const packageEvidence = fileEvidence(source, reading.nameLine);
    nodes.set(packageId, {
      id: packageId,
      label: reading.name,
      kind: "package",
      trust: "verified",
      status: "accepted",
      confidence: 1,
      path: file,
      ecosystem: reading.ecosystem,
      description: `${reading.ecosystem} package declared by ${file}`,
      evidence: [packageEvidence],
      provenance: provenance("manifest", `${reading.ecosystem}-package-v1`),
    });
    addRelation(
      packageId,
      nodeId,
      "declared-in",
      packageEvidence,
      "verified",
      "accepted",
      1,
      "manifest",
      `${reading.ecosystem}-package-v1`,
    );
    for (const dependency of reading.dependencies
      .filter((item) => item.name)
      .slice(0, MAX_DEPENDENCIES)) {
      const dependencyId = id(
        "dependency",
        `${reading.ecosystem}:${dependency.name.toLowerCase()}`,
      );
      const dependencyEvidence = fileEvidence(source, dependency.line);
      if (!nodes.has(dependencyId))
        nodes.set(dependencyId, {
          id: dependencyId,
          label: dependency.name,
          kind: "dependency",
          trust: "verified",
          status: "accepted",
          confidence: 1,
          ecosystem: reading.ecosystem,
          description: `${reading.ecosystem} dependency`,
          evidence: [dependencyEvidence],
          provenance: provenance(
            "manifest",
            `${reading.ecosystem}-dependency-v1`,
          ),
        });
      addRelation(
        packageId,
        dependencyId,
        "depends-on",
        dependencyEvidence,
        "verified",
        "accepted",
        1,
        "manifest",
        `${reading.ecosystem}-dependency-v1`,
      );
    }
    if (reading.dependencies.length > MAX_DEPENDENCIES)
      diagnostics.push({
        code: "KNOWLEDGE_DEPENDENCY_LIMIT_REACHED",
        severity: "warning",
        subject: file,
        message: `Dependency projection retained ${MAX_DEPENDENCIES}/${reading.dependencies.length} entries.`,
      });
  }

  for (const document of documents) {
    if (!document.supersedes?.value) continue;
    const wanted = lower(document.supersedes.value);
    const target = documents.find(
      (candidate) =>
        candidate.node.id !== document.node.id &&
        (lower(candidate.node.label).includes(wanted) ||
          wanted.includes(lower(candidate.node.label)) ||
          lower(candidate.node.path || "").includes(
            wanted.replace(/\s+/g, "-"),
          )),
    );
    if (!target) {
      diagnostics.push({
        code: "KNOWLEDGE_SUPERSEDES_UNRESOLVED",
        severity: "warning",
        subject: document.node.id,
        message: `Superseded decision could not be resolved: ${document.supersedes.value}`,
      });
      continue;
    }
    const source = sourceNodes.get(document.node.path!);
    if (!source) continue;
    addRelation(
      document.node.id,
      target.node.id,
      "supersedes",
      lineEvidence(source, document.lines, document.supersedes.line),
      "authored",
      "accepted",
      1,
      "architecture-document",
      "explicit-supersedes-v1",
    );
  }

  const graphNodes = [...nodes.values()].slice(0, 2_000);
  const graphNodeIds = new Set(graphNodes.map((node) => node.id));
  const graphEndpointIds = new Set([
    ...input.nodes.map((node) => node.id),
    ...(input.semantic?.nodes.map((node) => node.id) || []),
    ...graphNodeIds,
  ]);
  const graphRelations = [...relations.values()]
    .filter(
      (relation) =>
        graphEndpointIds.has(relation.from) &&
        graphEndpointIds.has(relation.to),
    )
    .slice(0, 5_000);
  const revision = contentHash(
    JSON.stringify({
      sourceRevision: input.sourceRevision,
      nodes: graphNodes,
      relations: graphRelations,
      diagnostics,
    }),
  );
  return finalizeKnowledgeGraph(
    {
      schemaVersion: 1,
      contract: "witch.knowledge/v1",
      analyzerVersion: KNOWLEDGE_ANALYZER_VERSION,
      policyVersion: KNOWLEDGE_POLICY_VERSION,
      workspaceRoot: input.workspaceRoot,
      sourceRevision: input.sourceRevision,
      ...(input.semantic ? { semanticRevision: input.semantic.revision } : {}),
      revision,
      generatedAt: input.generatedAt,
      nodes: graphNodes,
      relations: graphRelations,
      diagnostics,
    },
    input.nodes,
    input.semantic,
  );
}
