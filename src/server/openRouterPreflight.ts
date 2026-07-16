const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_PREFLIGHT_MODEL = "google/gemini-2.5-flash";
export const OPENROUTER_PREFLIGHT_MAX_TOKENS = 8;

export type OpenRouterPreflightStatus =
  | "credential_missing"
  | "authentication"
  | "quota"
  | "rate_limit"
  | "model_unavailable"
  | "server"
  | "unavailable";

export class OpenRouterPreflightError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: OpenRouterPreflightStatus,
    message: string,
  ) {
    super(message);
  }
}

function classifyFailure(status: number): OpenRouterPreflightError {
  if (status === 401 || status === 403)
    return new OpenRouterPreflightError(status, "authentication", "OpenRouter rejected the configured credential.");
  if (status === 402)
    return new OpenRouterPreflightError(status, "quota", "OpenRouter reports insufficient credits for this check.");
  if (status === 429)
    return new OpenRouterPreflightError(status, "rate_limit", "OpenRouter is rate-limiting this check. Try again shortly.");
  if (status === 404)
    return new OpenRouterPreflightError(status, "model_unavailable", "Gemini 2.5 Flash is unavailable through OpenRouter right now.");
  if (status >= 500)
    return new OpenRouterPreflightError(status, "server", "OpenRouter is temporarily unavailable. Try again shortly.");
  return new OpenRouterPreflightError(status, "unavailable", "OpenRouter could not complete the connection check.");
}

export async function runOpenRouterPreflight(input: {
  apiKey: string;
  referer: string;
  fetchImpl?: typeof fetch;
}) {
  if (!input.apiKey.trim())
    throw new OpenRouterPreflightError(503, "credential_missing", "A server-managed OpenRouter credential is not configured.");

  const fetchImpl = input.fetchImpl ?? fetch;
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetchImpl(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": input.referer,
        "X-OpenRouter-Title": "AI Medley Architect",
      },
      body: JSON.stringify({
        model: OPENROUTER_PREFLIGHT_MODEL,
        messages: [{ role: "user", content: "Reply with OK." }],
        max_tokens: OPENROUTER_PREFLIGHT_MAX_TOKENS,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new OpenRouterPreflightError(502, "unavailable", "Could not reach OpenRouter for the connection check.");
  }

  if (!response.ok) throw classifyFailure(response.status);
  return {
    model: OPENROUTER_PREFLIGHT_MODEL,
    latencyMs: Date.now() - startedAt,
  };
}
