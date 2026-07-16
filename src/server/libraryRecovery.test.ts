import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recoverOrphanedLibraryAudio } from "./libraryRecovery";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-library-recovery-"));
try {
  fs.writeFileSync(path.join(root, "recover.mp3"), "source bytes");
  fs.writeFileSync(path.join(root, "ignore.txt"), "not audio");
  let stored: any[] = [];
  const store = {
    read: () => structuredClone(stored),
    write: (entries: any[]) => { stored = structuredClone(entries); },
  };
  const recovered = recoverOrphanedLibraryAudio({ audioDir: root, store });
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].filename, "recover.mp3");
  assert.equal(recovered[0].mimeType, "audio/mpeg");
  assert.equal(fs.readFileSync(path.join(root, "recover.mp3"), "utf8"), "source bytes");
  assert.equal(recoverOrphanedLibraryAudio({ audioDir: root, store }).length, 0);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("libraryRecovery tests passed");
