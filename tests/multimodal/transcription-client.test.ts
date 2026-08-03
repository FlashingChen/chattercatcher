import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import {
  createTranscriptionModel,
  OpenAICompatibleTranscriptionModel,
} from "../../src/multimodal/transcription-client.js";

describe("OpenAICompatibleTranscriptionModel", () => {
  let tempDir: string;
  let audioPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-transcription-"));
    audioPath = path.join(tempDir, "voice.mp3");
    await fs.writeFile(audioPath, Buffer.from([1, 2, 3]));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("sends the audio file to /audio/transcriptions as multipart form data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "今晚记得带水杯。" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const model = new OpenAICompatibleTranscriptionModel({
      baseUrl: "https://example.test/v1/",
      apiKey: "transcribe-key",
      model: "whisper",
    });

    const result = await model.transcribe({ audioPath, mimeType: "audio/mpeg" });

    expect(result).toEqual({ text: "今晚记得带水杯。" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer transcribe-key" }),
      }),
    );
    const form = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    expect(form.get("model")).toBe("whisper");
    const file = form.get("file") as File;
    expect(file.name).toBe("voice.mp3");
    expect(file.type).toBe("audio/mpeg");
  });

  it("rejects empty transcripts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ text: "" }), { status: 200 }),
    );
    const model = new OpenAICompatibleTranscriptionModel({
      baseUrl: "https://example.test/v1",
      apiKey: "transcribe-key",
      model: "whisper",
    });

    await expect(model.transcribe({ audioPath, mimeType: "audio/mpeg" })).rejects.toThrow("转写模型返回为空。");
  });

  it("preserves response status and body on request failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("quota exceeded", { status: 429 }));
    const model = new OpenAICompatibleTranscriptionModel({
      baseUrl: "https://example.test/v1",
      apiKey: "transcribe-key",
      model: "whisper",
    });

    await expect(model.transcribe({ audioPath, mimeType: "audio/mpeg" })).rejects.toThrow(
      "转写请求失败：429 quota exceeded",
    );
  });

  it("requires complete transcription config", async () => {
    const model = new OpenAICompatibleTranscriptionModel({
      baseUrl: "",
      apiKey: "",
      model: "",
    });

    await expect(model.transcribe({ audioPath, mimeType: "audio/mpeg" })).rejects.toThrow(
      "转写配置不完整。",
    );
  });

  it("creates a model from transcription config and secrets", () => {
    const config = createDefaultConfig();
    config.transcription.baseUrl = "https://example.test/v1";
    config.transcription.model = "whisper";
    const secrets = createDefaultSecrets();
    secrets.transcription.apiKey = "transcribe-key";

    const model = createTranscriptionModel(config, secrets);

    expect(model).toBeInstanceOf(OpenAICompatibleTranscriptionModel);
  });
});
