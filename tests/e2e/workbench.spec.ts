import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { electronEnvironment } from "./environment";

let application: ElectronApplication;
let page: Page;
let fixture: string;
let profile: string;
const errors: string[] = [];
const mod = process.platform === "darwin" ? "Meta" : "Control";
const documentStart =
  process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home";
const documentEnd =
  process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";
const executablePath = process.env.WITCH_PACKAGED_EXECUTABLE
  ? path.resolve(process.env.WITCH_PACKAGED_EXECUTABLE)
  : undefined;
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  fixture = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "witch-ui-fixture-")),
  );
  profile = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "witch-ui-profile-")),
  );
  await fs.mkdir(path.join(fixture, "src/api"), { recursive: true });
  await fs.mkdir(path.join(fixture, "src/ui"), { recursive: true });
  await fs.mkdir(path.join(fixture, "empty-folder"));
  await fs.writeFile(
    path.join(fixture, "app.cjs"),
    'function compute() {\n  const left = 2;\n  const right = 3;\n  const answer = left + right;\n  console.log("WITCH_TASK_" + answer);\n}\ncompute();\n',
  );
  await fs.writeFile(
    path.join(fixture, "src/api/client.ts"),
    "export function greet(name: string) { return `Hello ${name}` }\n",
  );
  await fs.writeFile(
    path.join(fixture, "src/ui/view.ts"),
    'import { greet } from "../api/client"\nexport const greeting = greet("Witch")\n',
  );
  await fs.writeFile(
    path.join(fixture, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ES2022",
        moduleResolution: "node",
      },
      include: ["src"],
    }),
  );
  const env = electronEnvironment({ WITCH_USER_DATA_DIR: profile });
  application = await electron.launch({
    executablePath,
    args: executablePath ? [] : ["out/main/index.js"],
    cwd: process.cwd(),
    env,
  });
  await application.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, fixture);
  page = await application.firstWindow();
  page.on("pageerror", (error) => {
    errors.push(error.message);
    console.error("Renderer exception:", error.stack);
  });
  page.on("dialog", (dialog) => void dialog.accept());
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await expect(page.locator(".architecture-card")).toHaveCount(3);
});

test.afterAll(async () => {
  if (application) {
    await page
      ?.evaluate(() => window.witch.workspace.dirty([]))
      .catch(() => undefined);
    await application.close();
  }
  // Only test-owned mkdtemp directories are removed.
  await fs.rm(fixture, { recursive: true, force: true });
  await fs.rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  });
});

test("desktop IPC accepts only the trusted workbench frame", async () => {
  const result = await application.evaluate(async ({ BrowserWindow }) => {
    const foreign = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    try {
      await foreign.loadURL("about:blank");
      return await foreign.webContents.executeJavaScript(
        `require('electron').ipcRenderer.invoke('settings:get').then(() => 'unexpected access', error => error.message)`,
      );
    } finally {
      foreign.destroy();
    }
  });
  expect(result).toContain("Untrusted desktop IPC sender");
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).toContain("frame-src 'none'");
  expect(policy).not.toContain("localhost");
  expect(await page.evaluate(() => window.witch.settings.get())).toHaveProperty(
    "preferences",
  );
});

test("a second process sharing the same profile exits without creating another workbench", async () => {
  expect(
    await application.evaluate(({ app }) => app.hasSingleInstanceLock()),
  ).toBe(true);
  const child = spawn(
    executablePath || application.process().spawnfile,
    executablePath ? [] : ["out/main/index.js"],
    {
      cwd: process.cwd(),
      env: electronEnvironment({ WITCH_USER_DATA_DIR: profile }),
      windowsHide: true,
      stdio: "ignore",
    },
  );
  const code = await new Promise<number | null>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error("Second Witch process did not release the shared profile"),
      );
    }, 15000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  expect(code).toBe(0);
  expect(
    await application.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() => window.witch.workspace.current()),
  ).toHaveProperty("root", fixture);
});

