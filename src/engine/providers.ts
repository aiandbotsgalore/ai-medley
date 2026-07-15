import { FunctionCallingConfigMode, GoogleGenAI, Type } from "@google/genai";
import type { MedleyConfig } from "../components/ConfigPanel";
import {
  MAX_PROVIDER_REQUEST_BYTES,
  MAX_PROVIDER_ESTIMATED_TOKENS,
  PROVIDER_REQUEST_TIMEOUT_MS,
} from "../types/specialistWorkflow";
import {
  assertProviderRequestWithinBudget,
  buildGeminiRequest,
  buildOpenRouterRequest,
  classifyProviderFailure,
  ProviderRequestError,
  OPENROUTER_ROUTING_METADATA_HEADER,
  OPENROUTER_ROUTING_METADATA_VALUE,
  sanitizeProviderAssistantMessage,
  extractOpenRouterRoutingAudit,
  type CategorizedProviderMessage,
  type ProviderMessageCategory,
  type ProviderRequestAudit,
} from "./providerRequest";
import { SERVER_MANAGED_API_KEY } from "../constants/provider";

type ProviderResponse = {
  text?: string;
  functionCalls?: Array<{ id: string; name: string; args: unknown }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type ProviderToolResponse = {
  name: string;
  id: string;
  response: unknown;
};

type ProviderSession = {
  send: (
    message: string | ProviderToolResponse[],
    options?: {
      signal?: AbortSignal;
      requestId?: string;
      timeoutMs?: number;
      messageCategory?: Extract<
        ProviderMessageCategory,
        "stageData" | "repairErrors"
      >;
    },
  ) => Promise<ProviderResponse>;
  getHistory: () => unknown[];
};

type ProviderAuditContext = {
  stage: string;
  role: string;
  /** Force the single schema-bearing tool required by an Automatic stage. */
  requiredToolName?: string;
  /** Use OpenRouter strict JSON Schema output instead of a tool call. */
  structuredOutput?: { name: string; schema: unknown };
  onRequestAudit?: (audit: ProviderRequestAudit) => void;
};

type AnalyzeAudioOptions = {
  config: MedleyConfig;
  file: Blob | File;
  mimeType: string;
  displayName: string;
  prompt: string;
  signal?: AbortSignal;
};

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * The automatic specialists share their tool definitions with OpenRouter. The
 * two providers use different envelopes, though: OpenRouter wraps each
 * declaration in `{ type: "function", function: ... }`, while Gemini accepts
 * the declaration itself. Sending the OpenRouter wrapper to Gemini makes the
 * API reject the request before the model can make an arrangement decision.
 */
function toGeminiSchema(value: any): any {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(toGeminiSchema);

  const output: Record<string, unknown> = {};
  if (value.type === "object" || value.type === Type.OBJECT)
    output.type = Type.OBJECT;
  else if (value.type === "array" || value.type === Type.ARRAY)
    output.type = Type.ARRAY;
  else if (
    value.type === "number" ||
    value.type === "integer" ||
    value.type === Type.NUMBER
  )
    output.type = Type.NUMBER;
  else if (value.type === "boolean" || value.type === Type.BOOLEAN)
    output.type = Type.BOOLEAN;
  else if (value.type === "string" || value.type === Type.STRING)
    output.type = Type.STRING;

  for (const key of ["description", "enum", "minimum", "maximum"] as const) {
    if (value[key] !== undefined) output[key] = value[key];
  }
  if (value.required) output.required = value.required;
  if (value.items) output.items = toGeminiSchema(value.items);
  if (value.properties) {
    output.properties = Object.fromEntries(
      Object.entries(value.properties).map(([key, child]) => [
        key,
        toGeminiSchema(child),
      ]),
    );
  }
  return output;
}

function toGeminiFunctionDeclarations(tools: unknown[]) {
  return tools.map((tool: any) => {
    const declaration = tool?.type === "function" ? tool.function : tool;
    return {
      name: String(declaration?.name ?? ""),
      description: String(declaration?.description ?? ""),
      parameters: toGeminiSchema(declaration?.parameters ?? { type: "object" }),
    };
  });
}

function getActiveApiKey(config: MedleyConfig) {
  return config.provider === "gemini"
    ? config.geminiApiKey
    : config.openrouterApiKey;
}

function normalizeTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part)
        return String((part as { text?: unknown }).text ?? "");
      return "";
    })
    .join("\n")
    .trim();
}

