import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { EpisodeRepository } from "../../src/episodes/repository.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { AudioTranscriptionTaskRepository } from "../../src/multimodal/audio-tasks.js";
import type { TranscriptionModel } from "../../src/multimodal/audio-types.js";
import { AudioTranscriptionWorker } from "../../src/multimodal/audio-worker.js";

let testDir: string;

describe("AudioTranscriptionWorker", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-audio-worker-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("处理语音任务并把 API 返回的转写文本写进派生消息、索引和刷新记忆", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.episodes.windowMinutes = 10;
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const episodes = new EpisodeRepository(database);
    const tasks = new AudioTranscriptionTaskRepository(database);

    try {
      const sourceMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "audio-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "audio",
        text: "[语音] voice-1",
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
        platformMessageId: "audio-1",
        audioKey: "audio-1",
        storedPath: path.join(testDir, "voice.mp3"),
        mimeType: "audio/mpeg",
      });
      const indexedMessageIds: string[] = [];
      const model: TranscriptionModel = {
        async transcribe(input) {
          expect(input).toMatchObject({ audioPath: path.join(testDir, "voice.mp3"), mimeType: "audio/mpeg" });
          return { text: "今晚记得带水杯。" };
        },
      };

      const result = await new AudioTranscriptionWorker({
        config,
        messages,
        episodes,
        tasks,
        model,
        transcriptionModelName: "whisper",
        vectorIndexMessage: async (messageId) => {
          indexedMessageIds.push(messageId);
          return { chunks: 1, vectors: 1 };
        },
        summarizeEpisode: async (window) => {
          expect(window.messages.map((message) => message.text)).toEqual([
            "[语音] voice-1",
            "[语音转写] 文件名：voice.mp3\n今晚记得带水杯。",
          ]);
          return "语音转写说明 voice.mp3 里说今晚记得带水杯。";
        },
      }).processPending();

      const updatedTask = tasks.getById(task.id);
      const derived = messages.searchMessages("水杯")[0];

      expect(result).toEqual({ processed: 1, succeeded: 1, skipped: 0, failed: 0 });
      expect(derived).toMatchObject({ messageType: "audio_transcript" });
      expect(derived?.text).toContain("今晚记得带水杯。");
      expect(indexedMessageIds).toEqual([derived?.messageId]);
      expect(updatedTask).toMatchObject({ status: "succeeded", derivedMessageId: derived?.messageId });
      expect(episodes.listRecentEpisodes(1)[0]?.summary).toContain("voice.mp3");
    } finally {
      database.close();
    }
  });

  it("转写失败最多重试三次后标为失败", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const messages = new MessageRepository(database);
    const tasks = new AudioTranscriptionTaskRepository(database);

    try {
      const sourceMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "audio-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "audio",
        text: "[语音] voice-1",
        sentAt: "2026-05-01T10:00:00.000Z",
      });
      const failingTask = tasks.enqueue({
        sourceMessageId,
        platformMessageId: "audio-1",
        audioKey: "audio-fail",
        storedPath: "/tmp/fail.mp3",
        mimeType: "audio/mpeg",
      });
      let failures = 0;
      const model: TranscriptionModel = {
        async transcribe() {
          failures += 1;
          throw new Error("transcription timeout");
        },
      };
      const worker = new AudioTranscriptionWorker({
        config,
        messages,
        tasks,
        model,
        transcriptionModelName: "whisper",
      });

      const first = await worker.processPending(10);
      const second = await worker.processPending(10);
      const third = await worker.processPending(10);

      expect(first).toEqual({ processed: 1, succeeded: 0, skipped: 0, failed: 1 });
      expect(second).toEqual({ processed: 1, succeeded: 0, skipped: 0, failed: 1 });
      expect(third).toEqual({ processed: 1, succeeded: 0, skipped: 0, failed: 1 });
      expect(tasks.getById(failingTask.id)).toMatchObject({ status: "failed", attempts: 3, lastError: "transcription timeout" });
      expect(messages.getMessageCount()).toBe(1);
      expect(failures).toBe(3);
    } finally {
      database.close();
    }
  });
});
