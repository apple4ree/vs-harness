import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LanguageServer } from "../apps/desktop/src/main/services/language-server";
import { rustAnalyzerCandidates } from "../apps/desktop/src/main/services/language-intelligence";

test("rust-analyzer discovery uses explicit or standard absolute locations", () => {
  assert.deepEqual(rustAnalyzerCandidates("win32", {}, "D:\\Users\\witch"), [
    "D:\\Users\\witch\\.cargo\\bin\\rust-analyzer.exe",
  ]);
  assert.deepEqual(
    rustAnalyzerCandidates(
      "linux",
      { WITCH_RUST_ANALYZER_PATH: "/tools/rust-analyzer" },
      "/home/witch",
    ).slice(0, 2),
    ["/tools/rust-analyzer", "/home/witch/.cargo/bin/rust-analyzer"],
  );
  assert.throws(
    () =>
      rustAnalyzerCandidates("linux", {
        WITCH_RUST_ANALYZER_PATH: "./rust-analyzer",
      }),
    /absolute path/,
  );
});

test(
  "real Pyright delivers diagnostics, navigation, outline and a review-only rename",
  { timeout: 45_000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-pyright-"));
    const entrypoint = path.resolve("node_modules/pyright/langserver.index.js");
    const server = new LanguageServer({
      id: "python",
      label: "Python · Pyright",
      command: process.execPath,
      args: [entrypoint, "--stdio"],
      installedPath: entrypoint,
      extensions: [".py", ".pyi"],
      configuration: {
        python: {},
        "python.analysis": {
          diagnosticMode: "openFilesOnly",
          typeCheckingMode: "basic",
        },
      },
    });
    t.after(async () => {
      await server.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4 });
    });
    const helper =
      'def greet(name: str) -> str:\n    """Build a Witch greeting."""\n    return name.upper()\n';
    const main =
      'from helper import greet\nvalue: int = "invalid"\nprint(greet("witch"))\n';
    await fs.writeFile(path.join(root, "helper.py"), helper);
    await fs.writeFile(path.join(root, "main.py"), main);
    const runner =
      'from helper import greet\n\ndef run() -> str:\n    return greet("witch")\n';
    await fs.writeFile(path.join(root, "runner.py"), runner);
    server.setWorkspace(root);
    const diagnostic = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("No Pyright type diagnostic received")),
        20_000,
      );
      server.on("diagnostics", (event) => {
        if (
          event.path === "main.py" &&
          event.diagnostics.some((item: any) => item.severity === 1)
        ) {
          clearTimeout(timer);
          resolve(event);
        }
      });
    });
    await server.sync("helper.py", helper);
    await server.sync("main.py", main);
    await server.sync("runner.py", runner);
    const errors = await diagnostic;
    assert.equal(errors.language, "python");
    assert(
      errors.diagnostics.some(
        (item: any) =>
          item.source === "Pyright" && /not assignable/i.test(item.message),
      ),
      JSON.stringify(errors),
    );
    const definitions = await server.locations("definition", "main.py", {
      line: 2,
      character: 8,
    });
    assert.deepEqual(definitions[0]?.path, "helper.py");
    assert.equal(definitions[0]?.start.line, 0);
    const references = await server.locations("references", "helper.py", {
      line: 0,
      character: 5,
    });
    assert(references.some((item) => item.path === "main.py"));
    const symbols = await server.documentSymbols("helper.py");
    assert(symbols.some((item) => item.name === "greet" && item.depth === 0));
    const hover = await server.hover("main.py", { line: 2, character: 8 });
    assert(hover?.contents.some((item) => item.includes("greet")));
    const calls = await server.outgoingCalls("runner.py", {
      line: 2,
      character: 5,
    });
    assert.equal(calls?.caller.name, "run");
    assert(
      calls?.outgoing.some(
        (call) =>
          call.name === "greet" &&
          call.path === "helper.py" &&
          call.fromRanges.some((range) => range.start.line === 3),
      ),
      JSON.stringify(calls),
    );
    const preview = await server.rename(
      "helper.py",
      { line: 0, character: 5 },
      "welcome",
    );
    assert(preview.changes.some((item) => item.path === "helper.py"));
    assert(preview.changes.some((item) => item.path === "main.py"));
    assert.equal(
      await fs.readFile(path.join(root, "helper.py"), "utf8"),
      helper,
    );
    assert.equal(await fs.readFile(path.join(root, "main.py"), "utf8"), main);
  },
);

test("Rust language providers reject command-only code actions", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-rust-lsp-"));
  const entrypoint = path.resolve("tests/fixtures/fake-language-server.mjs");
  const server = new LanguageServer({
    id: "rust",
    label: "Rust · rust-analyzer",
    command: process.execPath,
    args: [entrypoint],
    installedPath: entrypoint,
    extensions: [".rs"],
  });
  t.after(async () => {
    await server.stop();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 4 });
  });
  const source = "pub const VALUE: usize = 1;\n";
  await fs.writeFile(path.join(root, "main.rs"), source);
  server.setWorkspace(root);
  await server.sync("main.rs", source);
  server.watchedFiles([
    { path: "created.rs", type: 1 },
    { path: "main.rs", type: 2 },
  ]);
  let watched = "";
  for (let attempt = 0; attempt < 40 && !watched; attempt++) {
    watched = await fs
      .readFile(path.join(root, "watched-files.txt"), "utf8")
      .catch(() => "");
    if (!watched) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.match(watched, /created\.rs/);
  assert.match(watched, /"type":1/);
  const actions = await server.codeActions("main.rs", {
    start: { line: 0, character: 10 },
    end: { line: 0, character: 15 },
  });
  const command = actions.find((item) => item.title === "Organize imports")!;
  assert.match(command.disabled!, /cannot be previewed safely/);
  await assert.rejects(
    () => server.resolveAction(command.id),
    /cannot be previewed safely/,
  );
  await assert.rejects(fs.stat(path.join(root, "executed-commands.txt")), {
    code: "ENOENT",
  });
});
