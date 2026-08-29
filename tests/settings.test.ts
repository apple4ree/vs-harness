import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_PREFERENCES,
  validatePreferences,
  normalizeShortcut,
  shortcutMatches,
  validateExtension,
} from "../apps/desktop/src/shared/settings";
import { SettingsService } from "../apps/desktop/src/main/services/settings-service";

test("settings validate ranges and cross-platform shortcut conflicts", () => {
  assert.equal(normalizeShortcut("shift+mod+p"), "Mod+Shift+P");
  assert(
    shortcutMatches(
      {
        key: "s",
        ctrlKey: true,
        metaKey: false,
        shiftKey: false,
        altKey: false,
      },
      "Mod+S",
      false,
    ),
  );
  assert(
    shortcutMatches(
      {
        key: "s",
        ctrlKey: false,
        metaKey: true,
        shiftKey: false,
        altKey: false,
      },
      "Mod+S",
      true,
    ),
  );
  assert.throws(
    () => validatePreferences({ ...DEFAULT_PREFERENCES, fontSize: 100 }),
    /preferences/,
  );
  assert.throws(
    () =>
      validatePreferences({
        ...DEFAULT_PREFERENCES,
        keybindings: { ...DEFAULT_PREFERENCES.keybindings, search: "Mod+P" },
      }),
    /same shortcut/,
  );
  assert.throws(
    () =>
      validatePreferences({
        ...DEFAULT_PREFERENCES,
        keybindings: { ...DEFAULT_PREFERENCES.keybindings, search: "Ctrl+P" },
      }),
    /same shortcut/,
  );
  assert.throws(
    () =>
      validatePreferences({
        ...DEFAULT_PREFERENCES,
        keybindings: { ...DEFAULT_PREFERENCES.keybindings, search: "Meta+P" },
      }),
    /same shortcut/,
  );
});
test("preferences and non-executable snippet extensions persist", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "witch-settings-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const service = new SettingsService(directory);
  assert.equal((await service.get()).preferences.theme, "night");
  await service.save({
    ...DEFAULT_PREFERENCES,
    theme: "twilight",
    fontSize: 16,
  });
  const extension = JSON.parse(
    await fs.readFile(
      "examples/extensions/witch-typescript.witch.json",
      "utf8",
    ),
  );
  await service.install(extension);
  let settings = await new SettingsService(directory).get();
  assert.equal(settings.preferences.fontSize, 16);
  assert.equal(settings.extensions[0].snippets[0].prefix, "wfn");
  settings = await service.toggle(extension.id, false);
  assert.equal(settings.extensions[0].enabled, false);
  assert.throws(
    () => validateExtension({ ...extension, id: "../../outside" }),
    /publisher/,
  );
  assert.throws(
    () => validateExtension({ ...extension, main: "execute.js" }),
    /Executable/,
  );
  await fs.writeFile(path.join(directory, "preferences.json"), "broken");
  const fallback = await service.get();
  assert.equal(fallback.preferences.fontSize, 13);
  assert.equal(fallback.warnings.length, 1);
});
