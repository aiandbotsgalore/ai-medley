import fs from "node:fs";
import path from "node:path";

export function resolveServerStartupConfig(input: {
  cwd: string;
  port?: string;
  dataRoot?: string;
  ffmpegPath?: string | null;
}) {
  const port = input.port === undefined ? 3000 : Number(input.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error(`Invalid PORT: ${input.port}`);
  const dataRoot = path.resolve(input.dataRoot || input.cwd);
  if (!input.ffmpegPath || !fs.existsSync(input.ffmpegPath))
    throw new Error("Bundled FFmpeg binary is unavailable");
  return {
    port,
    host: "127.0.0.1" as const,
    dataRoot,
    libraryDir: path.join(dataRoot, "library"),
    workDir: path.join(dataRoot, "workdir"),
  };
}