test("architecture edges and drag-to-chat source context work in Electron", async () => {
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  const edgePoint = await page
    .locator(".react-flow__edge-interaction")
    .first()
    .evaluate((element) => {
      const path = element as SVGPathElement;
      const point = path.getPointAtLength(path.getTotalLength() / 2);
      const position = new DOMPoint(point.x, point.y).matrixTransform(
        path.getScreenCTM()!,
      );
      return { x: position.x, y: position.y };
    });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  await expect(page.locator(".relationship-details")).toContainText(
    "src/ui/view.ts:1",
  );
  await expect(page.locator(".relationship-details code")).toContainText(
    "import { greet }",
  );
  await page
    .locator(".relationship-details .component-relations button")
    .first()
    .click();
  await expect(page.locator(".source-breadcrumb")).toContainText(
    "src/ui/view.ts",
  );
  await page
    .getByRole("button", { name: "Constellation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Close connection details", exact: true })
    .click();
  const handle = page.getByRole("button", {
    name: "Drag src/api to chat",
    exact: true,
  });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await handle.dispatchEvent("dragstart", { dataTransfer: transfer });
  await page
    .getByRole("region", { name: "Component chat" })
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.locator(".context-chip")).toContainText("src/api");
  await expect(page.getByLabel("Agent mode")).toHaveValue("ask");
  await page.getByLabel("Agent mode").selectOption("change");
  await expect(page.getByLabel("Agent mode")).toHaveValue("change");
  await expect(page.getByRole("tree")).toContainText("empty-folder");
  await page.screenshot({ path: "test-results/witch-architecture.png" });
  const node = page.locator('.react-flow__node[data-id="module:src/api"]');
  const position = () =>
    node.evaluate((element) => (element as HTMLElement).style.transform);
  const before = await position();
  const label = await node.locator("strong").boundingBox();
  if (!label) throw new Error("Graph node was not rendered");
  await page.mouse.move(label.x + 20, label.y + 6);
  await page.mouse.down();
  await page.mouse.move(label.x + 65, label.y + 46, { steps: 8 });
  await page.mouse.up();
  await expect.poll(position).not.toBe(before);
  const moved = await position();
  await fs.writeFile(
    path.join(fixture, "src/api/client.ts"),
    "export function greet(name: string) { return `Greetings ${name}` }\n",
  );
  await expect(node.locator(".architecture-card")).toHaveClass(/has-changed/);
  expect(await position()).toBe(moved);
  await page
    .getByRole("button", { name: "Arrange graph", exact: true })
    .click();
});

