import assert from "node:assert/strict";
import {
  MAX_ANALYSIS_DURATION_SEC,
  MAX_PROJECT_TRACKS,
  MAX_SESSION_LOG_ENTRIES,
  appendBoundedLog,
  assertAnalysisDuration,
  assertProjectResourceBudget,
} from "./resourcePolicy";

assert.doesNotThrow(() =>
  assertProjectResourceBudget(Array.from({ length: 25 }, () => ({ durationSec: 60 }))),
);
assert.throws(
  () => assertProjectResourceBudget(Array.from({ length: MAX_PROJECT_TRACKS + 1 }, () => ({ durationSec: 60 }))),
  /track limit/i,
);
assert.doesNotThrow(() => assertAnalysisDuration(MAX_ANALYSIS_DURATION_SEC));
assert.throws(() => assertAnalysisDuration(MAX_ANALYSIS_DURATION_SEC + 1), /analysis limit/i);
const logs: string[] = [];
for (let index = 0; index < MAX_SESSION_LOG_ENTRIES + 20; index++)
  appendBoundedLog(logs, `log-${index}`);
assert.equal(logs.length, MAX_SESSION_LOG_ENTRIES);
assert.equal(logs.at(-1), `log-${MAX_SESSION_LOG_ENTRIES + 19}`);

console.log("resourcePolicy tests passed");
