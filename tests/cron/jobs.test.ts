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

  it("rejects blank prompts after trimming", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database);
      expect(() =>
        repository.create({ chatId: "chat-a", schedule: "0 9 * * *", prompt: "   " }),
      ).toThrow("定时任务 prompt 不能为空");
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

  it("does not mutate deleted jobs on success/failure marks", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date(2026, 4, 5, 8, 58, 0) });
      const created = repository.create({ chatId: "chat-a", schedule: "0 9 * * *", prompt: "总结" });

      expect(repository.deleteByChat(created.id, "chat-a")).toBe(true);
      const deletedBefore = repository.get(created.id)!;

      repository.markSuccess(created.id, new Date(2026, 4, 5, 9, 0, 0));
      repository.markFailure(created.id, "LLM 请求失败", new Date(2026, 4, 6, 9, 0, 0));

      const deletedAfter = repository.get(created.id)!;
      expect(deletedAfter.status).toBe("deleted");
      expect(deletedAfter.nextRunAt).toBe(deletedBefore.nextRunAt);
      expect(deletedAfter.lastRunAt).toBeUndefined();
      expect(deletedAfter.lastError).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("lists due jobs by next_run_at ascending with limit", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date(2026, 4, 5, 8, 50, 0) });
      const first = repository.create({ chatId: "chat-a", schedule: "52 8 * * *", prompt: "任务一" });
      const second = repository.create({ chatId: "chat-a", schedule: "53 8 * * *", prompt: "任务二" });
      repository.create({ chatId: "chat-a", schedule: "54 8 * * *", prompt: "任务三" });

      const due = repository.listDue(new Date(2026, 4, 5, 8, 55, 0), 2);
      expect(due).toHaveLength(2);
      expect(due.map((item) => item.id)).toEqual([first.id, second.id]);
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

  it("persists cron mention targets", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const repository = new CronJobRepository(database, { now: () => new Date(2026, 4, 5, 8, 58, 0) });
      const created = repository.create({
        chatId: "chat-a",
        schedule: "0 9 * * *",
        prompt: "提醒妈妈带水杯",
        mentionTargetName: "妈妈",
        mentionOpenId: "ou_mom",
        mentionUserId: "u_mom",
      });

      expect(repository.get(created.id)).toMatchObject({
        mentionTargetName: "妈妈",
        mentionOpenId: "ou_mom",
        mentionUserId: "u_mom",
      });
      expect(repository.listDue(new Date(2026, 4, 5, 9, 0, 0))[0]).toMatchObject({
        mentionTargetName: "妈妈",
        mentionOpenId: "ou_mom",
        mentionUserId: "u_mom",
      });
    } finally {
      database.close();
    }
  });

  it("creates Feishu member mapping and cron mention columns without rewriting messages", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const memberColumns = database.prepare("PRAGMA table_info(feishu_chat_members)").all() as Array<{ name: string }>;
      expect(memberColumns.map((column) => column.name)).toEqual([
        "chat_id",
        "open_id",
        "user_id",
        "user_name",
        "updated_at",
      ]);

      const cronColumns = database.prepare("PRAGMA table_info(cron_jobs)").all() as Array<{ name: string }>;
      expect(cronColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "mention_target_name",
        "mention_open_id",
        "mention_user_id",
      ]));

      database.prepare(`
        INSERT INTO feishu_chat_members (chat_id, open_id, user_id, user_name, updated_at)
        VALUES ('oc_family', 'ou_mom', 'u_mom', '妈妈', '2026-05-16T00:00:00.000Z')
      `).run();

      expect(database.prepare("SELECT sender_name FROM messages").all()).toEqual([]);
    } finally {
      database.close();
    }
  });
});
