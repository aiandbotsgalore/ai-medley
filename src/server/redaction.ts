const SENSITIVE_KEY = /(?:api.?key|authorization|token|secret|password|credential|signed.?uri)/i;

function redactString(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(
      /((?:api[_-]?key|token|secret|password|signature|sig)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(?:AIza|sk-or-v1-|sk-)[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]");
}

export function redactSensitive<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === "string") return redactString(value) as T;
  if (!value || typeof value !== "object") return value;
  if (seen.has(value as object)) return "[CIRCULAR]" as T;
  seen.add(value as object);
  if (Array.isArray(value))
    return value.map((item) => redactSensitive(item, seen)) as T;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY.test(key)
      ? "[REDACTED]"
      : redactSensitive(child, seen);
  }
  return output as T;
}