test("file create, rename, save and external-change conflict preserve data", async () => {
  await page.getByRole("button", { name: "+ File", exact: true }).click();
  await page.getByLabel("Workspace-relative path").fill("src/new-file.ts");
  await page.getByRole("button", { name: "Create file", exact: true }).click();
  await expect(page.locator(".source-breadcrumb")).toContainText(
    "src/new-file.ts",
  );
  const editor = page
    .locator(".workbench-view:not([hidden]) .monaco-editor")
    .first();
  await editor.click({ position: { x: 220, y: 60 } });
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText("export const first = 1;\n");
  await page.keyboard.press(`${mod}+s`);
  await expect
    .poll(async () =>
      (
        await fs.readFile(path.join(fixture, "src/new-file.ts"), "utf8")
      ).replaceAll("\r\n", "\n"),
    )
    .toBe("export const first = 1;\n");
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByLabel("Workspace-relative path").fill("src/renamed.ts");
  await page
    .getByRole("dialog", { name: "Rename file or folder" })
    .getByRole("button", { name: "Rename", exact: true })
    .click();
  await expect(page.locator(".source-breadcrumb")).toContainText(
    "src/renamed.ts",
  );
  await fs.writeFile(
    path.join(fixture, "src/renamed.ts"),
    "export const fromDisk = 2;\n",
  );
  await expect(editor).toContainText("fromDisk");
  await editor.click({ position: { x: 220, y: 60 } });
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText("export const unsaved = 3;\n");
  await fs.writeFile(
    path.join(fixture, "src/renamed.ts"),
    "export const external = 4;\n",
  );
  await expect(page.locator(".document-conflict")).toBeVisible();
  await expect(editor).toContainText("unsaved");
  await page.keyboard.press(`${mod}+s`);
  await expect(page.getByRole("status")).toContainText("changed on disk");
  expect(await fs.readFile(path.join(fixture, "src/renamed.ts"), "utf8")).toBe(
    "export const external = 4;\n",
  );
  await page.getByRole("button", { name: "Review disk version" }).click();
  await expect(
    page.getByRole("dialog", { name: "Compare editor and disk" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Replace buffer with disk version" })
    .click();
  await expect(editor).toContainText("external");
  await expect(page.locator(".document-conflict")).toHaveCount(0);
});

test("editing UTF-8 BOM and CRLF files preserves their encoding and line endings", async () => {
  const target = path.join(fixture, "bom.ts");
  await fs.writeFile(target, "\uFEFFexport const original = 1;\r\n");
  await page
    .locator(".file-list")
    .getByRole("button", { name: "bom.ts", exact: true })
    .click();
  const editor = page
    .locator(".workbench-view:not([hidden]) .monaco-editor")
    .first();
  await editor.click({ position: { x: 220, y: 40 } });
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText('export const unicode = "한글";');
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("console.log(unicode);");
  await page.keyboard.press(`${mod}+s`);
  await expect
    .poll(() => fs.readFile(target, "utf8"))
    .toBe('\uFEFFexport const unicode = "한글";\r\nconsole.log(unicode);');
  expect(errors).toEqual([]);
});

test("language server diagnostics, rename review and multiple terminal sessions work", async () => {
  await page
    .getByRole("button", { name: "src/api/client.ts", exact: true })
    .click();
  const editor = page
    .locator(".workbench-view:not([hidden]) .monaco-editor")
    .first();
  await editor.click({ position: { x: 220, y: 30 } });
  await page.keyboard.press(documentStart);
  await page.keyboard.press("Home");
  for (let index = 0; index < 18; index++)
    await page.keyboard.press("ArrowRight");
  await page.keyboard.press("F2");
  await page.getByLabel("New symbol name").fill("welcome");
  await page.getByRole("button", { name: "Preview rename" }).click();
  await expect(page.locator(".review-file")).toHaveCount(2);
  await page.getByRole("button", { name: "Apply to editor buffers" }).click();
  expect(
    await fs.readFile(path.join(fixture, "src/api/client.ts"), "utf8"),
  ).toContain("function greet");
  await page.getByRole("button", { name: "Save all", exact: false }).click();
  await expect
    .poll(() => fs.readFile(path.join(fixture, "src/ui/view.ts"), "utf8"))
    .toContain("welcome");
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.witch.terminal.list()))
    .toHaveLength(1);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.witch.terminal.list()))
    .toHaveLength(2);
  await expect(page.locator(".terminal-tab")).toHaveCount(2);
  await expect(page.locator(".terminal-tab.selected")).toContainText(
    process.platform === "win32" ? "powershell" : "sh",
  );
  const output = page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        let text = "";
        const timer = setTimeout(() => {
          off();
          reject(new Error("Interactive shell did not execute the command"));
        }, 10000);
        const off = window.witch.terminal.onData((event) => {
          text += event.data;
          if (text.includes("WITCH_EXECUTED")) {
            clearTimeout(timer);
            off();
            resolve(text);
          }
        });
      }),
  );
  await page.locator(".terminal-instance:visible .xterm-screen").click();
  await page.keyboard.type(
    process.platform === "win32"
      ? "Write-Output ('WITCH_' + 'EXECUTED')"
      : "printf 'WITCH_%s\\n' EXECUTED",
  );
  await page.keyboard.press("Enter");
  await output;
  await page.screenshot({ path: "test-results/witch-source-terminals.png" });
  expect(errors).toEqual([]);
});

test("canceling app quit leaves terminal processes and the language server running", async () => {
  const terminals = await page.evaluate(() => window.witch.terminal.list());
  expect(terminals).toHaveLength(2);
  const confirmed = await application.evaluate(async ({ app, dialog }) => {
    const original = dialog.showMessageBox;
    let requested = false;
    dialog.showMessageBox = async () => {
      requested = true;
      return { response: 0, checkboxChecked: false };
    };
    try {
      app.quit();
      await new Promise<void>((resolve) => setImmediate(resolve));
      return requested;
    } finally {
      dialog.showMessageBox = original;
    }
  });
  expect(confirmed).toBe(true);
  expect(await page.evaluate(() => window.witch.terminal.list())).toEqual(
    terminals,
  );
  expect(await page.evaluate(() => window.witch.lsp.status())).toHaveProperty(
    "connected",
    true,
  );
  await expect(page.locator(".terminal-tab")).toHaveCount(2);
});

