import assert from "node:assert/strict";
import {
  SSEStreamController,
  type EventSourceLike,
} from "./sseStreamController";

class FakeEventSource implements EventSourceLike {
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const sources: Array<{ url: string; source: FakeEventSource }> = [];
const timers: Array<() => void> = [];
const statuses: string[] = [];
const logs: string[] = [];
const controller = new SSEStreamController({
  createEventSource: (url) => {
    const source = new FakeEventSource();
    sources.push({ url, source });
    return source;
  },
  setStatus: (status) => statuses.push(status),
  setTimeoutImpl: ((callback: () => void) => {
    timers.push(callback);
    return callback as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout,
  clearTimeoutImpl: ((callback: () => void) => {
    const index = timers.indexOf(callback);
    if (index >= 0) timers.splice(index, 1);
  }) as unknown as typeof clearTimeout,
  random: () => 0,
  closedReadyState: 2,
});

controller.connect("run-a", { onLog: (message) => logs.push(message) });
assert.equal(sources.length, 1);
const runA = sources[0].source;
runA.close();
runA.onerror?.();
assert.equal(timers.length, 1);

controller.connect("run-b", { onLog: (message) => logs.push(message) });
assert.equal(sources.length, 2);
const runB = sources[1].source;

const staleReconnect = timers.shift();
staleReconnect?.();
assert.equal(sources.length, 2);
assert.equal(sources[1].url, "/api/session/run-b/stream");

runA.emit("log", { message: "late run a" });
assert.deepEqual(logs, []);
runB.emit("log", { message: "run b" });
assert.deepEqual(logs, ["run b"]);
const timersBeforeHeartbeat = timers.length;
runB.emit("heartbeat", { sequence: 1 });
assert.equal(timers.length, timersBeforeHeartbeat);
runB.emit("completed", { summary: "done" });
assert.equal(runB.closed, true);
assert.equal(statuses.at(-1), "closed");

controller.disconnect();
assert.equal(runB.closed, true);
assert.equal(statuses.at(-1), "closed");

// Browser timer functions are receiver-sensitive. Verify the controller's
// default wrappers call them through globalThis instead of as class methods.
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
let receiverSafeTimerCalled = false;
try {
  globalThis.setTimeout = function (this: unknown, callback: TimerHandler) {
    assert.equal(this, globalThis);
    receiverSafeTimerCalled = true;
    return callback as unknown as ReturnType<typeof setTimeout>;
  } as typeof setTimeout;
  globalThis.clearTimeout = function (this: unknown) {
    assert.equal(this, globalThis);
  } as typeof clearTimeout;

  const nativeTimerSources: FakeEventSource[] = [];
  const nativeTimerController = new SSEStreamController({
    createEventSource: () => {
      const source = new FakeEventSource();
      nativeTimerSources.push(source);
      return source;
    },
    setStatus: () => {},
    random: () => 0,
    closedReadyState: 2,
  });
  nativeTimerController.connect("receiver-safe");
  nativeTimerSources[0].close();
  nativeTimerSources[0].onerror?.();
  assert.equal(receiverSafeTimerCalled, true);
  nativeTimerController.disconnect();
} finally {
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
}

console.log("sseStreamController tests passed");
