import { GoogleGenAI } from '@google/genai';
import type { MedleyConfig } from '../components/ConfigPanel';
import {
  MAX_PROVIDER_REQUEST_BYTES,
  MAX_PROVIDER_ESTIMATED_TOKENS,
  PROVIDER_REQUEST_TIMEOUT_MS,
} from '../types/specialistWorkflow';
import {
  buildOpenRouterRequest,
  sanitizeProviderAssistantMessage,
  type CategorizedProviderMessage,
  type ProviderMessageCategory,
  type ProviderRequestAudit,
} from './providerRequest';

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
      messageCategory?: Extract<ProviderMessageCategory, 'stageData' | 'repairErrors'>;
    },
  ) => Promise<ProviderResponse>;
  getHistory: () => unknown[];
};

type ProviderAuditContext = {
  stage: string;
  role: string;
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

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

function getActiveApiKey(config: MedleyConfig) {
  return config.provider === 'gemini' ? config.geminiApiKey : config.openrouterApiKey;
}

function normalizeTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text ?? '');
      return '';
    })
    .join('\n')
    .trim();
}

async function blobToBase64(file: Blob) {
  const buffer = await file.arrayBuffer();
  let binary = '';
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
  if (!request.withinHardLimits) {
    const error = new Error(
      `Provider request exceeds limits: ${request.utf8Bytes}/${MAX_PROVIDER_REQUEST_BYTES} bytes, ` +
      `${request.estimatedTokens}/${MAX_PROVIDER_ESTIMATED_TOKENS} estimated tokens`,
    );
    (error as any).status = 413;
    (error as any).payloadMetrics = request;
    throw error;
  }
  const apiKey = getActiveApiKey(config);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.origin,
        'X-Title': 'AI Medley Architect'
      },
      body: request.serializedBody,
      signal
    });

    if (response.ok) return response.json();
    const text = await response.text();
    if (response.status === 429 && attempt === 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          signal?.removeEventListener('abort', abort);
          resolve();
        }, 2_000);
        const abort = () => {
          window.clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        };
        if (signal?.aborted) abort();
        else signal?.addEventListener('abort', abort, { once: true });
      });
      continue;
    }
    const error = new Error(`OpenRouter request failed (${response.status})`);
    (error as any).status = response.status;
    (error as any).rawBody = text;
    (error as any).requestBody = request.requestBody;
    throw error;
  }
  throw new Error('OpenRouter request failed after retry');
}

function createRequestSignal(signal?: AbortSignal, timeoutMs = PROVIDER_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    controller.abort(new DOMException('Provider request timed out', 'TimeoutError'));
  }, timeoutMs);
  const abort = () => controller.abort(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    },
  };
}

