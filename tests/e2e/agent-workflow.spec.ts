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

test("component chat runs isolated edits, honors canceled approval, applies diffs and updates the map", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "witch-chat-ui-"));
  const root = path.join(directory, "project"),
    profile = path.join(directory, "profile");
  await fs.mkdir(root);
  await fs.mkdir(profile);
  const original = 'export const greeting = "Hello";\n';
  await fs.writeFile(path.join(root, "greeting.ts"), original);
  const protocolFixture = path.resolve("tests/fixtures/fake-codex.mjs");
  const cli = path.join(
    directory,
    process.platform === "win32" ? "fixture.cmd" : "fixture",
  );
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  await fs.writeFile(
    cli,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "${protocolFixture}" %*\r\n`
      : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(protocolFixture)} "$@"\n`,
    { mode: 0o700 },
  );
  const executablePath = process.env.WITCH_PACKAGED_EXECUTABLE
    ? path.resolve(process.env.WITCH_PACKAGED_EXECUTABLE)
    : undefined;
  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      executablePath,
      args: executablePath ? [] : ["out/main/index.js"],
      cwd: process.cwd(),
      env: electronEnvironment({
        WITCH_USER_DATA_DIR: profile,
        WITCH_CODEX_PATH: cli,
      }),
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
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error")
        console.error("Workbench console:", message.text());
    });
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await expect(page.locator(".architecture-card")).toHaveCount(1);
    const before = await page.evaluate(
      async () => (await window.witch.analysis.current())?.revision,
    );
    expect(before).toBeTruthy();
    const artwork = page.locator(".chat-observatory img");
    expect(
      await artwork.evaluate((image: HTMLImageElement) => image.draggable),
    ).toBe(false);
    await expect(artwork).toHaveCSS("pointer-events", "none");
    // The chat region's default drop point overlaps this artwork on macOS.
    // Keeping it inert lets the enclosing Component chat handler receive it.
    await page
      .getByRole("button", { name: "Drag root to chat", exact: true })
      .dragTo(page.getByRole("region", { name: "Component chat" }));
    await expect(page.locator(".context-chip")).toContainText("root");
    await page.getByLabel("Agent mode").selectOption("change");
    await page
      .getByLabel("Message Witch")
      .fill("Change the greeting in this component.");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Review 1 changed file →",
        exact: true,
      }),
    ).toBeVisible();
    expect(await fs.readFile(path.join(root, "greeting.ts"), "utf8")).toBe(
      original,
    );
    const run = (await page.evaluate(() => window.witch.agent.list()))[0];
    expect(run.contexts[0].paths).toEqual(["greeting.ts"]);
    expect(run.stagingRoot).toBeTruthy();
    expect(
      await fs.readFile(path.join(run.stagingRoot!, "greeting.ts"), "utf8"),
    ).toContain("Welcome to Witch");
    await page
      .getByRole("button", { name: "Review 1 changed file →", exact: true })
      .click();
    const review = page.getByRole("dialog", {
      name: "Review agent changes",
      exact: true,
    });
    await expect(review.locator(".monaco-diff-editor")).toContainText(
      "Welcome to Witch",
    );
    await review.getByLabel("Apply greeting.ts", { exact: true }).uncheck();
    await expect(
      review.getByRole("button", {
        name: "Apply selected changes",
        exact: true,
      }),
    ).toBeDisabled();
    await review.getByLabel("Apply greeting.ts", { exact: true }).check();
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    await review
      .getByRole("button", { name: "Apply selected changes", exact: true })
      .click();
    await expect(review.getByRole("alert")).toContainText("Apply canceled");
    expect(await fs.readFile(path.join(root, "greeting.ts"), "utf8")).toBe(
      original,
    );
    expect(
      await page.evaluate(
        async () => (await window.witch.analysis.current())?.revision,
      ),
    ).toBe(before);
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await page.screenshot({ path: "test-results/witch-agent-review.png" });
    await review
      .getByRole("button", { name: "Apply selected changes", exact: true })
      .click();
    await expect(review).not.toBeVisible();
    await expect
      .poll(async () => {
        if (await page.locator(".recovery-screen").count())
          throw new Error(
            (await page.locator(".recovery-screen pre").textContent()) ||
              "Workbench recovery triggered",
          );
        return page.locator(".applied-note").allTextContents();
      })
      .toContainEqual(expect.stringContaining("1 file(s) applied"));
    expect(await fs.readFile(path.join(root, "greeting.ts"), "utf8")).toContain(
      "Welcome to Witch",
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.witch.analysis.current())?.revision,
        ),
      )
      .not.toBe(before);
    await expect(page.locator(".architecture-card")).toHaveClass(/has-changed/);
    await page.getByLabel("Agent mode").selectOption("ask");
    await page.getByLabel("Message Witch").fill("Explain this component.");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.locator(".run-state.completed")).toHaveCount(1);
    await page.getByLabel("Message Witch").fill("WAIT_FOREVER");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.locator(".run-state.running")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.witch.providers.status()).codex,
        ),
      )
      .toMatchObject({ installed: true, running: true, connected: true });
    await page.getByRole("button", { name: "Stop agent", exact: true }).click();
    await expect(page.locator(".run-state.interrupted")).toHaveCount(1);
    expect(
      await page.evaluate(
        async () => (await window.witch.providers.status()).codex,
      ),
    ).toMatchObject({ installed: true, running: false, connected: false });
    await page.getByLabel("Agent mode").selectOption("change");
    await page.getByLabel("Message Witch").fill("PARTIAL_EDIT");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.witch.agent.list())[0].activity,
        ),
      )
      .toContainEqual(expect.stringContaining("Editing: greeting.ts"));
    await page.getByRole("button", { name: "Stop agent", exact: true }).click();
    await expect(page.locator(".run-state.review")).toHaveCount(1);
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 0,
        checkboxChecked: false,
      });
    });
    const archive = page.getByRole("button", {
      name: "Archive without applying",
      exact: true,
    });
    await archive.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Archive canceled" }),
    ).toBeVisible();
    await expect(page.locator(".run-state.review")).toHaveCount(1);
    await application.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    });
    await archive.click();
    await expect(page.locator(".run-state.archived")).toHaveCount(1);
    const archived = (await page.evaluate(() => window.witch.agent.list()))[0];
    const snapshot = JSON.parse(
      await fs.readFile(archived.archivePath!, "utf8"),
    );
    expect(snapshot.run.changes[0].after).toContain("Partial edit");
    expect(await fs.readFile(path.join(root, "greeting.ts"), "utf8")).toContain(
      "Welcome to Witch",
    );
    expect(
      await fs.readFile(
        path.join(archived.stagingRoot!, "greeting.ts"),
        "utf8",
      ),
    ).toContain("Partial edit");
    await page.reload();
    await expect(page.locator(".run-state.applied")).toHaveCount(1);
    await expect(page.locator(".run-state.completed")).toHaveCount(1);
    await expect(page.locator(".run-state.interrupted")).toHaveCount(1);
    await expect(page.locator(".run-state.archived")).toHaveCount(1);
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
