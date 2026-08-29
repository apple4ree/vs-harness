import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { LanguageServer } from "../apps/desktop/src/main/services/language-server";

test("code-action previews reject side-effectful commands and expire after buffer changes", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-lsp-policy-"));
  const server = new LanguageServer({
    runtime: process.execPath,
    entrypoint: path.resolve("tests/fixtures/fake-language-server.mjs"),
    tsserver: path.resolve("node_modules/typescript/lib/tsserver.js"),
  });
  t.after(async () => {
    await server.stop();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 4 });
  });
  const original = "export const value = 1;\n";
  await fs.writeFile(path.join(root, "main.ts"), original);
  server.setWorkspace(root);
  await server.sync("main.ts", original);
  const range = {
    start: { line: 0, character: 13 },
    end: { line: 0, character: 18 },
  };
  const actions = await server.codeActions("main.ts", range);
  const unsafe = actions.find(
    (action) => action.title === "Unsafe refactor command",
  )!;
  assert.match(unsafe.disabled!, /cannot be previewed safely/);
  await assert.rejects(
    server.resolveAction(unsafe.id),
    /cannot be previewed safely/,
  );
  await assert.rejects(fs.stat(path.join(root, "executed-commands.txt")), {
    code: "ENOENT",
  });
  const text = actions.find((action) => action.title === "Text-only fix")!;
  assert.match(
    (await server.resolveAction(text.id)).changes[0].after,
    /renamed/,
  );
  const organize = actions.find(
    (action) => action.title === "Organize imports",
  )!;
  assert.match(
    (await server.resolveAction(organize.id)).changes[0].after,
    /renamed/,
  );
  assert.equal(
    await fs.readFile(path.join(root, "executed-commands.txt"), "utf8"),
    "_typescript.organizeImports\n",
  );
  assert.equal(await fs.readFile(path.join(root, "main.ts"), "utf8"), original);
  await server.sync("main.ts", original + "// newer buffer\n");
  await assert.rejects(server.resolveAction(text.id), /documents changed/);
  await assert.rejects(server.resolveAction(organize.id), /documents changed/);
});

test(
  "opening a TypeScript project does not load project-local executable language plugins",
  { timeout: 20000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-lsp-plugin-"));
    const server = new LanguageServer({
      runtime: process.execPath,
      entrypoint: path.resolve(
        "node_modules/typescript-language-server/lib/cli.mjs",
      ),
      tsserver: path.resolve("node_modules/typescript/lib/tsserver.js"),
    });
    t.after(async () => {
      await server.stop();
      await fs.rm(root, { recursive: true, force: true, maxRetries: 4 });
    });
    const plugin = path.join(root, "node_modules", "witch-test-plugin");
    await fs.mkdir(plugin, { recursive: true });
    await fs.writeFile(
      path.join(plugin, "package.json"),
      JSON.stringify({ name: "witch-test-plugin", main: "index.cjs" }),
    );
    const marker = path.join(root, "plugin-executed.txt");
    await fs.writeFile(
      path.join(plugin, "index.cjs"),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'Unexpected execution'); module.exports = () => ({ create(info) { return info.languageService; } });`,
    );
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          plugins: [{ name: "witch-test-plugin" }],
        },
        include: ["main.ts"],
      }),
    );
    const content = 'const count: number = "invalid";\n';
    await fs.writeFile(path.join(root, "main.ts"), content);
    server.setWorkspace(root);
    const diagnostics = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Project diagnostics did not arrive")),
        10000,
      );
      server.on("diagnostics", (event) => {
        if (
          event.diagnostics.some((item: { code: number }) => item.code === 2322)
        ) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await server.sync("main.ts", content);
    await diagnostics;
    assert(
      (await server.hover("main.ts", { line: 0, character: 7 }))?.contents.some(
        (item) => item.includes("number"),
      ),
    );
    await assert.rejects(fs.stat(marker), { code: "ENOENT" });
  },
);