test("editor reload recovers unsaved buffers without automatic writes", async () => {
  const terminalIds = await page.evaluate(async () =>
    (await window.witch.terminal.list()).map((session) => session.id),
  );
  expect(terminalIds).toHaveLength(2);
  await application.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, fixture);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Auto save", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page
    .locator(".file-list")
    .getByRole("button", { name: "src/renamed.ts", exact: true })
    .click();
  const original = await fs.readFile(
    path.join(fixture, "src/renamed.ts"),
    "utf8",
  );
  const editor = page
    .locator(".workbench-view:not([hidden]) .monaco-editor")
    .first();
  await editor.click({ position: { x: 220, y: 40 } });
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText("export const recoveredDraft = true;\n");
  await expect
    .poll(() =>
      page.evaluate(
        async (root) =>
          (await window.witch.workspace.session(root)).session?.documents.find(
            (item) => item.path === "src/renamed.ts",
          )?.draft?.content,
        fixture,
      ),
    )
    .toContain("recoveredDraft");
  await page.reload();
  await expect(page.locator(".terminal-tab")).toHaveCount(2);
  expect(
    await page.evaluate(async () =>
      (await window.witch.terminal.list()).map((session) => session.id),
    ),
  ).toEqual(terminalIds);
  await expect(
    page.locator(".terminal-instance:visible .xterm-rows"),
  ).toContainText("WITCH_EXECUTED");
  await expect(editor).toContainText("recoveredDraft");
  await expect(page.locator(".document-conflict")).toContainText(
    "Recovered unsaved edits",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Auto save", { exact: true }).check();
  await page.getByLabel("Auto-save delay").fill("500");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  // Negative temporal assertion: wait longer than the configured 500ms auto-save delay.
  await page.waitForTimeout(850);
  expect(await fs.readFile(path.join(fixture, "src/renamed.ts"), "utf8")).toBe(
    original,
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => fs.readFile(path.join(fixture, "src/renamed.ts"), "utf8"))
    .toContain("recoveredDraft");
  await expect(page.locator(".document-conflict")).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Auto save", { exact: true }).uncheck();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  expect(errors).toEqual([]);
});

test("panel dividers resize by mouse and keyboard and restore after reload", async () => {
  const project = page.getByRole("separator", { name: "Resize project panel" });
  const chat = page.getByRole("separator", { name: "Resize chat panel" });
  const terminal = page.getByRole("separator", { name: "Resize terminal" });
  const bounds = await project.boundingBox();
  if (!bounds) throw new Error("Missing project divider");
  await page.mouse.move(bounds.x + 2, bounds.y + 40);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 32, bounds.y + 40, { steps: 5 });
  await page.mouse.up();
  await expect(project).toHaveAttribute("aria-valuenow", "250");
  await chat.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(chat).toHaveAttribute("aria-valuenow", "360");
  await terminal.focus();
  await page.keyboard.press("Shift+ArrowUp");
  await expect(terminal).toHaveAttribute("aria-valuenow", "250");
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.witch.settings.get()).preferences.layout,
      ),
    )
    .toEqual({ left: 250, right: 360, terminal: 250 });
  await page.reload();
  await expect(project).toHaveAttribute("aria-valuenow", "250");
  await expect(chat).toHaveAttribute("aria-valuenow", "360");
  await expect(terminal).toHaveAttribute("aria-valuenow", "250");
  await page.screenshot({ path: "test-results/witch-resized-panels.png" });
  expect(errors).toEqual([]);
});

test("Node debugger and project tasks are connected to the desktop UI", async () => {
  await page
    .locator(".file-list")
    .getByRole("button", { name: "app.cjs", exact: true })
    .click();
  const editor = page
    .locator(".workbench-view:not([hidden]) .monaco-editor")
    .first();
  await editor.click({ position: { x: 220, y: 40 } });
  await page.keyboard.press(documentStart);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("F9");
  await expect(page.locator(".witch-breakpoint")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Start debugging", exact: true })
    .click();
  await expect(page.locator(".debug-status")).toContainText("paused");
  await page
    .getByRole("button", { name: "Continue debugging", exact: true })
    .click();
  await expect(page.locator(".debug-stack .selected")).toContainText("compute");
  await expect(page.locator(".debug-stack .selected")).toContainText(
    "app.cjs:4",
  );
  await expect(
    page.locator(".debug-scope[open] .debug-variables"),
  ).toContainText("left");
  await page.getByRole("button", { name: "Step over", exact: true }).click();
  await expect(page.locator(".debug-stack .selected")).toContainText(
    "app.cjs:5",
  );
  await expect(
    page.locator(".debug-scope[open] .debug-variables"),
  ).toContainText("5");
  await page.screenshot({ path: "test-results/witch-debugger.png" });
  await page
    .getByRole("button", { name: "Continue debugging", exact: true })
    .click();
  await expect(page.locator(".debug-status")).toContainText("stopped");
  await page.getByRole("button", { name: "Edit tasks", exact: true }).click();
  await expect(page.locator(".source-breadcrumb")).toContainText(
    ".witch/tasks.json",
  );
  await page
    .locator(".file-list")
    .getByRole("button", { name: "app.cjs", exact: true })
    .click();
  await expect(
    page.getByLabel("Run project task").locator("option"),
  ).toHaveCount(2);
  const executed = page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        let text = "";
        const timer = setTimeout(() => {
          off();
          reject(new Error("Project task did not execute"));
        }, 15000);
        const off = window.witch.terminal.onData((event) => {
          text += event.data;
          if (text.includes("WITCH_TASK_5")) {
            clearTimeout(timer);
            off();
            resolve(text);
          }
        });
      }),
  );
  await page
    .getByLabel("Run project task")
    .selectOption({ label: "Run active file" });
  await executed;
  await expect(page.locator(".terminal-tab.selected")).toContainText("exited");
  expect(errors).toEqual([]);
});

