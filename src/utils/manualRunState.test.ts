import assert from "node:assert/strict";
import {
  shouldResetManualToolFailure,
  shouldSendManualToolResponses,
} from "./manualRunState";

assert.equal(shouldSendManualToolResponses(false, 1), true);
assert.equal(shouldSendManualToolResponses(false, 0), false);
assert.equal(
  shouldSendManualToolResponses(true, 1),
  false,
  "A completed manual finalization must not trigger another provider turn",
);
assert.equal(shouldResetManualToolFailure(false), true);
assert.equal(
  shouldResetManualToolFailure(true),
  false,
  "A failed tool batch must retain its fallback streak",
);

console.log("manualRunState tests passed");
