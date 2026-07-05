import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildArtifactInventory,
  summarizeArtifactInventory,
} from "./artifactInventory";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-inventory-"));
try {
  const work = path.join(root, "workdir");
  const session = path.join(work, "active-session");
  fs.mkdirSync(session, { recursive: true });
  const finalPath = path.join(session, "medley_final.mp3");
  const unknownPath = path.join(work, "unknown.part");
  fs.writeFileSync(finalPath, "final");
  fs.writeFileSync(unknownPath, "unknown");
  const items = buildArtifactInventory({
    roots: [work],
    references: [{ filePath: finalPath, reason: "completed-output" }],
    activeSessionIds: ["active-session"],
  });
  assert.equal(items.every((item) => item.action === "preserve"), true);
  assert.equal(
    items.find((item) => item.relativePath.endsWith("medley_final.mp3"))?.category,
    "completed-output",
  );
  assert.equal(items.find((item) => item.relativePath.endsWith("unknown.part"))?.category, "unknown");
  assert.equal(summarizeArtifactInventory(items).deletionCandidates, 0);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("artifactInventory tests passed");
