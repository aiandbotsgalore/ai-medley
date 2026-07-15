import assert from "node:assert/strict";
import {
  assertProviderRequestWithinBudget,
  buildGeminiRequest,
  buildOpenRouterRequest,
  classifyProviderFailure,
  getManualProviderFailureDecision,
  extractOpenRouterRoutingAudit,
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

const forcedOpenRouter = buildOpenRouterRequest({
  model: "test/model",
  temperature: 0.1,
  messages: [],
  tools: [],
  requiredToolName: "set_design_plan",
});
assert.deepEqual(forcedOpenRouter.requestBody.tool_choice, {
  type: "function",
  function: { name: "set_design_plan" },
});
assert.equal(forcedOpenRouter.requestBody.parallel_tool_calls, false);

const structuredOpenRouter = buildOpenRouterRequest({
  model: "test/model",
  temperature: 0.1,
  messages: [],
  tools: [],
  requiredToolName: "set_design_plan",
  structuredOutput: {
    name: "set_design_plan",
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { status: { type: "string" } },
      required: ["status"],
    },
  },
});
assert.deepEqual(structuredOpenRouter.requestBody.response_format, {
  type: "json_schema",
  json_schema: {
    name: "set_design_plan",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { status: { type: "string" } },
      required: ["status"],
    },
  },
});
assert.deepEqual(structuredOpenRouter.requestBody.provider, {
  require_parameters: true,
});
assert.equal("tools" in structuredOpenRouter.requestBody, false);
assert.equal("tool_choice" in structuredOpenRouter.requestBody, false);

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

const routingAudit = extractOpenRouterRoutingAudit({
  openrouter_metadata: {
    requested: "test/model",
    strategy: "fallback",
    summary: "available=2, selected=Provider B",
    attempt: 2,
    endpoints: {
      available: [
        { provider: "Provider A", model: "test/model", selected: false },
        { provider: "Provider B", model: "test/model", selected: true },
      ],
    },
    attempts: [
      { provider: "Provider A", model: "test/model", status: 529 },
      { provider: "Provider B", model: "test/model", status: 200 },
    ],
    pipeline: [{ type: "response_healing", name: "response-healing", data: { ignored: true } }],
  },
});
assert.deepEqual(routingAudit, {
  requestedModel: "test/model",
  strategy: "fallback",
  summary: "available=2, selected=Provider B",
  attempt: 2,
  endpoints: [
    { provider: "Provider A", model: "test/model", selected: false },
    { provider: "Provider B", model: "test/model", selected: true },
  ],
  fallbackAttempts: [
    { provider: "Provider A", model: "test/model", status: 529 },
    { provider: "Provider B", model: "test/model", status: 200 },
  ],
  pipelineStages: [{ type: "response_healing", name: "response-healing" }],
});

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

const openRouterFailure = classifyProviderFailure({
  status: 429,
  body: {
    error: {
      message: "retry later",
      metadata: { error_type: "rate_limit_exceeded", provider_code: "upstream_429" },
    },
    openrouter_metadata: { strategy: "fallback", attempt: 2 },
  },
});
assert.equal(openRouterFailure.providerErrorType, "rate_limit_exceeded");
assert.equal(openRouterFailure.providerCode, "upstream_429");
assert.equal(openRouterFailure.routing?.attempt, 2);

const nestedProviderFailure = classifyProviderFailure({
  status: 400,
  body: {
    error: {
      message: "Provider returned error",
      metadata: {
        raw: JSON.stringify({
          error: { message: "Tool calling is unavailable for this route" },
        }),
      },
    },
  },
});
assert.match(
  nestedProviderFailure.message,
  /Tool calling is unavailable for this route/,
);

console.log("providerRequest tests passed");
