import { test, expect, _electron as electron } from "@playwright/test";
import { createServer } from "vite";
import { resolveConfig } from "electron-vite";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AddressInfo } from "node:net";
import { electronEnvironment } from "./environment";

test("development renderer starts with its CSP and reloads without losing the bridge", async () => {
  test.skip(
    Boolean(process.env.WITCH_PACKAGED_EXECUTABLE),
    "The packaged app deliberately ignores renderer development URLs",
  );
  const profile = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-dev-profile-"),
  );
  const config = await resolveConfig({}, "serve", "development");
  const server = await createServer({
    ...config.config!.renderer,
    logLevel: "error",
    server: { host: "localhost", port: 0 },
  });
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await server.listen();
    const port = (server.httpServer!.address() as AddressInfo).port;
    const env = electronEnvironment({
      WITCH_USER_DATA_DIR: profile,
      ELECTRON_RENDERER_URL: `http://localhost:${port}`,
    });
    application = await electron.launch({
      args: ["out/main/index.js"],
      cwd: process.cwd(),
      env,
    });
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /Content Security Policy|preamble/.test(message.text())
      )
        errors.push(message.text());
    });
    await expect(
      page.getByRole("button", { name: "Open repository", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    expect(page.url()).toContain(`http://localhost:${port}`);
    expect(
      await page.evaluate(() => window.witch.settings.get()),
    ).toHaveProperty("preferences");
    await expect
      .poll(() => ({ clients: server.ws.clients.size, errors }))
      .toEqual({ clients: 1, errors: [] });
    const loaded = page.waitForEvent("domcontentloaded");
    server.ws.send({ type: "full-reload", path: "*" });
    await loaded;
    await expect(
      page.getByRole("button", { name: "Settings", exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await application?.close();
    await server.close();
    await fs.rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
});
