import assert from "node:assert/strict";
import {
  OPENROUTER_PREFLIGHT_MAX_TOKENS,
  OPENROUTER_PREFLIGHT_MODEL,
  OpenRouterPreflightError,
  runOpenRouterPreflight,
} from "./openRouterPreflight";

const response = (status: number) => new Response("{}", { status });

let request: RequestInit | undefined;
const available = await runOpenRouterPreflight({
  apiKey: "test-key",
  referer: "http://127.0.0.1:3000",
  fetchImpl: async (_url, init) => {
    request = init;
    return response(200);
  },
});
assert.equal(available.model, OPENROUTER_PREFLIGHT_MODEL);
const body = JSON.parse(String(request?.body));
assert.equal(body.model, OPENROUTER_PREFLIGHT_MODEL);
assert.equal(body.max_tokens, OPENROUTER_PREFLIGHT_MAX_TOKENS);
assert.deepEqual(body.messages, [{ role: "user", content: "Reply with OK." }]);
assert.equal(new Headers(request?.headers).get("Authorization"), "Bearer test-key");

for (const [status, code] of [
  [401, "authentication"],
  [402, "quota"],
  [429, "rate_limit"],
] as const) {
  await assert.rejects(
    runOpenRouterPreflight({
      apiKey: "test-key",
      referer: "http://127.0.0.1:3000",
      fetchImpl: async () => response(status),
    }),
    (error: unknown) =>
      error instanceof OpenRouterPreflightError && error.code === code,
  );
}

await assert.rejects(
  runOpenRouterPreflight({ apiKey: "", referer: "http://127.0.0.1:3000" }),
  (error: unknown) =>
    error instanceof OpenRouterPreflightError && error.code === "credential_missing",
);

console.log("openRouterPreflight tests passed");
