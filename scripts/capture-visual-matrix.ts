import { _electron as electron, type ElectronApplication } from "playwright";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type MatrixEntry = {
  theme: "night" | "twilight" | "contrast";
  viewport: "desktop" | "compact";
  lens: "overview" | "components";
  screenshot: string;
  receipt: Record<string, unknown>;
};

const themes = ["night", "twilight", "contrast"] as const;
const viewports = {
  desktop: { width: 1600, height: 1000 },
  compact: { width: 1180, height: 760 },
} as const;
const lenses = ["overview", "components"] as const;

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

function contactSheet(entries: MatrixEntry[]) {
  const cards = entries
    .map(
      (entry) => `
      <article>
        <img src="${path.basename(entry.screenshot)}" alt="${entry.theme} ${entry.viewport} ${entry.lens}">
        <footer><strong>${entry.theme} · ${entry.viewport}</strong><span>${entry.lens}</span></footer>
      </article>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Witch visual matrix</title>
  <style>html{background:#09060d;color:#eadcf5;font:14px system-ui}body{margin:0;padding:28px}h1{font:28px Georgia;margin:0 0 8px}p{color:#a893b9;margin:0 0 22px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}article{overflow:hidden;border:1px solid #604474;border-radius:12px;background:#160e20;box-shadow:0 12px 35px #0008}img{display:block;width:100%;height:auto}footer{display:flex;justify-content:space-between;padding:10px 12px;color:#bca5ce}span{color:#8f7aa1}@media(max-width:1000px){.grid{grid-template-columns:1fr}}</style>
  </head><body><h1>Witch rendered-graph visual matrix</h1><p>${entries.length} fixed viewport/theme/lens captures with machine-readable delivery receipts.</p><main class="grid">${cards}</main></body></html>`;
}

async function main() {
  const projectRoot = await fs.realpath(path.resolve(process.argv[2] || "."));
  const output = path.resolve(
    process.argv[3] || "test-results/visual-matrix",
  );
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "witch-visual-matrix-"));
  await fs.mkdir(output, { recursive: true });
  let application: ElectronApplication | undefined;
  const errors: string[] = [];
  try {
    application = await electron.launch({
      args: ["out/main/index.js"],
      cwd: process.cwd(),
      env: environment({ WITCH_USER_DATA_DIR: profile }),
    });
    await application.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    }, projectRoot);
    const page = await application.firstWindow();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewports.desktop);
    await page.getByRole("button", { name: "Open repository", exact: true }).click();
    await page.locator(".architecture-card").first().waitFor({
      state: "visible",
      timeout: 180_000,
    });
    await page
      .getByRole("button", { name: "Collapse terminal", exact: true })
      .click()
      .catch(() => undefined);
    await page
      .getByLabel("Semantic Composer provider")
      .selectOption("rules")
      .catch(() => undefined);
    const compose = page.getByRole("button", { name: "Compose meaning", exact: true });
    if (await compose.isEnabled().catch(() => false)) {
      await compose.click();
      await page
        .locator(".semantic-composer-receipt")
        .waitFor({ state: "visible", timeout: 60_000 });
    }

    const entries: MatrixEntry[] = [];
    for (const theme of themes)
      for (const [viewport, size] of Object.entries(viewports) as Array<
        [keyof typeof viewports, (typeof viewports)[keyof typeof viewports]]
      >)
        for (const lens of lenses) {
          const previousReceipt = await page
            .locator(".graph-delivery-receipt")
            .getAttribute("data-receipt");
          const previousMeasuredAt = previousReceipt
            ? (JSON.parse(previousReceipt) as { generatedAt?: string }).generatedAt
            : undefined;
          await page.setViewportSize(size);
          await page.evaluate((selectedTheme) => {
            document.documentElement.dataset.theme = selectedTheme;
          }, theme);
          await page.getByLabel("Meaning lens").selectOption(lens);
          await page.evaluate(() =>
            window.dispatchEvent(new Event("witch:validate-graph")),
          );
          const stage = page.locator(".graph-stage");
          await stage.waitFor({ state: "visible" });
          await page.waitForFunction(
            (previous) => {
              const status = document
                .querySelector(".graph-stage")
                ?.getAttribute("data-render-status");
              const encoded = document
                .querySelector(".graph-delivery-receipt")
                ?.getAttribute("data-receipt");
              if (!encoded) return false;
              const receipt = JSON.parse(encoded) as { generatedAt?: string };
              return (
                (status === "pass" || status === "warning" || status === "fail") &&
                receipt.generatedAt !== previous
              );
            },
            previousMeasuredAt,
            { timeout: 15_000 },
          );
          const encoded = await stage
            .locator(".graph-delivery-receipt")
            .getAttribute("data-receipt");
          if (!encoded) throw new Error("Rendered graph receipt is missing");
          const screenshot = path.join(
            output,
            `${theme}-${viewport}-${lens}.png`,
          );
          await page.screenshot({ path: screenshot, fullPage: false });
          entries.push({
            theme,
            viewport,
            lens,
            screenshot,
            receipt: JSON.parse(encoded) as Record<string, unknown>,
          });
        }

    const html = contactSheet(entries);
    const htmlPath = path.join(output, "contact-sheet.html");
    await fs.writeFile(htmlPath, html);
    await page.setViewportSize({ width: 1800, height: 1200 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.screenshot({
      path: path.join(output, "contact-sheet.png"),
      fullPage: true,
    });
    await fs.writeFile(
      path.join(output, "visual-matrix-receipt.json"),
      JSON.stringify(
        {
          contract: "witch.visual-matrix/v1",
          generatedAt: new Date().toISOString(),
          projectRoot,
          entries: entries.map((entry) => ({
            ...entry,
            screenshot: path.basename(entry.screenshot),
          })),
          browserErrors: errors,
          valid:
            errors.length === 0 &&
            entries.every((entry) => entry.receipt.valid === true),
        },
        null,
        2,
      ),
    );
    if (errors.length || entries.some((entry) => entry.receipt.valid !== true))
      process.exitCode = 1;
  } finally {
    await application?.close().catch(() => undefined);
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
