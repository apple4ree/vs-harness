import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyzeRepository,
  type ArchitectureCache,
} from "../apps/desktop/src/main/services/architecture";
import { corroborateSymbolCalls } from "../apps/desktop/src/main/services/call-corroboration";
import {
  findRustAnalyzerExecutable,
  LanguageIntelligence,
} from "../apps/desktop/src/main/services/language-intelligence";
import { LanguageServer } from "../apps/desktop/src/main/services/language-server";
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
  const rank = Number(argument("--rank"));
  if (!requestedRoot || !path.isAbsolute(requestedRoot))
    throw new Error("--root must be an absolute repository path");
  if (!slug || !/^[-.\w]+\/[-.\w]+$/.test(slug))
    throw new Error("--slug must be an owner/repository name");
  if (!Number.isInteger(rank) || rank < 1 || rank > 100)
    throw new Error("--rank must be an integer from 1 to 100");
  if (output && !path.isAbsolute(output))
    throw new Error("--output must be an absolute JSON path");
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

  const cache: ArchitectureCache = new Map();
  const coldStart = performance.now();
  const cold = await analyzeRepository(root, { cache });
  const coldMs = milliseconds(coldStart);
  const warmStart = performance.now();
  const warm = await analyzeRepository(root, {
    cache,
    previousSemantic: cold.semantic,
  });
  const warmMs = milliseconds(warmStart);

  const language = createLanguageIntelligence(root);
  let enriched = warm;
  let corroborationMs = 0;
  let languageProviders: Awaited<
    ReturnType<LanguageIntelligence["status"]>
  > | null = null;
  try {
    const corroborationStart = performance.now();
    enriched = await analyzeRepository(root, {
      cache,
      previousSemantic: warm.semantic,
      callCorroborator: (input) => corroborateSymbolCalls(input, language),
    });
    corroborationMs = milliseconds(corroborationStart);
    languageProviders = await language.status();
  } finally {
    await language.stop();
  }

  const layoutStart = performance.now();
  const moduleView = buildView(enriched, "modules", null, false, "", new Set());
  const layoutMs = milliseconds(layoutStart);
  const semantic = enriched.semantic!;
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
      corroborationMilliseconds: corroborationMs,
      layoutMilliseconds: layoutMs,
      maxResidentMB: Math.round(process.resourceUsage().maxRSS / 1024),
      truncated: enriched.truncated,
      warnings: enriched.warnings,
      architectureValid: enriched.validation.valid,
    },
    semantic: {
      valid: semantic.validation.valid,
      nodes: semantic.nodes.length,
      relations: semantic.relations.length,
      claims: semantic.claims.length,
      questions: semantic.questions.length,
      nodeKinds,
      relationKinds,
      relationStatuses,
      relationTrust,
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
