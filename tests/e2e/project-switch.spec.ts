import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { electronEnvironment } from "./environment";

test("repeated project switches isolate same-name editor buffers, language results and graph updates", async () => {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "witch-switch-ui-")),
  );
  const profile = path.join(directory, "profile");
  await fs.mkdir(profile);
  const roots = [path.join(directory, "alpha"), path.join(directory, "beta")];
  const labels = ["ALPHA", "BETA"];
  const contents = labels.map(
    (label) =>
      `/** ${label} project value. */\nexport const value = "${label}";\n`,
  );
  for (const [index, root] of roots.entries()) {
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, "module.ts"), contents[index]);
    await fs.writeFile(
      path.join(root, "index.ts"),
      'import { value } from "./module";\nconsole.log(value);\n',
    );
    await fs.writeFile(
      path.join(root, "tsconfig.json"),
      '{"compilerOptions":{"strict":true},"include":["*.ts"]}',
    );
  }
  const executablePath = process.env.WITCH_PACKAGED_EXECUTABLE
    ? path.resolve(process.env.WITCH_PACKAGED_EXECUTABLE)
    : undefined;
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  const documentEnd =
    process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      executablePath,
      args: executablePath ? [] : ["out/main/index.js"],
      cwd: process.cwd(),
      env: electronEnvironment({ WITCH_USER_DATA_DIR: profile }),
    });
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (let cycle = 0; cycle < 4; cycle++) {
      const index = cycle % 2,
        root = roots[index],
        other = roots[1 - index];
      await application.evaluate(({ dialog }, selected) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selected],
        });
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      }, root);
      await page
        .getByRole("button", { name: "Open repository", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => window.witch.workspace.current()))
        .toHaveProperty("root", root);
      await expect
        .poll(() => page.evaluate(() => window.witch.analysis.current()))
        .toHaveProperty("workspaceRoot", root);
      await page.keyboard.press(`${mod}+p`);
      await page
        .getByRole("combobox", { name: "Quick open file" })
        .fill("module.ts");
      await page.keyboard.press("Enter");
      const editor = page
        .locator(".workbench-view:not([hidden]) .monaco-editor")
        .first();
      await expect(editor).toContainText(`${labels[index]} project value`);
      await expect(editor).not.toContainText(
        `${labels[1 - index]} project value`,
      );
      await expect
        .poll(() =>
          page.evaluate(
            async (root) =>
              (
                await window.witch.lsp.hover(
                  "module.ts",
                  { line: 1, character: 14 },
                  root,
                )
              )?.contents.join("\n"),
            root,
          ),
        )
        .toContain(`${labels[index]} project value`);
      const rejected = await page.evaluate(async (root) => {
        try {
          await window.witch.lsp.hover(
            "module.ts",
            { line: 1, character: 14 },
            root,
          );
          return "unexpected access";
        } catch (error) {
          return String(error);
        }
      }, other);
      expect(rejected).not.toBe("unexpected access");
      const revision = await page.evaluate(
        async () => (await window.witch.analysis.current())?.revision,
      );
      await editor.click({ position: { x: 210, y: 40 } });
      const addition = `// saved in ${labels[index]}, cycle ${cycle}\n`;
      contents[index] += addition;
      await page.keyboard.press(documentEnd);
      await page.keyboard.insertText(addition);
      await page.keyboard.press(`${mod}+s`);
      await expect
        .poll(() => fs.readFile(path.join(root, "module.ts"), "utf8"))
        .toBe(contents[index]);
      expect(await fs.readFile(path.join(other, "module.ts"), "utf8")).toBe(
        contents[1 - index],
      );
      await expect
        .poll(() =>
          page.evaluate(
            async () => (await window.witch.analysis.current())?.revision,
          ),
        )
        .not.toBe(revision);
      expect(
        await page.evaluate(
          async () => (await window.witch.analysis.current())?.workspaceRoot,
        ),
      ).toBe(root);
    }
    await page.reload();
    const editor = page
      .locator(".workbench-view:not([hidden]) .monaco-editor")
      .first();
    await expect(editor).toContainText("saved in BETA, cycle 3");
    await expect(editor).not.toContainText("saved in ALPHA");
    expect(errors).toEqual([]);
  } finally {
    if (application) await application.close();
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
