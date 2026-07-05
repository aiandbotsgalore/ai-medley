import assert from "node:assert/strict";
import { redactSensitive } from "./redaction";

const canary = "sk-or-v1-super-secret-canary";
const redacted = redactSensitive({
  authorization: `Bearer ${canary}`,
  nested: [{ url: `https://example.test?a=1&token=${canary}`, note: canary }],
  safe: "keep me",
});
const serialized = JSON.stringify(redacted);
assert.doesNotMatch(serialized, /super-secret-canary/);
assert.equal(redacted.safe, "keep me");
assert.equal(redacted.authorization, "[REDACTED]");

console.log("redaction tests passed");
