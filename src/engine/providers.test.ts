import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../components/ConfigPanel";
import { ProviderRequestError } from "./providerRequest";
import { createProviderSession } from "./providers";
import { SERVER_MANAGED_API_KEY } from "../constants/provider";

const globalAny = globalThis as any;
globalAny.window = {
  location: { origin: "http://127.0.0.1:3000" },
  setTimeout,
  clearTimeout,
};

const config = {
  ...DEFAULT_CONFIG,
  modelMode: "manual" as const,
  provider: "openrouter" as const,
  model: "test/model",
  openrouterApiKey: "test-key",
};

const response = (status: number, body: unknown, headers?: Record<string, string>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const bodies: string[] = [];
let attempts = 0;
globalAny.fetch = async (_url: string, init: RequestInit) => {
  bodies.push(String(init.body));
  attempts++;
  if (attempts === 1)
    return response(429, { error: { message: "slow down" } }, { "Retry-After": "0" });
  return response(200, {
    choices: [{ message: { role: "assistant", content: "ok" } }],
    usage: { prompt_tokens: 12 },
  });
};

const session = createProviderSession(config, "system", [], 0.1);
const result = await session.send("hello");
assert.equal(result.text, "ok");
assert.equal(attempts, 2);
assert.equal(bodies[0], bodies[1], "transport retry must reuse the exact body");
assert.deepEqual(
  session.getHistory().map((message: any) => message.role),
  ["user", "assistant"],
);

globalAny.fetch = async () =>
  response(401, { error: { message: "bad key", apiKey: "secret-value" } });
const audits: any[] = [];
const failed = createProviderSession(config, "system", [], 0.1, [], {
  stage: "manual",
  role: "manual",
  onRequestAudit: (audit) => audits.push(audit),
});
await assert.rejects(
  failed.send("must not commit"),
  (error: unknown) =>
    error instanceof ProviderRequestError &&
    error.category === "authentication" &&
    !error.message.includes("secret-value"),
);
assert.deepEqual(failed.getHistory(), []);
assert.equal(audits.at(-1)?.status, "failed");
assert.equal(audits.at(-1)?.errorCategory, "authentication");

for (const [status, category] of [
  [402, "quota"],
  [403, "authentication"],
  [404, "model_unavailable"],
  [408, "timeout"],
  [500, "server"],
] as const) {
  globalAny.fetch = async () => response(status, { error: { message: "safe" } });
  const statusSession = createProviderSession(config, "system", [], 0.1);
  await assert.rejects(
    statusSession.send("one attempt"),
    (error: unknown) =>
      error instanceof ProviderRequestError && error.category === category,
  );
  assert.deepEqual(statusSession.getHistory(), []);
}

globalAny.fetch = async () =>
  new Response("not-json", {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const malformed = createProviderSession(config, "system", [], 0.1);
await assert.rejects(
  malformed.send("bad response"),
  (error: unknown) =>
    error instanceof ProviderRequestError &&
    error.category === "malformed_response",
);
assert.deepEqual(malformed.getHistory(), []);

let oversizedNetworkCalled = false;
globalAny.fetch = async () => {
  oversizedNetworkCalled = true;
  return response(200, {});
};
const oversized = createProviderSession(
  config,
  "x".repeat(110 * 1024),
  [],
  0.1,
);
await assert.rejects(
  oversized.send("never sent"),
  (error: unknown) =>
    error instanceof ProviderRequestError && error.category === "payload",
);
assert.equal(oversizedNetworkCalled, false);

const fallbackBodies: any[] = [];
let fallbackCall = 0;
globalAny.fetch = async (_url: string, init: RequestInit) => {
  fallbackBodies.push(JSON.parse(String(init.body)));
  fallbackCall++;
  if (fallbackCall === 1) {
    return response(200, {
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "tool-1",
            type: "function",
            function: { name: "test_tool", arguments: "{}" },
          }],
        },
      }],
    });
  }
  if (fallbackCall === 2)
    return response(402, { error: { message: "quota" } });
  return response(200, {
    choices: [{ message: { role: "assistant", content: "continued" } }],
  });
};
const originalModel = createProviderSession(config, "system", [], 0.1);
await originalModel.send("start");
const toolResult = [{ name: "test_tool", id: "tool-1", response: { ok: true } }];
await assert.rejects(originalModel.send(toolResult), ProviderRequestError);
assert.equal(
  originalModel.getHistory().filter((message: any) => message.role === "tool").length,
  0,
);

