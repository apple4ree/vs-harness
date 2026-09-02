import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

type CommandResult = {
  command: string;
  args: string[];
  status: number | null;
  signal: NodeJS.Signals | null;
  milliseconds: number;
  stdout: string;
  stderr: string;
  error?: string;
};

type ToolStatus = "pass" | "warning" | "fail" | "not-applicable";

const SOURCE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".cxx",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".cjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positionalArguments() {
  return process.argv.slice(2).filter((value) => !value.startsWith("--"));
}

function requireAbsoluteArgument(name: string, positionalIndex: number) {
  const value = argument(name) || positionalArguments()[positionalIndex];
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return path.resolve(value);
}

function run(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    maxBuffer?: number;
  } = {},
): CommandResult {
  const started = performance.now();
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout ?? 180_000,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
  });
  return {
    command,
    args,
    status: result.status,
    signal: result.signal,
    milliseconds: Math.round(performance.now() - started),
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    ...(result.error ? { error: result.error.message } : {}),
  };
}

async function writeLog(target: string, result: CommandResult) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const content = [
    `command: ${result.command}`,
    `args: ${JSON.stringify(result.args)}`,
    `status: ${result.status}`,
    `signal: ${result.signal || ""}`,
    `milliseconds: ${result.milliseconds}`,
    ...(result.error ? [`error: ${result.error}`] : []),
    "",
    "--- stdout ---",
    result.stdout,
    "",
    "--- stderr ---",
    result.stderr,
    "",
  ].join("\n");
  await fs.writeFile(target, content, "utf8");
}

async function pathExists(target: string) {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

async function directoryBytes(root: string): Promise<number> {
  if (!(await pathExists(root))) return 0;
  let total = 0;
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(target);
    else if (entry.isFile()) total += (await fs.stat(target)).size;
  }
  return total;
}

async function readJson<T>(target: string): Promise<T> {
  return JSON.parse(await fs.readFile(target, "utf8")) as T;
}

