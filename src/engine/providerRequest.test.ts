import assert from "node:assert/strict";
import {
  assertProviderRequestWithinBudget,
  buildGeminiRequest,
  buildOpenRouterRequest,
  classifyProviderFailure,
  getManualProviderFailureDecision,
  parseRetryAfterMs,
} from "./providerRequest";

const unicode = "🎵".repeat(100);
const openRouter = buildOpenRouterRequest({
  model: "test/model",
  temperature: 0.1,
  messages: [{ category: "stageData", message: { role: "user", content: unicode } }],
  tools: [],
});
assert.equal(openRouter.utf8Bytes, new TextEncoder().encode(openRouter.serializedBody).byteLength);
assert.doesNotThrow(() => assertProviderRequestWithinBudget(openRouter));

const gemini = buildGeminiRequest({
  model: "gemini-test",
  temperature: 0.1,
  systemInstruction: "system",
  messages: [{ category: "stageData", message: { role: "user", parts: [{ text: "hello" }] } }],
  tools: [],
});
assert.equal(gemini.withinHardLimits, true);
assert.doesNotThrow(() => assertProviderRequestWithinBudget(gemini));

const oversizedGemini = buildGeminiRequest({
  model: "gemini-test",
  temperature: 0.1,
  systemInstruction: "x".repeat(110 * 1024),
  messages: [],
  tools: [],
});
assert.throws(
  () => assertProviderRequestWithinBudget(oversizedGemini),
  /systemPrompt|request exceeds/i,
);

for (const trackCount of [2, 4, 10, 25, 100]) {
  const stageData = JSON.stringify({
    tracks: Array.from({ length: trackCount }, (_, index) => ({
      trackId: `track-${index}`,
      summary: "s".repeat(800),
    })),
  });
  const messages = [
    { category: "stageData" as const, message: { role: "user", content: stageData } },
  ];
  const measuredOpenRouter = buildOpenRouterRequest({
    model: "test/model",
    temperature: 0.1,
    messages,
    tools: [],
  });
  const measuredGemini = buildGeminiRequest({
    model: "gemini-test",
    temperature: 0.1,
    systemInstruction: "system",
    messages: [
      {
        category: "stageData",
        message: { role: "user", parts: [{ text: stageData }] },
      },
    ],
    tools: [],
  });
  assert.equal(
    measuredOpenRouter.withinHardLimits,
    trackCount <= 25,
    `OpenRouter ${trackCount}-track bound`,
  );
  assert.equal(
    measuredGemini.withinHardLimits,
    trackCount <= 25,
    `Gemini ${trackCount}-track bound`,
  );
}

assert.equal(parseRetryAfterMs("2", 0), 2_000);
assert.equal(parseRetryAfterMs("invalid", 0), null);

const cases = [
  [401, "authentication", "reconfigure"],
  [402, "quota", "switch_model"],
  [403, "authentication", "reconfigure"],
  [404, "model_unavailable", "switch_model"],
  [408, "timeout", "switch_model"],
  [429, "rate_limit", "switch_model"],
  [500, "server", "switch_model"],
] as const;
for (const [status, category, action] of cases) {
  const error = classifyProviderFailure({
    status,
    body: JSON.stringify({ error: { message: `status ${status}`, apiKey: "secret" } }),
    retryAfter: status === 429 ? "1" : null,
  });
  assert.equal(error.category, category);
  assert.equal(getManualProviderFailureDecision(error).action, action);
  assert.doesNotMatch(error.message, /secret/);
}

console.log("providerRequest tests passed");
