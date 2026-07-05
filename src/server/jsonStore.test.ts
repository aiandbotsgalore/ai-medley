import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  JsonStoreReadError,
  ensureJsonArrayFile,
  readJsonArrayFile,
  writeJsonArrayFileAtomic,
} from "./jsonStore";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-json-store-"));
const storePath = path.join(root, "store.json");

try {
  ensureJsonArrayFile(storePath);
  assert.deepEqual(readJsonArrayFile(storePath), []);

  writeJsonArrayFileAtomic(storePath, [{ id: "first", extra: { kept: true } }]);
  writeJsonArrayFileAtomic(storePath, [{ id: "second" }]);
  assert.deepEqual(readJsonArrayFile(storePath), [{ id: "second" }]);
  assert.deepEqual(readJsonArrayFile(`${storePath}.bak`), [
    { id: "first", extra: { kept: true } },
  ]);

  fs.writeFileSync(storePath, "{truncated", "utf8");
  const corruptBytes = fs.readFileSync(storePath);
  assert.throws(
    () => readJsonArrayFile(storePath),
    (error: unknown) =>
      error instanceof JsonStoreReadError && /parse/.test(error.message),
  );
  assert.throws(
    () => writeJsonArrayFileAtomic(storePath, []),
    JsonStoreReadError,
    "A mutation must not overwrite a corrupt store with an empty projection",
  );
  assert.deepEqual(fs.readFileSync(storePath), corruptBytes);
  assert.deepEqual(readJsonArrayFile(`${storePath}.bak`), [
    { id: "first", extra: { kept: true } },
  ]);

  const leftovers = fs
    .readdirSync(root)
    .filter((name) => name.includes(".tmp-"));
  assert.deepEqual(leftovers, [], "Atomic writes must not leave temp files");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("jsonStore tests passed");
