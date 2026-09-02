import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";

type CaseResult = {
  caseId: string;
  goldEdges: number;
  scopedGoldEdges: number;
  witchEdges: number;
  truePositive: number;
  scopedTruePositive: number;
  falsePositive: number;
  falseNegative: number;
  exact: boolean;
  scopedExact: boolean;
  missed: string[];
  extra: string[];
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

function moduleName(relativePath: string) {
  return relativePath
    .replace(/\\/g, "/")
    .replace(/\.(?:py|js|jsx|ts|tsx|rs)$/i, "")
    .replace(/\/__init__$/i, "")
    .replace(/\//g, ".");
}

const ratio = (numerator: number, denominator: number) =>
  denominator === 0 ? 1 : numerator / denominator;

export async function evaluateCallgraphBenchmark(benchmarkRoot: string) {
  const relativeBenchmarkRoot = path.relative(process.cwd(), benchmarkRoot);
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(
      await fs.readFile(path.join(benchmarkRoot, "benchmark.json"), "utf8"),
    ) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const callgraphs = await findFiles(benchmarkRoot, "callgraph.json");
  if (!callgraphs.length)
    throw new Error(`No callgraph.json fixtures found under ${benchmarkRoot}`);
  const cases: CaseResult[] = [];
  const errors: Array<{ caseId: string; message: string }> = [];

  for (const callgraphPath of callgraphs) {
    const caseRoot = path.dirname(callgraphPath);
    const caseId = path.relative(benchmarkRoot, caseRoot).replace(/\\/g, "/");
    try {
      const gold = JSON.parse(
        await fs.readFile(callgraphPath, "utf8"),
      ) as Record<string, string[]>;
      const internalNames = new Set(Object.keys(gold));
      const goldSet = new Set<string>();
      for (const [from, targets] of Object.entries(gold))
        for (const to of targets)
          if (internalNames.has(to)) goldSet.add(`${from} -> ${to}`);

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
          `${moduleName(node.path)}.${source?.symbol.qualifiedName || node.label}`,
        );
      }

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
          `${moduleName(from.path)}.${fromSource?.symbol.qualifiedName || from.label} -> ${moduleName(to.path)}.${toSource?.symbol.qualifiedName || to.label}`,
        );
      }

      const scopedGold = new Set(
        [...goldSet].filter((edge) => {
          const [from, to] = edge.split(" -> ");
          return declared.has(from) && declared.has(to);
        }),
      );
      const truePositive = [...witchSet].filter((edge) => goldSet.has(edge));
      const scopedTruePositive = [...witchSet].filter((edge) =>
        scopedGold.has(edge),
      );
      const missed = [...goldSet].filter((edge) => !witchSet.has(edge));
      const extra = [...witchSet].filter((edge) => !goldSet.has(edge));
      cases.push({
        caseId,
        goldEdges: goldSet.size,
        scopedGoldEdges: scopedGold.size,
        witchEdges: witchSet.size,
        truePositive: truePositive.length,
        scopedTruePositive: scopedTruePositive.length,
        falsePositive: extra.length,
        falseNegative: missed.length,
        exact: extra.length === 0 && missed.length === 0,
        scopedExact:
          extra.length === 0 && scopedTruePositive.length === scopedGold.size,
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
      goldEdges: sum.goldEdges + item.goldEdges,
      scopedGoldEdges: sum.scopedGoldEdges + item.scopedGoldEdges,
      witchEdges: sum.witchEdges + item.witchEdges,
      truePositive: sum.truePositive + item.truePositive,
      scopedTruePositive: sum.scopedTruePositive + item.scopedTruePositive,
      falsePositive: sum.falsePositive + item.falsePositive,
      falseNegative: sum.falseNegative + item.falseNegative,
    }),
    {
      goldEdges: 0,
      scopedGoldEdges: 0,
      witchEdges: 0,
      truePositive: 0,
      scopedTruePositive: 0,
      falsePositive: 0,
      falseNegative: 0,
    },
  );
  const precision = ratio(totals.truePositive, totals.witchEdges);
  const recall = ratio(totals.truePositive, totals.goldEdges);
  const scopedPrecision = ratio(totals.scopedTruePositive, totals.witchEdges);
  const scopedRecall = ratio(totals.scopedTruePositive, totals.scopedGoldEdges);
  const result = {
    contract: "witch.external-callgraph-evaluation/v1",
    source:
      typeof metadata.name === "string"
        ? metadata.name
        : `SWARM-CG ${path.basename(benchmarkRoot)}`,
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
    totals,
    metrics: {
      precision,
      recall,
      f1: ratio(2 * precision * recall, precision + recall),
      scopedPrecision,
      scopedRecall,
      scopedF1: ratio(
        2 * scopedPrecision * scopedRecall,
        scopedPrecision + scopedRecall,
      ),
    },
    errors,
    cases,
  };
  return result;
}

async function main() {
  const benchmarkRoot = process.argv[2] ? path.resolve(process.argv[2]) : null;
  const outputPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (!benchmarkRoot || !outputPath)
    throw new Error(
      "Usage: npm run benchmark:callgraph -- <benchmark-root> <output.json>",
    );
  const result = await evaluateCallgraphBenchmark(benchmarkRoot);
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
