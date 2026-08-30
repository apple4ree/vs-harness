import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";

test("pull requests and main pushes run cross-platform desktop quality gates", async () => {
  const workflow = await fs.readFile(".github/workflows/quality.yml", "utf8");
  assert.match(workflow, /^\s*pull_request:/m);
  assert.match(workflow, /^\s*push:/m);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /node-version:\s*22/);
  for (const command of [
    "npm ci",
    "npm run typecheck",
    "npm test",
    "npm run build",
    "npm run test:e2e",
  ])
    assert.match(workflow, new RegExp(command.replaceAll(" ", "\\s+")));
  assert.match(workflow, /if:\s*failure\(\)/);
  assert.match(workflow, /test-results\//);
});