async function blobToBase64(file: Blob) {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchOpenRouter(
  config: MedleyConfig,
  request: ReturnType<typeof buildOpenRouterRequest>,
  signal?: AbortSignal,
) {
  assertProviderRequestWithinBudget(request);
  const apiKey = getActiveApiKey(config);
  const serverManaged = apiKey === SERVER_MANAGED_API_KEY;
  for (let attempt = 0; attempt < 2; attempt++) {
    let response: Response;
    try {
      response = await fetch(
        serverManaged ? "/api/provider/openrouter" : OPENROUTER_API_URL,
        {
        method: "POST",
        headers: {
          ...(serverManaged ? {} : { Authorization: `Bearer ${apiKey}` }),
          "Content-Type": serverManaged ? "text/plain" : "application/json",
          ...(serverManaged
            ? {}
            : {
                "HTTP-Referer": window.location.origin,
                "X-OpenRouter-Title": "AI Medley Architect",
                [OPENROUTER_ROUTING_METADATA_HEADER]: OPENROUTER_ROUTING_METADATA_VALUE,
              }),
        },
        body: request.serializedBody,
        signal,
      },
      );
    } catch (cause) {
      throw classifyProviderFailure({ cause });
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch (cause) {
        throw new ProviderRequestError({
          category: "malformed_response",
          status: response.status,
          message: "Provider returned malformed JSON.",
          cause,
        });
      }
    }
    const text = await response.text();
    const error = classifyProviderFailure({
      status: response.status,
      body: text,
      retryAfter: response.headers.get("Retry-After"),
    });
    if ((response.status === 429 || response.status === 503) && attempt === 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        }, error.retryAfterMs ?? 2_000);
        const abort = () => {
          window.clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
      });
      continue;
    }
    throw error;
  }
  throw new ProviderRequestError({
    category: "rate_limit",
    status: 429,
    message: "Provider rate-limit retry budget exhausted.",
  });
}

function createRequestSignal(
  signal?: AbortSignal,
  timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort(
      new DOMException("Provider request timed out", "TimeoutError"),
    );
  }, timeoutMs);
  const abort = () =>
    controller.abort(
      signal?.reason ?? new DOMException("Aborted", "AbortError"),
    );
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    },
  };
}

