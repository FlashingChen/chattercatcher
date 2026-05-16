import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { CronJobRepository } from "../../src/cron/jobs.js";
import { createCronJobTools } from "../../src/cron/tools.js";
import { openDatabase } from "../../src/db/database.js";

let testDir: string;

describe("createCronJobTools", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-cron-tools-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function createRepository(): { database: ReturnType<typeof openDatabase>; repository: CronJobRepository } {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const repository = new CronJobRepository(database, { now: () => new Date(2026, 4, 5, 8, 58, 0) });
    return { database, repository };
  }

  it("returns create/list/delete tools", () => {
    const { database, repository } = createRepository();
    try {
      const tools = createCronJobTools({ repository, chatId: "chat-a", createdByOpenId: "user-a" });

      expect(tools.map((tool) => tool.name)).toEqual([
        "create_cron_job",
        "list_cron_jobs",
        "delete_cron_job",
      ]);
    } finally {
      database.close();
    }
  });

  it("creates, lists, and deletes jobs in the current chat", async () => {
    const { database, repository } = createRepository();
    try {
      const resolveUniqueName = vi.fn(async (chatId: string, userName: string) => {
        expect(chatId).toBe("chat-a");
        expect(userName).toBe("妈妈");
        return {
          chatId,
          openId: "ou_mom",
          userId: "u_mom",
          userName,
          updatedAt: "2026-05-16T00:00:00.000Z",
        };
      });
      const tools = createCronJobTools({
        repository,
        chatId: "chat-a",
        createdByOpenId: "user-a",
        memberResolver: { resolveUniqueName },
      });
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      const created = JSON.parse(await byName.get("create_cron_job")!.execute({
        schedule: "0 9 * * *",
        prompt: "提醒妈妈带水杯",
        imageFileName: "order-code.jpg",
        mentionTargetName: "妈妈",
      }));
      expect(created).toMatchObject({
        ok: true,
        job: {
          chatId: "chat-a",
          createdByOpenId: "user-a",
          schedule: "0 9 * * *",
          prompt: "提醒妈妈带水杯",
          imageFileName: "order-code.jpg",
          mentionTargetName: "妈妈",
          mentionOpenId: "ou_mom",
          mentionUserId: "u_mom",
        },
      });

      const list = JSON.parse(await byName.get("list_cron_jobs")!.execute({}));
      expect(list.jobs).toHaveLength(1);
      expect(list.jobs[0]).toMatchObject({ id: created.job.id, chatId: "chat-a", imageFileName: "order-code.jpg", mentionTargetName: "妈妈" });

      const deleted = JSON.parse(await byName.get("delete_cron_job")!.execute({ id: created.job.id }));
      expect(deleted).toMatchObject({ ok: true, id: created.job.id });
      expect(repository.listByChat("chat-a")).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("lists only jobs in the current chat", async () => {
    const { database, repository } = createRepository();
    try {
      repository.create({ chatId: "chat-a", schedule: "0 9 * * *", prompt: "总结 A" });
      repository.create({ chatId: "chat-b", schedule: "0 10 * * *", prompt: "总结 B" });
      const tools = createCronJobTools({ repository, chatId: "chat-a" });
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      const list = JSON.parse(await byName.get("list_cron_jobs")!.execute({}));
      expect(list.jobs).toHaveLength(1);
      expect(list.jobs[0]).toMatchObject({ chatId: "chat-a", prompt: "总结 A" });
    } finally {
      database.close();
    }
  });

  it("returns tool errors for invalid input and wrong chat deletion", async () => {
    const { database, repository } = createRepository();
    try {
      const otherJob = repository.create({ chatId: "chat-b", schedule: "0 9 * * *", prompt: "总结" });
      const tools = createCronJobTools({ repository, chatId: "chat-a" });
      const byName = new Map(tools.map((tool) => [tool.name, tool]));

      await expect(byName.get("create_cron_job")!.execute({ schedule: "bad cron", prompt: "总结" })).rejects.toThrow("cron 表达式无效");
      const deleted = JSON.parse(await byName.get("delete_cron_job")!.execute({ id: otherJob.id }));
      expect(deleted).toMatchObject({ ok: false });
      expect(repository.get(otherJob.id)).toMatchObject({ status: "active" });
    } finally {
      database.close();
    }
  });
});