async function abortablePromise<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', abort);
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
  if (config.provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const chat = ai.chats.create({
      model: config.model,
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        tools: [{ functionDeclarations: tools as never[] }],
        temperature
      },
      history: (initialHistory as any[]) ?? []
    });

    return {
      async send(message, options) {
        const request = createRequestSignal(options?.signal, options?.timeoutMs);
        try {
          const result = await abortablePromise(
            chat.sendMessage({ message: message as any }),
            request.signal,
          );
          return {
            text: result.text ?? '',
            functionCalls: (result.functionCalls ?? []).map(call => ({
              id: call.id,
              name: call.name,
              args: call.args
            }))
          };
        } catch (error) {
          if (request.signal.aborted && request.signal.reason) throw request.signal.reason;
          throw error;
        } finally {
          request.cleanup();
        }
      },
      getHistory() {
        return chat.getHistory() as unknown[];
      }
    };
  }

  const messages: CategorizedProviderMessage[] = [
    {
      message: { role: 'system', content: systemInstruction },
      category: 'systemPrompt',
    },
    ...((initialHistory as Array<Record<string, unknown>>) ?? []).map(message => ({
      message,
      category: 'messageHistory' as const,
    })),
  ];
  let requestNumber = 0;

  return {
    getHistory() {
      return messages.slice(1).map(item => item.message);
    },
    async send(message, options) {
      if (typeof message === 'string') {
        messages.push({
          message: { role: 'user', content: message },
          category: options?.messageCategory ?? 'stageData',
        });
      } else {
        for (const toolResponse of message) {
          messages.push({
            message: {
              role: 'tool',
              tool_call_id: toolResponse.id,
              content: JSON.stringify(toolResponse.response),
            },
            category: 'toolResults',
          });
        }
      }

      requestNumber++;
      const builtRequest = buildOpenRouterRequest({
        model: config.model,
        temperature,
        messages,
        tools,
      });
      const requestId = options?.requestId ?? `${auditContext?.stage ?? 'provider'}:${requestNumber}`;
      const auditBase: ProviderRequestAudit = {
        requestId,
        stage: auditContext?.stage ?? 'unknown',
        role: auditContext?.role ?? 'unknown',
        model: config.model,
        requestNumber,
        tools: tools.map((tool: any) => String(tool?.function?.name ?? '')).filter(Boolean),
        utf8Bytes: builtRequest.utf8Bytes,
        estimatedTokens: builtRequest.estimatedTokens,
        breakdown: builtRequest.breakdown,
        status: 'measured',
      };
      auditContext?.onRequestAudit?.(auditBase);
      const request = createRequestSignal(options?.signal, options?.timeoutMs);
      let data: any;
      try {
        data = await fetchOpenRouter(config, builtRequest, request.signal);
      } catch (error) {
        if (request.signal.aborted && request.signal.reason) throw request.signal.reason;
        throw error;
      } finally {
        request.cleanup();
      }

      const choice = data?.choices?.[0];
      const assistantMessage = choice?.message ?? {};
      const sanitizedAssistantMessage = sanitizeProviderAssistantMessage({
        ...assistantMessage,
        content: normalizeTextContent(assistantMessage.content),
      });
      messages.push({
        message: sanitizedAssistantMessage,
        category: 'messageHistory',
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
              const parseError = new Error(`Failed to parse tool call arguments for ${call.function?.name}`);
              (parseError as any).rawArguments = rawArgs;
              (parseError as any).toolCall = call;
              throw parseError;
            }
          }

          return {
            id: call.id,
            name: call.function?.name ?? '',
            args: parsedArgs
          };
        });
      }

      const usage = data?.usage;
      auditContext?.onRequestAudit?.({
        ...auditBase,
        actualPromptTokens: usage?.prompt_tokens,
        status: 'completed',
      });

      return {
        text: normalizeTextContent(assistantMessage.content),
        functionCalls,
        usage: usage ? {
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
          total_tokens: usage.total_tokens
        } : undefined
      };
    }
  };
}

export async function analyzeAudioWithProvider(options: AnalyzeAudioOptions) {
  const { config, file, mimeType, displayName, prompt, signal } = options;

  if (config.provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const uploadResult = await ai.files.upload({
      file: file instanceof File ? file : new File([file], displayName, { type: mimeType }),
      config: { mimeType, displayName }
    });

    let fileInfo = uploadResult;
    let attempts = 0;
    while (fileInfo.state === 'PROCESSING' && attempts < 15) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      await new Promise(resolve => setTimeout(resolve, 2000));
      fileInfo = await ai.files.get({ name: uploadResult.name! });
      attempts++;
    }

    if (fileInfo.state !== 'ACTIVE') {
      throw new Error(`Gemini upload failed with state ${fileInfo.state}`);
    }

    const result = await ai.models.generateContent({
      model: config.model,
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { fileData: { fileUri: fileInfo.uri!, mimeType } }
        ]
      }]
    });

    return result.text ?? '';
  }

  const base64Audio = await blobToBase64(file);
  const request = buildOpenRouterRequest({
    model: config.model,
    temperature: config.temperature,
    messages: [{
      category: 'stageData',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'input_audio',
            input_audio: {
              data: base64Audio,
              format: mimeType.split('/')[1] || 'mpeg'
            }
          }
        ]
      },
    }],
    tools: [],
  });
  const data = await fetchOpenRouter(config, request, signal);

  return normalizeTextContent(data?.choices?.[0]?.message?.content);
}
