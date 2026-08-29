import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listWorkspace,
  resolveWorkspacePath,
  readWorkspaceText,
  writeWorkspaceText,
  contentHash,
  normalizedRelative,
} from "../apps/desktop/src/main/services/workspace-files";

test("workspace paths reject traversal, absolute paths, roots, and junction ancestors", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-path-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const bad of [
    "..",
    "../outside",
    ".",
    "",
    "C:\\outside.txt",
    "/etc/passwd",
    "a/../../b",
    "file:stream",
    "folder./one.ts",
    "folder /one.ts",
    "CON.ts",
    "dir/com1.txt",
    "one?.ts",
    "name\t.ts",
  ])
    assert.throws(() => normalizedRelative(bad));
  await fs.mkdir(path.join(root, "outside"));
  await fs.symlink(
    path.join(root, "outside"),
    path.join(root, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    resolveWorkspacePath(root, "link/new.ts", true),
    /junction/,
  );
});

test("listing retains empty folders and obeys ignores; saves reject conflicts and binary data", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-files-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "empty"));
  await fs.mkdir(path.join(root, "node_modules"));
  await fs.writeFile(path.join(root, ".gitignore"), "*.log\n");
  await fs.writeFile(path.join(root, "hidden.log"), "ignore");
  await fs.writeFile(path.join(root, "index.ts"), "const value = 1\n");
  await fs.writeFile(path.join(root, "binary.bin"), Buffer.from([0, 1, 2]));
  const { entries } = await listWorkspace(root);
  assert(
    entries.some(
      (entry) => entry.path === "empty" && entry.kind === "directory",
    ),
  );
  assert(
    !entries.some(
      (entry) => entry.path === "node_modules" || entry.path === "hidden.log",
    ),
  );
  const original = await readWorkspaceText(root, "index.ts");
  await writeWorkspaceText(
    root,
    "index.ts",
    "const value = 2\n",
    contentHash(original),
  );
  await assert.rejects(
    writeWorkspaceText(root, "index.ts", "lost update", contentHash(original)),
    /changed on disk/,
  );
  await assert.rejects(readWorkspaceText(root, "binary.bin"), /binary/);
  await fs.writeFile(path.join(root, "invalid.txt"), Buffer.from([0xff, 0xfe]));
  await assert.rejects(readWorkspaceText(root, "invalid.txt"), /UTF-8/);
  await fs.writeFile(path.join(root, "bom.txt"), "\uFEFFhello");
  assert.equal(await readWorkspaceText(root, "bom.txt"), "\uFEFFhello");
  await assert.rejects(
    writeWorkspaceText(root, "index.ts", "binary\0data"),
    /Binary/,
  );
  const hash = contentHash(await readWorkspaceText(root, "index.ts"));
  const concurrent = await Promise.allSettled([
    writeWorkspaceText(root, "index.ts", "first save", hash),
    writeWorkspaceText(root, "index.ts", "second save", hash),
  ]);
  assert.equal(
    concurrent.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(await readWorkspaceText(root, "index.ts"), "first save");
  assert(
    !(await fs.readdir(root)).some((name) => name.startsWith(".witch-save-")),
  );
});

test("nested ignore rules preserve Git-style anchoring and recursive filename matches", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-ignore-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src/deep/cache"), { recursive: true });
  await fs.mkdir(path.join(root, "src/cache"));
  await fs.writeFile(
    path.join(root, "src/.gitignore"),
    "*.log\n/only-here.txt\ncache/\n!kept.log\n",
  );
  for (const file of [
    "src/hidden.log",
    "src/deep/hidden.log",
    "src/deep/kept.log",
    "src/only-here.txt",
    "src/deep/only-here.txt",
    "src/cache/data.txt",
    "src/deep/cache/data.txt",
  ])
    await fs.writeFile(path.join(root, file), "fixture");
  const paths = (await listWorkspace(root)).entries.map((entry) => entry.path);
  assert(paths.includes("src/deep/kept.log"));
  assert(paths.includes("src/deep/only-here.txt"));
  assert(
    !paths.some(
      (file) => file.endsWith("hidden.log") || file.includes("/cache"),
    ),
  );
  assert(!paths.includes("src/only-here.txt"));
});
