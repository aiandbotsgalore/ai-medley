import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getAdjacentTab, moveItem } from "./accessibility";

assert.deepEqual(moveItem(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
assert.deepEqual(moveItem(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
assert.deepEqual(moveItem(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
assert.deepEqual(moveItem(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
assert.equal(getAdjacentTab("workshop", "ArrowRight"), "history");
assert.equal(getAdjacentTab("history", "ArrowRight"), "workshop");
assert.equal(getAdjacentTab("workshop", "ArrowLeft"), "history");
assert.equal(getAdjacentTab("history", "Home"), "workshop");
assert.equal(getAdjacentTab("workshop", "End"), "history");

const root = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const app = read("src/App.tsx");
const config = read("src/components/ConfigPanel.tsx");
const library = read("src/components/LibrarySidebar.tsx");
const history = read("src/components/HistoryBrowser.tsx");
const header = read("src/components/Header.tsx");
const css = read("src/index.css");

for (const contract of [
  'role="tablist"',
  'role="tab"',
  'role="tabpanel"',
  'role="progressbar"',
  'role="alert"',
]) {
  assert.ok(app.includes(contract), `App must include ${contract}`);
}
for (const contract of [
  'role="dialog"',
  'aria-modal="true"',
  'aria-labelledby="configuration-title"',
  'event.key === "Escape"',
  'event.key === "Tab"',
  "htmlFor=",
]) {
  assert.ok(config.includes(contract), `Config dialog must include ${contract}`);
}
assert.ok(library.includes("Move ${file.originalName} up"));
assert.ok(library.includes("Move ${file.originalName} down"));
assert.ok(library.includes("Remove ${file.originalName}"));
assert.ok(history.includes("Load session from"));
assert.ok(history.includes("Download MP3 from"));
assert.ok(history.includes("Delete session from"));
assert.ok(header.includes('aria-label="Start a new session"'));
assert.ok(header.includes("keeps library and history"));
assert.ok(css.includes(":focus-visible"));
assert.ok(css.includes("prefers-reduced-motion: reduce"));
assert.ok(app.includes("const isInputStage = isIdle || isUploading"));
assert.ok(app.includes('role="progressbar"'));
assert.ok(app.includes('data-testid="new-session-ready"'));
assert.ok(app.includes("Fresh session ready"));
assert.ok(app.includes("<h2 className=\"text-[15px]"));
assert.ok(!app.includes("fonts.googleapis.com"));
assert.ok(config.includes('element.setAttribute("inert", "")'));
assert.ok(css.includes("min-height: 44px"));

console.log("accessibility tests passed");
