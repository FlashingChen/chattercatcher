import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureConfigFiles,
  loadConfig,
  loadSecrets,
  maskSecret,
  resetConfigFiles,
} from "../../src/config/store.js";
import {
  appConfigSchema,
  appSecretsSchema,
  createDefaultConfig,
  createDefaultSecrets,
} from "../../src/config/schema.js";

let testHome: string;

async function writeLegacyConfig(config: Record<string, unknown>) {
  await fs.mkdir(testHome, { recursive: true });
  await fs.writeFile(path.join(testHome, "config.json"), JSON.stringify(config), "utf8");
}

async function writeLegacySecrets(secrets: Record<string, unknown>) {
  await fs.mkdir(testHome, { recursive: true });
  await fs.writeFile(path.join(testHome, "secrets.json"), JSON.stringify(secrets), "utf8");
}

describe("config store", () => {
  beforeEach(async () => {
    testHome = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-test-"));
    process.env.CHATTERCATCHER_HOME = testHome;
  });

  afterEach(async () => {
    delete process.env.CHATTERCATCHER_HOME;
    await fs.rm(testHome, { recursive: true, force: true });
  });

  it("创建默认配置和密钥文件", async () => {
    await ensureConfigFiles();

    const config = await loadConfig();
    const secrets = await loadSecrets();

    expect(config.web.host).toBe("127.0.0.1");
    expect(config.web.port).toBe(3878);
    expect(config.storage.dataDir).toBe(path.join(testHome, "data"));
    expect(secrets.llm.apiKey).toBe("");
  });

  it("可以重置配置", async () => {
    await ensureConfigFiles();
    await resetConfigFiles();

    const config = await loadConfig();

    expect(config.feishu.requireMention).toBe(true);
  });

  it("旧配置缺少会话记忆字段时会补默认值", async () => {
    await writeLegacyConfig({
      feishu: { domain: "feishu", appId: "cli_app_id", botOpenId: "", groupPolicy: "open", requireMention: true },
      llm: { baseUrl: "", model: "" },
      embedding: { baseUrl: "", model: "", dimension: null },
      storage: { dataDir: path.join(testHome, "data") },
      web: { host: "127.0.0.1", port: 3878 },
      schedules: { indexing: "*/10 * * * *" },
    });

    const config = await loadConfig();

    expect(config.episodes).toEqual({ windowMinutes: 10, quietMinutes: 2 });
  });

  it("旧配置缺少 multimodal 字段时会补默认值", async () => {
    await writeLegacyConfig({
      feishu: { domain: "feishu", appId: "cli_app_id", botOpenId: "", groupPolicy: "open", requireMention: true },
      llm: { baseUrl: "", model: "" },
      embedding: { baseUrl: "", model: "", dimension: null },
      storage: { dataDir: path.join(testHome, "data") },
      web: { host: "127.0.0.1", port: 3878 },
      schedules: { indexing: "*/10 * * * *" },
      episodes: { windowMinutes: 10, quietMinutes: 2 },
    });

    const config = await loadConfig();

    expect(config.multimodal).toEqual({ baseUrl: "", model: "" });
  });

  it("旧密钥缺少 multimodal 字段时会补默认值", async () => {
    await writeLegacySecrets({
      feishu: { appSecret: "legacy-feishu-secret" },
      llm: { apiKey: "legacy-llm-key" },
      embedding: { apiKey: "legacy-embedding-key" },
    });

    const secrets = await loadSecrets();

    expect(secrets.multimodal).toEqual({ apiKey: "" });
  });

  it("打印密钥时会脱敏", () => {
    expect(maskSecret("")).toBe("");
    expect(maskSecret("short")).toBe("********");
    expect(maskSecret("sk-1234567890")).toBe("sk-1...7890");
  });
});

describe("multimodal config", () => {
  it("defaults multimodal config and secret to empty values", () => {
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();

    expect(config.multimodal).toEqual({ baseUrl: "", model: "" });
    expect(secrets.multimodal).toEqual({ apiKey: "" });
  });

  it("parses explicit multimodal config", () => {
    const config = appConfigSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      storage: {},
      web: {},
      schedules: {},
      episodes: {},
      multimodal: { baseUrl: "https://api.example.com/v1", model: "vision-model" },
    });
    const secrets = appSecretsSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      multimodal: { apiKey: "vision-key" },
    });

    expect(config.multimodal.baseUrl).toBe("https://api.example.com/v1");
    expect(config.multimodal.model).toBe("vision-model");
    expect(secrets.multimodal.apiKey).toBe("vision-key");
  });

  it("parses omitted or null multimodal to default values", () => {
    const omittedConfig = appConfigSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      storage: {},
      web: {},
      schedules: {},
      episodes: {},
    });
    const nullConfig = appConfigSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      storage: {},
      web: {},
      schedules: {},
      episodes: {},
      multimodal: null,
    });
    const omittedSecrets = appSecretsSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
    });
    const nullSecrets = appSecretsSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      multimodal: null,
    });

    expect(omittedConfig.multimodal).toEqual({ baseUrl: "", model: "" });
    expect(nullConfig.multimodal).toEqual({ baseUrl: "", model: "" });
    expect(omittedSecrets.multimodal).toEqual({ apiKey: "" });
    expect(nullSecrets.multimodal).toEqual({ apiKey: "" });
  });
});

describe("transcription config", () => {
  it("defaults transcription config and secret to empty values", () => {
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();

    expect(config.transcription).toEqual({ baseUrl: "", model: "" });
    expect(secrets.transcription).toEqual({ apiKey: "" });
  });

  it("parses explicit transcription config", () => {
    const config = appConfigSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      storage: {},
      web: {},
      schedules: {},
      episodes: {},
      multimodal: {},
      transcription: { baseUrl: "https://api.example.com/v1", model: "whisper-model" },
    });
    const secrets = appSecretsSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      multimodal: {},
      transcription: { apiKey: "transcribe-key" },
    });

    expect(config.transcription.baseUrl).toBe("https://api.example.com/v1");
    expect(config.transcription.model).toBe("whisper-model");
    expect(secrets.transcription.apiKey).toBe("transcribe-key");
  });

  it("parses omitted or null transcription to default values", () => {
    const omittedConfig = appConfigSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      storage: {},
      web: {},
      schedules: {},
      episodes: {},
      multimodal: {},
    });
    const nullConfig = appConfigSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      storage: {},
      web: {},
      schedules: {},
      episodes: {},
      multimodal: {},
      transcription: null,
    });
    const omittedSecrets = appSecretsSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      multimodal: {},
    });
    const nullSecrets = appSecretsSchema.parse({
      feishu: {},
      llm: {},
      embedding: {},
      multimodal: {},
      transcription: null,
    });

    expect(omittedConfig.transcription).toEqual({ baseUrl: "", model: "" });
    expect(nullConfig.transcription).toEqual({ baseUrl: "", model: "" });
    expect(omittedSecrets.transcription).toEqual({ apiKey: "" });
    expect(nullSecrets.transcription).toEqual({ apiKey: "" });
  });
});
