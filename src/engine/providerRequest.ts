import {
  MAX_PROVIDER_ESTIMATED_TOKENS,
  MAX_PROVIDER_REQUEST_BYTES,
} from "../types/specialistWorkflow";

export type ProviderMessageCategory =
  | "systemPrompt"
  | "stageData"
  | "messageHistory"
  | "toolResults"
  | "repairErrors";

export type CategorizedProviderMessage = {
  message: Record<string, unknown>;
  category: ProviderMessageCategory;
};

export type ProviderRequestBreakdown = Record<
  | "systemPrompt"
  | "stageData"
  | "toolSchemas"
  | "messageHistory"
  | "toolResults"
  | "repairErrors"
  | "requestEnvelope",
  { utf8Bytes: number; estimatedTokens: number }
>;

export type BuiltProviderRequest = {
  provider: "openrouter" | "gemini";
  requestBody: Record<string, unknown>;
  serializedBody: string;
  utf8Bytes: number;
  estimatedTokens: number;
  withinHardLimits: boolean;
  breakdown: ProviderRequestBreakdown;
};

export type ProviderErrorCategory =
  | "payload"
  | "authentication"
  | "quota"
  | "model_unavailable"
  | "rate_limit"
  | "timeout"
  | "server"
  | "malformed_response"
  | "network"
  | "aborted"
  | "unknown";

export type ManualProviderAction =
  | "retry_same"
  | "switch_model"
  | "reconfigure"
  | "reduce_payload"
  | "stop";

export class ProviderRequestError extends Error {
  readonly category: ProviderErrorCategory;
  readonly status?: number;
  readonly retryAfterMs: number | null;
  readonly payloadMetrics?: BuiltProviderRequest;

  constructor(options: {
    message: string;
    category: ProviderErrorCategory;
    status?: number;
    retryAfterMs?: number | null;
    payloadMetrics?: BuiltProviderRequest;
    cause?: unknown;
  }) {
    super(options.message, { cause: options.cause });
    this.name = "ProviderRequestError";
    this.category = options.category;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.payloadMetrics = options.payloadMetrics;
  }
}

export const PROVIDER_COMPONENT_MAX_BYTES: Partial<
  Record<keyof ProviderRequestBreakdown, number>
> = {
  systemPrompt: 48 * 1024,
  stageData: 64 * 1024,
  toolSchemas: 32 * 1024,
  messageHistory: 64 * 1024,
  toolResults: 48 * 1024,
  repairErrors: 32 * 1024,
};

export type ProviderRequestAudit = {
  requestId: string;
  stage: string;
  role: string;
  model: string;
  requestNumber: number;
  tools: string[];
  utf8Bytes: number;
  estimatedTokens: number;
  breakdown: ProviderRequestBreakdown;
  actualPromptTokens?: number;
  errorCategory?: ProviderErrorCategory;
  status: "measured" | "completed" | "failed";
};

function measureSerialized(serialized: string) {
  return {
    utf8Bytes: new TextEncoder().encode(serialized).byteLength,
    estimatedTokens: Math.ceil(serialized.length / 3),
  };
}

function measureValue(value: unknown) {
  return measureSerialized(JSON.stringify(value));
}

function isWithinRequestLimits(
  total: { utf8Bytes: number; estimatedTokens: number },
  breakdown: ProviderRequestBreakdown,
) {
  return (
    total.utf8Bytes <= MAX_PROVIDER_REQUEST_BYTES &&
    total.estimatedTokens <= MAX_PROVIDER_ESTIMATED_TOKENS &&
    Object.entries(PROVIDER_COMPONENT_MAX_BYTES).every(
      ([category, limit]) =>
        breakdown[category as keyof ProviderRequestBreakdown].utf8Bytes <=
        limit,
    )
  );
}