function parseMermaid(source: string) {
  const lines = source.split(/\r?\n/);
  const nodes = lines.filter((line) => /^\s*n\d+\[/.test(line)).length;
  const edges = lines.filter((line) =>
    /^\s*n\d+\s+-->\s+n\d+/.test(line),
  ).length;
  const groups = lines.filter((line) => /^\s*subgraph\s+/.test(line)).length;
  return { nodes, edges, groups, lines: lines.filter(Boolean).length };
}

function codeExtensionCounts(extensionCounts: Record<string, number>) {
  return Object.fromEntries(
    Object.entries(extensionCounts).filter(([extension]) =>
      SOURCE_EXTENSIONS.has(extension.toLowerCase()),
    ),
  );
}

function sumExtensions(
  extensionCounts: Record<string, number>,
  extensions: string[],
) {
  return extensions.reduce(
    (total, extension) => total + (extensionCounts[extension] || 0),
    0,
  );
}

function parseReportedSeconds(output: string) {
  const match = output.match(/Repository indexed successfully \(([\d.]+)s\)/);
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

function parseMarkdownTable(output: string) {
  try {
    const parsed = JSON.parse(output) as { markdown?: string };
    const lines = (parsed.markdown || "")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("|") && !/^\|\s*---/.test(line));
    if (lines.length < 2) return [];
    const headers = lines[0]
      .split("|")
      .slice(1, -1)
      .map((value) => value.trim());
    return lines.slice(1).map((line) => {
      const values = line
        .split("|")
        .slice(1, -1)
        .map((value) => value.trim());
      return Object.fromEntries(
        headers.map((header, index) => [header, values[index] || ""]),
      );
    });
  } catch {
    return [];
  }
}

function statusFrom(result: CommandResult): ToolStatus {
  if (result.status === 0) return "pass";
  if (result.error?.toLowerCase().includes("timeout")) return "fail";
  return "fail";
}

async function benchmarkCartographer(input: {
  node: string;
  cli: string;
  root: string;
  outputRoot: string;
}) {
  const highBase = path.join(input.outputRoot, "architecture-high");
  const detailBase = path.join(input.outputRoot, "architecture-detail");
  await fs.mkdir(input.outputRoot, { recursive: true });
  const high = run(
    input.node,
    [
      input.cli,
      "map",
      input.root,
      "--level",
      "high",
      "--format",
      "mermaid",
      "--out",
      highBase,
    ],
    { timeout: 180_000 },
  );
  const detail = run(
    input.node,
    [
      input.cli,
      "map",
      input.root,
      "--level",
      "detail",
      "--format",
      "mermaid",
      "--out",
      detailBase,
    ],
    { timeout: 180_000 },
  );
  await writeLog(path.join(input.outputRoot, "high.log"), high);
  await writeLog(path.join(input.outputRoot, "detail.log"), detail);
  const highMermaid = `${highBase}.mermaid`;
  const detailMermaid = `${detailBase}.mermaid`;
  const complete =
    high.status === 0 &&
    detail.status === 0 &&
    (await pathExists(highMermaid)) &&
    (await pathExists(detailMermaid));
  return {
    status: complete ? ("pass" as const) : ("fail" as const),
    milliseconds: high.milliseconds + detail.milliseconds,
    highMilliseconds: high.milliseconds,
    detailMilliseconds: detail.milliseconds,
    high: complete
      ? parseMermaid(await fs.readFile(highMermaid, "utf8"))
      : null,
    detail: complete
      ? parseMermaid(await fs.readFile(detailMermaid, "utf8"))
      : null,
    stdoutSummary: [high.stdout.trim(), detail.stdout.trim()]
      .filter(Boolean)
      .join("\n"),
    errors: [
      high.stderr.trim(),
      detail.stderr.trim(),
      high.error,
      detail.error,
    ].filter(Boolean),
    artifacts: {
      highMermaid,
      highHtml: `${highBase}.html`,
      detailMermaid,
      detailHtml: `${detailBase}.html`,
    },
  };
}

async function benchmarkDependencyCruiser(input: {
  node: string;
  cli: string;
  root: string;
  outputRoot: string;
  extensionCounts: Record<string, number>;
}) {
  const supportedFiles = sumExtensions(input.extensionCounts, [
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".ts",
    ".tsx",
  ]);
  if (!supportedFiles) {
    return {
      status: "not-applicable" as const,
      reason: "No JavaScript or TypeScript files in Witch's workspace listing.",
      supportedFiles,
    };
  }
  await fs.mkdir(input.outputRoot, { recursive: true });
  const output = path.join(input.outputRoot, "dependencies.json");
  const result = run(
    input.node,
    [
      input.cli,
      "--no-config",
      "--output-type",
      "json",
      "--exclude",
      "node_modules",
      "--output-to",
      output,
      ".",
    ],
    { cwd: input.root, timeout: 240_000, maxBuffer: 64 * 1024 * 1024 },
  );
  await writeLog(path.join(input.outputRoot, "run.log"), result);
  if (result.status !== 0 || !(await pathExists(output))) {
    return {
      status: statusFrom(result),
      supportedFiles,
      milliseconds: result.milliseconds,
      error: result.stderr.trim() || result.error || "No JSON output produced.",
      artifact: output,
    };
  }
  const parsed = await readJson<{
    modules?: Array<{
      source: string;
      orphan?: boolean;
      dependencies?: Array<{
        resolved?: string;
        circular?: boolean;
        couldNotResolve?: boolean;
        coreModule?: boolean;
      }>;
    }>;
    summary?: { totalCruised?: number; violations?: unknown[] };
  }>(output);
  const modules = parsed.modules || [];
  const dependencies = modules.flatMap((module) => module.dependencies || []);
  return {
    status: "pass" as const,
    supportedFiles,
    milliseconds: result.milliseconds,
    modules: modules.length,
    edges: dependencies.length,
    unresolved: dependencies.filter((dependency) => dependency.couldNotResolve)
      .length,
    circularEdges: dependencies.filter((dependency) => dependency.circular)
      .length,
    orphanModules: modules.filter((module) => module.orphan).length,
    violations: parsed.summary?.violations?.length || 0,
    totalCruised: parsed.summary?.totalCruised || modules.length,
    artifact: output,
  };
}

async function benchmarkCode2Flow(input: {
  cli: string;
  nodeBin: string;
  root: string;
  outputRoot: string;
  extensionCounts: Record<string, number>;
}) {
  const languages = [
    {
      id: "py",
      count: input.extensionCounts[".py"] || 0,
      extraArgs: [] as string[],
    },
    {
      id: "js",
      count: input.extensionCounts[".js"] || 0,
      extraArgs: ["--source-type", "module"],
    },
  ].filter((language) => language.count > 0);
  if (!languages.length) {
    return {
      status: "not-applicable" as const,
      reason: "No .py or .js files supported by code2flow.",
      supportedFiles: 0,
      runs: [],
    };
  }
  await fs.mkdir(input.outputRoot, { recursive: true });
  const runs = [];
  for (const language of languages) {
    const output = path.join(input.outputRoot, `${language.id}.json`);
    const result = run(
      input.cli,
      [
        input.root,
        "--language",
        language.id,
        "--output",
        output,
        "--skip-parse-errors",
        "--quiet",
        ...language.extraArgs,
      ],
      {
        timeout: 240_000,
        maxBuffer: 32 * 1024 * 1024,
        env: {
          ...process.env,
          PATH: `${input.nodeBin}${path.delimiter}${process.env.PATH || ""}`,
        },
      },
    );
    await writeLog(path.join(input.outputRoot, `${language.id}.log`), result);
    let graph: { graph?: { nodes?: object; edges?: unknown[] } } | null = null;
    if (result.status === 0 && (await pathExists(output))) {
      try {
        graph = await readJson(output);
      } catch {
        graph = null;
      }
    }
    const nodes = graph?.graph?.nodes
      ? Object.keys(graph.graph.nodes).length
      : 0;
    const edges = graph?.graph?.edges?.length || 0;
    runs.push({
      language: language.id,
      supportedFiles: language.count,
      status:
        result.status === 0 && graph ? ("pass" as const) : ("fail" as const),
      milliseconds: result.milliseconds,
      nodes,
      edges,
      warnings: result.stderr
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      artifact: output,
      error:
        result.status === 0 && graph
          ? null
          : result.error || result.stderr.trim() || "No readable JSON output.",
    });
  }
  const passed = runs.filter((item) => item.status === "pass");
  return {
    status:
      passed.length === runs.length
        ? ("pass" as const)
        : passed.length
          ? ("warning" as const)
          : ("fail" as const),
    supportedFiles: runs.reduce(
      (total, item) => total + item.supportedFiles,
      0,
    ),
    milliseconds: runs.reduce((total, item) => total + item.milliseconds, 0),
    nodes: passed.reduce((total, item) => total + item.nodes, 0),
    edges: passed.reduce((total, item) => total + item.edges, 0),
    runs,
  };
}

async function ensureGitNexusSandbox(source: string, destination: string) {
  if (!(await pathExists(destination))) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const clone = run(
      "git",
      ["clone", "--quiet", "--no-hardlinks", source, destination],
      { timeout: 300_000 },
    );
    if (clone.status !== 0) {
      throw new Error(
        `Could not create GitNexus sandbox: ${clone.stderr || clone.error}`,
      );
    }
  }
  const sourceCommit = run("git", ["-C", source, "rev-parse", "HEAD"]);
  const destinationCommit = run("git", [
    "-C",
    destination,
    "rev-parse",
    "HEAD",
  ]);
  if (
    sourceCommit.status !== 0 ||
    destinationCommit.status !== 0 ||
    sourceCommit.stdout.trim() !== destinationCommit.stdout.trim()
  ) {
    throw new Error("GitNexus sandbox does not match the fixed source commit.");
  }
}

