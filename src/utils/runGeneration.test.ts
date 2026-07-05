import assert from "node:assert/strict";
import {
  beginRunGeneration,
  cancelRunGeneration,
  isRunGenerationActive,
  supersededRunError,
} from "./runGeneration";

const counter = { current: 0 };
const first = beginRunGeneration(counter);
assert.equal(first.id, 1);
assert.equal(isRunGenerationActive(counter, first), true);

const second = beginRunGeneration(counter);
assert.equal(isRunGenerationActive(counter, first), false);
assert.equal(isRunGenerationActive(counter, second), true);

cancelRunGeneration(counter, second.controller);
assert.equal(second.controller.signal.aborted, true);
assert.equal(isRunGenerationActive(counter, second), false);

const error = supersededRunError();
assert.equal(error.name, "AbortError");

console.log("runGeneration tests passed");
