import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  LanguageServer,
  applyTextEdits,
} from "../apps/desktop/src/main/services/language-server";
import { RpcDecoder } from "../apps/desktop/src/main/services/json-rpc";

test("RPC framing retains split Unicode and back-to-back messages", () => {
  const decoder = new RpcDecoder("headers");
  const values = [
    { id: 1, result: "한국어 🧙" },
    { id: 2, result: [] },
  ];
  const bytes = Buffer.concat(
    values.map((value) => {
      const body = JSON.stringify(value);
      return Buffer.from(
        `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
      );
    }),
  );
  const output = [];
  for (let i = 0; i < bytes.length; i++)
    output.push(...decoder.push(bytes.subarray(i, i + 1)));
  assert.deepEqual(output, values);
});

test("text edits preserve CRLF and reject overlapping or invalid ranges", () => {
  assert.equal(
    applyTextEdits("a\r\nb", [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 1 },
        },
        newText: "한글",
      },
    ]),
    "a\r\n한글",
  );
  assert.throws(
    () =>
      applyTextEdits("a", [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 2 },
          },
          newText: "",
        },
      ]),
    /exceeds/,
  );
});

test(
  "real TypeScript server delivers diagnostics, definitions, references, completion and rename preview",
  { timeout: 30_000 },
  async (t) => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "witch-language-test-"),
    );
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
    server.setWorkspace(root);
    const content =
      'export function greet(name: string) { return name.toUpperCase() }\nconst count: number = "invalid"\ngreet("민수")\n';
    await fs.writeFile(path.join(root, "sample.ts"), content);
    const diagnostic = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("No type diagnostic received")),
        15000,
      );
      server.on("diagnostics", (event) => {
        if (event.diagnostics.some((item: any) => item.code === 2322)) {
          clearTimeout(timer);
          resolve(event);
        }
      });
    });
    await Promise.all([server.start(), server.start()]);
    await server.sync("sample.ts", content);
    const errors = await diagnostic;
    assert.equal(
      errors.diagnostics.find((item: any) => item.code === 2322).start.line,
      1,
    );
    const definitions = await server.locations("definition", "sample.ts", {
      line: 2,
      character: 2,
    });
    assert.equal(definitions[0]?.start.line, 0);
    const references = await server.locations("references", "sample.ts", {
      line: 0,
      character: 18,
    });
    assert.equal(references.length, 2);
    const completion = await server.completion("sample.ts", {
      line: 0,
      character: content.indexOf("name.toUpperCase") + "name.".length,
    });
    assert(completion.some((item) => item.label === "toLowerCase"));
    const preview = await server.rename(
      "sample.ts",
      { line: 0, character: 18 },
      "welcome",
    );
    assert(preview.changes[0]?.after.includes('welcome("민수")'));
    assert.equal(
      await fs.readFile(path.join(root, "sample.ts"), "utf8"),
      content,
      "preview must not write files",
    );
    const bom = '\uFEFFexport const first = "한글";\r\nconsole.log(first);\r\n';
    await fs.writeFile(path.join(root, "bom.ts"), bom);
    await server.sync("bom.ts", bom);
    const bomPreview = await server.rename(
      "bom.ts",
      { line: 0, character: 14 },
      "renamed",
    );
    assert.equal(bomPreview.changes[0]?.before, bom);
    assert.equal(
      bomPreview.changes[0]?.after,
      '\uFEFFexport const renamed = "한글";\r\nconsole.log(renamed);\r\n',
    );
    const hints =
      '/** Builds a greeting for the Witch user. */\nfunction makeGreeting(name: string, count: number) { return name.repeat(count); }\nmakeGreeting("현자", 2);\n';
    await fs.writeFile(path.join(root, "hints.ts"), hints);
    await server.sync("hints.ts", hints);
    const hover = await server.hover("hints.ts", { line: 2, character: 3 });
    assert(
      hover?.contents.some(
        (item) => item.includes("makeGreeting") && item.includes("string"),
      ),
      JSON.stringify(hover),
    );
    assert(hover?.contents.some((item) => item.includes("Builds a greeting")));
    const signature = await server.signatureHelp("hints.ts", {
      line: 2,
      character: 'makeGreeting("현자", '.length,
    });
    assert.equal(signature?.activeParameter, 1);
    assert.match(signature!.signatures[0].label, /name: string, count: number/);
    assert.match(signature!.signatures[0].documentation!, /Builds a greeting/);
    assert.equal(await fs.readFile(path.join(root, "hints.ts"), "utf8"), hints);
  },
);

test(
  "completion resolves same-file auto imports and rejects stale suggestions without writing source",
  { timeout: 30000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-completion-"));
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
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "esnext",
          moduleResolution: "node",
        },
        include: ["*.ts"],
      }),
    );
    await fs.writeFile(
      path.join(root, "helper.ts"),
      "/** Return a Witch value. */\nexport function computeWitchValue(input: number) { return input + 1; }\n",
    );
    const original = "const result = computeWi";
    await fs.writeFile(path.join(root, "consumer.ts"), original);
    server.setWorkspace(root);
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Consumer diagnostics did not arrive")),
        10000,
      );
      server.on("diagnostics", (event) => {
        if (event.path === "consumer.ts") {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    await server.sync("consumer.ts", original);
    await ready;
    const items = await server.completion("consumer.ts", {
      line: 0,
      character: original.length,
    });
    const item = items.find((item) => item.label === "computeWitchValue");
    assert(item?.id, JSON.stringify(items.map((item) => item.label)));
    const resolved = await server.resolveCompletion(item.id);
    assert(
      resolved.additionalTextEdits?.some(
        (edit) =>
          edit.newText.includes("import") &&
          edit.newText.includes("computeWitchValue"),
      ),
      JSON.stringify(resolved),
    );
    const withImports = applyTextEdits(original, resolved.additionalTextEdits!);
    assert.match(withImports, /from ["']\.\/helper["']/);
    assert.equal(
      await fs.readFile(path.join(root, "consumer.ts"), "utf8"),
      original,
    );
    await server.sync("consumer.ts", original + "t");
    await assert.rejects(server.resolveCompletion(item.id), /expired/);
    await assert.rejects(
      server.completion("consumer.ts", { line: 0, character: 1000 }),
      /outside the synchronized document/,
    );
  },
);