export function buildOpenRouterRequest(input: {
  model: string;
  temperature: number;
  messages: CategorizedProviderMessage[];
  tools: unknown[];
}): BuiltProviderRequest {
  const requestBody = {
    model: input.model,
    temperature: input.temperature,
    messages: input.messages.map((item) => item.message),
    tools: input.tools,
    tool_choice: "auto",
  };
  const serializedBody = JSON.stringify(requestBody);
  const total = measureSerialized(serializedBody);
  const messagesByCategory = (category: ProviderMessageCategory) =>
    input.messages
      .filter((item) => item.category === category)
      .map((item) => item.message);
  const breakdown: ProviderRequestBreakdown = {
    systemPrompt: measureValue(messagesByCategory("systemPrompt")),
    stageData: measureValue(messagesByCategory("stageData")),
    toolSchemas: measureValue(input.tools),
    messageHistory: measureValue(messagesByCategory("messageHistory")),
    toolResults: measureValue(messagesByCategory("toolResults")),
    repairErrors: measureValue(messagesByCategory("repairErrors")),
    requestEnvelope: measureValue({
      model: input.model,
      temperature: input.temperature,
      tool_choice: "auto",
    }),
  };

  return {
    provider: "openrouter",
    requestBody,
    serializedBody,
    utf8Bytes: total.utf8Bytes,
    estimatedTokens: total.estimatedTokens,
    withinHardLimits: isWithinRequestLimits(total, breakdown),
    breakdown,
  };
}

export function buildGeminiRequest(input: {
  model: string;
  temperature: number;
  systemInstruction: string;
  messages: CategorizedProviderMessage[];
  tools: unknown[];
}): BuiltProviderRequest {
  const requestBody = {
    model: input.model,
    system_instruction: { parts: [{ text: input.systemInstruction }] },
    contents: input.messages.map((item) => item.message),
    tools: [{ function_declarations: input.tools }],
    generation_config: { temperature: input.temperature },
  };
  const serializedBody = JSON.stringify(requestBody);
  const total = measureSerialized(serializedBody);
  const messagesByCategory = (category: ProviderMessageCategory) =>
    input.messages
      .filter((item) => item.category === category)
      .map((item) => item.message);
  const breakdown: ProviderRequestBreakdown = {
    systemPrompt: measureValue(input.systemInstruction),
    stageData: measureValue(messagesByCategory("stageData")),
    toolSchemas: measureValue(input.tools),
    messageHistory: measureValue(messagesByCategory("messageHistory")),
    toolResults: measureValue(messagesByCategory("toolResults")),
    repairErrors: measureValue(messagesByCategory("repairErrors")),
    requestEnvelope: measureValue({
      model: input.model,
      temperature: input.temperature,
    }),
  };
  return {
    provider: "gemini",
    requestBody,
    serializedBody,
    utf8Bytes: total.utf8Bytes,
    estimatedTokens: total.estimatedTokens,
    withinHardLimits: isWithinRequestLimits(total, breakdown),
    breakdown,
  };
}

export function largestRequestComponent(breakdown: ProviderRequestBreakdown) {
  return Object.entries(breakdown).sort(
    (a, b) => b[1].utf8Bytes - a[1].utf8Bytes,
  )[0];
}

export function assertProviderRequestWithinBudget(
  request: BuiltProviderRequest,
): void {
  if (request.withinHardLimits) return;
  const [component, measurement] = largestRequestComponent(request.breakdown);
  throw new ProviderRequestError({
    category: "payload",
    status: 413,
    payloadMetrics: request,
    message:
      `Provider request exceeds the shared pre-network budget ` +
      `(${request.utf8Bytes}/${MAX_PROVIDER_REQUEST_BYTES} bytes, ` +
      `${request.estimatedTokens}/${MAX_PROVIDER_ESTIMATED_TOKENS} estimated tokens). ` +
      `Largest component: ${component} (${measurement.utf8Bytes} bytes).`,
  });
}

export function parseRetryAfterMs(
  value: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1_000, 30_000);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.min(Math.max(0, timestamp - now), 30_000);
}

