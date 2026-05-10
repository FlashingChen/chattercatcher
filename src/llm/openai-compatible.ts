import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { EmbeddingModel } from "../rag/embedding.js";
import type { ChatMessage, ChatModel, ChatTool, ToolCall, ToolChatResult } from "../rag/types.js";

export interface OpenAICompatibleChatOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

interface OpenAICompatibleMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: OpenAICompatibleMessage & { reasoning_content?: string };
  }>;
}

interface EmbeddingResponse {
  data?: Array<{
    embedding?: number[];
  }>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function toOpenAIMessage(message: ChatMessage): OpenAICompatibleMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls
      ? {
          tool_calls: message.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: "function" as const,
            function: {
              name: toolCall.name,
              arguments: JSON.stringify(toolCall.input),
            },
          })),
        }
      : {}),
    ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {}),
  };
}

function toOpenAITool(tool: ChatTool): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
} {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function parseToolCalls(message?: OpenAICompatibleMessage): ToolCall[] {
  return (
    message?.tool_calls?.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function.name,
      input: JSON.parse(toolCall.function.arguments),
    })) ?? []
  );
}

export class OpenAICompatibleChatModel implements ChatModel {
  constructor(private readonly options: OpenAICompatibleChatOptions) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    if (!this.options.baseUrl || !this.options.apiKey || !this.options.model) {
      throw new Error("LLM 配置不完整。请运行 chattercatcher setup 或 chattercatcher settings。");
    }

    const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: messages.map(toOpenAIMessage),
        temperature: this.options.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM 请求失败：${response.status} ${body}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;
    const content = message?.content?.trim();
    if (!content) {
      throw new Error("LLM 返回为空。");
    }

    return content;
  }

  async completeWithTools(messages: ChatMessage[], tools: ChatTool[]): Promise<ToolChatResult> {
    if (!this.options.baseUrl || !this.options.apiKey || !this.options.model) {
      throw new Error("LLM 配置不完整。请运行 chattercatcher setup 或 chattercatcher settings。");
    }

    const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: messages.map(toOpenAIMessage),
        tools: tools.map(toOpenAITool),
        tool_choice: "auto",
        temperature: this.options.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`LLM 请求失败：${response.status} ${body}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const message = data.choices?.[0]?.message;

    return {
      content: message?.content ?? "",
      toolCalls: parseToolCalls(message),
      reasoningContent: message?.reasoning_content ?? undefined,
    };
  }
}

export interface OpenAICompatibleEmbeddingOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export class OpenAICompatibleEmbeddingModel implements EmbeddingModel {
  constructor(private readonly options: OpenAICompatibleEmbeddingOptions) {}

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector ?? [];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.options.baseUrl || !this.options.apiKey || !this.options.model) {
      throw new Error("Embedding 配置不完整。请运行 chattercatcher setup 或 chattercatcher settings。");
    }

    const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        input: texts,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Embedding 请求失败：${response.status} ${body}`);
    }

    const data = (await response.json()) as EmbeddingResponse;
    return data.data?.map((item) => item.embedding ?? []) ?? [];
  }
}

export function createChatModel(config: AppConfig, secrets: AppSecrets): OpenAICompatibleChatModel {
  return new OpenAICompatibleChatModel({
    baseUrl: config.llm.baseUrl,
    apiKey: secrets.llm.apiKey,
    model: config.llm.model,
  });
}

export function createEmbeddingModel(config: AppConfig, secrets: AppSecrets): OpenAICompatibleEmbeddingModel {
  return new OpenAICompatibleEmbeddingModel({
    baseUrl: config.embedding.baseUrl || config.llm.baseUrl,
    apiKey: secrets.embedding.apiKey || secrets.llm.apiKey,
    model: config.embedding.model,
  });
}
