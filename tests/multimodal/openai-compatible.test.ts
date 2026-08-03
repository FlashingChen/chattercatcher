import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { OpenAICompatibleMultimodalModel, createMultimodalModel } from "../../src/multimodal/openai-compatible.js";

describe("OpenAICompatibleMultimodalModel", () => {
  let tempDir: string;
  let imagePath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-multimodal-"));
    imagePath = path.join(tempDir, "image.jpg");
    await fs.writeFile(imagePath, Buffer.from([1, 2, 3]));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("sends a local image as OpenAI-compatible multimodal content", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "白板上写着发布计划",
                  isMeaningful: true,
                  reason: "包含计划信息",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const model = new OpenAICompatibleMultimodalModel({
      baseUrl: "https://example.test/v1/",
      apiKey: "vision-key",
      model: "vision",
    });

    const result = await model.describeImage({ imagePath, mimeType: "image/jpeg", context: "发布会讨论" });

    expect(result).toEqual({
      summary: "白板上写着发布计划",
      isMeaningful: true,
      reason: "包含计划信息",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer vision-key" }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("vision");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("发布会讨论") }),
      { type: "image_url", image_url: { url: "data:image/jpeg;base64,AQID" } },
    ]);
  });

  it("rejects empty summaries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ summary: "", isMeaningful: true }) } }],
        }),
        { status: 200 },
      ),
    );
    const model = new OpenAICompatibleMultimodalModel({
      baseUrl: "https://example.test/v1",
      apiKey: "vision-key",
      model: "vision",
    });

    await expect(model.describeImage({ imagePath, mimeType: "image/jpeg" })).rejects.toThrow(
      "多模态模型返回的 summary 为空。",
    );
  });

  it("rejects invalid model output", async () => {
    const model = new OpenAICompatibleMultimodalModel({
      baseUrl: "https://example.test/v1",
      apiKey: "vision-key",
      model: "vision",
    });

    for (const content of [
      "not-json",
      JSON.stringify({ summary: "有效摘要", isMeaningful: "yes" }),
      JSON.stringify(null),
      "",
    ]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
      );

      await expect(model.describeImage({ imagePath, mimeType: "image/jpeg" })).rejects.toThrow(/多模态模型/);
    }
  });

  it("preserves response status and body on request failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("quota exceeded", { status: 429 }));
    const model = new OpenAICompatibleMultimodalModel({
      baseUrl: "https://example.test/v1",
      apiKey: "vision-key",
      model: "vision",
    });

    await expect(model.describeImage({ imagePath, mimeType: "image/jpeg" })).rejects.toThrow(
      "多模态请求失败：429 quota exceeded",
    );
  });

  it("creates a model from multimodal config and secrets", async () => {
    const config = createDefaultConfig();
    config.multimodal.baseUrl = "https://example.test/v1";
    config.multimodal.model = "vision";
    const secrets = createDefaultSecrets();
    secrets.multimodal.apiKey = "vision-key";

    const model = createMultimodalModel(config, secrets);

    expect(model).toBeInstanceOf(OpenAICompatibleMultimodalModel);
  });

  it("parses extractedText from the multimodal response and requires it in the prompt", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "截图里有行程表",
                  isMeaningful: true,
                  extractedText: "8月10日 上午9:00 家长会",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const model = new OpenAICompatibleMultimodalModel({
      baseUrl: "https://example.test/v1",
      apiKey: "vision-key",
      model: "vision",
    });

    const result = await model.describeImage({ imagePath, mimeType: "image/jpeg" });

    expect(result).toEqual({
      summary: "截图里有行程表",
      isMeaningful: true,
      extractedText: "8月10日 上午9:00 家长会",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const prompt = body.messages[0].content[0].text as string;
    expect(prompt).toContain("extractedText");
    expect(prompt).toContain("原样提取");
  });

  it("omits extractedText when the response omits or empties it", async () => {
    const model = new OpenAICompatibleMultimodalModel({
      baseUrl: "https://example.test/v1",
      apiKey: "vision-key",
      model: "vision",
    });

    for (const content of [
      JSON.stringify({ summary: "无文字截图", isMeaningful: true }),
      JSON.stringify({ summary: "无文字截图", isMeaningful: true, extractedText: "" }),
      JSON.stringify({ summary: "无文字截图", isMeaningful: true, extractedText: "   " }),
    ]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 }),
      );

      const result = await model.describeImage({ imagePath, mimeType: "image/jpeg" });
      expect(result.extractedText).toBeUndefined();
      expect(result.summary).toBe("无文字截图");
    }
  });

  it("rejects a non-string extractedText", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ summary: "有文字", isMeaningful: true, extractedText: 42 }) } }],
        }),
        { status: 200 },
      ),
    );
    const model = new OpenAICompatibleMultimodalModel({
      baseUrl: "https://example.test/v1",
      apiKey: "vision-key",
      model: "vision",
    });

    await expect(model.describeImage({ imagePath, mimeType: "image/jpeg" })).rejects.toThrow(
      "extractedText 不是字符串",
    );
  });
});
