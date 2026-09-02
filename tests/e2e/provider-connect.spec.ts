import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { electronEnvironment } from "./environment";

const executablePath = process.env.WITCH_PACKAGED_EXECUTABLE
  ? path.resolve(process.env.WITCH_PACKAGED_EXECUTABLE)
  : undefined;

test("detected Codex and Claude CLIs sign in through Witch and refresh automatically", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-provider-connect-"),
  );
  const profile = path.join(directory, "profile");
  const marker = path.join(directory, "signed-in");
  const claudeMarker = path.join(directory, "claude-signed-in");
  const fixture = path.join(directory, "fake-codex.mjs");
  const cli = path.join(
    directory,
    process.platform === "win32" ? "codex-fixture.cmd" : "codex-fixture",
  );
  await fs.mkdir(profile);
  await fs.writeFile(
    fixture,
    [
      'import { existsSync, writeFileSync } from "node:fs";',
      "const marker = process.env.WITCH_FAKE_CODEX_AUTH;",
      "const claudeMarker = process.env.WITCH_FAKE_CLAUDE_AUTH;",
      "const args = process.argv.slice(2);",
      'if (args[0] === "--version") { console.log("codex-fixture 1.0.0"); process.exit(0); }',
      'if (args[0] === "login" && args[1] === "status") process.exit(marker && existsSync(marker) ? 0 : 1);',
      'if (args[0] === "login") { writeFileSync(marker, "signed-in"); process.exit(0); }',
      'if (args[0] === "auth" && args[1] === "status") { console.log(JSON.stringify({ loggedIn: Boolean(claudeMarker && existsSync(claudeMarker)) })); process.exit(0); }',
      'if (args[0] === "auth" && args[1] === "login") { writeFileSync(claudeMarker, "signed-in"); process.exit(0); }',
      "process.exit(2);",
      "",
    ].join("\n"),
  );
  if (process.platform === "win32") {
    await fs.writeFile(
      cli,
      `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n`,
    );
  } else {
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    await fs.writeFile(
      cli,
      `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(fixture)} "$@"\n`,
      { mode: 0o755 },
    );
  }

  let application: ElectronApplication | undefined;
  try {
    application = await electron.launch({
      executablePath,
      args: executablePath ? [] : ["out/main/index.js"],
      cwd: process.cwd(),
      env: electronEnvironment({
        WITCH_USER_DATA_DIR: profile,
        WITCH_CODEX_PATH: cli,
        WITCH_CLAUDE_PATH: cli,
        WITCH_FAKE_CODEX_AUTH: marker,
        WITCH_FAKE_CLAUDE_AUTH: claudeMarker,
      }),
    });
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "AI providers" }).click();
    const card = page.locator(".provider-card").filter({
      has: page.getByRole("heading", { name: "Codex CLI", exact: true }),
    });
    await expect(card).toContainText("detected");
    await card.getByRole("button", { name: "Connect Codex" }).click();
    await expect(card).toContainText("signed in");
    await expect(
      card.getByRole("button", { name: "Recheck Codex" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.witch.providers.status()).codex,
        ),
      )
      .toMatchObject({ installed: true, authenticated: true });
    expect(await fs.readFile(marker, "utf8")).toBe("signed-in");

    const claudeCard = page.locator(".provider-card").filter({
      has: page.getByRole("heading", {
        name: "Claude Code CLI",
        exact: true,
      }),
    });
    await expect(claudeCard).toContainText("detected");
    await claudeCard
      .getByRole("button", { name: "Connect Claude Code" })
      .click();
    await expect(
      claudeCard.getByRole("button", { name: "Recheck Claude Code" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.witch.providers.status()).claude,
        ),
      )
      .toMatchObject({ installed: true, authenticated: true });
    expect(await fs.readFile(claudeMarker, "utf8")).toBe("signed-in");
  } finally {
    await application?.close().catch(() => undefined);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