async function abortablePromise<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    // The request may have synchronously observed cancellation before this
    // wrapper attaches its normal handlers. Consume that late rejection so a
    // cancelled provider attempt never becomes an unhandled browser error.
    void promise.catch(() => {});
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function createProviderSession(
  config: MedleyConfig,
  systemInstruction: string,
  tools: unknown[],
  temperature: number,
  initialHistory?: unknown[],
  auditContext?: ProviderAuditContext,
): ProviderSession {
  if (config.provider === "gemini") {
    const serverManaged = config.geminiApiKey === SERVER_MANAGED_API_KEY;
    const ai = serverManaged
      ? null
      : new GoogleGenAI({ apiKey: config.geminiApiKey });
    const messages: CategorizedProviderMessage[] = (
      (initialHistory as Array<Record<string, unknown>>) ?? []
    ).map((message) => ({ message, category: "messageHistory" as const }));
    let requestNumber = 0;

    return {
      async send(message, options) {
        const pending: CategorizedProviderMessage[] =
          typeof message === "string"
            ? [
                {
                  message: { role: "user", parts: [{ text: message }] },
                  category: options?.messageCategory ?? "stageData",
                },
              ]
            : message.map((toolResponse) => ({
                message: {
                  role: "user",
                  parts: [
                    {
                      functionResponse: {
                        id: toolResponse.id,
                        name: toolResponse.name,
                        response: toolResponse.response,
                      },
                    },
                  ],
                },
                category: "toolResults" as const,
              }));
        const candidateMessages = [...messages, ...pending];
        const builtRequest = buildGeminiRequest({
          model: config.model,
          temperature,
          systemInstruction,
          messages: candidateMessages,
          tools,
        });
        assertProviderRequestWithinBudget(builtRequest);
        requestNumber++;
        const requestId =
          options?.requestId ??
          `${auditContext?.stage ?? "provider"}:${requestNumber}`;
        const auditBase: ProviderRequestAudit = {
          requestId,
          stage: auditContext?.stage ?? "unknown",
          role: auditContext?.role ?? "unknown",
          model: config.model,
          requestNumber,
          tools: tools.map((tool: any) => String(tool?.name ?? "")).filter(Boolean),
          utf8Bytes: builtRequest.utf8Bytes,
          estimatedTokens: builtRequest.estimatedTokens,
          breakdown: builtRequest.breakdown,
          status: "measured",
        };
        auditContext?.onRequestAudit?.(auditBase);
        const request = createRequestSignal(
          options?.signal,
          options?.timeoutMs,
        );
        try {
          const generateRequest = {
              model: config.model,
              contents: candidateMessages.map((item) => item.message) as any,
              config: {
                systemInstruction: { parts: [{ text: systemInstruction }] },
                tools: [{ functionDeclarations: toGeminiFunctionDeclarations(tools) }],
                // Gemini supports forcing a named function. Automatic stages
                // cannot safely proceed with prose or an unrelated tool call.
                ...(auditContext?.requiredToolName
                  ? {
                      toolConfig: {
                        functionCallingConfig: {
                          mode: FunctionCallingConfigMode.ANY,
                          allowedFunctionNames: [auditContext.requiredToolName],
                        },
                      },
                    }
                  : {}),
                temperature,
              },
            };
          const result = await abortablePromise(
            serverManaged
              ? fetch("/api/provider/gemini", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(generateRequest),
                  signal: request.signal,
                }).then(async (response) => {
                  const data = await response.json().catch(() => ({}));
                  if (!response.ok) {
                    throw classifyProviderFailure({
                      status: response.status,
                      body: data,
                    });
                  }
                  return data;
                })
              : ai!.models.generateContent(generateRequest),
            request.signal,
          );
          const assistantContent =
            (result as any)?.candidateContent ??
            (result as any)?.candidates?.[0]?.content ?? {
            role: "model",
            parts: [
              ...(result.text ? [{ text: result.text }] : []),
              ...((result.functionCalls ?? []).map((call: any) => ({
                functionCall: call,
              })) as any[]),
            ],
          };
          messages.push(...pending, {
            message: assistantContent,
            category: "messageHistory",
          });
          auditContext?.onRequestAudit?.({ ...auditBase, status: "completed" });
          return {
            text: result.text ?? "",
            functionCalls: (result.functionCalls ?? []).map((call) => ({
              id: call.id,
              name: call.name,
              args: call.args,
            })),
          };
        } catch (error) {
          const classified = classifyProviderFailure({ cause: error });
          auditContext?.onRequestAudit?.({
            ...auditBase,
            errorCategory: classified.category,
            status: "failed",
          });
          if (request.signal.aborted && request.signal.reason)
            throw request.signal.reason;
          throw classified;
        } finally {
          request.cleanup();
        }
      },
      getHistory() {
        return messages.map((item) => item.message);
      },
    };
  }

  const messages: CategorizedProviderMessage[] = [
    {
      message: { role: "system", content: systemInstruction },
      category: "systemPrompt",
    },
    ...((initialHistory as Array<Record<string, unknown>>) ?? []).map(
      (message) => ({
        message,
        category: "messageHistory" as const,
      }),
    ),
  ];
  let requestNumber = 0;

  return {
    getHistory() {
      return messages.slice(1).map((item) => item.message);
    },
    async send(message, options) {
      const pending: CategorizedProviderMessage[] =
        typeof message === "string"
          ? [
              {
                message: { role: "user", content: message },
                category: options?.messageCategory ?? "stageData",
              },
            ]
          : message.map((toolResponse) => ({
            message: {
              role: "tool",
              tool_call_id: toolResponse.id,
              content: JSON.stringify(toolResponse.response),
            },
            category: "toolResults",
          }));

      requestNumber++;
      const structuredOutput = auditContext?.structuredOutput;
      const requestTools = structuredOutput ? [] : tools;
      const builtRequest = buildOpenRouterRequest({
        model: config.model,
        temperature,
        messages: [...messages, ...pending],
        tools: requestTools,
        requiredToolName: structuredOutput
          ? undefined
          : auditContext?.requiredToolName,
        structuredOutput,
      });
      const requestId =
        options?.requestId ??
        `${auditContext?.stage ?? "provider"}:${requestNumber}`;
      const auditBase: ProviderRequestAudit = {
        requestId,
        stage: auditContext?.stage ?? "unknown",
        role: auditContext?.role ?? "unknown",
        model: config.model,
        requestNumber,
        tools: requestTools
          .map((tool: any) => String(tool?.function?.name ?? ""))
          .filter(Boolean),
        utf8Bytes: builtRequest.utf8Bytes,
        estimatedTokens: builtRequest.estimatedTokens,
        breakdown: builtRequest.breakdown,
        status: "measured",
      };
      auditContext?.onRequestAudit?.(auditBase);
      const request = createRequestSignal(options?.signal, options?.timeoutMs);
      let data: any;
      try {
        data = await fetchOpenRouter(config, builtRequest, request.signal);
      } catch (error) {
        const classified = classifyProviderFailure({ cause: error });
        auditContext?.onRequestAudit?.({
          ...auditBase,
          errorCategory: classified.category,
          providerErrorType: classified.providerErrorType,
          providerCode: classified.providerCode,
          routing: classified.routing,
          status: "failed",
        });
        if (request.signal.aborted && request.signal.reason)
          throw request.signal.reason;
        throw classified;
      } finally {
        request.cleanup();
      }

      const choice = data?.choices?.[0];
      const assistantMessage = choice?.message ?? {};
      const sanitizedAssistantMessage = sanitizeProviderAssistantMessage({
        ...assistantMessage,
        content: normalizeTextContent(assistantMessage.content),
      });
      let functionCalls: any[] = [];

      if (Array.isArray(assistantMessage.tool_calls)) {
        functionCalls = assistantMessage.tool_calls.map((call: any) => {
          let parsedArgs: any = {};
          const rawArgs = call.function?.arguments;

          if (rawArgs) {
            try {
              parsedArgs = JSON.parse(rawArgs);
            } catch (parseErr) {
              const parseError = new Error(
                `Failed to parse tool call arguments for ${call.function?.name}`,
              );
              (parseError as any).rawArguments = rawArgs;
              (parseError as any).toolCall = call;
              throw parseError;
            }
          }

          return {
            id: call.id,
            name: call.function?.name ?? "",
            args: parsedArgs,
          };
        });
      }

      messages.push(...pending, {
        message: sanitizedAssistantMessage,
        category: "messageHistory",
      });

      const usage = data?.usage;
      auditContext?.onRequestAudit?.({
        ...auditBase,
        actualPromptTokens: usage?.prompt_tokens,
        routing: extractOpenRouterRoutingAudit(data),
        status: "completed",
      });

      return {
        text: normalizeTextContent(assistantMessage.content),
        functionCalls,
        usage: usage
          ? {
              prompt_tokens: usage.prompt_tokens,
              completion_tokens: usage.completion_tokens,
              total_tokens: usage.total_tokens,
            }
          : undefined,
      };
    },
  };
}