function safeProviderMessage(body: unknown): string | null {
  let candidate = "";
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    const providerError = (parsed as any)?.error;
    candidate = String(
      (typeof providerError === "string" ? providerError : providerError?.message) ??
        (parsed as any)?.message ??
        "",
    );
  } catch {
    candidate = typeof body === "string" ? body : "";
  }
  if (!candidate) return null;
  return candidate
    .replace(
      /(api[_ -]?key|authorization|token|secret)\s*[:=]\s*[^\s,;}]+/gi,
      "$1=[REDACTED]",
    )
    .slice(0, 500);
}

export function classifyProviderFailure(input: {
  status?: number;
  body?: unknown;
  retryAfter?: string | null;
  cause?: unknown;
}): ProviderRequestError {
  if (input.cause instanceof ProviderRequestError) return input.cause;
  const cause = input.cause as any;
  const status = input.status ?? cause?.status;
  const name = String(cause?.name ?? "");
  let category: ProviderErrorCategory = "unknown";
  if (name === "AbortError") category = "aborted";
  else if (name === "TimeoutError") category = "timeout";
  else if (status === 413) category = "payload";
  else if (status === 401 || status === 403) category = "authentication";
  else if (status === 402) category = "quota";
  else if (status === 404) category = "model_unavailable";
  else if (status === 408) category = "timeout";
  else if (status === 429) category = "rate_limit";
  else if (typeof status === "number" && status >= 500) category = "server";
  else if (cause instanceof TypeError) category = "network";
  const detail = safeProviderMessage(input.body);
  return new ProviderRequestError({
    category,
    status,
    retryAfterMs: parseRetryAfterMs(input.retryAfter),
    cause: input.cause,
    message: `Provider request failed${status ? ` (${status})` : ""}${detail ? `: ${detail}` : ""}`,
  });
}

export function getManualProviderFailureDecision(
  error: ProviderRequestError,
): { action: ManualProviderAction; userMessage: string } {
  switch (error.category) {
    case "authentication":
      return {
        action: "reconfigure",
        userMessage: "Provider authentication failed. Check the selected provider API key.",
      };
    case "payload":
      return {
        action: "reduce_payload",
        userMessage: error.message,
      };
    case "quota":
      return {
        action: "switch_model",
        userMessage: "The selected model has no available quota. Trying a fallback model.",
      };
    case "model_unavailable":
      return {
        action: "switch_model",
        userMessage: "The selected model is unavailable or has no compatible endpoint.",
      };
    case "rate_limit":
      return {
        action: "switch_model",
        userMessage: "The bounded rate-limit retry was exhausted. Trying a fallback model.",
      };
    case "timeout":
    case "server":
    case "malformed_response":
    case "network":
      return {
        action: "switch_model",
        userMessage: "The provider request failed after its bounded attempt. Trying a fallback model.",
      };
    case "aborted":
      return { action: "stop", userMessage: "Provider request cancelled." };
    default:
      return { action: "stop", userMessage: "Provider request failed." };
  }
}

export function sanitizeProviderAssistantMessage(
  message: any,
): Record<string, unknown> {
  const content =
    typeof message?.content === "string"
      ? message.content.slice(0, 2_000)
      : null;
  const sanitized: Record<string, unknown> = {
    role: "assistant",
    content: content || null,
  };
  if (!Array.isArray(message?.tool_calls)) return sanitized;
  sanitized.tool_calls = message.tool_calls.map((call: any) => {
    const name = String(call?.function?.name ?? "");
    const raw = call?.function?.arguments;
    let args = typeof raw === "string" ? raw : JSON.stringify(raw ?? {});
    if (name === "submit_execution_report") {
      try {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
        args = JSON.stringify({
          schemaVersion: parsed.schemaVersion,
          executionVersion: parsed.executionVersion,
          arrangementVersion: parsed.arrangementVersion,
          attemptedTransitionCount: Array.isArray(parsed.attemptedTransitions)
            ? parsed.attemptedTransitions.length
            : 0,
        });
      } catch {
        args = "{}";
      }
    }
    return {
      id: String(call?.id ?? ""),
      type: "function",
      function: { name, arguments: args },
    };
  });
  return sanitized;
}
