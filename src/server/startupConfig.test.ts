import assert from "node:assert/strict";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { resolveServerStartupConfig } from "./startupConfig";

const config = resolveServerStartupConfig({
  cwd: process.cwd(),
  port: "3210",
  dataRoot: path.join(process.cwd(), "isolated-data"),
  ffmpegPath,
});
assert.equal(config.port, 3210);
assert.equal(config.host, "127.0.0.1");
assert.match(config.libraryDir, /isolated-data[\\/]library$/);
assert.throws(
  () =>
    resolveServerStartupConfig({
      cwd: process.cwd(),
      port: "not-a-port",
      ffmpegPath,
    }),
  /Invalid PORT/,
);
assert.throws(
  () => resolveServerStartupConfig({ cwd: process.cwd(), ffmpegPath: null }),
  /FFmpeg/,
);

console.log("startupConfig tests passed");
