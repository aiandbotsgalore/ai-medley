import assert from "node:assert/strict";
import { replayIdempotent, stableHash } from "./sessionIdempotency";

assert.equal(stableHash({ b: 2, a: 1 }), stableHash({ a: 1, b: 2 }));
let calls = 0;
const first = await replayIdempotent({ sessionId: "s1", operation: "render", key: "k1", request: { b: 2, a: 1 }, execute: async () => ({ value: ++calls }) });
const second = await replayIdempotent({ sessionId: "s1", operation: "render", key: "k1", request: { a: 1, b: 2 }, execute: async () => ({ value: ++calls }) });
assert.equal(first.replayed, false);
assert.equal(second.replayed, true);
assert.equal(calls, 1);
await assert.rejects(() => replayIdempotent({ sessionId: "s1", operation: "render", key: "k1", request: { a: 2 }, execute: async () => ({}) }), /different request/);
console.log("sessionIdempotency tests passed");
