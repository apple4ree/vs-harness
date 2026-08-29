// Reproducible local benchmark. Creates and removes only its own synthetic fixture.
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import {
  analyzeRepository,
  type ArchitectureCache,
} from "../apps/desktop/src/main/services/architecture";
import { buildView } from "../apps/desktop/src/renderer/src/components/architecture-view";

async function main() {
  const count = Number(process.argv[2] || 1000);
  if (!Number.isInteger(count) || count < 20 || count > 5000)
    throw new Error("Choose 20–5000 fixture files");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-benchmark-"));
  try {
    const width = 20;
    for (let index = 0; index < count; index++) {
      const module = `src/module-${Math.floor(index / width)}`;
      await fs.mkdir(path.join(root, module), { recursive: true });
      const previous = index
        ? `import { value as previous } from "../module-${Math.floor((index - 1) / width)}/file-${index - 1}";\n`
        : "";
      await fs.writeFile(
        path.join(root, module, `file-${index}.ts`),
        `${previous}export const value = ${index ? "previous + 1" : "1"};\nexport function Component${index}() { return value; }\n`,
      );
    }
    const cache: ArchitectureCache = new Map();
    const coldStart = performance.now();
    const cold = await analyzeRepository(root, { cache });
    const coldMs = performance.now() - coldStart;
    const warmStart = performance.now();
    const warm = await analyzeRepository(root, { cache });
    const warmMs = performance.now() - warmStart;
    const layoutStart = performance.now();
    const view = buildView(warm, "modules", null, false, "", new Set());
    const layoutMs = performance.now() - layoutStart;
    assert.equal(cold.scannedFiles, count);
    assert.equal(cold.edges.length, count - 1);
    assert.equal(warm.revision, cold.revision);
    assert.equal(warm.truncated, false);
    assert.deepEqual(warm.warnings, []);
    await fs.appendFile(
      path.join(root, "src/module-0/file-0.ts"),
      "export const changed = true;\n",
    );
    const updateStart = performance.now();
    const updated = await analyzeRepository(root, { cache });
    const updatedMs = performance.now() - updateStart;
    assert.notEqual(updated.revision, cold.revision);
    console.log(
      JSON.stringify(
        {
          files: count,
          relations: cold.edges.length,
          modules: view.total,
          visibleCards: view.nodes.length,
          coldMs: Math.round(coldMs),
          cachedMs: Math.round(warmMs),
          oneFileChangeMs: Math.round(updatedMs),
          layoutMs: Math.round(layoutMs),
          peakResidentMB: Math.round(process.resourceUsage().maxRSS / 1024),
          truncated: warm.truncated,
        },
        null,
        2,
      ),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
