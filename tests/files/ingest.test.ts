import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { ingestLocalFile } from "../../src/files/ingest.js";
import { FileJobRepository } from "../../src/files/jobs.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { MessageFtsRetriever } from "../../src/rag/message-retriever.js";
import { createDocxBuffer } from "./docx-fixture.js";

let testDir: string;

describe("local file ingest", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-files-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("保存文本文件并写入 RAG 检索库", async () => {
    const sourcePath = path.join(testDir, "activity.md");
    await fs.writeFile(sourcePath, "# 活动安排\n\n端午活动改到 2026/6/30，以这个为准。", "utf8");

    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      const jobs = new FileJobRepository(database);
      const result = await ingestLocalFile({ config, messages, jobs, filePath: sourcePath });

      expect(result.fileName).toBe("activity.md");
      expect(result.parser).toBe("text");
      expect(result.characters).toBeGreaterThan(0);
      expect(jobs.list()[0]).toMatchObject({ status: "indexed", parser: "text" });
      await expect(fs.stat(result.storedPath)).resolves.toBeTruthy();

      const evidence = await new MessageFtsRetriever(messages).retrieve("端午活动什么时候");
      expect(evidence[0]).toMatchObject({
        source: {
          type: "file",
          label: "activity.md",
        },
      });
      expect(evidence[0]?.text).toContain("2026/6/30");
    } finally {
      database.close();
    }
  });

  it("拒绝暂不支持的扩展名并记录失败任务", async () => {
    const sourcePath = path.join(testDir, "scan.exe");
    await fs.writeFile(sourcePath, "fake", "utf8");

    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const database = openDatabase(config);

    try {
      const jobs = new FileJobRepository(database);
      await expect(
        ingestLocalFile({ config, messages: new MessageRepository(database), jobs, filePath: sourcePath }),
      ).rejects.toThrow("暂不支持该文件类型");
      expect(jobs.list()[0]).toMatchObject({ status: "failed" });
    } finally {
      database.close();
    }
  });

  it("解析 DOCX 后写入 RAG 检索库", async () => {
    const sourcePath = path.join(testDir, "activity.docx");
    await fs.writeFile(sourcePath, await createDocxBuffer("附件里写着端午活动改到 2026/6/30。"));

    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      const result = await ingestLocalFile({ config, messages, filePath: sourcePath });
      const evidence = await new MessageFtsRetriever(messages).retrieve("附件端午活动");

      expect(result.parser).toBe("docx");
      expect(evidence.some((item) => item.source.type === "file" && item.text.includes("2026/6/30"))).toBe(true);
    } finally {
      database.close();
    }
  });

  it("ingest 时记录内容 sha256 与飞书 file_key，重复 ingest 同路径 ID 不变", async () => {
    const sourcePath = path.join(testDir, "note.md");
    const content = "写下来：端午活动改到 2026/6/30。\n";
    await fs.writeFile(sourcePath, content, "utf8");

    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      const jobs = new FileJobRepository(database);
      const first = await ingestLocalFile({
        config,
        messages,
        jobs,
        filePath: sourcePath,
        platformFileKey: "file_v2_from_feishu",
      });

      const expectedSha = crypto.createHash("sha256").update(content).digest("hex");
      expect(first.contentSha256).toBe(expectedSha);
      expect(first.platformFileKey).toBe("file_v2_from_feishu");
      expect(jobs.get(first.jobId!)).toMatchObject({
        contentSha256: expectedSha,
        platformFileKey: "file_v2_from_feishu",
      });

      const second = await ingestLocalFile({ config, messages, jobs, filePath: sourcePath });
      expect(second.jobId).toBe(first.jobId);
      expect(second.messageId).toBe(first.messageId);
      expect(messages.getMessageCount()).toBe(1);
    } finally {
      database.close();
    }
  });
});
