import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { NodeDebugService } from "../apps/desktop/src/main/services/node-debugger";

test("breakpoints persist per project, merge concurrent file changes and never start code on restore", async (t) => {
  const fixture = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-breakpoints-"),
  );
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const root = path.join(fixture, "project"),
    directory = path.join(fixture, "profile");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "first.js"), "console.log(1)\n");
  await fs.writeFile(path.join(root, "second.cjs"), "console.log(2)\n");
  const options = { runtime: process.execPath, breakpointDirectory: directory };
  const first = new NodeDebugService(options);
  await Promise.all([
    first.setBreakpoints(root, "first.js", [1, 2, 2]),
    first.setBreakpoints(root, "second.cjs", [1]),
  ]);
  const restored = new NodeDebugService(options);
  const points = await restored.loadBreakpoints(root);
  assert.equal(points.length, 3);
  assert(points.every((point) => !point.verified));
  assert.equal(restored.isRunning(), false);
  assert.deepEqual(
    await restored.loadBreakpoints(path.join(fixture, "other")),
    [],
  );
  await restored.setBreakpoints(root, "first.js", []);
  assert.deepEqual(
    (await new NodeDebugService(options).loadBreakpoints(root)).map(
      (point) => point.path,
    ),
    ["second.cjs"],
  );
  await assert.rejects(restored.setBreakpoints(root, "../escape.js", [1]));
  const file = path.join(
    directory,
    (await fs.readdir(directory)).find((name) => name.endsWith(".json"))!,
  );
  await fs.writeFile(file, "corrupt journal");
  const broken = new NodeDebugService(options);
  await assert.rejects(
    broken.loadBreakpoints(root),
    /original file is retained/,
  );
  await assert.rejects(
    broken.setBreakpoints(root, "first.js", [1]),
    /original file is retained/,
  );
  assert.equal(await fs.readFile(file, "utf8"), "corrupt journal");
});

test("breakpoints follow file and folder moves and are removed only inside a deleted path", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-breakpoint-move-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "project");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/first.js"), "console.log(1)\n");
  await fs.writeFile(path.join(root, "src/second.cjs"), "console.log(2)\n");
  await fs.writeFile(path.join(root, "src-copy.js"), "console.log(3)\n");
  const options = {
    runtime: process.execPath,
    breakpointDirectory: path.join(directory, "profile"),
  };
  const service = new NodeDebugService(options);
  await service.setBreakpoints(root, "src/first.js", [1]);
  await service.setBreakpoints(root, "src/second.cjs", [1]);
  await service.setBreakpoints(root, "src-copy.js", [1]);
  await fs.rename(
    path.join(root, "src/first.js"),
    path.join(root, "src/renamed.mjs"),
  );
  await service.relocateBreakpoints(root, "src/first.js", "src/renamed.mjs");
  assert(
    service.breakpoints(root).some((point) => point.path === "src/renamed.mjs"),
  );
  await fs.rename(path.join(root, "src"), path.join(root, "renamed"));
  await service.relocateBreakpoints(root, "src", "renamed");
  assert.deepEqual(
    new Set(
      (await new NodeDebugService(options).loadBreakpoints(root)).map(
        (point) => point.path,
      ),
    ),
    new Set(["renamed/renamed.mjs", "renamed/second.cjs", "src-copy.js"]),
  );
  await service.relocateBreakpoints(root, "renamed");
  assert.deepEqual(
    service.breakpoints(root).map((point) => point.path),
    ["src-copy.js"],
  );
  await assert.rejects(service.relocateBreakpoints(root, "../outside"));
  assert.equal(service.isRunning(), false);
});
