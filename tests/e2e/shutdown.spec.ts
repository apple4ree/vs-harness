import { test, expect, _electron as electron } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { electronEnvironment } from "./environment";

test("app quit completes after stopping the language server and flushing profile state", async () => {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "witch-quit-ui-")),
  );
  const root = path.join(directory, "project"),
    profile = path.join(directory, "profile");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n");
  await fs.writeFile(path.join(root, "saved-at-quit.txt"), "Before save\n");
  const executablePath = process.env.WITCH_PACKAGED_EXECUTABLE
    ? path.resolve(process.env.WITCH_PACKAGED_EXECUTABLE)
    : undefined;
  const application = await electron.launch({
    executablePath,
    args: executablePath ? [] : ["out/main/index.js"],
    env: electronEnvironment({ WITCH_USER_DATA_DIR: profile }),
  });
  const child = application.process();
  let forced = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    application.on("console", (message) => {
      if (message.type() === "error")
        console.error("Quit diagnostic:", message.text());
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
    }, root);
    const page = await application.firstWindow();
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await expect(page.locator(".architecture-card")).toHaveCount(1);
    await page.evaluate(async () => {
      await window.witch.lsp.open("main.ts", "export const value = 1;\n");
      const settings = await window.witch.settings.get();
      await window.witch.settings.save({
        ...settings.preferences,
        fontSize: 17,
      });
    });
    expect(await page.evaluate(() => window.witch.lsp.status())).toMatchObject({
      connected: true,
    });
    // Delay only a disposable fixture's atomic rename, proving quit waits for
    // the in-flight save instead of abandoning it or canceling quit forever.
    await application.evaluate((_electron, root) => {
      const promises = process.getBuiltinModule("fs").promises;
      const original = promises.rename;
      promises.rename = async (from, to) => {
        if (
          String(to).endsWith("saved-at-quit.txt") &&
          String(to).startsWith(root)
        ) {
          (globalThis as any).__witchSavePending = true;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return original(from, to);
      };
    }, root);
    await page.evaluate((root) => {
      void window.witch.workspace.writeFile(
        "saved-at-quit.txt",
        "Save completes before exit.\n",
        undefined,
        root,
      );
    }, root);
    await expect
      .poll(() =>
        application.evaluate(() =>
          Boolean((globalThis as any).__witchSavePending),
        ),
      )
      .toBe(true);
    watchdog = setTimeout(() => {
      forced = true;
      child.kill();
    }, 15_000);
    const exited = new Promise<void>((resolve) =>
      child.once("exit", () => resolve()),
    );
    await application.close();
    await exited;
    clearTimeout(watchdog);
    expect(
      forced,
      "Witch should finish its own normal shutdown without being killed",
    ).toBe(false);
    const saved = JSON.parse(
      await fs.readFile(
        path.join(profile, "settings/preferences.json"),
        "utf8",
      ),
    );
    expect(saved.fontSize).toBe(17);
    expect(
      await fs.readFile(path.join(root, "saved-at-quit.txt"), "utf8"),
    ).toBe("Save completes before exit.\n");
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null) {
      const exited = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill();
      await exited;
    }
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
