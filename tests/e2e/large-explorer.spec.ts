import { test, expect, _electron as electron } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { electronEnvironment } from "./environment";

test("large expanded folders render a bounded viewport and reveal off-screen keyboard selections", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-large-tree-"),
  );
  const root = path.join(directory, "project"),
    profile = path.join(directory, "profile");
  await fs.mkdir(path.join(root, "bulk"), { recursive: true });
  await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n");
  for (let batch = 0; batch < 1200; batch += 40)
    await Promise.all(
      Array.from({ length: 40 }, (_, offset) => {
        const index = String(batch + offset).padStart(4, "0");
        return fs.writeFile(
          path.join(root, "bulk", `page-${index}.txt`),
          `Page ${index}\n`,
        );
      }),
    );
  const executablePath = process.env.WITCH_PACKAGED_EXECUTABLE
    ? path.resolve(process.env.WITCH_PACKAGED_EXECUTABLE)
    : undefined;
  const application = await electron.launch({
    executablePath,
    args: executablePath ? [] : ["out/main/index.js"],
    env: electronEnvironment({ WITCH_USER_DATA_DIR: profile }),
  });
  const child = application.process();
  try {
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
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    const tree = page.getByRole("tree", { name: "Project files" });
    const folder = tree.getByRole("button", { name: "bulk", exact: true });
    await folder.click();
    await expect(folder).toBeFocused();
    expect(await tree.locator(".project-tree-row").count()).toBeLessThan(80);
    await page.keyboard.press("End");
    await expect(
      tree.getByRole("button", { name: "main.ts", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowUp");
    const last = tree.getByRole("button", {
      name: "page-1199.txt",
      exact: true,
    });
    await expect(last).toBeFocused();
    await expect(last).toBeVisible();
    await page.keyboard.press("F2");
    await expect(
      page.getByLabel("Workspace-relative path", { exact: true }),
    ).toHaveValue("bulk/page-1199.txt");
    await page.keyboard.press("Escape");
    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+p`);
    await page
      .getByRole("combobox", { name: "Quick open file" })
      .fill("page-0600.txt");
    await page.keyboard.press("Enter");
    await expect(
      tree.getByRole("button", { name: "page-0600.txt", exact: true }),
    ).toBeVisible();
    await expect(
      page.locator(".workbench-view:not([hidden]) .monaco-editor"),
    ).toContainText("Page 0600");
    expect(await tree.locator(".project-tree-row").count()).toBeLessThan(80);
    const row = tree.getByRole("treeitem").filter({
      has: page.getByRole("button", { name: "page-0600.txt", exact: true }),
    });
    await expect(row).toHaveAttribute("aria-level", "2");
    await expect(row).toHaveAttribute("aria-setsize", "1200");
    expect(errors).toEqual([]);
    await page.screenshot({ path: "test-results/witch-large-explorer.png" });
    await page.keyboard.press(`${mod}+Shift+f`);
    const search = page.getByRole("dialog", {
      name: "Search workspace",
      exact: true,
    });
    await search
      .getByRole("textbox", { name: "Search workspace", exact: true })
      .fill("Page 1199");
    await search.getByRole("button", { name: "Search", exact: true }).click();
    const match = search.getByRole("button", {
      name: /bulk\/page-1199\.txt:1:1/,
    });
    await expect(match).toBeVisible();
    await expect(search.locator(".navigation-hint")).toContainText("1201/1201");
    await match.click();
    await expect(
      page.locator(".workbench-view:not([hidden]) .monaco-editor"),
    ).toContainText("Page 1199");
    expect(errors).toEqual([]);
  } finally {
    const timeout = setTimeout(() => child.kill(), 15000);
    await application.close();
    clearTimeout(timeout);
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
