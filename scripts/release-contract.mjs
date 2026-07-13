import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");
const packageJson = JSON.parse(read("package.json"));
const server = read("server.ts");
const operations = read("docs/current-operations.md");
const apiRoutes = read("docs/api-routes.md");
const readme = read("README.md");
const agents = read("AGENTS.md");
const claude = read("CLAUDE.md");
const plansIndex = read("docs/plans/README.md");

for (const dependency of [
  "@google/generative-ai",
  "motion",
  "autoprefixer",
]) {
  assert.equal(
    packageJson.dependencies?.[dependency] ??
      packageJson.devDependencies?.[dependency],
    undefined,
    `${dependency} must not remain declared after its no-use proof`,
  );
}

for (const command of [
  "npm ci",
  "npm test",
  "npm run lint",
  "npm run build",
  "npm run start",
  "npm run test:production-start",
]) {
  assert.ok(
    readme.includes(command) || operations.includes(command),
    `Current operations documentation must include ${command}`,
  );
}

for (const value of [
  ">=20 <27",
  "dist/server.js",
  "127.0.0.1",
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "PORT",
  "AI_MEDLEY_DATA_ROOT",
  "NODE_ENV",
  "Automatic Specialist Team",
  "Manual Model",
  "contained",
  "expert",
  "google/gemini-2.5-pro",
  "gemini-2.5-flash",
]) {
  assert.ok(
    operations.includes(value),
    `Current operations documentation must include ${value}`,
  );
}

for (const guide of [agents, claude]) {
  assert.ok(guide.includes("docs/current-operations.md"));
  assert.ok(guide.includes("dist/server.js"));
  assert.ok(guide.includes("Automatic Specialist Team"));
}
assert.match(plansIndex, /historical/i);
assert.match(plansIndex, /do not delete/i);

const executableRoutes = Array.from(
  server.matchAll(/app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g),
  ([, method, route]) => `${method.toUpperCase()} ${route}`,
).sort();
const documentedRoutes = Array.from(
  apiRoutes.matchAll(/`(GET|POST|PUT|PATCH|DELETE) ([^`]+)`/g),
  ([, method, route]) => `${method} ${route}`,
).sort();
assert.deepEqual(
  documentedRoutes,
  executableRoutes,
  "Documented API routes must exactly match Express registrations",
);

const envVariables = Array.from(
  server.matchAll(/process\.env\.([A-Z0-9_]+)/g),
  ([, name]) => name,
);
for (const variable of new Set(envVariables)) {
  assert.ok(
    operations.includes(variable),
    `Current operations documentation must include ${variable}`,
  );
}

console.log("release documentation contract passed");
