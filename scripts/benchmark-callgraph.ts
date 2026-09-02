import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  analyzeRepository,
  ARCHITECTURE_ANALYZER_VERSION,
} from "../apps/desktop/src/main/services/architecture";
import { SEMANTIC_ANALYZER_VERSION } from "../apps/desktop/src/main/services/semantic-analysis";

type CaseResult = {
  caseId: string;
  oracleSymbols: number;
  scopedOracleSymbols: number;
  goldEdges: number;
  scopedGoldEdges: number;
  witchEdges: number;
  scopedWitchEdges: number;
  truePositive: number;
  scopedTruePositive: number;
  falsePositive: number;
  scopedFalsePositive: number;
  falseNegative: number;
  scopedFalseNegative: number;
  exact: boolean;
  scopedExact: boolean;
  missed: string[];
  extra: string[];
};

type BenchmarkCaseDefinition = {
  id: string;
  root: string;
  callgraph: string;
};

type BenchmarkMetadata = Record<string, unknown> & {
  cases?: BenchmarkCaseDefinition[];
  oracleFormat?: "adjacency" | "dypybench-dynapyt";
  sourceRoots?: string[];
};

async function findFiles(root: string, name: string) {
  const output: string[] = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop()!;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.name === name) output.push(absolute);
    }
  }
  return output.sort();
}

function moduleName(relativePath: string, sourceRoots: string[] = []) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const sourceRoot = sourceRoots.find(
    (candidate) =>
      normalizedPath === candidate ||
      normalizedPath.startsWith(`${candidate}/`),
  );
  const rootedPath = sourceRoot
    ? normalizedPath.slice(sourceRoot.length).replace(/^\//, "")
    : normalizedPath;
  return rootedPath
    .replace(/\.(?:py|js|jsx|ts|tsx|rs)$/i, "")
    .replace(/\/__init__$/i, "")
    .replace(/\//g, ".");
}

function dypybenchCandidates(value: string, sourceRoots: string[]) {
  const base = value.replace(/^\.?DyPyBench\.temp\.project\d+\./, "");
  const candidates = new Set([base]);
  for (const sourceRoot of sourceRoots) {
    const prefix = `${sourceRoot.replace(/\//g, ".")}.`;
    if (base.startsWith(prefix)) candidates.add(base.slice(prefix.length));
  }
  const pending = [...candidates];
  while (pending.length) {
    const candidate = pending.pop()!;
    const matches = [...candidate.matchAll(/\.__init__(?=\.|$)/g)];
    for (const match of matches) {
      const next = `${candidate.slice(0, match.index)}${candidate.slice(
        match.index! + ".__init__".length,
      )}`;
      if (!candidates.has(next)) {
        candidates.add(next);
        pending.push(next);
      }
    }
  }
  return [...candidates];
}

export function normalizeOracleSymbol(
  value: string,
  format: BenchmarkMetadata["oracleFormat"],
  declared: ReadonlySet<string>,
  sourceRoots: string[] = [],
) {
  const candidates =
    format === "dypybench-dynapyt"
      ? dypybenchCandidates(value, sourceRoots)
      : [value];
  return (
    candidates.find((candidate) => declared.has(candidate)) || candidates[0]
  );
}

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? 1 : numerator / denominator;

export const f1Score = (precision: number, recall: number) =>
  precision + recall === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);