test("settings, remapped shortcuts, auto save and local snippet extensions work and persist", async () => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Theme", { exact: true }).selectOption("twilight");
  await page.getByLabel("Editor font size").fill("16");
  await page.getByLabel("Word wrap", { exact: true }).check();
  await page.getByRole("button", { name: "shortcuts", exact: true }).click();
  await page
    .getByLabel("Save file shortcut", { exact: true })
    .fill("Mod+Alt+S");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "twilight");
  await page
    .locator(".file-list")
    .getByRole("button", { name: "src/renamed.ts", exact: true })
    .click();
  const editor = page
    .locator(".workbench-view:not([hidden]) .monaco-editor")
    .first();
  await expect(editor.locator(".view-lines")).toHaveCSS("font-size", "16px");
  await editor.click({ position: { x: 220, y: 40 } });
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText("export const customShortcut = true;\n");
  await page.keyboard.press(`${mod}+Alt+s`);
  await expect
    .poll(() => fs.readFile(path.join(fixture, "src/renamed.ts"), "utf8"))
    .toContain("customShortcut");
  await page.keyboard.press(`${mod}+Shift+p`);
  await page.getByLabel("Find command").fill("Open settings");
  await page.keyboard.press("Enter");
  await page.getByLabel("Auto save", { exact: true }).check();
  await page.getByLabel("Auto-save delay").fill("500");
  await page.getByRole("button", { name: "extensions", exact: true }).click();
  await application.evaluate(({ dialog }, manifest) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [manifest],
    });
  }, path.resolve("examples/extensions/witch-typescript.witch.json"));
  await page
    .getByRole("button", { name: "Import snippet extension", exact: true })
    .click();
  await expect(page.locator(".extension-card")).toContainText(
    "witch.typescript-starters",
  );
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await editor.click({ position: { x: 220, y: 40 } });
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText("wfn");
  await page.keyboard.press("Control+Space");
  await expect
    .poll(async () => {
      if (errors.length) throw new Error(errors.join("\n"));
      return page.locator(".suggest-widget.visible").allTextContents();
    })
    .toContainEqual(expect.stringContaining("wfn"));
  await page.keyboard.press("Tab");
  await expect(editor).toContainText("export function");
  await expect
    .poll(() => fs.readFile(path.join(fixture, "src/renamed.ts"), "utf8"))
    .toContain("export function");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.screenshot({ path: "test-results/witch-settings.png" });
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  expect(errors).toEqual([]);

  await application.close();
  const env = electronEnvironment({ WITCH_USER_DATA_DIR: profile });
  application = await electron.launch({
    executablePath,
    args: executablePath ? [] : ["out/main/index.js"],
    cwd: process.cwd(),
    env,
  });
  page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "twilight");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Editor font size")).toHaveValue("16");
  await expect(page.getByLabel("Auto save", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "extensions", exact: true }).click();
  await expect(page.locator(".extension-card")).toContainText(
    "witch.typescript-starters",
  );
  await page
    .getByRole("button", { name: "Close settings", exact: true })
    .click();
  await expect(
    page.getByRole("separator", { name: "Resize project panel" }),
  ).toHaveAttribute("aria-valuenow", "250");
  await application.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [root],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, fixture);
  await page
    .getByRole("button", { name: "Open repository", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => window.witch.debug.breakpoints()))
    .toEqual([{ path: "app.cjs", line: 4, verified: false }]);
  await page
    .locator(".file-list")
    .getByRole("button", { name: "app.cjs", exact: true })
    .click();
  await expect(
    page
      .locator(".workbench-view:not([hidden]) .monaco-editor .witch-breakpoint")
      .first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("file mutations reject stale projects and preserve drafts changed during native confirmation", async () => {
  const relative = "guarded-delete.txt";
  await fs.writeFile(path.join(fixture, relative), "guarded original\n");
  const wrongRoot = path.join(fixture, "not-current");
  const stale = await page.evaluate(
    async ({ wrongRoot }) => {
      try {
        await window.witch.workspace.createFile(
          "stale.txt",
          "must not write",
          wrongRoot,
        );
      } catch (error) {
        return String(error);
      }
      return "unexpected write";
    },
    { wrongRoot },
  );
  expect(stale).toContain("project changed");
  expect(
    await fs.stat(path.join(fixture, "stale.txt")).catch(() => null),
  ).toBeNull();

  await application.evaluate(({ dialog }) => {
    const state = globalThis as typeof globalThis & {
      witchTestConfirmation?: () => void;
      witchTestWaiting?: boolean;
    };
    dialog.showMessageBox = async () =>
      new Promise((resolve) => {
        state.witchTestWaiting = true;
        state.witchTestConfirmation = () =>
          resolve({ response: 1, checkboxChecked: false });
      });
  });
  const deletion = page.evaluate(
    async ({ relative, root }) => {
      try {
        await window.witch.workspace.delete(relative, true, root);
      } catch (error) {
        return String(error);
      }
      return "unexpected deletion";
    },
    { relative, root: fixture },
  );
  try {
    await expect
      .poll(() =>
        application.evaluate(
          () =>
            (globalThis as typeof globalThis & { witchTestWaiting?: boolean })
              .witchTestWaiting,
        ),
      )
      .toBe(true);
    const switching = await page.evaluate(async () => {
      try {
        await window.witch.workspace.open();
      } catch (error) {
        return String(error);
      }
      return "unexpected switch";
    });
    expect(switching).toContain("Wait for moving a file or folder to trash");
    await page.evaluate(
      ({ relative, root }) => window.witch.workspace.dirty([relative], root),
      { relative, root: fixture },
    );
  } finally {
    await application.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & {
        witchTestConfirmation?: () => void;
        witchTestWaiting?: boolean;
      };
      state.witchTestConfirmation?.();
      delete state.witchTestConfirmation;
      delete state.witchTestWaiting;
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
  }
  expect(await deletion).toContain("Save or close unsaved files");
  expect(await fs.readFile(path.join(fixture, relative), "utf8")).toBe(
    "guarded original\n",
  );
  await page.evaluate(
    (root) => window.witch.workspace.dirty([], root),
    fixture,
  );
  await page.evaluate(
    (root) =>
      window.witch.workspace.createFile("after-guard.txt", "ready", root),
    fixture,
  );
  expect(await fs.readFile(path.join(fixture, "after-guard.txt"), "utf8")).toBe(
    "ready",
  );
});

test("quick open and the project tree support keyboard navigation without losing focus", async () => {
  await page.keyboard.press(`${mod}+p`);
  await page
    .getByRole("combobox", { name: "Quick open file", exact: true })
    .fill("client.ts");
  await expect(
    page.getByRole("option", { name: /client\.ts/ }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Quick open", exact: true }),
  ).not.toBeVisible();
  await expect(page.locator(".source-breadcrumb")).toContainText(
    "src/api/client.ts",
  );
  const tree = page.getByRole("tree", { name: "Project files" });
  const folder = tree.getByRole("button", { name: "api", exact: true });
  await folder.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowRight");
  await expect(
    tree.getByRole("button", { name: "client.ts", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  const file = tree.getByRole("button", { name: "client.ts", exact: true });
  await expect(file).toBeFocused();
  await page.keyboard.press("F2");
  await expect(
    page.getByLabel("Workspace-relative path", { exact: true }),
  ).toHaveValue("src/api/client.ts");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Rename file or folder", exact: true }),
  ).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("accepting a TypeScript auto-import completion changes the editor buffer before an explicit save", async () => {
  const preferences = (await page.evaluate(() => window.witch.settings.get()))
    .preferences;
  await page.evaluate(
    (preferences) =>
      window.witch.settings.save({ ...preferences, autoSave: false }),
    preferences,
  );
  const relative = "src/auto-import.ts";
  await fs.writeFile(path.join(fixture, relative), "export {};\n");
  await page.keyboard.press(`${mod}+p`);
  await page
    .getByRole("combobox", { name: "Quick open file" })
    .fill("auto-import.ts");
  await expect(
    page.getByRole("option", { name: /auto-import\.ts/ }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  const editor = page
    .locator(".workbench-view:not([hidden]) .monaco-editor")
    .first();
  await editor.click({ position: { x: 220, y: 40 } });
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText("const value = welco");
  await expect
    .poll(async () => {
      await page.keyboard.press("Control+Space");
      return page.locator(".suggest-widget.visible").allTextContents();
    })
    .toContainEqual(expect.stringContaining("welcome"));
  await page.keyboard.press("Tab");
  await expect(editor).toContainText("import { welcome }");
  expect(await fs.readFile(path.join(fixture, relative), "utf8")).toBe(
    "export {};\n",
  );
  await page.keyboard.press(`${mod}+Alt+s`);
  await expect
    .poll(() => fs.readFile(path.join(fixture, relative), "utf8"))
    .toContain("import { welcome }");
  expect(errors).toEqual([]);
});

test("TypeScript hover and signature hints show source documentation in the editor", async () => {
  const relative = "src/hints.ts";
  const original =
    '/** Builds a greeting for the Witch user. */\nfunction makeGreeting(name: string, count: number) { return name.repeat(count); }\nmakeGreeting("Witch", 2);\n';
  await fs.writeFile(path.join(fixture, relative), original);
  await page.keyboard.press(`${mod}+p`);
  await page
    .getByRole("combobox", { name: "Quick open file" })
    .fill("hints.ts");
  await expect(page.getByRole("option", { name: /hints\.ts/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const editor = page
    .locator(".workbench-view:not([hidden]) .monaco-editor")
    .first();
  await editor.click({ position: { x: 190, y: 40 } });
  await page.keyboard.press(documentStart);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press(`${mod}+k`);
  await page.keyboard.press(`${mod}+i`);
  const hover = page
    .locator(".monaco-hover")
    .filter({ hasText: "Builds a greeting" });
  await expect(hover).toBeVisible();
  await expect(hover).toContainText("name: string");
  await expect(hover.locator(".monaco-tokenized-source")).toBeVisible();
  await page.screenshot({
    path: "test-results/witch-language-hover.png",
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await editor.click({ position: { x: 210, y: 40 } });
  await page.keyboard.press(documentEnd);
  await page.keyboard.insertText('makeGreeting("Witch", ');
  await page.keyboard.press(`${mod}+Shift+Space`);
  const hint = page.locator(".parameter-hints-widget.visible");
  await expect(hint).toContainText("name: string");
  await expect(hint).toContainText("count: number");
  await expect(hint.locator(".parameter.active")).toContainText("count");
  await page.screenshot({ path: "test-results/witch-language-signature.png" });
  expect(await fs.readFile(path.join(fixture, relative), "utf8")).toBe(
    original,
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press(`${mod}+Alt+s`);
  expect(errors).toEqual([]);
});

test("renaming a JavaScript file keeps its saved breakpoints attached to the new path", async () => {
  await page.evaluate(() => window.witch.debug.setBreakpoints("app.cjs", [2]));
  const tree = page.getByRole("tree", { name: "Project files" });
  await tree.getByRole("button", { name: "app.cjs", exact: true }).click();
  await page.keyboard.press("F2");
  const rename = page.getByRole("dialog", {
    name: "Rename file or folder",
    exact: true,
  });
  await rename
    .getByLabel("Workspace-relative path", { exact: true })
    .fill("relocated.cjs");
  await rename.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(
    tree.getByRole("button", { name: "relocated.cjs", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.witch.debug.breakpoints()))
    .toEqual([{ path: "relocated.cjs", line: 2, verified: false }]);
  await expect(page.locator(".source-breadcrumb")).toContainText(
    "relocated.cjs",
  );
  await assertFileMissing(path.join(fixture, "app.cjs"));
  expect(
    await fs.readFile(path.join(fixture, "relocated.cjs"), "utf8"),
  ).toContain("function compute");
  expect(errors).toEqual([]);
});

async function assertFileMissing(file: string) {
  await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
}
