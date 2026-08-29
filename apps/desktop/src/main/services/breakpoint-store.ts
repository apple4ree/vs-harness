import { promises as fs } from "node:fs";
import path from "node:path";
import { contentHash, normalizedRelative } from "./workspace-files";
import type { Breakpoint } from "../../shared/execution";

export class BreakpointStore {
  constructor(private directory: string) {}
  private target(root: string) {
    const absolute = path.resolve(root);
    return path.join(
      this.directory,
      contentHash(
        process.platform === "win32" ? absolute.toLowerCase() : absolute,
      ) + ".json",
    );
  }
  private validate(value: unknown): Breakpoint[] {
    if (!Array.isArray(value) || value.length > 10000)
      throw new Error("Invalid saved breakpoints");
    const seen = new Set<string>();
    return value.map((item) => {
      const file = normalizedRelative(item?.path);
      if (
        !/\.[cm]?js$/i.test(file) ||
        !Number.isSafeInteger(item.line) ||
        item.line < 1 ||
        item.line > 1000000
      )
        throw new Error("Invalid saved breakpoint location");
      const key = `${file}:${item.line}`;
      if (seen.has(key)) throw new Error("Duplicate saved breakpoint");
      seen.add(key);
      return { path: file, line: item.line, verified: false };
    });
  }
  async load(root: string): Promise<Breakpoint[]> {
    const target = this.target(root);
    try {
      if ((await fs.stat(target)).size > 2_000_000)
        throw new Error("Breakpoint file exceeds 2 MB");
      const value = JSON.parse(await fs.readFile(target, "utf8"));
      if (value.version !== 1)
        throw new Error("Unsupported breakpoint version");
      return this.validate(value.breakpoints);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error(
        `Saved breakpoints could not be loaded; the original file is retained at ${target}. ${error}`,
      );
    }
  }
  // NodeDebugService serializes mutations, including persistence, before calling this method.
  async save(root: string, breakpoints: Breakpoint[]) {
    const value = { version: 1, breakpoints: this.validate(breakpoints) };
    await fs.mkdir(this.directory, { recursive: true });
    const target = this.target(root),
      temporary = target + ".tmp";
    await fs.writeFile(temporary, JSON.stringify(value), "utf8");
    await fs.rename(temporary, target);
  }
}