export function resolveBenchmarkPath(
  benchmarkRoot: string,
  relativePath: string,
) {
  if (!relativePath || path.isAbsolute(relativePath))
    throw new Error(
      `Benchmark paths must be non-empty and relative: ${relativePath}`,
    );
  const resolved = path.resolve(benchmarkRoot, relativePath);
  const relative = path.relative(benchmarkRoot, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    throw new Error(`Benchmark path escapes its corpus root: ${relativePath}`);
  return resolved;
}

export async function evaluateCallgraphBenchmark(
  benchmarkRoot: string,
  manifestPath?: string,
) {
  benchmarkRoot = path.resolve(benchmarkRoot);
  const relativeBenchmarkRoot = path.relative(process.cwd(), benchmarkRoot);
  let metadata: BenchmarkMetadata = {};
  try {
    metadata = JSON.parse(
      await fs.readFile(
        manifestPath || path.join(benchmarkRoot, "benchmark.json"),
        "utf8",
      ),
    ) as BenchmarkMetadata;
  } catch (error) {
    if (manifestPath || (error as NodeJS.ErrnoException).code !== "ENOENT")
      throw error;
  }
  const configuredCases = metadata.cases;
  if (
    metadata.oracleFormat !== undefined &&
    metadata.oracleFormat !== "adjacency" &&
    metadata.oracleFormat !== "dypybench-dynapyt"
  )
    throw new Error(`Unsupported oracle format: ${metadata.oracleFormat}`);
  if (
    metadata.sourceRoots !== undefined &&
    (!Array.isArray(metadata.sourceRoots) ||
      metadata.sourceRoots.some(
        (item) =>
          typeof item !== "string" ||
          !item ||
          path.isAbsolute(item) ||
          item.replace(/\\/g, "/").split("/").includes(".."),
      ))
  )
    throw new Error("Benchmark sourceRoots must contain safe relative paths");
  const sourceRoots = (metadata.sourceRoots || []).map((item) =>
    item.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, ""),
  );
  if (
    configuredCases !== undefined &&
    (!Array.isArray(configuredCases) ||
      configuredCases.some(
        (item) =>
          !item ||
          typeof item.id !== "string" ||
          typeof item.root !== "string" ||
          typeof item.callgraph !== "string",
      ))
  )
    throw new Error(
      "Benchmark manifest cases must provide id, root, and callgraph strings",
    );
  if (
    configuredCases &&
    new Set(configuredCases.map((item) => item.id)).size !==
      configuredCases.length
  )
    throw new Error("Benchmark manifest case ids must be unique");
  const caseInputs = configuredCases?.length
    ? configuredCases.map((item) => ({
        caseId: item.id,
        caseRoot: resolveBenchmarkPath(benchmarkRoot, item.root),
        callgraphPath: resolveBenchmarkPath(benchmarkRoot, item.callgraph),
      }))
    : (await findFiles(benchmarkRoot, "callgraph.json")).map(
        (callgraphPath) => ({
          caseId: path
            .relative(benchmarkRoot, path.dirname(callgraphPath))
            .replace(/\\/g, "/"),
          caseRoot: path.dirname(callgraphPath),
          callgraphPath,
        }),
      );
  if (!caseInputs.length)
    throw new Error(`No callgraph.json fixtures found under ${benchmarkRoot}`);
  const cases: CaseResult[] = [];
  const errors: Array<{ caseId: string; message: string }> = [];

  for (const { callgraphPath, caseRoot, caseId } of caseInputs) {
    try {
      const gold = JSON.parse(
        await fs.readFile(callgraphPath, "utf8"),
      ) as Record<string, string[]>;
      const graph = await analyzeRepository(caseRoot);
      const semantic = graph.semantic!;
      const semanticNodes = new Map(
        semantic.nodes.map((node) => [node.id, node]),
      );
      const sourceSymbols = new Map(
        graph.nodes.flatMap((node) =>
          node.path
            ? node.symbols.map(
                (symbol) => [symbol.id, { node, symbol }] as const,
              )
            : [],
        ),
      );
      const declared = new Set<string>();
      for (const node of semantic.nodes) {
        if (node.kind !== "symbol" || !node.path || !node.sourceSymbolId)
          continue;
        const source = sourceSymbols.get(node.sourceSymbolId);
        declared.add(
          `${moduleName(node.path, sourceRoots)}.${source?.symbol.qualifiedName || node.label}`,
        );
      }

      const normalizedEntries = Object.entries(gold).map(
        ([from, targets]) =>
          [
            normalizeOracleSymbol(
              from,
              metadata.oracleFormat,
              declared,
              sourceRoots,
            ),
            targets.map((to) =>
              normalizeOracleSymbol(
                to,
                metadata.oracleFormat,
                declared,
                sourceRoots,
              ),
            ),
          ] as const,
      );
      const internalNames = new Set(normalizedEntries.map(([from]) => from));
      const goldSet = new Set<string>();
      for (const [from, targets] of normalizedEntries)
        for (const to of targets)
          if (internalNames.has(to)) goldSet.add(`${from} -> ${to}`);

      const witchSet = new Set<string>();
      for (const relation of semantic.relations) {
        if (relation.kind !== "calls") continue;
        const from = semanticNodes.get(relation.from);
        const to = semanticNodes.get(relation.to);
        if (
          !from?.path ||
          !to?.path ||
          !from.sourceSymbolId ||
          !to.sourceSymbolId
        )
          continue;
        const fromSource = sourceSymbols.get(from.sourceSymbolId);
        const toSource = sourceSymbols.get(to.sourceSymbolId);
        witchSet.add(
          `${moduleName(from.path, sourceRoots)}.${fromSource?.symbol.qualifiedName || from.label} -> ${moduleName(to.path, sourceRoots)}.${toSource?.symbol.qualifiedName || to.label}`,
        );
      }

      const scopedGold = new Set(
        [...goldSet].filter((edge) => {
          const [from, to] = edge.split(" -> ");
          return declared.has(from) && declared.has(to);
        }),
      );
      const comparableNames = new Set(
        [...internalNames].filter((name) => declared.has(name)),
      );
      const scopedWitch = new Set(
        [...witchSet].filter((edge) => {
          const [from, to] = edge.split(" -> ");
          return comparableNames.has(from) && comparableNames.has(to);
        }),
      );
      const truePositive = [...witchSet].filter((edge) => goldSet.has(edge));
      const scopedTruePositive = [...scopedWitch].filter((edge) =>
        scopedGold.has(edge),
      );
      const missed = [...goldSet].filter((edge) => !witchSet.has(edge));
      const extra = [...witchSet].filter((edge) => !goldSet.has(edge));
      const scopedExtra = [...scopedWitch].filter(
        (edge) => !scopedGold.has(edge),
      );
      cases.push({
        caseId,
        oracleSymbols: internalNames.size,
        scopedOracleSymbols: comparableNames.size,
        goldEdges: goldSet.size,
        scopedGoldEdges: scopedGold.size,
        witchEdges: witchSet.size,
        scopedWitchEdges: scopedWitch.size,
        truePositive: truePositive.length,
        scopedTruePositive: scopedTruePositive.length,
        falsePositive: extra.length,
        scopedFalsePositive: scopedExtra.length,
        falseNegative: missed.length,
        scopedFalseNegative: scopedGold.size - scopedTruePositive.length,
        exact: extra.length === 0 && missed.length === 0,
        scopedExact:
          scopedExtra.length === 0 &&
          scopedTruePositive.length === scopedGold.size,
        missed: missed.slice(0, 12),
        extra: extra.slice(0, 12),
      });
    } catch (error) {
      errors.push({
        caseId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const totals = cases.reduce(
    (sum, item) => ({
      oracleSymbols: sum.oracleSymbols + item.oracleSymbols,
      scopedOracleSymbols: sum.scopedOracleSymbols + item.scopedOracleSymbols,
      goldEdges: sum.goldEdges + item.goldEdges,
      scopedGoldEdges: sum.scopedGoldEdges + item.scopedGoldEdges,
      witchEdges: sum.witchEdges + item.witchEdges,
      scopedWitchEdges: sum.scopedWitchEdges + item.scopedWitchEdges,
      truePositive: sum.truePositive + item.truePositive,
      scopedTruePositive: sum.scopedTruePositive + item.scopedTruePositive,
      falsePositive: sum.falsePositive + item.falsePositive,
      scopedFalsePositive: sum.scopedFalsePositive + item.scopedFalsePositive,
      falseNegative: sum.falseNegative + item.falseNegative,
      scopedFalseNegative: sum.scopedFalseNegative + item.scopedFalseNegative,
    }),
    {
      oracleSymbols: 0,
      scopedOracleSymbols: 0,
      goldEdges: 0,
      scopedGoldEdges: 0,
      witchEdges: 0,
      scopedWitchEdges: 0,
      truePositive: 0,
      scopedTruePositive: 0,
      falsePositive: 0,
      scopedFalsePositive: 0,
      falseNegative: 0,
      scopedFalseNegative: 0,
    },
  );
  const precision = ratio(totals.truePositive, totals.witchEdges);
  const recall = ratio(totals.truePositive, totals.goldEdges);
  const scopedPrecision = ratio(
    totals.scopedTruePositive,
    totals.scopedWitchEdges,
  );
  const scopedRecall = ratio(totals.scopedTruePositive, totals.scopedGoldEdges);
  const nonVacuousCases = cases.filter((item) => item.scopedGoldEdges > 0);
  const nonVacuousExactCases = nonVacuousCases.filter(
    (item) => item.scopedExact,
  );
  const vacuousScopedCases = cases.filter((item) => item.scopedGoldEdges === 0);
  const result = {
    contract: "witch.external-callgraph-evaluation/v2",
    analyzers: {
      architecture: ARCHITECTURE_ANALYZER_VERSION,
      semantic: SEMANTIC_ANALYZER_VERSION,
    },
    source:
      typeof metadata.name === "string"
        ? metadata.name
        : `Callgraph corpus ${path.basename(benchmarkRoot)}`,
    groundTruth: metadata,
    generatedAt: new Date().toISOString(),
    benchmarkRoot:
      relativeBenchmarkRoot && !relativeBenchmarkRoot.startsWith("..")
        ? relativeBenchmarkRoot.replace(/\\/g, "/")
        : benchmarkRoot,
    evaluatedCases: cases.length,
    failedCases: errors.length,
    exactCases: cases.filter((item) => item.exact).length,
    scopedExactCases: cases.filter((item) => item.scopedExact).length,
    coverage: {
      totalGoldEdges: totals.goldEdges,
      scopedGoldEdges: totals.scopedGoldEdges,
      oracleEdgeCoverage: ratio(totals.scopedGoldEdges, totals.goldEdges),
      totalOracleSymbols: totals.oracleSymbols,
      scopedOracleSymbols: totals.scopedOracleSymbols,
      oracleSymbolCoverage: ratio(
        totals.scopedOracleSymbols,
        totals.oracleSymbols,
      ),
      nonVacuousCases: nonVacuousCases.length,
      vacuousScopedCases: vacuousScopedCases.length,
      nonVacuousCaseCoverage: ratio(nonVacuousCases.length, cases.length),
      nonVacuousExactCases: nonVacuousExactCases.length,
      nonVacuousExactRate: ratio(
        nonVacuousExactCases.length,
        nonVacuousCases.length,
      ),
    },
    totals,
    metrics: {
      precision,
      recall,
      f1: f1Score(precision, recall),
      scopedPrecision,
      scopedRecall,
      scopedF1: f1Score(scopedPrecision, scopedRecall),
    },
    metricValidity: {
      precision: totals.witchEdges > 0,
      recall: totals.goldEdges > 0,
      scopedPrecision: totals.scopedWitchEdges > 0,
      scopedRecall: totals.scopedGoldEdges > 0,
      scopedF1: totals.scopedGoldEdges > 0,
    },
    errors,
    cases,
  };
  return result;
}

async function main() {
  const benchmarkRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const manifestIndex = process.argv.indexOf("--manifest");
  const manifestPath =
    manifestIndex >= 0 && process.argv[manifestIndex + 1]
      ? path.resolve(process.argv[manifestIndex + 1])
      : undefined;
  if (!benchmarkRoot || !outputPath)
    throw new Error(
      "Usage: npm run benchmark:callgraph -- <benchmark-root> <output.json> [--manifest <benchmark.json>]",
    );
  const result = await evaluateCallgraphBenchmark(benchmarkRoot, manifestPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(
    `${JSON.stringify({ ...result, cases: undefined }, null, 2)}\n`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  });
