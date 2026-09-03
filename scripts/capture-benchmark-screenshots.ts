import { _electron as electron, type ElectronApplication } from "playwright";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

type CaptureResult = {
  rank: number;
  repository: string;
  root: string;
  screenshot: string;
  view: "semantic-components" | "semantic-workflows" | "source-modules";
  expanded?: boolean;
  note?: string;
};

function environment(overrides: Record<string, string>) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[0] !== "ELECTRON_RUN_AS_NODE",
      ),
    ),
    ...overrides,
  };
}

function displayName(folder: string) {
  return folder.replace(/^\d+-/, "").replace("--", "/");
}

async function capture(
  root: string,
  output: string,
  rank: number,
  semanticLens: "components" | "workflows",
  expandWorkflows: boolean,
): Promise<CaptureResult> {
  const repository = displayName(path.basename(root));
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), `witch-capture-${rank}-`),
  );
  const target = path.join(
    output,
    `${String(rank).padStart(2, "0")}-${path.basename(root).replace(/^\d+-/, "")}.png`,
  );
  let application: ElectronApplication | undefined;
  const errors: string[] = [];
  let view: CaptureResult["view"] = "source-modules";
  try {
    application = await electron.launch({
      args: ["out/main/index.js"],
      cwd: process.cwd(),
      env: environment({ WITCH_USER_DATA_DIR: profile }),
    });
    await application.evaluate(({ dialog }, projectRoot) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [projectRoot],
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
    }, root);
    const page = await application.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page
      .getByRole("button", { name: "Open repository", exact: true })
      .click();
    await page.locator(".architecture-card").first().waitFor({
      state: "visible",
      timeout: 180_000,
    });
    await page
      .getByRole("button", { name: "Collapse terminal", exact: true })
      .click()
      .catch(() => undefined);

    try {
      await page
        .getByLabel("Semantic Composer provider")
        .selectOption("rules", { timeout: 15_000 });
      await page
        .getByRole("button", { name: "Compose meaning", exact: true })
        .click();
      await page.locator(".semantic-composer-receipt").waitFor({
        state: "visible",
        timeout: 45_000,
      });
      await page.getByLabel("Meaning lens").selectOption(semanticLens);
      view = `semantic-${semanticLens}`;
      if (semanticLens === "workflows" && expandWorkflows) {
        const showMore = page.getByRole("button", {
          name: /^Show \d+ more$/,
        });
        if (await showMore.isVisible().catch(() => false))
          await showMore.click();
        const showSupport = page.getByLabel(/^Show support/);
        if (
          (await showSupport.isVisible().catch(() => false)) &&
          !(await showSupport.isChecked())
        )
          await showSupport.check();
      }
    } catch (error) {
      errors.push(
        `Semantic composition: ${error instanceof Error ? error.message : error}`,
      );
      await page
        .getByRole("button", { name: "Modules", exact: true })
        .click()
        .catch(() => undefined);
    }
    const arrange = page.getByRole("button", {
      name: "Arrange graph",
      exact: true,
    });
    if (
      (await arrange.isVisible().catch(() => false)) &&
      (await arrange.isEnabled().catch(() => false))
    )
      await arrange.click();
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      window.getSelection()?.removeAllRanges();
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    await page.screenshot({ path: target, fullPage: false });
    return {
      rank,
      repository,
      root,
      screenshot: target,
      view,
      ...(expandWorkflows ? { expanded: true } : {}),
      ...(errors.length ? { note: errors.join(" | ").slice(0, 800) } : {}),
    };
  } finally {
    await application?.close().catch(() => undefined);
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

async function main() {
  const input = path.resolve(
    process.argv[2] ||
      "C:/Users/cdi65/witch-benchmarks/github-trending-2026-08-31",
  );
  const output = path.resolve(
    process.argv[3] || "docs/screenshots/github-trending-2026-08-31",
  );
  const requestedLens = process.argv[4] || "components";
  if (!(["components", "workflows"] as const).includes(requestedLens as any))
    throw new Error("Screenshot lens must be components or workflows");
  const semanticLens = requestedLens as "components" | "workflows";
  const rankArgument = process.argv[5];
  const requestedRank =
    rankArgument && rankArgument !== "expanded"
      ? Number.parseInt(rankArgument, 10)
      : null;
  const expandWorkflows = process.argv.slice(5).includes("expanded");
  const repositories = (await fs.readdir(input, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d{2}-/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (repositories.length !== 10)
    throw new Error(
      `Expected 10 benchmark repositories; found ${repositories.length}`,
    );
  if (
    requestedRank !== null &&
    (!Number.isInteger(requestedRank) ||
      requestedRank < 1 ||
      requestedRank > 10)
  )
    throw new Error("Screenshot rank must be an integer from 1 to 10");
  await fs.mkdir(output, { recursive: true });
  const results: CaptureResult[] = [];
  for (const [index, repository] of repositories.entries()) {
    if (requestedRank !== null && requestedRank !== index + 1) continue;
    const root = await fs.realpath(path.join(input, repository.name));
    console.log(`[${index + 1}/10] ${displayName(repository.name)}`);
    try {
      const result = await capture(
        root,
        output,
        index + 1,
        semanticLens,
        expandWorkflows,
      );
      results.push(result);
      console.log(`  ${result.view}: ${result.screenshot}`);
    } catch (error) {
      results.push({
        rank: index + 1,
        repository: displayName(repository.name),
        root,
        screenshot: "",
        view: "source-modules",
        note: error instanceof Error ? error.message : String(error),
      });
      console.error(`  failed: ${error}`);
    }
  }
  if (requestedRank !== null) {
    if (results.some((result) => !result.screenshot)) process.exitCode = 1;
    return;
  }
  await fs.writeFile(
    path.join(output, "capture-results.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  );
  const englishMarkdown = [
    "# Witch GitHub Benchmark Screenshots",
    "",
    "[English](README.md) · [한국어](README.ko.md)",
    "",
    "Generated from the fixed 2026-08-31 benchmark checkouts. Repository code was not executed.",
    "",
    ...results.flatMap((result) => [
      `## ${result.rank}. ${result.repository}`,
      "",
      result.screenshot
        ? `![${result.repository}](./${path.basename(result.screenshot).replaceAll(" ", "%20")})`
        : `Capture failed: ${result.note || "Unknown error"}`,
      "",
      `View: ${result.view}${result.expanded ? " · Expanded production and support catalog" : ""}${result.note ? ` · Note: ${result.note}` : ""}`,
      "",
    ]),
  ].join("\n");
  const koreanMarkdown = [
    "# Witch GitHub 벤치마크 스크린샷",
    "",
    "[한국어](README.ko.md) · [English](README.md)",
    "",
    "2026-08-31에 고정한 benchmark checkout으로 생성했습니다. 저장소 코드는 실행하지 않았습니다.",
    "",
    ...results.flatMap((result) => [
      `## ${result.rank}. ${result.repository}`,
      "",
      result.screenshot
        ? `![${result.repository}](./${path.basename(result.screenshot).replaceAll(" ", "%20")})`
        : `캡처 실패: ${result.note || "알 수 없는 오류"}`,
      "",
      `화면: ${result.view}${result.expanded ? " · 확장된 production/support catalog" : ""}${result.note ? ` · 참고: ${result.note}` : ""}`,
      "",
    ]),
  ].join("\n");
  await Promise.all([
    fs.writeFile(path.join(output, "README.md"), englishMarkdown),
    fs.writeFile(path.join(output, "README.ko.md"), koreanMarkdown),
  ]);
  if (results.some((result) => !result.screenshot)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
