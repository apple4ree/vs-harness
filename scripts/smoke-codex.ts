// Explicit opt-in live integration check. Uses only an artificial project, never the Witch sources.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { AgentService } from "../apps/desktop/src/main/services/agent-service";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import type { AgentRun } from "../apps/desktop/src/shared/agent";
import { findCliExecutable } from "../apps/desktop/src/main/services/cli-discovery";

async function main() {
  if (process.env.WITCH_LIVE_CODEX_TEST !== "1")
    throw new Error(
      "Set WITCH_LIVE_CODEX_TEST=1 to authorize a live Codex fixture test",
    );
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-live-codex-"),
  );
  const root = path.join(directory, "project");
  await fs.mkdir(root);
  const original = 'export const greeting = "Hello";\n';
  await fs.writeFile(path.join(root, "greeting.ts"), original);
  const graph = await analyzeRepository(root);
  const service = new AgentService({
    dataDirectory: path.join(directory, "runs"),
    command: () => findCliExecutable("codex", process.env.WITCH_CODEX_PATH),
    version: "0.2.0-smoke",
  });
  let last = "";
  const done = new Promise<AgentRun>((resolve, reject) => {
    const timer = setTimeout(() => {
      void service.stop();
      reject(new Error("Live fixture test exceeded 180 seconds"));
    }, 180_000);
    service.on("event", ({ run }: { run: AgentRun }) => {
      const progress = `${run.status}: ${run.activity.at(-1) || ""}`;
      if (progress !== last) {
        process.stdout.write(progress + "\n");
        last = progress;
      }
      if (
        ["completed", "review", "failed", "interrupted"].includes(run.status)
      ) {
        clearTimeout(timer);
        resolve(run);
      }
    });
  });
  try {
    await service.start(root, graph, {
      mode: "change",
      contexts: [
        {
          nodeId: "greeting.ts",
          label: "greeting",
          paths: ["greeting.ts"],
          revision: graph.revision,
        },
      ],
      prompt:
        'Integration test: change only greeting.ts so the exported greeting string is "Welcome to Witch" instead of "Hello". Keep the export and filename. Do not create extra files, run tests, access network or use subagents. Return a brief summary.',
    });
    const run = await done;
    assert.equal(run.status, "review", run.error || run.response);
    assert.equal(
      await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
      original,
    );
    assert.deepEqual(
      run.changes.map((change) => change.path),
      ["greeting.ts"],
    );
    await service.apply(root, run.id, ["greeting.ts"]);
    assert.match(
      await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
      /Welcome to Witch/,
    );
    const updated = await analyzeRepository(root);
    assert.notEqual(updated.revision, graph.revision);
    process.stdout.write(
      `PASS: actual Codex -> isolated edit -> selected apply -> graph revision changed\nEvidence directory: ${directory}\n`,
    );
  } finally {
    await service.stop();
  }
}
main().catch((error) => {
  process.stderr.write(String(error) + "\n");
  process.exitCode = 1;
});
