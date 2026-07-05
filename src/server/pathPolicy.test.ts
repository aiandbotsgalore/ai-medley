import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertContainedDiagnosticCommand,
  resolveContainedExistingFile,
  resolveSessionFileForRead,
  resolveSessionFileForWrite,
} from "./pathPolicy";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-path-policy-"));
try {
  const work = path.join(root, "workdir");
  const session = path.join(work, "safe-session");
  const outside = path.join(root, "outside.txt");
  fs.mkdirSync(session, { recursive: true });
  fs.writeFileSync(path.join(session, "inside.txt"), "inside");
  fs.writeFileSync(outside, "outside");

  assert.equal(
    resolveSessionFileForRead({ workRoot: work, sessionId: "safe-session", filePath: "inside.txt" }),
    fs.realpathSync(path.join(session, "inside.txt")),
  );
  assert.throws(
    () => resolveSessionFileForRead({ workRoot: work, sessionId: "../escape", filePath: outside }),
    /session/i,
  );
  assert.throws(
    () => resolveSessionFileForRead({ workRoot: work, sessionId: "safe-session", filePath: "../outside.txt" }),
    /outside|unavailable/i,
  );
  assert.match(
    resolveSessionFileForWrite({ workRoot: work, sessionId: "safe-session", filePath: "nested/new.txt" }),
    /nested[\\/]new\.txt$/,
  );

  const link = path.join(session, "outside-link.txt");
  try {
    fs.symlinkSync(outside, link, "file");
    assert.equal(resolveContainedExistingFile(link, [session]), null);
  } catch (error: any) {
    if (error?.code !== "EPERM") throw error;
  }

  assert.doesNotThrow(() => assertContainedDiagnosticCommand("dir"));
  assert.doesNotThrow(() => assertContainedDiagnosticCommand("Get-Location"));
  assert.throws(() => assertContainedDiagnosticCommand("dir & type ..\\.env"), /expert/i);
  assert.throws(() => assertContainedDiagnosticCommand("ffmpeg -i a.mp3 b.mp3"), /contained/i);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("pathPolicy tests passed");
