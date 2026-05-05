import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { CronJobRepository } from "../../src/cron/jobs.js";
import { openDatabase } from "../../src/db/database.js";

let testDir: string;

describe("CronJobRepository", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-cron-jobs-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("creates and lists active jobs by chat", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date(2026, 4, 5, 8, 58, 0) });
      const created = repository.create({
        chatId: "chat-a",
        createdByOpenId: "user-a",
        schedule: "0 9 * * *",
        prompt: "总结昨天群聊",
      });
      repository.create({ chatId: "chat-b", schedule: "0 10 * * *", prompt: "提醒喝水" });

      expect(created).toMatchObject({
        chatId: "chat-a",
        createdByOpenId: "user-a",
        schedule: "0 9 * * *",
        prompt: "总结昨天群聊",
        status: "active",
      });
      expect(new Date(created.nextRunAt).getHours()).toBe(9);
      expect(repository.listByChat("chat-a")).toMatchObject([{ id: created.id, chatId: "chat-a" }]);
    } finally {
      database.close();
    }
  });

  it("rejects invalid cron schedules", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database);
      expect(() => repository.create({ chatId: "chat-a", schedule: "bad cron", prompt: "总结" })).toThrow("cron 表达式无效");
    } finally {
      database.close();
    }
  });

  it("soft deletes only the matching chat job", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date(2026, 4, 5, 8, 58, 0) });
      const created = repository.create({ chatId: "chat-a", schedule: "0 9 * * *", prompt: "总结" });

      expect(repository.deleteByChat(created.id, "chat-b")).toBe(false);
      expect(repository.deleteByChat(created.id, "chat-a")).toBe(true);
      expect(repository.listByChat("chat-a")).toHaveLength(0);
      expect(repository.list(10)[0]).toMatchObject({ id: created.id, status: "deleted" });
    } finally {
      database.close();
    }
  });

  it("lists due jobs and records success or failure", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date(2026, 4, 5, 8, 58, 0) });
      const created = repository.create({ chatId: "chat-a", schedule: "0 9 * * *", prompt: "总结" });

      expect(repository.listDue(new Date(2026, 4, 5, 8, 59, 0))).toHaveLength(0);
      expect(repository.listDue(new Date(2026, 4, 5, 9, 0, 0))[0]).toMatchObject({ id: created.id });

      repository.markSuccess(created.id, new Date(2026, 4, 5, 9, 0, 0));
      const afterSuccess = repository.get(created.id)!;
      expect(afterSuccess.lastRunAt).toBe(new Date(2026, 4, 5, 9, 0, 0).toISOString());
      expect(new Date(afterSuccess.nextRunAt).getDate()).toBe(6);
      expect(new Date(afterSuccess.nextRunAt).getHours()).toBe(9);

      repository.markFailure(created.id, "LLM 请求失败", new Date(2026, 4, 6, 9, 0, 0));
      const afterFailure = repository.get(created.id)!;
      expect(afterFailure.lastError).toBe("LLM 请求失败");
      expect(new Date(afterFailure.nextRunAt).getDate()).toBe(7);
      expect(new Date(afterFailure.nextRunAt).getHours()).toBe(9);
    } finally {
      database.close();
    }
  });
});
