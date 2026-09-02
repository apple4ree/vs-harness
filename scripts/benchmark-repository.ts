import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { corroborateSymbolCalls } from "../apps/desktop/src/main/services/call-corroboration";
import {
  findRustAnalyzerExecutable,
  LanguageIntelligence,
} from "../apps/desktop/src/main/services/language-intelligence";
import { LanguageServer } from "../apps/desktop/src/main/services/language-server";
import { RepositoryAnalysisService } from "../apps/desktop/src/main/services/repository-analysis";
import { listWorkspace } from "../apps/desktop/src/main/services/workspace-files";
import { buildView } from "../apps/desktop/src/renderer/src/components/architecture-view";

const runStarted = performance.now();

const DEEP_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
]);

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function countBy(values: string[]) {
  return Object.fromEntries(
    [
      ...values.reduce((counts, value) => {
        counts.set(value, (counts.get(value) || 0) + 1);
        return counts;
      }, new Map<string, number>()),
    ].sort(
      ([left, leftCount], [right, rightCount]) =>
        rightCount - leftCount || left.localeCompare(right),
    ),
  );
}

function milliseconds(start: number) {
  return Math.round(performance.now() - start);
}

function createLanguageIntelligence(root: string) {
  const pyright = path.resolve("node_modules/pyright/langserver.index.js");
  const rust =
    findRustAnalyzerExecutable() ||
    path.join(os.tmpdir(), "witch-rust-analyzer-not-installed");
  const rustConfiguration = {
    cargo: { buildScripts: { enable: false }, autoreload: false },
    procMacro: { enable: false },
    checkOnSave: false,
  };
  const language = new LanguageIntelligence([
    new LanguageServer({
      id: "python",
      label: "Python · Pyright",
      command: process.execPath,
      args: [pyright, "--stdio"],
      installedPath: pyright,
      extensions: [".py", ".pyi"],
      configuration: {
        python: {},
        "python.analysis": {
          autoSearchPaths: true,
          diagnosticMode: "openFilesOnly",
          typeCheckingMode: "basic",
          useLibraryCodeForTypes: true,
        },
      },
    }),
    new LanguageServer({
      id: "rust",
      label: "Rust · rust-analyzer",
      command: rust,
      args: [],
      extensions: [".rs"],
      initializationOptions: rustConfiguration,
      configuration: { "rust-analyzer": rustConfiguration },
    }),
  ]);
  language.setWorkspace(root);
  return language;
}

