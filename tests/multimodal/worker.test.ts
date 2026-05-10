import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { EpisodeRepository } from "../../src/episodes/repository.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { ImageMultimodalTaskRepository } from "../../src/multimodal/tasks.js";
import type { MultimodalModel } from "../../src/multimodal/types.js";
import { ImageMultimodalWorker } from "../../src/multimodal/worker.js";

let testDir: string;

describe("ImageMultimodalWorker", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-image-worker-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("处理有意义图片任务并创建派生消息、索引和刷新记忆", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.episodes.windowMinutes = 10;
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const episodes = new EpisodeRepository(database);
    const tasks = new ImageMultimodalTaskRepository(database);

    try {
      const sourceMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "image-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "image",
        text: "[图片] img-1",
        sentAt: "2026-05-01T10:00:00.000Z",
      });
      await episodes.summarizeReadyWindows({
        now: new Date("2026-05-01T10:04:00.000Z"),
        quietMs: 2 * 60 * 1000,
        windowMs: 10 * 60 * 1000,
        summarize: async () => "原摘要。",
      });
      const task = tasks.enqueue({
        sourceMessageId,
        platformMessageId: "image-1",
        imageKey: "img-1",
        storedPath: path.join(testDir, "order-code.jpg"),
        mimeType: "image/jpeg",
      });
      const indexedMessageIds: string[] = [];
      const model: MultimodalModel = {
        async describeImage(input) {
          expect(input).toMatchObject({ imagePath: path.join(testDir, "order-code.jpg"), mimeType: "image/jpeg", context: "图片文件名：order-code.jpg" });
          return { summary: "文件名：order-code.jpg。白板写着 5 月 10 日上线图片多模态功能。", isMeaningful: true, reason: "包含计划" };
        },
      };

      const result = await new ImageMultimodalWorker({
        config,
        messages,
        episodes,
        tasks,
        model,
        multimodalModelName: "vision",
        vectorIndexMessage: async (messageId) => {
          indexedMessageIds.push(messageId);
          return { chunks: 1, vectors: 1 };
        },
        summarizeEpisode: async (window) => {
          expect(window.messages.map((message) => message.text)).toEqual([
            "[图片] img-1",
            "[图片转述] 文件名：order-code.jpg\n文件名：order-code.jpg。白板写着 5 月 10 日上线图片多模态功能。",
          ]);
          return "图片转述说明 order-code.jpg 里白板写着 5 月 10 日上线图片多模态功能。";
        },
      }).processPending();

      const updatedTask = tasks.getById(task.id);
      const derived = messages.searchMessages("多模态")[0];

      expect(result).toEqual({ processed: 1, succeeded: 1, skipped: 0, failed: 0 });
      expect(derived).toMatchObject({ messageType: "image_summary" });
      expect(indexedMessageIds).toEqual([derived?.messageId]);
      expect(updatedTask).toMatchObject({ status: "succeeded", derivedMessageId: derived?.messageId });
      expect(episodes.listRecentEpisodes(1)[0]?.summary).toContain("order-code.jpg");
    } finally {
      database.close();
    }
  });

  it("跳过无意义图片且失败最多重试三次", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const tasks = new ImageMultimodalTaskRepository(database);

    try {
      const sourceMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "image-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "image",
        text: "[图片] img-1",
        sentAt: "2026-05-01T10:00:00.000Z",
      });
      const skippedTask = tasks.enqueue({
        sourceMessageId,
        platformMessageId: "image-1",
        imageKey: "img-skip",
        storedPath: "/tmp/skip.jpg",
        mimeType: "image/jpeg",
      });
      const failingTask = tasks.enqueue({
        sourceMessageId,
        platformMessageId: "image-1",
        imageKey: "img-fail",
        storedPath: "/tmp/fail.jpg",
        mimeType: "image/jpeg",
      });
      let failures = 0;
      const model: MultimodalModel = {
        async describeImage(input) {
          if (input.imagePath.includes("skip")) {
            return { summary: "普通表情包", isMeaningful: false, reason: "无事实信息" };
          }
          failures += 1;
          throw new Error("vision timeout");
        },
      };
      const worker = new ImageMultimodalWorker({
        config,
        messages,
        tasks,
        model,
        multimodalModelName: "vision",
      });

      const first = await worker.processPending(10);
      const second = await worker.processPending(10);
      const third = await worker.processPending(10);

      expect(first).toEqual({ processed: 2, succeeded: 0, skipped: 1, failed: 1 });
      expect(second).toEqual({ processed: 1, succeeded: 0, skipped: 0, failed: 1 });
      expect(third).toEqual({ processed: 1, succeeded: 0, skipped: 0, failed: 1 });
      expect(tasks.getById(skippedTask.id)).toMatchObject({ status: "skipped", attempts: 1, lastError: "无事实信息" });
      expect(tasks.getById(failingTask.id)).toMatchObject({ status: "failed", attempts: 3, lastError: "vision timeout" });
      expect(messages.getMessageCount()).toBe(1);
      expect(failures).toBe(3);
    } finally {
      database.close();
    }
  });

  it("忽略已被其他 worker 抢占的 pending 快照", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const tasks = new ImageMultimodalTaskRepository(database);

    try {
      const sourceMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "image-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "image",
        text: "[图片] img-1",
        sentAt: "2026-05-01T10:00:00.000Z",
      });
      const task = tasks.enqueue({
        sourceMessageId,
        platformMessageId: "image-1",
        imageKey: "img-race",
        storedPath: "/tmp/race.jpg",
        mimeType: "image/jpeg",
      });
      tasks.markRunning(task.id);
      const staleTasks = {
        ...tasks,
        listPending: () => [task],
        markRunning: tasks.markRunning.bind(tasks),
        markSucceeded: tasks.markSucceeded.bind(tasks),
        markSkipped: tasks.markSkipped.bind(tasks),
        markFailed: tasks.markFailed.bind(tasks),
      } as unknown as ImageMultimodalTaskRepository;
      const model: MultimodalModel = {
        async describeImage() {
          throw new Error("不应处理已抢占任务");
        },
      };

      const result = await new ImageMultimodalWorker({
        config,
        messages,
        tasks: staleTasks,
        model,
        multimodalModelName: "vision",
      }).processPending();

      expect(result).toEqual({ processed: 1, succeeded: 0, skipped: 0, failed: 0 });
      expect(messages.getMessageCount()).toBe(1);
    } finally {
      database.close();
    }
  });

  it("并发处理同一批 pending 任务时跳过已被抢占的任务", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const tasks = new ImageMultimodalTaskRepository(database);

    try {
      const sourceMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "image-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "image",
        text: "[图片] img-1",
        sentAt: "2026-05-01T10:00:00.000Z",
      });
      tasks.enqueue({
        sourceMessageId,
        platformMessageId: "image-1",
        imageKey: "img-race",
        storedPath: "/tmp/race.jpg",
        mimeType: "image/jpeg",
      });
      const model: MultimodalModel = {
        async describeImage() {
          return { summary: "白板写着并发处理完成。", isMeaningful: true };
        },
      };
      const firstWorker = new ImageMultimodalWorker({ config, messages, tasks, model, multimodalModelName: "vision" });
      const secondWorker = new ImageMultimodalWorker({ config, messages, tasks, model, multimodalModelName: "vision" });

      const [first, second] = await Promise.all([firstWorker.processPending(), secondWorker.processPending()]);

      expect(first.succeeded + second.succeeded).toBe(1);
      expect(first.failed + second.failed).toBe(0);
      expect(messages.searchMessages("并发")).toHaveLength(1);
      expect(tasks.listPending()).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
