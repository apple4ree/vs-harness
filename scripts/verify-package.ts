import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { listPackage, extractFile, statFile } from "@electron/asar";
import { machoArchitectures } from "./macho-architectures";

async function main() {
  const directory = path.resolve(process.argv[2] || "release/win-unpacked");
  const mac = directory.endsWith(".app");
  const resources = path.join(
    directory,
    mac ? "Contents/Resources" : "resources",
  );
  const archive = path.join(resources, "app.asar");
  const files = new Set(
    listPackage(archive, { isPack: false }).map((file) =>
      file.replaceAll("\\", "/").replace(/^\//, ""),
    ),
  );
  const project = JSON.parse(await fs.readFile("package.json", "utf8"));
  const bundled = JSON.parse(
    extractFile(archive, "package.json").toString("utf8"),
  );
  assert.equal(
    bundled.version,
    project.version,
    "The package must match the current project version",
  );
  assert.equal(bundled.main, "out/main/index.js");
  for (const required of [
    "out/main/index.js",
    "out/preload/index.js",
    "out/renderer/index.html",
  ])
    assert(files.has(required), `Missing ${required}`);
  // A version number alone cannot detect an outdated build of the same preview.
  const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex");
  const compiled = (
    await fs.readdir("out", { recursive: true, withFileTypes: true })
  )
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(process.cwd(), path.join(entry.parentPath, entry.name))
        .replaceAll("\\", "/"),
    );
  for (const file of compiled) {
    assert(
      files.has(file),
      `Package is missing the current build output: ${file}`,
    );
    assert.equal(
      hash(extractFile(archive, path.normalize(file))),
      hash(await fs.readFile(file)),
      `Packaged file differs from the current build: ${file}`,
    );
  }
  assert.equal(
    hash(await fs.readFile(path.join(resources, "icon.png"))),
    hash(await fs.readFile("build/icon.png")),
    "Packaged app icon differs from the current brand asset",
  );
  if (mac) {
    const icon = await fs.readFile(path.join(resources, "icon.icns"));
    assert.equal(icon.subarray(0, 4).toString("ascii"), "icns");
    assert.equal(icon.readUInt32BE(4), icon.length);
    assert.deepEqual(
      await machoArchitectures(path.join(directory, "Contents/MacOS/Witch")),
      ["arm64", "x64"],
      "The macOS app executable must contain both universal architectures",
    );
  }
  const html = extractFile(
    archive,
    path.join("out", "renderer", "index.html"),
  ).toString("utf8");
  assert(
    !/<(?:script|link|iframe)\b[^>]+(?:src|href)=["']https?:\/\//i.test(html),
    "Packaged renderer must not load a remote app",
  );
  for (const worker of ["editor", "json", "css", "html", "ts"])
    assert(
      [...files].some(
        (file) => file.includes(`${worker}.worker-`) && file.endsWith(".js"),
      ),
      `Missing bundled ${worker} worker`,
    );
  for (const required of [
    "node_modules/typescript/lib/tsserver.js",
    "node_modules/typescript-language-server/lib/cli.mjs",
  ]) {
    assert(
      "unpacked" in statFile(archive, path.normalize(required)),
      `Language server must be unpacked: ${required}`,
    );
    assert(
      (await fs.stat(path.join(archive + ".unpacked", required))).isFile(),
    );
  }
  const platforms = mac ? ["darwin-arm64", "darwin-x64"] : ["win32-x64"];
  for (const platform of platforms) {
    const native = platform.startsWith("darwin") ? "pty.node" : "conpty.node";
    const prebuilt = path.join(
      archive + ".unpacked",
      "node_modules/node-pty/prebuilds",
      platform,
    );
    assert(
      (await fs.stat(path.join(prebuilt, native))).size > 0,
      `Missing native terminal: ${platform}`,
    );
    if (mac) {
      for (const file of [native, "spawn-helper"])
        assert(
          (await machoArchitectures(path.join(prebuilt, file))).includes(
            platform.slice(7),
          ),
          `Terminal binary architecture does not match ${platform}: ${file}`,
        );
      const helper = await fs.stat(path.join(prebuilt, "spawn-helper"));
      assert(helper.isFile(), `Missing terminal spawn helper: ${platform}`);
      if (process.platform === "darwin")
        assert(
          helper.mode & 0o111,
          `Terminal helper is not executable: ${platform}`,
        );
    }
  }
  const forbidden = [...files].filter(
    (file) =>
      !file.startsWith("node_modules/") &&
      /(^|\/)(\.env(?:\..*)?|auth\.json|history\.json|preferences\.json|credentials\.json)$/.test(
        file,
      ),
  );
  assert.deepEqual(
    forbidden,
    [],
    "Runtime profiles and credentials must not be included in the app",
  );
  assert(
    (
      await fs.stat(
        path.join(directory, mac ? "Contents/MacOS/Witch" : "Witch.exe"),
      )
    ).isFile(),
  );
  console.log(
    `Verified Witch ${bundled.version}: exact build contents, branded icon, local workers, language server, terminal prebuilds, and profile exclusion.\n${directory}`,
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
