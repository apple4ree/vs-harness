import { promises as fs } from "node:fs";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  // npm on Windows may consume unknown `--name` flags while retaining their
  // values, so the runner also accepts `<root> <output>` positionally.
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
      `Behavior benchmark requires exactly 10 fixed repositories; found ${repositories.length}`,
    );
  const results: Array<Record<string, unknown>> = [];
  for (const repository of repositories) {
    const started = performance.now();
    const repositoryRoot = path.join(root, repository.name);
    try {
      const graph = await analyzeRepository(repositoryRoot);
      const behavior = graph.behavior;
      results.push({
        repository: repository.name,
        milliseconds: Math.round(performance.now() - started),
        sourceRevision: graph.revision,
        architectureValid: graph.validation.valid,
        semanticValid: graph.semantic?.validation.valid === true,
        behaviorValid: behavior?.validation.valid === true,
        behaviorRevision: behavior?.revision,
        values: behavior?.values.length || 0,
        relations: behavior?.relations.length || 0,
        verified: behavior?.validation.verifiedCount || 0,
        inferred: behavior?.validation.inferredCount || 0,
        diagnostics: behavior?.validation.diagnostics || [],
      });
    } catch (error) {
      results.push({
        repository: repository.name,
        milliseconds: Math.round(performance.now() - started),
        failure: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const payload = {
    contract: "witch.behavior-benchmark/v1",
    generatedAt: new Date().toISOString(),
    corpusRoot: root,
    repositories: results,
    summary: {
      total: results.length,
      valid: results.filter((result) => result.behaviorValid === true).length,
      invalid: results.filter(
        (result) => result.behaviorValid !== true || "failure" in result,
      ).length,
      relations: results.reduce(
        (total, result) => total + Number(result.relations || 0),
        0,
      ),
    },
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (output) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, json, "utf8");
  }
  process.stdout.write(json);
  if (payload.summary.invalid) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