async function main() {
  const requestedRoot = argument("--root");
  const slug = argument("--slug");
  const output = argument("--output");
  const requestedIndexRoot = argument("--index-root");
  const rank = Number(argument("--rank"));
  if (!requestedRoot || !path.isAbsolute(requestedRoot))
    throw new Error("--root must be an absolute repository path");
  if (!slug || !/^[-.\w]+\/[-.\w]+$/.test(slug))
    throw new Error("--slug must be an owner/repository name");
  if (!Number.isInteger(rank) || rank < 1 || rank > 100)
    throw new Error("--rank must be an integer from 1 to 100");
  if (output && !path.isAbsolute(output))
    throw new Error("--output must be an absolute JSON path");
  if (requestedIndexRoot && !path.isAbsolute(requestedIndexRoot))
    throw new Error("--index-root must be an absolute directory path");
  const root = await fs.realpath(requestedRoot);
  const gitDirectory = path.join(root, ".git");
  if (!(await fs.stat(gitDirectory)).isDirectory())
    throw new Error("The benchmark target must be a Git checkout");

  const listingStart = performance.now();
  const listing = await listWorkspace(root);
  const listingMs = milliseconds(listingStart);
  const files = listing.entries.filter((item) => item.kind === "file");
  const bytes = files.reduce((total, file) => total + file.size, 0);
  const extensionCounts = countBy(
    files.map((file) => file.extension || "[no extension]"),
  );

  const indexRoot =
    requestedIndexRoot ||
    (output
      ? path.join(path.dirname(output), "indexes")
      : await fs.mkdtemp(path.join(os.tmpdir(), "witch-repository-index-")));
  const analyzer = new RepositoryAnalysisService();
  analyzer.setIndexRoot(indexRoot);
  await analyzer.clearIndex(root);
  const coldStart = performance.now();
  const cold = await analyzer.analyze(root);
  const coldMs = milliseconds(coldStart);
  const warmStart = performance.now();
  const warm = await analyzer.analyze(root);
  const warmMs = milliseconds(warmStart);
  analyzer.dispose();

  const restartedAnalyzer = new RepositoryAnalysisService();
  restartedAnalyzer.setIndexRoot(indexRoot);
  const persistentStart = performance.now();
  const persistent = await restartedAnalyzer.analyze(root);
  const persistentMs = milliseconds(persistentStart);

  const language = createLanguageIntelligence(root);
  let enriched = persistent;
  let corroborationMs = 0;
  let languageProviders: Awaited<
    ReturnType<LanguageIntelligence["status"]>
  > | null = null;
  try {
    const corroborationStart = performance.now();
    enriched = await restartedAnalyzer.analyze(root, {
      callCorroborator: (input) => corroborateSymbolCalls(input, language),
    });
    corroborationMs = milliseconds(corroborationStart);
    languageProviders = await language.status();
  } finally {
    await language.stop();
    restartedAnalyzer.dispose();
  }

  const layoutStart = performance.now();
  const moduleView = buildView(enriched, "modules", null, false, "", new Set());
  const layoutMs = milliseconds(layoutStart);
  const semanticViews = Object.fromEntries(
    (
      [
        "overview",
        "components",
        "workflows",
        "calls",
        "behavior",
        "frameworks",
        "questions",
        "verified",
      ] as const
    ).map((lens) => {
      const started = performance.now();
      const view = buildView(
        enriched,
        "semantics",
        null,
        false,
        "",
        new Set(),
        null,
        lens,
      );
      return [
        lens,
        {
          milliseconds: milliseconds(started),
          totalNodes: view.total,
          visibleNodes: view.nodes.length,
          totalEdges: view.totalEdges,
          visibleEdges: view.edges.length,
          quality: view.quality.status,
          qualityDiagnostics: view.quality.diagnostics.length,
          omittedNodes: view.projection.omittedNodes,
          omittedEdges: view.projection.omittedEdges,
          qualityRemovedEdges: view.projection.qualityRemovedEdges,
        },
      ];
    }),
  );
  const semantic = enriched.semantic!;
  const behavior = enriched.behavior!;
  const frameworks = enriched.frameworks!;
  const workflowNodes = semantic.nodes.filter(
    (node) => node.kind === "workflow",
  );
  const supportPath =
    /(^|\/)(docs?|examples?|samples?|tests?|fixtures?|benchmarks?)(\/|$)|(^|\/)test_[^/]+$/i;
  const focusedWorkflowViews = workflowNodes.map((workflowNode) => {
    const started = performance.now();
    const view = buildView(
      enriched,
      "semantics",
      null,
      false,
      "",
      new Set(),
      null,
      "workflows",
      {
        focusId: workflowNode.id,
        mode: "sequence",
        collapseBranches: true,
      },
    );
    return {
      id: workflowNode.id,
      milliseconds: milliseconds(started),
      nodes: view.nodes.length,
      edges: view.edges.length,
      quality: view.quality.status,
      errors: view.quality.errors,
      warnings: view.quality.warnings,
    };
  });
  const deepFiles = enriched.nodes.filter((node) =>
    DEEP_EXTENSIONS.has(path.extname(node.path || "").toLowerCase()),
  ).length;
  const symbolFiles = enriched.nodes.filter(
    (node) => node.symbols.length > 0,
  ).length;
  const symbols = enriched.nodes.reduce(
    (total, node) => total + node.symbols.length,
    0,
  );
  const relationKinds = countBy(
    semantic.relations.map((relation) => relation.kind),
  );
  const relationStatuses = countBy(
    semantic.relations.map((relation) => relation.status),
  );
  const relationTrust = countBy(
    semantic.relations.map((relation) => relation.trust),
  );
  const nodeKinds = countBy(semantic.nodes.map((node) => node.kind));
  const semanticNodes = new Map(semantic.nodes.map((node) => [node.id, node]));
  const commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();

  const result = {
    rank,
    slug,
    commit,
    root,
    listing: {
      milliseconds: listingMs,
      totalFiles: enriched.totalFiles,
      listedEntries: listing.entries.length,
      bytes,
      truncated: listing.truncated,
      extensions: extensionCounts,
    },
    analysis: {
      indexedFiles: enriched.scannedFiles,
      deepLanguageFiles: deepFiles,
      shallowOnlyFiles: Math.max(0, enriched.scannedFiles - deepFiles),
      symbolFiles,
      symbols,
      fileRelations: enriched.edges.length,
      modules: moduleView.total,
      visibleCards: moduleView.nodes.length,
      coldMilliseconds: coldMs,
      warmMilliseconds: warmMs,
      persistentRestartMilliseconds: persistentMs,
      corroborationMilliseconds: corroborationMs,
      layoutMilliseconds: layoutMs,
      maxResidentMB: Math.round(process.resourceUsage().maxRSS / 1024),
      truncated: enriched.truncated,
      warnings: enriched.warnings,
      architectureValid: enriched.validation.valid,
      coverage: enriched.coverage,
      coveragePasses: {
        cold: cold.coverage?.cache,
        warm: warm.coverage?.cache,
        persistentRestart: persistent.coverage?.cache,
        corroborated: enriched.coverage?.cache,
      },
      semanticViews,
      focusedWorkflowViews: {
        total: focusedWorkflowViews.length,
        pass: focusedWorkflowViews.filter((view) => view.quality === "pass")
          .length,
        warning: focusedWorkflowViews.filter(
          (view) => view.quality === "warning",
        ).length,
        fail: focusedWorkflowViews.filter((view) => view.quality === "fail")
          .length,
        maxNodes: Math.max(
          0,
          ...focusedWorkflowViews.map((view) => view.nodes),
        ),
        maxEdges: Math.max(
          0,
          ...focusedWorkflowViews.map((view) => view.edges),
        ),
        milliseconds: focusedWorkflowViews.reduce(
          (total, view) => total + view.milliseconds,
          0,
        ),
      },
    },
    semantic: {
      valid: semantic.validation.valid,
      nodes: semantic.nodes.length,
      relations: semantic.relations.length,
      claims: semantic.claims.length,
      questions: semantic.questions.length,
      workflows: {
        total: workflowNodes.length,
        production: workflowNodes.filter(
          (node) => !supportPath.test(node.path || ""),
        ).length,
        support: workflowNodes.filter((node) =>
          supportPath.test(node.path || ""),
        ).length,
      },
      nodeKinds,
      relationKinds,
      relationStatuses,
      relationTrust,
    },
    behavior: {
      valid: behavior.validation.valid,
      revision: behavior.revision,
      values: behavior.values.length,
      relations: behavior.relations.length,
      workflows: behavior.workflows.length,
      verified: behavior.validation.verifiedCount,
      inferred: behavior.validation.inferredCount,
      evidence: behavior.validation.evidenceCount,
      diagnostics: behavior.validation.diagnostics,
      relationKinds: countBy(
        behavior.relations.map((relation) => relation.kind),
      ),
    },
    frameworks: {
      valid: frameworks.validation.valid,
      revision: frameworks.revision,
      detections: frameworks.validation.detectionCount,
      candidates: frameworks.validation.candidateCount,
      excluded: frameworks.validation.excludedCount,
      evidence: frameworks.validation.evidenceCount,
      diagnostics: frameworks.validation.diagnostics,
      coverage: frameworks.coverage,
      candidateKinds: countBy(
        frameworks.candidates.map(
          (candidate) => `${candidate.framework}:${candidate.kind}`,
        ),
      ),
    },
    samples: {
      workflows: semantic.nodes
        .filter((node) => node.kind === "workflow")
        .slice(0, 12)
        .map((node) => ({
          label: node.label,
          path: node.path,
          status: node.status,
          confidence: node.confidence,
        })),
      calls: semantic.relations
        .filter((relation) => relation.kind === "calls")
        .slice(0, 12)
        .map((relation) => ({
          from: semanticNodes.get(relation.from)?.label || relation.from,
          to: semanticNodes.get(relation.to)?.label || relation.to,
          path: relation.evidence[0]?.path,
          line: relation.evidence[0]?.line,
          trust: relation.trust,
          status: relation.status,
        })),
    },
    providers: languageProviders?.providers || [],
  };
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, json, "utf8");
  }
  process.stdout.write(json);
}

main().catch(async (error) => {
  const output = argument("--output");
  const failure = {
    rank: Number(argument("--rank")) || null,
    slug: argument("--slug") || null,
    root: argument("--root") || null,
    failure: {
      elapsedMilliseconds: Math.round(performance.now() - runStarted),
      message: error instanceof Error ? error.message : String(error),
    },
  };
  if (output && path.isAbsolute(output)) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
  }
  console.error(error);
  process.exitCode = 1;
});
