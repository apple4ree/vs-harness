import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { searchRepository } from "../apps/desktop/src/main/services/workspace-search";

test("workspace search uses literal Unicode-aware matches, ignore rules and real TS declarations", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-search-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "ignored"));
  await fs.writeFile(path.join(root, ".gitignore"), "ignored/\n*.skip\n");
  await fs.writeFile(
    path.join(root, "ignored/hidden.txt"),
    "[literal] visibleHidden",
  );
  await fs.writeFile(path.join(root, "hidden.skip"), "[literal]");
  const line = "İ [LITERAL] and [literal]";
  await fs.writeFile(path.join(root, "notes.txt"), "\uFEFF" + line + "\r\n");
  await fs.writeFile(
    path.join(root, "source.ts"),
    '/* function visiblePhantom() {} */\nconst stringValue = "class visibleFake {}";\nexport const visibleArrow = () => 1;\nexport function visibleFunction() {}\n',
  );
  await fs.writeFile(
    path.join(root, "source.py"),
    "def visiblePython():\n  pass\n",
  );
  const result = await searchRepository(root, "[literal]");
  assert.deepEqual(
    result.text.map(({ path, line, column }) => ({ path, line, column })),
    [
      { path: "notes.txt", line: 1, column: 3 },
      { path: "notes.txt", line: 1, column: line.indexOf("[literal]") + 1 },
    ],
  );
  assert.equal(result.truncated, false);
  const symbols = (await searchRepository(root, "visible")).symbols;
  assert.deepEqual(
    new Set(symbols.map((item) => item.name)),
    new Set(["visibleArrow", "visibleFunction", "visiblePython"]),
  );
  assert(
    symbols
      .filter((item) => item.path.endsWith(".ts"))
      .every((item) => item.origin === "typescript-ast"),
  );
  assert.equal(
    symbols.find((item) => item.name === "visiblePython")?.origin,
    "python-pattern",
  );
  const capped = await searchRepository(root, "[literal]", { resultLimit: 1 });
  assert.equal(capped.text.length, 1);
  assert.equal(capped.truncated, true);
  assert.match(capped.warnings.join(" "), /at most 1 matches/);
  const budget = await searchRepository(root, "visible", { byteBudget: 1 });
  assert.equal(budget.scannedFiles, 0);
  assert.equal(budget.truncated, true);
  await assert.rejects(
    searchRepository(root, "visible", {
      signal: AbortSignal.abort(new Error("Canceled fixture")),
    }),
    /Canceled fixture/,
  );
  await fs.writeFile(path.join(root, "unknown.data"), "\0binary");
  const binary = await searchRepository(root, "visible");
  assert(binary.warnings.some((warning) => warning.includes("unknown.data")));
  assert.equal(binary.truncated, true);
});

test(
  "workspace text search reaches files past the former 1,500-file boundary",
  { timeout: 30000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-search-many-"));
    t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 4 }));
    for (let batch = 0; batch < 1605; batch += 40)
      await Promise.all(
        Array.from({ length: Math.min(40, 1605 - batch) }, (_, offset) =>
          fs.writeFile(
            path.join(
              root,
              `file-${String(batch + offset).padStart(4, "0")}.txt`,
            ),
            "ordinary text\n",
          ),
        ),
      );
    await fs.writeFile(path.join(root, "zzz-last.txt"), "LAST_MARKER\n");
    const result = await searchRepository(root, "LAST_MARKER");
    assert.equal(result.scannedFiles, 1606);
    assert.equal(result.eligibleFiles, 1606);
    assert.equal(result.text[0]?.path, "zzz-last.txt");
    assert.equal(result.truncated, false);
  },
);
