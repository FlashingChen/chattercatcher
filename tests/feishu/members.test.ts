import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { FeishuMemberRepository, FeishuMemberResolver } from "../../src/feishu/members.js";

let testDir: string;

describe("FeishuMemberRepository", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-feishu-members-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function createRepository(): { database: ReturnType<typeof openDatabase>; repository: FeishuMemberRepository } {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    return { database, repository: new FeishuMemberRepository(database) };
  }

  it("upserts and reads members by chat and open id", () => {
    const { database, repository } = createRepository();
    try {
      repository.upsert({
        chatId: "oc_family",
        openId: "ou_mom",
        userId: "u_mom",
        userName: "妈妈",
        updatedAt: "2026-05-16T00:00:00.000Z",
      });
      repository.upsert({
        chatId: "oc_other",
        openId: "ou_mom",
        userName: "群外昵称",
        updatedAt: "2026-05-16T00:00:00.000Z",
      });

      expect(repository.get("oc_family", "ou_mom")).toEqual({
        chatId: "oc_family",
        openId: "ou_mom",
        userId: "u_mom",
        userName: "妈妈",
        updatedAt: "2026-05-16T00:00:00.000Z",
      });
      expect(repository.listByChat("oc_family")).toEqual([
        {
          chatId: "oc_family",
          openId: "ou_mom",
          userId: "u_mom",
          userName: "妈妈",
          updatedAt: "2026-05-16T00:00:00.000Z",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("resolves a nickname only when there is exactly one match", () => {
    const { database, repository } = createRepository();
    try {
      repository.upsert({ chatId: "oc_family", openId: "ou_1", userName: "小陈", updatedAt: "2026-05-16T00:00:00.000Z" });
      repository.upsert({ chatId: "oc_family", openId: "ou_2", userName: "小陈", updatedAt: "2026-05-16T00:00:00.000Z" });
      repository.upsert({ chatId: "oc_family", openId: "ou_3", userName: "妈妈", updatedAt: "2026-05-16T00:00:00.000Z" });

      expect(repository.findUniqueByName("oc_family", "妈妈")).toMatchObject({ openId: "ou_3" });
      expect(repository.findUniqueByName("oc_family", "小陈")).toBeNull();
      expect(repository.findUniqueByName("oc_family", "不存在")).toBeNull();
    } finally {
      database.close();
    }
  });

  it("refreshes chat members through the Feishu SDK and returns nickname for an open id", async () => {
    const { database, repository } = createRepository();
    const calls: unknown[] = [];
    try {
      const resolver = new FeishuMemberResolver({
        repository,
        now: () => new Date("2026-05-16T00:00:00.000Z"),
        client: {
          async listChatMembers(payload) {
            calls.push(payload);
            return [
              { openId: "ou_mom", userName: "妈妈" },
              { openId: "ou_dad", userName: "爸爸" },
            ];
          },
        },
      });

      await expect(resolver.resolveOpenIdName("oc_family", "ou_mom")).resolves.toBe("妈妈");
      expect(calls).toEqual([{ chatId: "oc_family", memberIdType: "open_id" }]);
      expect(repository.get("oc_family", "ou_dad")).toMatchObject({ userName: "爸爸" });
    } finally {
      database.close();
    }
  });

  it("uses cached member names before the TTL expires", async () => {
    const { database, repository } = createRepository();
    repository.upsert({
      chatId: "oc_family",
      openId: "ou_mom",
      userName: "妈妈",
      updatedAt: "2026-05-16T00:00:00.000Z",
    });
    try {
      const resolver = new FeishuMemberResolver({
        repository,
        now: () => new Date("2026-05-16T00:10:00.000Z"),
        ttlMs: 60 * 60 * 1000,
        client: {
          async listChatMembers() {
            throw new Error("should not refresh fresh cache");
          },
        },
      });

      await expect(resolver.resolveOpenIdName("oc_family", "ou_mom")).resolves.toBe("妈妈");
    } finally {
      database.close();
    }
  });

  it("returns the original id when SDK lookup fails", async () => {
    const { database, repository } = createRepository();
    try {
      const resolver = new FeishuMemberResolver({
        repository,
        now: () => new Date("2026-05-16T00:00:00.000Z"),
        client: {
          async listChatMembers() {
            throw new Error("no permission");
          },
        },
      });

      await expect(resolver.resolveOpenIdName("oc_family", "ou_mom")).resolves.toBe("ou_mom");
    } finally {
      database.close();
    }
  });
});
