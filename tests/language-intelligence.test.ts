import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LanguageServer } from "../apps/desktop/src/main/services/language-server";
import {
  findRustAnalyzerExecutable,
  rustAnalyzerCandidates,
} from "../apps/desktop/src/main/services/language-intelligence";

async function eventually<T>(
  probe: () => Promise<T>,
  accepts: (value: T) => boolean,
  label: string,
  timeout = 45_000,
) {
  const deadline = Date.now() + timeout;
  let last: T | undefined;
  let transientError: string | undefined;
  do {
    try {
      last = await probe();
      transientError = undefined;
      if (accepts(last)) return last;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/content modified/i.test(message)) throw error;
      transientError = message;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${transientError || JSON.stringify(last)}`);
}

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

test(
  "installed rust-analyzer connects and delivers diagnostics, navigation, outline and call hierarchy",
  { timeout: 120_000 },
  async (t) => {
    const executable = findRustAnalyzerExecutable();
    if (!executable) {
      t.skip("rust-analyzer is an optional system tool");
      return;
    }
    const probe = spawnSync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    if (probe.error || probe.status !== 0) {
      t.skip("rust-analyzer was found but is not runnable on this system");
      return;
    }
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "witch-rust-analyzer-"),
    );
    const configuration = {
      cargo: { buildScripts: { enable: false }, autoreload: false },
      procMacro: { enable: false },
      checkOnSave: false,
    };
    const server = new LanguageServer({
      id: "rust",
      label: "Rust · rust-analyzer",
      command: executable,
      args: [],
      extensions: [".rs"],
      initializationOptions: configuration,
      configuration: { "rust-analyzer": configuration },
    });
    t.after(async () => {
      await server.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4 });
    });
    const manifest =
      '[package]\nname = "witch_ra_fixture"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\npath = "src/lib.rs"\n';
    const helper = "pub fn calculate(value: i32) -> i32 {\n    value + 1\n}\n";
    const library =
      "mod helper;\n\nuse helper::calculate;\n\npub fn run_agent(value: i32) -> i32 {\n    calculate(value)\n}\n";
    const broken = "pub fn broken( {\n";
    await fs.mkdir(path.join(root, "src"));
    await fs.writeFile(path.join(root, "Cargo.toml"), manifest);
    await fs.writeFile(path.join(root, "src", "helper.rs"), helper);
    await fs.writeFile(path.join(root, "src", "lib.rs"), library);
    await fs.writeFile(path.join(root, "src", "broken.rs"), broken);
    server.setWorkspace(root);
    await server.sync("src/helper.rs", helper);
    await server.sync("src/lib.rs", library);

    const status = await server.status();
    assert.equal(status.installed, true);
    assert.equal(status.connected, true);

    const definitions = await eventually(
      () =>
        server.locations("definition", "src/lib.rs", {
          line: 5,
          character: 6,
        }),
      (items) => items.some((item) => item.path === "src/helper.rs"),
      "rust-analyzer did not resolve the definition",
    );
    assert(
      definitions.some(
        (item) => item.path === "src/helper.rs" && item.start.line === 0,
      ),
      JSON.stringify(definitions),
    );
    const references = await eventually(
      () =>
        server.locations("references", "src/helper.rs", {
          line: 0,
          character: 8,
        }),
      (items) => items.some((item) => item.path === "src/lib.rs"),
      "rust-analyzer did not resolve references",
    );
    assert(
      references.some((item) => item.path === "src/lib.rs"),
      JSON.stringify(references),
    );
    const symbols = await eventually(
      () => server.documentSymbols("src/lib.rs"),
      (items) => items.some((item) => item.name === "run_agent"),
      "rust-analyzer did not publish the outline",
    );
    assert(
      symbols.some((item) => item.name === "run_agent" && item.depth === 0),
      JSON.stringify(symbols),
    );
    const hover = await eventually(
      () =>
        server.hover("src/lib.rs", {
          line: 5,
          character: 6,
        }),
      (value) =>
        Boolean(value?.contents.some((item) => item.includes("calculate"))),
      "rust-analyzer did not return hover information",
    );
    assert(hover?.contents.some((item) => item.includes("calculate")));
    const calls = await eventually(
      () =>
        server.outgoingCalls("src/lib.rs", {
          line: 4,
          character: 8,
        }),
      (value) =>
        Boolean(value?.outgoing.some((call) => call.name === "calculate")),
      "rust-analyzer did not return outgoing calls",
    );
    assert.equal(calls?.provider, "rust");
    assert.equal(calls?.caller.name, "run_agent");
    assert(
      calls?.outgoing.some(
        (call) =>
          call.name === "calculate" &&
          call.path === "src/helper.rs" &&
          call.fromRanges.some((range) => range.start.line === 5),
      ),
      JSON.stringify(calls),
    );

    const diagnostic = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("No rust-analyzer parser diagnostic received")),
        30_000,
      );
      server.on("diagnostics", (event) => {
        if (
          event.path === "src/broken.rs" &&
          event.diagnostics.some((item: any) => item.severity === 1)
        ) {
          clearTimeout(timer);
          resolve(event);
        }
      });
    });
    await server.sync("src/broken.rs", broken);
    const errors = await diagnostic;
    assert.equal(errors.language, "rust");
    assert(
      errors.diagnostics.some(
        (item: any) =>
          item.source === "rust-analyzer" || /expected/i.test(item.message),
      ),
      JSON.stringify(errors),
    );
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
