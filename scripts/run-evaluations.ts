import { promises as fs } from "node:fs";
import path from "node:path";
import {
  deterministicFakeEvaluationProvider,
  runEvaluationMatrix,
} from "../apps/desktop/src/main/services/evaluation-harness";

async function main() {
  const evaluationRoot = path.resolve(process.argv[2] || "evals");
  const entries = await fs.readdir(evaluationRoot, { withFileTypes: true });
  const fixtures = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(evaluationRoot, entry.name));
  const result = await runEvaluationMatrix(fixtures, [
    deterministicFakeEvaluationProvider,
  ]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
