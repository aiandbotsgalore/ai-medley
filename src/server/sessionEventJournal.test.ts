import assert from "node:assert/strict";
import { SessionEventJournal, encodeSseEvent } from "./sessionEventJournal";

const journal = new SessionEventJournal(2);
const first = journal.append("log", { message: "one" });
const second = journal.append("progress", { value: 2 });
const third = journal.append("completed", { ok: true });
assert.deepEqual(journal.replayAfter(1), [second, third]);
assert.deepEqual(journal.replayAfter(2), [third]);
assert.equal(journal.currentSequence, 3);
assert.match(encodeSseEvent(first), /^id: 1\nevent: log\n/);

console.log("sessionEventJournal tests passed");
