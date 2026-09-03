import { test, expect, _electron as electron } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { electronEnvironment } from "./environment";
import { analyzeRepository } from "../../apps/desktop/src/main/services/architecture";
import { WorkbenchStore } from "../../apps/desktop/src/main/services/workbench-store";

test("Graph Intelligence queries, maps, and federates repository evidence", async () => {
  const fixture = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "witch-intelligence-fixture-")),
  );
  const profile = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "witch-intelligence-profile-")),
  );
  const providerFixture = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "witch-federation-provider-")),
  );
  const duplicateProviderFixture = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "witch-federation-provider-copy-")),
  );
  const executablePath = process.env.WITCH_PACKAGED_EXECUTABLE
    ? path.resolve(process.env.WITCH_PACKAGED_EXECUTABLE)
    : undefined;
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await fs.mkdir(path.join(fixture, "src"), { recursive: true });
    await fs.mkdir(path.join(fixture, "docs", "adr"), { recursive: true });
    await fs.writeFile(
      path.join(fixture, "src", "broker.py"),
      [
        "def submit_order(order):",
        "    return order",
        "",
        "def retry_order(order):",
        "    return submit_order(order)",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(fixture, "src", "workflow.py"),
      [
        "from .broker import submit_order, retry_order",
        "",
        "def execute_order(order):",
        "    if order:",
        "        return submit_order(order)",
        "    return retry_order(order)",
        "",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(fixture, "package.json"),
      JSON.stringify(
        {
          name: "witch-intelligence-fixture",
          dependencies: { "@witch/core": "workspace:*", react: "^19.0.0" },
        },
        null,
        2,
      ),
    );
    await fs.mkdir(path.join(providerFixture, "src"), { recursive: true });
    await fs.writeFile(
      path.join(providerFixture, "src", "index.ts"),
      "export function settle(value: string) { return value }\n",
    );
    await fs.writeFile(
      path.join(providerFixture, "package.json"),
      JSON.stringify({ name: "@witch/core" }, null, 2),
    );
    await fs.mkdir(path.join(duplicateProviderFixture, "src"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(duplicateProviderFixture, "src", "index.ts"),
      "export function settle(value: string) { return value }\n",
    );
    await fs.writeFile(
      path.join(duplicateProviderFixture, "package.json"),
      JSON.stringify({ name: "@witch/core" }, null, 2),
    );
    await fs.writeFile(
      path.join(fixture, "docs", "adr", "0001-local-analysis.md"),
      [
        "# ADR 0001: Keep analysis local",
        "",
        "Status: Accepted",
        "",
        "## Context",
        "Repository evidence may contain private implementation details.",
        "",
        "## Decision",
        "Architecture extraction runs locally and stores source-backed receipts.",
        "",
        "## Consequences",
        "Remote composition remains an explicit user action.",
      ].join("\n"),
    );
    const providerGraph = await analyzeRepository(providerFixture);
    const duplicateProviderGraph = await analyzeRepository(
      duplicateProviderFixture,
    );
    const history = new WorkbenchStore(path.join(profile, "state"));
    await history.update((state) => {
      state.projects.push({
        root: providerFixture,
        name: "Witch Core",
        lastOpenedAt: "2026-09-03T00:00:00.000Z",
        lastBranch: "main",
        lastCommit: "uncommitted",
      });
      state.projects.push({
        root: duplicateProviderFixture,
        name: "Witch Core Copy",
        lastOpenedAt: "2026-09-02T00:00:00.000Z",
        lastBranch: "main",
        lastCommit: "uncommitted",
      });
    });
    await history.saveSnapshot(providerGraph, "Witch Core", "uncommitted");
    await history.saveSnapshot(
      duplicateProviderGraph,
      "Witch Core Copy",
      "uncommitted",
    );
    await history.flush();
    application = await electron.launch({
      executablePath,
      args: executablePath ? [] : ["out/main/index.js"],
      cwd: process.cwd(),
      env: electronEnvironment({ WITCH_USER_DATA_DIR: profile }),
    });
    await application.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, fixture);
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await expect(page.locator(".analysis-coverage-summary")).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByRole("button", { name: "Intelligence", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Graph Intelligence" }),
    ).toBeVisible();
    await page.getByLabel("Graph query").fill("submit order");
    await page.getByRole("button", { name: "Build context" }).click();
    await expect(page.locator(".graph-query-receipt")).toContainText("seeds");
    await expect(
      page.locator(".graph-query-node-list article").first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /Map/ }).click();
    await expect(
      page.getByRole("region", { name: "Architecture meta graph" }),
    ).toBeVisible();
    await expect(page.getByText(/system resolution/i).first()).toBeVisible();
    await page.locator(".architecture-meta-node-main").first().click();
    await expect(page.getByText(/community resolution/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Brief", exact: true }).click();
    await expect(
      page.getByText("Structural hubs", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Knowledge/ }).click();
    await expect(
      page.getByRole("heading", { name: /Decisions & RFCs/ }),
    ).toBeVisible();
    await expect(page.getByText(/Keep analysis local/)).toBeVisible();
    await expect(
      page.getByText("witch-intelligence-fixture", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Federation/ }).click();
    await expect(page.getByText("Witch Core", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Build federation" }).click();
    await expect(page.getByText("Multi-repository system map")).toBeVisible();
    await expect(page.getByText(/@witch\/core/).first()).toBeVisible();
    await expect(page.getByText(/2 exact package links/)).toBeVisible();
    await expect(page.getByText(/1 unresolved questions/)).toBeVisible();
    await page
      .getByRole("button", { name: "Approve Witch Core", exact: true })
      .click();
    await expect(page.getByText(/1 applied approvals/)).toBeVisible();
    await expect(page.getByText(/user approval/)).toBeVisible();
    await expect(page.getByText(/0 unresolved questions/)).toBeVisible();
    await page.getByRole("button", { name: "Build federation" }).click();
    await expect(page.getByText(/1 applied approvals/)).toBeVisible();
    await expect(
      page.getByText("Provider approval history", { exact: true }),
    ).toBeVisible();
    const revoke = page.getByRole("button", {
      name: "Revoke approval for @witch/core",
      exact: true,
    });
    await revoke.click();
    await expect(revoke).toContainText("Confirm revoke");
    await revoke.click();
    await expect(
      page.locator(
        '.federation-approval-history article[data-status="revoked"]',
      ),
    ).toBeVisible();
    await expect(page.getByText(/2 exact package links/)).toBeVisible();
    await expect(page.getByText(/1 unresolved questions/)).toBeVisible();
    await page
      .getByRole("button", { name: "Communities", exact: true })
      .click();
    await expect(page.getByText(/observed communities/)).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    await fs.rm(fixture, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
    await fs.rm(providerFixture, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
    await fs.rm(duplicateProviderFixture, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
