import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  normalizeOpenRouterApiKey,
  persistOpenRouterApiKey,
} from "./credentialStore";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-medley-credentials-"));
const envPath = path.join(dir, ".env.local");
try {
  assert.throws(() => normalizeOpenRouterApiKey(""), /required|invalid/);
  assert.throws(() => normalizeOpenRouterApiKey("not-a-key"), /invalid/);
  assert.throws(
    () => normalizeOpenRouterApiKey(`sk-or-${"a".repeat(20)}\nINJECTED=true`),
    /invalid/,
  );

  fs.writeFileSync(envPath, "PORT=3000\nOPENROUTER_API_KEY=old-key\n");
  const key = `sk-or-v1-${"a".repeat(32)}`;
  assert.equal(persistOpenRouterApiKey(envPath, ` ${key} `), key);
  const saved = fs.readFileSync(envPath, "utf8");
  assert.match(saved, /^PORT=3000$/m);
  assert.match(saved, new RegExp(`^OPENROUTER_API_KEY="${key}"$`, "m"));
  assert.equal((saved.match(/OPENROUTER_API_KEY=/g) ?? []).length, 1);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("credentialStore tests passed");
