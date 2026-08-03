import fs from "node:fs/promises";
import path from "node:path";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { TranscribeAudioInput, TranscribeAudioResult, TranscriptionModel } from "./audio-types.js";

export interface OpenAICompatibleTranscriptionOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface TranscriptionResponse {
  text?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export class OpenAICompatibleTranscriptionModel implements TranscriptionModel {
  constructor(private readonly options: OpenAICompatibleTranscriptionOptions) {}

  async transcribe(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    if (!this.options.baseUrl || !this.options.apiKey || !this.options.model) {
      throw new Error("转写配置不完整。请运行 chattercatcher setup 或 chattercatcher settings。");
    }

    const audio = await fs.readFile(input.audioPath);
    const form = new FormData();
    form.append("model", this.options.model);
    form.append(
      "file",
      new Blob([audio], { type: input.mimeType }),
      path.basename(input.audioPath),
    );

    const response = await fetch(`${normalizeBaseUrl(this.options.baseUrl)}/audio/transcriptions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: form,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`转写请求失败：${response.status} ${body}`);
    }

    const data = (await response.json()) as TranscriptionResponse;
    const text = typeof data.text === "string" ? data.text.trim() : "";
    if (!text) {
      throw new Error("转写模型返回为空。");
    }

    return { text };
  }
}

export function createTranscriptionModel(config: AppConfig, secrets: AppSecrets): OpenAICompatibleTranscriptionModel {
  return new OpenAICompatibleTranscriptionModel({
    baseUrl: config.transcription.baseUrl,
    apiKey: secrets.transcription.apiKey,
    model: config.transcription.model,
  });
}
