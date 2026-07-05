import assert from "node:assert/strict";
import {
  MANUAL_TOOL_CONTRACT_VERSION,
  getGeminiManualToolDeclarations,
  getOpenRouterManualTools,
  parseManualToolCall,
} from "./manualToolContracts";

const openRouter = getOpenRouterManualTools();
const gemini = getGeminiManualToolDeclarations();
assert.equal(openRouter.length, gemini.length);
for (const tool of openRouter) {
  const schema = tool.function.parameters as any;
  assert.equal(schema.additionalProperties, false);
  assert.ok(schema.required.includes("contractVersion"));
}

assert.deepEqual(
  parseManualToolCall("finalize_medley", {
    contractVersion: MANUAL_TOOL_CONTRACT_VERSION,
    summary: "done",
  }),
  { contractVersion: 1, summary: "done" },
);
assert.throws(
  () =>
    parseManualToolCall("finalize_medley", {
      contractVersion: 1,
      summary: "done",
      finalMp3Path: "ignored.mp3",
    }),
  /Unrecognized key|invalid/i,
);
assert.throws(
  () => parseManualToolCall("set_design_plan", { contractVersion: 1, transitions: [{}] }),
  /invalid/i,
);

const legacy = parseManualToolCall(
  "finalize_medley",
  { finalMp3Path: "legacy.mp3", summary: "legacy", useCleanRender: true },
  { allowLegacy: true },
);
assert.equal(legacy.contractVersion, 1);
assert.equal(legacy.summary, "legacy");
assert.equal("finalMp3Path" in legacy, false);

console.log("manualToolContracts tests passed");