export async function analyzeAudioWithProvider(options: AnalyzeAudioOptions) {
  const { config, file, mimeType, displayName, prompt, signal } = options;

  if (config.provider === "gemini") {
    if (config.geminiApiKey === SERVER_MANAGED_API_KEY) {
      throw new Error(
        "Cloud audio upload is unavailable for a server-managed Gemini credential. Use local analysis or enter an in-memory Gemini key for this run.",
      );
    }
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const uploadResult = await ai.files.upload({
      file:
        file instanceof File
          ? file
          : new File([file], displayName, { type: mimeType }),
      config: { mimeType, displayName },
    });

    let fileInfo = uploadResult;
    let attempts = 0;
    while (fileInfo.state === "PROCESSING" && attempts < 15) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      fileInfo = await ai.files.get({ name: uploadResult.name! });
      attempts++;
    }

    if (fileInfo.state !== "ACTIVE") {
      throw new Error(`Gemini upload failed with state ${fileInfo.state}`);
    }

    const result = await ai.models.generateContent({
      model: config.model,
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            { fileData: { fileUri: fileInfo.uri!, mimeType } },
          ],
        },
      ],
    });

    return result.text ?? "";
  }

  const base64Audio = await blobToBase64(file);
  const request = buildOpenRouterRequest({
    model: config.model,
    temperature: config.temperature,
    messages: [
      {
        category: "stageData",
        message: {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "input_audio",
              input_audio: {
                data: base64Audio,
                format: mimeType.split("/")[1] || "mpeg",
              },
            },
          ],
        },
      },
    ],
    tools: [],
  });
  const data = await fetchOpenRouter(config, request, signal);

  return normalizeTextContent(data?.choices?.[0]?.message?.content);
}
