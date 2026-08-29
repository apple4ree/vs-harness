import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_PREFERENCES,
  validatePreferences,
  validateExtension,
  type Preferences,
  type SettingsSnapshot,
  type InstalledExtension,
} from "../../shared/settings";

export class SettingsService {
  private writes: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}
  async flush() {
    await this.writes;
  }
  private async write(target: string, value: unknown) {
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = target + ".tmp";
        await fs.writeFile(
          temporary,
          JSON.stringify(value, null, 2) + "\n",
          "utf8",
        );
        await fs.rename(temporary, target);
      });
    await this.writes;
  }
  async get(): Promise<SettingsSnapshot> {
    await this.writes.catch(() => undefined);
    const warnings: string[] = [];
    let preferences = structuredClone(DEFAULT_PREFERENCES);
    try {
      preferences = validatePreferences(
        JSON.parse(
          await fs.readFile(
            path.join(this.directory, "preferences.json"),
            "utf8",
          ),
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        warnings.push(
          `Preferences could not be loaded; defaults are in use. ${error}`,
        );
    }
    const extensionDirectory = path.join(this.directory, "extensions");
    const files = await fs
      .readdir(extensionDirectory, { withFileTypes: true })
      .catch(() => []);
    const extensions: InstalledExtension[] = [];
    for (const file of files.slice(0, 100)) {
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      try {
        const bytes = await fs.readFile(
          path.join(extensionDirectory, file.name),
        );
        if (bytes.length > 1_500_000)
          throw new Error("Manifest exceeds 1.5 MB");
        const raw = JSON.parse(bytes.toString("utf8"));
        extensions.push({
          ...validateExtension(raw),
          enabled: raw.enabled !== false,
        });
      } catch (error) {
        warnings.push(`${file.name}: ${error}`);
      }
    }
    return { preferences, extensions, warnings };
  }
  async save(value: Preferences) {
    await this.write(
      path.join(this.directory, "preferences.json"),
      validatePreferences(value),
    );
    return this.get();
  }
  async install(value: unknown) {
    const manifest = validateExtension(value);
    await this.write(
      path.join(this.directory, "extensions", manifest.id + ".json"),
      { ...manifest, enabled: true },
    );
    return this.get();
  }
  async toggle(id: string, enabled: boolean) {
    const current = (await this.get()).extensions.find(
      (extension) => extension.id === id,
    );
    if (!current || typeof enabled !== "boolean")
      throw new Error("Unknown extension");
    await this.write(
      path.join(this.directory, "extensions", current.id + ".json"),
      { ...current, enabled },
    );
    return this.get();
  }
  async extensionPath(id: string) {
    const current = (await this.get()).extensions.find(
      (extension) => extension.id === id,
    );
    if (!current) throw new Error("Unknown extension");
    return path.join(this.directory, "extensions", current.id + ".json");
  }
}
