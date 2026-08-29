const fs = require("node:fs");
const path = require("node:path");

if (process.platform === "darwin") {
  const prebuilds = path.resolve(
    __dirname,
    "../node_modules/node-pty/prebuilds",
  );
  for (const architecture of ["arm64", "x64"]) {
    const helper = path.join(
      prebuilds,
      `darwin-${architecture}`,
      "spawn-helper",
    );
    const stat = fs.lstatSync(helper);
    if (!stat.isFile() || stat.isSymbolicLink())
      throw new Error(`Invalid node-pty spawn helper: ${helper}`);
    fs.chmodSync(helper, 0o755);
  }
  console.log("Prepared executable macOS node-pty spawn helpers.");
}