let proxyRequest: { url: string; init: RequestInit } | null = null;
globalAny.fetch = async (url: string, init: RequestInit) => {
  proxyRequest = { url, init };
  return response(200, {
    choices: [{ message: { role: "assistant", content: "proxied" } }],
  });
};
const proxiedOpenRouter = createProviderSession(
  { ...config, openrouterApiKey: SERVER_MANAGED_API_KEY },
  "system",
  [],
  0.1,
);
await proxiedOpenRouter.send("hello proxy");
assert.equal(proxyRequest!.url, "/api/provider/openrouter");
assert.equal(new Headers(proxyRequest!.init.headers).has("Authorization"), false);

globalAny.fetch = async (url: string, init: RequestInit) => {
  proxyRequest = { url, init };
  return response(200, { text: "gemini proxied", functionCalls: [] });
};
const automaticTool = {
  type: "function" as const,
  function: {
    name: "set_design_plan",
    description: "Submit one constrained arrangement.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["transitionCandidateId"],
      properties: { transitionCandidateId: { type: "string" } },
    },
  },
};
const nativeGeminiTool = {
  name: "read_file",
  description: "Read an authorized file.",
  parameters: {
    type: "OBJECT",
    required: ["filePath"],
    properties: { filePath: { type: "STRING" } },
  },
};
const proxiedGemini = createProviderSession(
  {
    ...config,
    provider: "gemini",
    model: "gemini-test",
    geminiApiKey: SERVER_MANAGED_API_KEY,
  },
  "system",
  [automaticTool, nativeGeminiTool],
  0.1,
);
assert.equal((await proxiedGemini.send("hello proxy")).text, "gemini proxied");
assert.equal(proxyRequest!.url, "/api/provider/gemini");
const geminiProxyBody = JSON.parse(String(proxyRequest!.init.body));
assert.deepEqual(geminiProxyBody.config.tools[0].functionDeclarations, [
  {
    name: "set_design_plan",
    description: "Submit one constrained arrangement.",
    parameters: {
      type: "OBJECT",
      required: ["transitionCandidateId"],
      properties: { transitionCandidateId: { type: "STRING" } },
    },
  },
  nativeGeminiTool,
]);

globalAny.fetch = async () =>
  response(400, { error: "Invalid tool schema: api_key=secret-value" });
const rejectedGemini = createProviderSession(
  {
    ...config,
    provider: "gemini",
    model: "gemini-test",
    geminiApiKey: SERVER_MANAGED_API_KEY,
  },
  "system",
  [],
  0.1,
);
await assert.rejects(
  rejectedGemini.send("explain failure"),
  (error: unknown) =>
    error instanceof ProviderRequestError &&
    error.message.includes("Invalid tool schema") &&
    !error.message.includes("secret-value"),
);
globalAny.fetch = async (_url: string, init: RequestInit) => {
  fallbackBodies.push(JSON.parse(String(init.body)));
  return response(200, {
    choices: [{ message: { role: "assistant", content: "continued" } }],
  });
};
const fallbackModel = createProviderSession(
  { ...config, model: "test/fallback" },
  "system",
  [],
  0.1,
  originalModel.getHistory(),
);
await fallbackModel.send(toolResult);
assert.equal(
  fallbackBodies.at(-1).messages.filter((message: any) => message.role === "tool").length,
  1,
  "fallback request must contain one copy of the failed tool result",
);

console.log("providers tests passed");
