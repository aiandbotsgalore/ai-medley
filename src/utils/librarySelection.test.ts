import assert from "node:assert/strict";
import {
  reconcileSelectedTrackIds,
  selectLibraryEntriesById,
  toggleSelectedTrackId,
} from "./librarySelection";

assert.deepEqual(reconcileSelectedTrackIds([], [], ["a", "b"], false), ["a", "b"]);
const firstStrictModeLoad = reconcileSelectedTrackIds(
  [],
  [],
  ["a", "b"],
  false,
);
assert.deepEqual(
  reconcileSelectedTrackIds(
    firstStrictModeLoad,
    ["a", "b"],
    ["a", "b"],
    true,
  ),
  ["a", "b"],
  "Repeated initial library reconciliation must retain the default selection",
);
assert.deepEqual(reconcileSelectedTrackIds(["a"], ["a", "b"], ["a", "b", "c"], true), ["a", "c"]);
assert.deepEqual(reconcileSelectedTrackIds(["a", "missing"], ["a", "b"], ["a", "b"], true), ["a"]);
assert.deepEqual(toggleSelectedTrackId(["a", "b"], "a"), ["b"]);
assert.deepEqual(toggleSelectedTrackId(["a"], "b"), ["a", "b"]);
assert.deepEqual(
  selectLibraryEntriesById(
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    ["c", "a"],
  ),
  [{ id: "a" }, { id: "c" }],
);
console.log("librarySelection tests passed");
