import assert from "node:assert/strict";
import { AnalysisJobRegistry } from "./analysisJobRegistry";

const registry = new AnalysisJobRegistry();
const first = registry.begin("track-a", "run-1");
assert.equal(registry.isCurrent(first), true);
const second = registry.begin("track-a", "run-2");
assert.equal(first.controller.signal.aborted, true);
assert.equal(registry.isCurrent(first), false);
assert.equal(registry.isCurrent(second), true);
registry.cancel(second);
assert.equal(registry.isCurrent(second), false);
registry.finish(second);

const independent = registry.begin("track-b", "run-1");
assert.equal(registry.isCurrent(independent), true);
registry.finish(independent);
assert.equal(registry.isCurrent(independent), false);

const bounded = new AnalysisJobRegistry(2);
const boundedA = bounded.begin("a", "1");
const boundedB = bounded.begin("b", "1");
assert.throws(() => bounded.begin("c", "1"), /concurrency limit/i);
bounded.finish(boundedA);
assert.doesNotThrow(() => bounded.begin("c", "1"));
bounded.finish(boundedB);

console.log("analysisJobRegistry tests passed");
