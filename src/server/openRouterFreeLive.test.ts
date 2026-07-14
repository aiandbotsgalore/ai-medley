import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const workspace = process.cwd();
const dataRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "ai-medley-openrouter-free-live-"),
);
const port = 40_000 + Math.floor(Math.random() * 500);
const baseUrl = `http://127.0.0.1:${port}`;
let serverOutput = "";

type OpenRouterModel = {
  id?: unknown;
  supported_parameters?: unknown;
};

function isFreeToolModel(model: OpenRouterModel): model is {
  id: string;
  supported_parameters: string[];
} {
  return (
    typeof model.id === "string" &&
    model.id.endsWith(":free") &&
    Array.isArray(model.supported_parameters) &&
    model.supported_parameters.includes("tools")
  );
}

async function getLiveFreeToolModel() {
  const requested = process.env.OPENROUTER_LIVE_TEST_MODEL?.trim();
  if (requested) {
    assert.match(
      requested,
      /:free$/,
      "OPENROUTER_LIVE_TEST_MODEL must end in :free so this test cannot spend credits",
    );
  }
  const response = await fetch(
    "https://openrouter.ai/api/v1/models?supported_parameters=tools&output_modalities=text&sort=throughput-high-to-low",
  );
  assert.equal(response.ok, true, `OpenRouter model catalog failed (${response.status})`);
  const payload = await response.json() as { data?: OpenRouterModel[] };
  const models = Array.isArray(payload.data) ? payload.data : [];
  const model = requested
    ? models.find((item) => item.id === requested && isFreeToolModel(item))
    : models.find(isFreeToolModel);
  assert.ok(
    model,
    requested
      ? `Configured live test model is not currently a free tool-calling model: ${requested}`
      : "OpenRouter currently lists no free model with tool-calling support",
  );
  return model.id;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null)
      throw new Error(`Isolated server exited (${server.exitCode}): ${serverOutput}`);
    try {
      if ((await fetch(`${baseUrl}/api/health`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Isolated server did not start: ${serverOutput}`);
}

const server = spawn(
  process.execPath,
  [path.join(workspace, "node_modules", "tsx", "dist", "cli.mjs"), "server.ts"],
  {
    cwd: workspace,
    // The server reads its normal local credential configuration, but every
    // writable application path is isolated. This test never reads library/
    // or workdir/ and sends only the synthetic tool prompt below.
    env: {
      ...process.env,
      AI_MEDLEY_DATA_ROOT: dataRoot,
      NODE_ENV: "test",
      PORT: String(port),
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));

try {
  const model = await getLiveFreeToolModel();
  await waitForServer();
  const response = await fetch(`${baseUrl}/api/provider/openrouter`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "This is an integration test. Call the required function exactly once. Do not write normal text.",
        },
        {
          role: "user",
          content: "Report that the OpenRouter free-model tool contract passed.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "report_openrouter_contract",
            description: "Report the fixed live integration-test result.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                status: { type: "string", enum: ["pass"] },
              },
              required: ["status"],
            },
          },
        },
      ],
      tool_choice: {
        type: "function",
        function: { name: "report_openrouter_contract" },
      },
      parallel_tool_calls: false,
      max_tokens: 128,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  assert.equal(
    response.ok,
    true,
    `Live free OpenRouter request failed (${response.status}): ${String(payload?.error ?? "unknown error").slice(0, 500)}`,
  );
  const toolCall = payload?.choices?.[0]?.message?.tool_calls?.find(
    (item: any) => item?.function?.name === "report_openrouter_contract",
  );
  assert.ok(toolCall, "Live free model did not return the required tool call");
  const args = JSON.parse(String(toolCall.function.arguments ?? "{}"));
  assert.deepEqual(args, { status: "pass" });
  const routing = payload?.openrouter_metadata;
  assert.ok(
    routing && typeof routing === "object",
    "OpenRouter routing metadata was not returned by the server proxy",
  );
  console.log(
    `openRouterFreeLive passed using ${model}; routing attempt ${routing.attempt ?? "unknown"}: ${String(routing.summary ?? "no summary").slice(0, 240)}`,
  );
} finally {
  if (server.exitCode === null) server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
  fs.rmSync(dataRoot, { recursive: true, force: true });
}
