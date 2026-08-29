import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  cliSearchDirectories,
  findCliExecutable,
  prepareCliCommand,
  windowsSystemExecutable,
} from "../apps/desktop/src/main/services/cli-discovery";

test("desktop CLI discovery includes Finder install paths and ignores relative PATH entries", () => {
  const mac = cliSearchDirectories(
    { PATH: ".:/usr/bin:/usr/bin" },
    "darwin",
    "/Users/fixture",
  );
  assert(mac.includes("/opt/homebrew/bin"));
  assert(mac.includes("/Users/fixture/.local/bin"));
  assert(!mac.includes("."));
  assert.equal(mac.filter((entry) => entry === "/usr/bin").length, 1);
  const windows = cliSearchDirectories(
    { Path: "C:\\Tools;c:\\tools;." },
    "win32",
    "C:\\Users\\fixture",
  );
  assert.equal(
    windows.filter((entry) => entry.toLowerCase() === "c:\\tools").length,
    1,
  );
  assert(!windows.includes("."));
});

test("Windows system helpers use absolute System32 paths rather than PATH or the workspace", () => {
  assert.equal(
    windowsSystemExecutable("taskkill.exe", {
      SystemRoot: "D:\\Windows",
      PATH: "C:\\untrusted",
    }),
    "D:\\Windows\\System32\\taskkill.exe",
  );
  assert.equal(
    windowsSystemExecutable("cmd.exe", { SYSTEMROOT: "C:\\Windows" }),
    "C:\\Windows\\System32\\cmd.exe",
  );
  assert.equal(
    windowsSystemExecutable("cmd.exe", {}),
    "C:\\Windows\\System32\\cmd.exe",
  );
  assert.throws(
    () => windowsSystemExecutable("cmd.exe", { SystemRoot: "." }),
    /absolute local/,
  );
});

test("CLI discovery reads the filesystem without executing a candidate", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-cli-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const script = path.join(
    root,
    process.platform === "win32" ? "fixture.cmd" : "fixture",
  );
  await fs.writeFile(script, "this is not an executable program", {
    mode: 0o700,
  });
  assert.equal(findCliExecutable("fixture", script), script);
  assert.equal(findCliExecutable("fixture", "relative-command"), null);
  assert.equal(findCliExecutable("fixture", path.join(root, "missing")), null);
});

test(
  "Windows batch CLI invocations quote paths with spaces and ampersands safely",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-cli-quoting-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const directory = path.join(root, "CLI tools & fixture");
    await fs.mkdir(directory);
    const script = path.join(directory, "fixture.cmd");
    await fs.writeFile(script, "@echo off\r\necho WITCH_CLI_%1\r\n");
    const invocation = prepareCliCommand(script, ["--version"]);
    const result = spawnSync(invocation.command, invocation.args, {
      ...invocation.options,
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.match(result.stdout, /WITCH_CLI_.*--version/);
    assert.throws(
      () => prepareCliCommand(path.join(root, "%TEMP%", "fixture.cmd"), []),
      /safely quoted/,
    );
    assert.throws(
      () => prepareCliCommand(script, ["hello & unexpected"]),
      /safely quoted/,
    );
  },
);
