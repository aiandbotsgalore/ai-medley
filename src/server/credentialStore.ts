import fs from "node:fs";
import path from "node:path";

const OPENROUTER_KEY_NAME = "OPENROUTER_API_KEY";

export function normalizeOpenRouterApiKey(value: unknown) {
  if (typeof value !== "string") throw new Error("OpenRouter API key is required");
  const apiKey = value.trim();
  if (
    apiKey.length < 20 ||
    apiKey.length > 512 ||
    !apiKey.startsWith("sk-or-") ||
    /[\r\n\0]/.test(apiKey)
  ) {
    throw new Error("OpenRouter API key format is invalid");
  }
  return apiKey;
}

export function persistOpenRouterApiKey(filePath: string, value: unknown) {
  const apiKey = normalizeOpenRouterApiKey(value);
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const lines = existing.split(/\r?\n/);
  const assignment = `${OPENROUTER_KEY_NAME}=${JSON.stringify(apiKey)}`;
  let replaced = false;
  const updated = lines.map((line) => {
    if (/^\s*OPENROUTER_API_KEY\s*=/.test(line)) {
      replaced = true;
      return assignment;
    }
    return line;
  });
  if (!replaced) updated.push(assignment);
  const serialized = `${updated.filter((line, index, all) => line || index < all.length - 1).join("\n")}\n`;

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, serialized, { encoding: "utf8", mode: 0o600 });
  return apiKey;
}
