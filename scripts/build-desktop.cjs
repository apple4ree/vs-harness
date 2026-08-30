const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const cli = path.join(
  projectRoot,
  "node_modules",
  "electron-vite",
  "bin",
  "electron-vite.js",
);

if (!existsSync(cli)) {
  console.error("electron-vite is not installed. Run npm ci before building.");
  process.exit(1);
}

// Keep the documented build command stable across shells and operating
// systems. Command-line Node flags override a smaller ambient NODE_OPTIONS.
const result = spawnSync(
  process.execPath,
  ["--max-old-space-size=4096", cli, "build", ...process.argv.slice(2)],
  {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