async function benchmarkGitNexus(input: {
  node: string;
  cli: string;
  sourceRoot: string;
  sandboxRoot: string;
  outputRoot: string;
  home: string;
  identityCache: string;
  alias: string;
}) {
  try {
    await ensureGitNexusSandbox(input.sourceRoot, input.sandboxRoot);
  } catch (error) {
    return {
      status: "fail" as const,
      coldWallMilliseconds: 0,
      error: error instanceof Error ? error.message : String(error),
      metaPath: path.join(input.sandboxRoot, ".gitnexus", "gitnexus.json"),
    };
  }
  await fs.mkdir(input.outputRoot, { recursive: true });
  await fs.mkdir(input.home, { recursive: true });
  await fs.mkdir(input.identityCache, { recursive: true });
  const env = {
    ...process.env,
    GITNEXUS_HOME: input.home,
    GITNEXUS_ANALYZER_IDENTITY_CACHE_DIR: input.identityCache,
  };
  const analyzeArgs = [
    input.cli,
    "analyze",
    input.sandboxRoot,
    "--index-only",
    "--skip-git",
    "--name",
    input.alias,
    "--workers",
    "2",
  ];
  const cold = run(input.node, analyzeArgs, {
    env,
    timeout: 900_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  await writeLog(path.join(input.outputRoot, "cold.log"), cold);
  const metaPath = path.join(input.sandboxRoot, ".gitnexus", "gitnexus.json");
  if (cold.status !== 0 || !(await pathExists(metaPath))) {
    return {
      status: "fail" as const,
      coldWallMilliseconds: cold.milliseconds,
      error:
        cold.stderr.trim() || cold.error || "No GitNexus metadata produced.",
      metaPath,
    };
  }
  const warm = run(input.node, analyzeArgs, {
    env,
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  await writeLog(path.join(input.outputRoot, "warm.log"), warm);
  const relationQuery = run(
    input.node,
    [
      input.cli,
      "cypher",
      "MATCH (a)-[r]->(b) RETURN r.type AS relation, count(r) AS count ORDER BY count DESC",
      "--repo",
      input.alias,
      "--limit",
      "50",
    ],
    { env, timeout: 120_000 },
  );
  const nodeQuery = run(
    input.node,
    [
      input.cli,
      "cypher",
      "MATCH (n) RETURN labels(n) AS labels, count(n) AS count ORDER BY count DESC",
      "--repo",
      input.alias,
      "--limit",
      "50",
    ],
    { env, timeout: 120_000 },
  );
  await writeLog(path.join(input.outputRoot, "relations.log"), relationQuery);
  await writeLog(path.join(input.outputRoot, "nodes.log"), nodeQuery);
  const meta = await readJson<{
    stats?: {
      files?: number;
      nodes?: number;
      edges?: number;
      communities?: number;
      processes?: number;
      embeddings?: number;
    };
    capabilities?: object;
    unresolvedReceiverMembers?: { counts?: Record<string, number> };
  }>(metaPath);
  const relationKinds = Object.fromEntries(
    parseMarkdownTable(relationQuery.stdout).map((row) => [
      row.relation,
      Number(row.count) || 0,
    ]),
  );
  const nodeKinds = Object.fromEntries(
    parseMarkdownTable(nodeQuery.stdout).map((row) => [
      row.labels,
      Number(row.count) || 0,
    ]),
  );
  const unresolvedReceiverMembers = Object.values(
    meta.unresolvedReceiverMembers?.counts || {},
  ).reduce((total, count) => total + count, 0);
  const warningLines = `${cold.stdout}\n${cold.stderr}`
    .split(/\r?\n/)
    .filter(
      (line) =>
        /truncat|missing|dropped|skipped|unavailable/i.test(line) &&
        !/index-only/i.test(line),
    );
  return {
    status:
      cold.status === 0 && warm.status === 0
        ? warningLines.length
          ? ("warning" as const)
          : ("pass" as const)
        : ("warning" as const),
    coldWallMilliseconds: cold.milliseconds,
    coldReportedAnalysisMilliseconds: parseReportedSeconds(
      `${cold.stdout}\n${cold.stderr}`,
    ),
    warmWallMilliseconds: warm.milliseconds,
    warmReportedAnalysisMilliseconds: parseReportedSeconds(
      `${warm.stdout}\n${warm.stderr}`,
    ),
    stats: meta.stats || {},
    relationKinds,
    nodeKinds,
    unresolvedReceiverMembers,
    warnings: warningLines,
    capabilities: meta.capabilities || {},
    indexBytes: await directoryBytes(path.join(input.sandboxRoot, ".gitnexus")),
    metaPath,
  };
}

async function main() {
  const corpusRoot = requireAbsoluteArgument("--corpus-root", 0);
  const witchResultsRoot = requireAbsoluteArgument("--witch-results", 1);
  const toolRoot = requireAbsoluteArgument("--tool-root", 2);
  const outputRoot = requireAbsoluteArgument("--output-root", 3);
  const requestedSandboxRoot =
    argument("--gitnexus-sandbox-root") ||
    (process.argv.includes("--corpus-root")
      ? undefined
      : positionalArguments()[4]);
  const gitNexusSandboxRoot = requestedSandboxRoot
    ? path.resolve(requestedSandboxRoot)
    : path.join(outputRoot, "gitnexus-sandboxes");
  if (!path.isAbsolute(gitNexusSandboxRoot)) {
    throw new Error("--gitnexus-sandbox-root must be an absolute path");
  }
  const selected = new Set(
    (
      argument("--tools") ||
      "repo-cartographer,dependency-cruiser,code2flow,gitnexus"
    )
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  const node = process.execPath;
  const node2218 = path.join(
    toolRoot,
    "node-runtime",
    "node_modules",
    "node",
    "bin",
    "node.exe",
  );
  const cartographerCli = path.join(
    toolRoot,
    "node_modules",
    "repo-cartographer",
    "dist",
    "index.js",
  );
  const dependencyCruiserCli = path.join(
    toolRoot,
    "node_modules",
    "dependency-cruiser",
    "bin",
    "dependency-cruise.mjs",
  );
  const code2flowCli = path.join(
    toolRoot,
    "python-env",
    "Scripts",
    "code2flow.exe",
  );
  const gitNexusCli = path.join(
    toolRoot,
    "node_modules",
    "gitnexus",
    "dist",
    "cli",
    "index.js",
  );
  const requiredPaths = [
    ...(selected.has("repo-cartographer") ? [cartographerCli] : []),
    ...(selected.has("dependency-cruiser")
      ? [
          dependencyCruiserCli,
          path.join(toolRoot, "node_modules", "typescript", "package.json"),
        ]
      : []),
    ...(selected.has("code2flow")
      ? [code2flowCli, path.join(toolRoot, "node_modules", ".bin", "acorn.cmd")]
      : []),
    ...(selected.has("gitnexus") ? [node2218, gitNexusCli] : []),
  ];
  for (const target of requiredPaths) {
    if (!(await pathExists(target))) {
      throw new Error(`Required benchmark tool is missing: ${target}`);
    }
  }
  if (await pathExists(path.join(outputRoot, "summary.json"))) {
    throw new Error(
      `Refusing to overwrite an existing benchmark: ${path.join(outputRoot, "summary.json")}`,
    );
  }
  await fs.mkdir(outputRoot, { recursive: true });
  const corpusDirectories = (
    await fs.readdir(corpusRoot, { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const repositories = [];
  for (const [index, entry] of corpusDirectories.entries()) {
    const rank = index + 1;
    const root = path.join(corpusRoot, entry.name);
    const witchResultPath = path.join(
      witchResultsRoot,
      `${String(rank).padStart(2, "0")}.json`,
    );
    const witch = await readJson<{
      rank: number;
      slug: string;
      commit: string;
      listing: {
        totalFiles: number;
        extensions: Record<string, number>;
      };
      analysis: {
        indexedFiles: number;
        deepLanguageFiles: number;
        symbols: number;
        fileRelations: number;
        coldMilliseconds: number;
        warmMilliseconds: number;
        persistentRestartMilliseconds: number;
        maxResidentMB: number;
        semanticViews: Record<
          string,
          {
            totalNodes: number;
            totalEdges: number;
            visibleNodes: number;
            visibleEdges: number;
            quality: string;
          }
        >;
      };
      semantic: {
        nodes: number;
        relations: number;
        workflows: { total: number; production: number; support: number };
        relationKinds: Record<string, number>;
      };
    }>(witchResultPath);
    const commit = run("git", ["-C", root, "rev-parse", "HEAD"]);
    if (commit.status !== 0 || commit.stdout.trim() !== witch.commit) {
      throw new Error(
        `${witch.slug} no longer matches the fixed Witch result.`,
      );
    }
    const resultDirectory = path.join(
      outputRoot,
      `${String(rank).padStart(2, "0")}-${witch.slug.replace("/", "--")}`,
    );
    const savedResultPath = path.join(resultDirectory, "result.json");
    if (await pathExists(savedResultPath)) {
      process.stdout.write(
        `[${rank}/${corpusDirectories.length}] ${witch.slug} (resume)\n`,
      );
      repositories.push(await readJson(savedResultPath));
      continue;
    }
    const extensionCounts = witch.listing.extensions;
    const item: Record<string, unknown> = {
      rank,
      slug: witch.slug,
      commit: witch.commit,
      root,
      listing: {
        totalFiles: witch.listing.totalFiles,
        codeFiles: Object.values(codeExtensionCounts(extensionCounts)).reduce(
          (total, count) => total + count,
          0,
        ),
        codeExtensions: codeExtensionCounts(extensionCounts),
      },
      witch: {
        status: "pass",
        coldMilliseconds: witch.analysis.coldMilliseconds,
        warmMilliseconds: witch.analysis.warmMilliseconds,
        persistentRestartMilliseconds:
          witch.analysis.persistentRestartMilliseconds,
        indexedFiles: witch.analysis.indexedFiles,
        deepFiles: witch.analysis.deepLanguageFiles,
        symbols: witch.analysis.symbols,
        fileRelations: witch.analysis.fileRelations,
        semanticNodes: witch.semantic.nodes,
        semanticRelations: witch.semantic.relations,
        workflows: witch.semantic.workflows,
        relationKinds: witch.semantic.relationKinds,
        workflowProjection: witch.analysis.semanticViews.workflows,
        maxResidentMB: witch.analysis.maxResidentMB,
      },
    };
    process.stdout.write(
      `[${rank}/${corpusDirectories.length}] ${witch.slug}\n`,
    );
    if (selected.has("repo-cartographer")) {
      item.repoCartographer = await benchmarkCartographer({
        node,
        cli: cartographerCli,
        root,
        outputRoot: path.join(resultDirectory, "repo-cartographer"),
      });
    }
    if (selected.has("dependency-cruiser")) {
      item.dependencyCruiser = await benchmarkDependencyCruiser({
        node,
        cli: dependencyCruiserCli,
        root,
        outputRoot: path.join(resultDirectory, "dependency-cruiser"),
        extensionCounts,
      });
    }
    if (selected.has("code2flow")) {
      item.code2flow = await benchmarkCode2Flow({
        cli: code2flowCli,
        nodeBin: path.join(toolRoot, "node_modules", ".bin"),
        root,
        outputRoot: path.join(resultDirectory, "code2flow"),
        extensionCounts,
      });
    }
    if (selected.has("gitnexus")) {
      item.gitNexus = await benchmarkGitNexus({
        node: node2218,
        cli: gitNexusCli,
        sourceRoot: root,
        sandboxRoot: path.join(
          gitNexusSandboxRoot,
          `${String(rank).padStart(2, "0")}-${entry.name.slice(3)}`,
        ),
        outputRoot: path.join(resultDirectory, "gitnexus"),
        home: path.join(toolRoot, "gitnexus-home-benchmark"),
        identityCache: path.join(toolRoot, "gitnexus-identity-cache"),
        alias: `witch-bench-20260831-${String(rank).padStart(2, "0")}`,
      });
    }
    repositories.push(item);
    await fs.mkdir(resultDirectory, { recursive: true });
    await fs.writeFile(
      path.join(resultDirectory, "result.json"),
      `${JSON.stringify(item, null, 2)}\n`,
      "utf8",
    );
  }
  const summary = {
    contractVersion: 1,
    generatedAt: new Date().toISOString(),
    safety: {
      targetRepositoryCodeExecuted: false,
      targetDependenciesInstalled: false,
      targetBuildsOrTestsRun: false,
      gitNexusUsedIsolatedClones: true,
      unsupportedLanguagesScoredAsFailure: false,
    },
    environment: {
      platform: process.platform,
      architecture: process.arch,
      witchNode: process.version,
      gitNexusNode: run(node2218, ["--version"]).stdout.trim(),
      corpusRoot,
      witchResultsRoot,
      toolRoot,
      gitNexusSandboxRoot,
    },
    tools: {
      witch: { version: "0.2.0", license: "project" },
      repoCartographer: { version: "1.0.1", license: "MIT" },
      dependencyCruiser: { version: "18.2.0", license: "MIT" },
      code2flow: { version: "2.5.1", license: "MIT" },
      gitNexus: {
        version: "1.6.10",
        license: "PolyForm-Noncommercial-1.0.0",
        embeddings: false,
        pdg: false,
      },
    },
    selectedTools: [...selected],
    repositories,
  };
  await fs.writeFile(
    path.join(outputRoot, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${path.join(outputRoot, "summary.json")}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
