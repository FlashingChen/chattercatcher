import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { AudioTranscriptionTaskRepository } from "../../src/multimodal/audio-tasks.js";

let testDir: string;

describe("audio transcription task repository", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-audio-tasks-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("enqueue 对相同 sourceMessageId + audioKey 幂等，并且只返回一个待处理任务", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      const sourceMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "audio",
        text: "[语音]",
        sentAt: "2026-05-01T08:00:00.000Z",
        rawPayload: { audioKey: "audio-1" },
      });

      const repository = new AudioTranscriptionTaskRepository(database);
      const first = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        audioKey: "audio-1",
        storedPath: "/tmp/original.mp3",
        mimeType: "audio/mpeg",
      });
      const second = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        audioKey: "audio-1",
        storedPath: "/tmp/updated.mp3",
        mimeType: "audio/mpeg",
      });

      expect(second.id).toBe(first.id);
      expect(second.sourceMessageId).toBe(sourceMessageId);
      expect(second.audioKey).toBe("audio-1");
      expect(second.storedPath).toBe("/tmp/updated.mp3");
      expect(second.status).toBe("pending");
      expect(second.attempts).toBe(0);
      expect(second.lastError).toBeUndefined();
      expect(second.derivedMessageId).toBeUndefined();

      const pending = repository.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]).toMatchObject({
        id: first.id,
        sourceMessageId,
        platformMessageId: "message-1",
        audioKey: "audio-1",
        storedPath: "/tmp/updated.mp3",
        mimeType: "audio/mpeg",
        status: "pending",
        attempts: 0,
      });
    } finally {
      database.close();
    }
  });

  it("支持任务运行、成功、跳过和失败状态流转", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const messages = new MessageRepository(database);
      const sourceMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "audio",
        text: "[语音]",
        sentAt: "2026-05-01T08:00:00.000Z",
      });
      const derivedMessageId = messages.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "derived-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "audio_transcript",
        text: "[语音转写] 有信息",
        sentAt: "2026-05-01T08:01:00.000Z",
      });
      const repository = new AudioTranscriptionTaskRepository(database);

      const succeeded = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        audioKey: "audio-success",
        storedPath: "/tmp/success.mp3",
        mimeType: "audio/mpeg",
      });
      const runningSucceeded = repository.markRunning(succeeded.id);
      const completed = repository.markSucceeded(succeeded.id, derivedMessageId);

      expect(runningSucceeded).toMatchObject({ status: "running", attempts: 1 });
      expect(completed).toMatchObject({ status: "succeeded", attempts: 1, derivedMessageId });
      expect(completed.lastError).toBeUndefined();

      const skipped = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        audioKey: "audio-skip",
        storedPath: "/tmp/skip.mp3",
        mimeType: "audio/mpeg",
      });
      repository.markRunning(skipped.id);
      const skippedRecord = repository.markSkipped(skipped.id, "无有效语音");
      expect(skippedRecord).toMatchObject({ status: "skipped", attempts: 1, lastError: "无有效语音" });
      expect(skippedRecord.derivedMessageId).toBeUndefined();

      const retrying = repository.enqueue({
        sourceMessageId,
        platformMessageId: "message-1",
        audioKey: "audio-retry",
        storedPath: "/tmp/retry.mp3",
        mimeType: "audio/mpeg",
      });
      repository.markRunning(retrying.id);
      const pendingAgain = repository.markFailed(retrying.id, "timeout", false);
      expect(pendingAgain).toMatchObject({ status: "pending", attempts: 1, lastError: "timeout" });

      repository.markRunning(retrying.id);
      const finalFailure = repository.markFailed(retrying.id, "still timeout", true);
      expect(finalFailure).toMatchObject({ status: "failed", attempts: 2, lastError: "still timeout" });
      expect(repository.listPending().map((task) => task.id)).not.toContain(retrying.id);
      expect(() => repository.markRunning(finalFailure.id)).toThrow("语音转写任务状态无法更新");
    } finally {
      database.close();
    }
  });
});
