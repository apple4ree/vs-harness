import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
  windowsHide: true,
});
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "fixture/pids")
    process.stdout.write(
      JSON.stringify({
        id: message.id,
        result: { parent: process.pid, child: child.pid },
      }) + "\n",
    );
});
