import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-production-smoke-"));
const port = 31000 + Math.floor(Math.random() * 10000);
const child = spawn(process.execPath, ["dist/server.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    AI_MEDLEY_DATA_ROOT: root,
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

try {
  let healthy = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Production server exited early (${child.exitCode}): ${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { Host: `127.0.0.1:${port}` },
      });
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!healthy) throw new Error(`Production health check timed out: ${output}`);
  console.log(`production smoke passed on owned port ${port}`);
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
  fs.rmSync(root, { recursive: true, force: true });
}
