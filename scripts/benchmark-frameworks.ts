import { promises as fs } from "node:fs";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  const requestedRoot = argument("--root") || positional[0];
  const output = argument("--output") || positional[1];
  if (!requestedRoot || !path.isAbsolute(requestedRoot))
    throw new Error("--root must be an absolute fixed-corpus directory");
  if (output && !path.isAbsolute(output))
    throw new Error("--output must be an absolute JSON path");
  const root = await fs.realpath(requestedRoot);
  const repositories = (await fs.readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (repositories.length !== 10)
    throw new Error(
      `Framework benchmark requires exactly 10 fixed repositories; found ${repositories.length}`,
    );
  const results: Array<Record<string, unknown>> = [];
  for (const repository of repositories) {
    const started = performance.now();
    try {
      const graph = await analyzeRepository(path.join(root, repository.name));
      const frameworks = graph.frameworks;
      const valid = Boolean(
        graph.validation.valid &&
          graph.semantic?.validation.valid &&
          graph.behavior?.validation.valid &&
          frameworks?.validation.valid,
      );
      results.push({
        repository: repository.name,
        milliseconds: Math.round(performance.now() - started),
        valid,
        sourceRevision: graph.revision,
        frameworkRevision: frameworks?.revision || null,
        detections: frameworks?.validation.detectionCount || 0,
        candidates: frameworks?.validation.candidateCount || 0,
        excluded: frameworks?.validation.excludedCount || 0,
        coverage:
          frameworks?.coverage.filter(
            (item) => item.detectedFiles || item.candidateCount || item.excludedCount,
          ) || [],
        diagnostics: frameworks?.validation.diagnostics || [
          { code: "FRAMEWORK_GRAPH_MISSING" },
        ],
      });
    } catch (error) {
      results.push({
        repository: repository.name,
        milliseconds: Math.round(performance.now() - started),
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const report = {
    contract: "witch.framework-benchmark/v1",
    generatedAt: new Date().toISOString(),
    corpusRoot: root,
    repositories: results,
    summary: {
      total: results.length,
      valid: results.filter((item) => item.valid).length,
      invalid: results.filter((item) => !item.valid).length,
      detections: results.reduce(
        (total, item) => total + Number(item.detections || 0),
        0,
      ),
      candidates: results.reduce(
        (total, item) => total + Number(item.candidates || 0),
        0,
      ),
      excluded: results.reduce(
        (total, item) => total + Number(item.excluded || 0),
        0,
      ),
    },
  };
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.invalid) process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
