import { GoogleGenAI } from '@google/genai';
import type { MedleyConfig } from '../components/ConfigPanel';

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
  send: (message: string | ProviderToolResponse[]) => Promise<ProviderResponse>;
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

async function fetchOpenRouter(config: MedleyConfig, body: Record<string, unknown>, signal?: AbortSignal) {
  const apiKey = getActiveApiKey(config);
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.origin,
      'X-Title': 'AI Medley Architect'
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`OpenRouter request failed (${response.status})`);
    (error as any).status = response.status;
    (error as any).rawBody = text;
    (error as any).requestBody = body; // for debugging
    throw error;
  }

  return response.json();
}

export function createProviderSession(
  config: MedleyConfig,
  systemInstruction: string,
  tools: unknown[],
  temperature: number
): ProviderSession {
  if (config.provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const chat = ai.chats.create({
      model: config.model,
      config: {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        tools: [{ functionDeclarations: tools as never[] }],
        temperature
      }
    });

    return {
      async send(message) {
        const result = await chat.sendMessage({ message: message as any });
        return {
          text: result.text ?? '',
          functionCalls: (result.functionCalls ?? []).map(call => ({
            id: call.id,
            name: call.name,
            args: call.args
          }))
        };
      }
    };
  }

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemInstruction }
  ];

  return {
    async send(message) {
      if (typeof message === 'string') {
        messages.push({ role: 'user', content: message });
      } else {
        for (const toolResponse of message) {
          messages.push({
            role: 'tool',
            tool_call_id: toolResponse.id,
            content: JSON.stringify(toolResponse.response)
          });
        }
      }

      const data = await fetchOpenRouter(config, {
        model: config.model,
        temperature,
        messages,
        tools,
        tool_choice: 'auto'
      });

      const choice = data?.choices?.[0];
      const assistantMessage = choice?.message ?? {};
      messages.push(assistantMessage);

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
  const data = await fetchOpenRouter(config, {
    model: config.model,
    temperature: config.temperature,
    messages: [{
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
    }]
  }, signal);

  return normalizeTextContent(data?.choices?.[0]?.message?.content);
}
