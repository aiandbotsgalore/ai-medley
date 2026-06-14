import {
  MAX_PROVIDER_ESTIMATED_TOKENS,
  MAX_PROVIDER_REQUEST_BYTES,
} from '../types/specialistWorkflow';

export type ProviderMessageCategory =
  | 'systemPrompt'
  | 'stageData'
  | 'messageHistory'
  | 'toolResults'
  | 'repairErrors';

export type CategorizedProviderMessage = {
  message: Record<string, unknown>;
  category: ProviderMessageCategory;
};

export type ProviderRequestBreakdown = Record<
  'systemPrompt' | 'stageData' | 'toolSchemas' | 'messageHistory' | 'toolResults' | 'repairErrors' | 'requestEnvelope',
  { utf8Bytes: number; estimatedTokens: number }
>;

export type BuiltProviderRequest = {
  requestBody: Record<string, unknown>;
  serializedBody: string;
  utf8Bytes: number;
  estimatedTokens: number;
  withinHardLimits: boolean;
  breakdown: ProviderRequestBreakdown;
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
  status: 'measured' | 'completed';
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

export function buildOpenRouterRequest(input: {
  model: string;
  temperature: number;
  messages: CategorizedProviderMessage[];
  tools: unknown[];
}): BuiltProviderRequest {
  const requestBody = {
    model: input.model,
    temperature: input.temperature,
    messages: input.messages.map(item => item.message),
    tools: input.tools,
    tool_choice: 'auto',
  };
  const serializedBody = JSON.stringify(requestBody);
  const total = measureSerialized(serializedBody);
  const messagesByCategory = (category: ProviderMessageCategory) =>
    input.messages.filter(item => item.category === category).map(item => item.message);
  const breakdown: ProviderRequestBreakdown = {
    systemPrompt: measureValue(messagesByCategory('systemPrompt')),
    stageData: measureValue(messagesByCategory('stageData')),
    toolSchemas: measureValue(input.tools),
    messageHistory: measureValue(messagesByCategory('messageHistory')),
    toolResults: measureValue(messagesByCategory('toolResults')),
    repairErrors: measureValue(messagesByCategory('repairErrors')),
    requestEnvelope: measureValue({
      model: input.model,
      temperature: input.temperature,
      tool_choice: 'auto',
    }),
  };

  return {
    requestBody,
    serializedBody,
    utf8Bytes: total.utf8Bytes,
    estimatedTokens: total.estimatedTokens,
    withinHardLimits:
      total.utf8Bytes <= MAX_PROVIDER_REQUEST_BYTES &&
      total.estimatedTokens <= MAX_PROVIDER_ESTIMATED_TOKENS,
    breakdown,
  };
}

export function largestRequestComponent(breakdown: ProviderRequestBreakdown) {
  return Object.entries(breakdown)
    .sort((a, b) => b[1].utf8Bytes - a[1].utf8Bytes)[0];
}

export function sanitizeProviderAssistantMessage(message: any): Record<string, unknown> {
  const content = typeof message?.content === 'string'
    ? message.content.slice(0, 2_000)
    : null;
  const sanitized: Record<string, unknown> = {
    role: 'assistant',
    content: content || null,
  };
  if (!Array.isArray(message?.tool_calls)) return sanitized;
  sanitized.tool_calls = message.tool_calls.map((call: any) => {
    const name = String(call?.function?.name ?? '');
    const raw = call?.function?.arguments;
    let args = typeof raw === 'string' ? raw : JSON.stringify(raw ?? {});
    if (name === 'submit_execution_report') {
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {});
        args = JSON.stringify({
          schemaVersion: parsed.schemaVersion,
          executionVersion: parsed.executionVersion,
          arrangementVersion: parsed.arrangementVersion,
          attemptedTransitionCount: Array.isArray(parsed.attemptedTransitions)
            ? parsed.attemptedTransitions.length
            : 0,
        });
      } catch {
        args = '{}';
      }
    }
    return {
      id: String(call?.id ?? ''),
      type: 'function',
      function: { name, arguments: args },
    };
  });
  return sanitized;
}
