import fs from "node:fs/promises";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { DescribeImageInput, DescribeImageResult, MultimodalModel } from "./types.js";

export interface OpenAICompatibleMultimodalOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

interface MultimodalCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function buildPrompt(context?: string): string {
  const contextText = context?.trim();
  return [
    "请理解这张图片，判断它是否包含值得进入知识库和会话记忆的有意义信息。",
    "请只输出 JSON，格式为 {\"summary\": string, \"isMeaningful\": boolean, \"reason\": string}。",
    "summary 使用简洁中文转述图片中的关键信息；无意义图片也要给出简短 summary。",
    "如果上下文提供了图片文件名，summary 必须原样包含该文件名，便于之后按文件名检索和发送图片。",
    contextText ? `上下文：${contextText}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
}

function parseDescribeImageResult(content: string): DescribeImageResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new Error("多模态模型返回的 JSON 无法解析。");
  }

  if (!data || typeof data !== "object") {
    throw new Error("多模态模型返回格式不正确。");
  }

  const result = data as Record<string, unknown>;
  const summary = typeof result.summary === "string" ? result.summary.trim() : "";
  if (!summary) {
    throw new Error("多模态模型返回的 summary 为空。");
  }
  if (typeof result.isMeaningful !== "boolean") {
    throw new Error("多模态模型返回的 isMeaningful 不是布尔值。");
  }

  const reason = typeof result.reason === "string" ? result.reason.trim() : "";
  return {
    summary,
    isMeaningful: result.isMeaningful,
    ...(reason ? { reason } : {}),
  };
}

export class OpenAICompatibleMultimodalModel implements MultimodalModel {
  constructor(private readonly options: OpenAICompatibleMultimodalOptions) {}

  async describeImage(input: DescribeImageInput): Promise<DescribeImageResult> {
    if (!this.options.baseUrl || !this.options.apiKey || !this.options.model) {
      throw new Error("多模态配置不完整。请运行 chattercatcher setup 或 chattercatcher settings。");
    }

    const image = await fs.readFile(input.imagePath);
    const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.options.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: buildPrompt(input.context) },
              { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${image.toString("base64")}` } },
            ],
          },
        ],
        response_format: { type: "json_object" },
        temperature: this.options.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`多模态请求失败：${response.status} ${body}`);
    }

    const data = (await response.json()) as MultimodalCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error("多模态模型返回为空。");
    }

    return parseDescribeImageResult(content);
  }
}

export function createMultimodalModel(config: AppConfig, secrets: AppSecrets): OpenAICompatibleMultimodalModel {
  return new OpenAICompatibleMultimodalModel({
    baseUrl: config.multimodal.baseUrl,
    apiKey: secrets.multimodal.apiKey,
    model: config.multimodal.model,
  });
}
