import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import {
  createFeishuChatMembersClient,
  FeishuMemberRepository,
  FeishuMemberResolver,
} from "../../src/feishu/members.js";

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

  it("checks cached unique names before refreshing", async () => {
    const { database, repository } = createRepository();
    repository.upsert({
      chatId: "oc_family",
      openId: "ou_mom",
      userName: "妈妈",
      updatedAt: "2026-05-16T00:00:00.000Z",
    });

    const listChatMembers = vi.fn(async () => [
      { openId: "ou_mom", userName: "妈妈" },
      { openId: "ou_dad", userName: "爸爸" },
    ]);

    try {
      const resolver = new FeishuMemberResolver({
        repository,
        now: () => new Date("2026-05-16T00:10:00.000Z"),
        ttlMs: 60 * 60 * 1000,
        client: { listChatMembers },
      });

      await expect(resolver.resolveUniqueName("oc_family", "妈妈")).resolves.toMatchObject({ openId: "ou_mom" });
      expect(listChatMembers).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("refreshes and rechecks unique names when cache misses", async () => {
    const { database, repository } = createRepository();
    const listChatMembers = vi.fn(async () => [
      { openId: "ou_mom", userName: "妈妈" },
      { openId: "ou_dad", userName: "爸爸" },
    ]);

    try {
      const resolver = new FeishuMemberResolver({
        repository,
        now: () => new Date("2026-05-16T00:00:00.000Z"),
        client: { listChatMembers },
      });

      await expect(resolver.resolveUniqueName("oc_family", "妈妈")).resolves.toMatchObject({ openId: "ou_mom" });
      expect(listChatMembers).toHaveBeenCalledTimes(1);
    } finally {
      database.close();
    }
  });

  it("returns null and logs when unique-name refresh fails", async () => {
    const { database, repository } = createRepository();
    const logger = { warn: vi.fn() };

    try {
      const resolver = new FeishuMemberResolver({
        repository,
        now: () => new Date("2026-05-16T00:00:00.000Z"),
        client: {
          async listChatMembers() {
            throw new Error("no permission");
          },
        },
        logger,
      });

      await expect(resolver.resolveUniqueName("oc_family", "妈妈")).resolves.toBeNull();
      expect(logger.warn).toHaveBeenCalledWith("Failed to refresh Feishu chat members for unique name resolution", {
        chatId: "oc_family",
        userName: "妈妈",
        error: expect.any(Error),
      });
    } finally {
      database.close();
    }
  });

  it("returns the original id when SDK lookup fails", async () => {
    const { database, repository } = createRepository();
    try {
      const logger = { warn: vi.fn() };
      const resolver = new FeishuMemberResolver({
        repository,
        now: () => new Date("2026-05-16T00:00:00.000Z"),
        client: {
          async listChatMembers() {
            throw new Error("no permission");
          },
        },
        logger,
      });

      await expect(resolver.resolveOpenIdName("oc_family", "ou_mom")).resolves.toBe("ou_mom");
      expect(logger.warn).toHaveBeenCalledWith("Failed to refresh Feishu chat members for open id resolution", {
        chatId: "oc_family",
        openId: "ou_mom",
        error: expect.any(Error),
      });
    } finally {
      database.close();
    }
  });
});

describe("createFeishuChatMembersClient", () => {
  it("collects paginated members and maps SDK fields", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          items: [
            { member_id: "ou_mom", name: "妈妈", user_id: "u_mom" },
            { member_id: "ou_skip" },
          ],
          has_more: true,
          page_token: "next-page",
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ member_id: "ou_dad", name: "爸爸" }],
          has_more: false,
        },
      });

    const client = createFeishuChatMembersClient({
      im: {
        v1: {
          chatMembers: { get },
        },
      },
    });

    await expect(client.listChatMembers({ chatId: "oc_family", memberIdType: "open_id" })).resolves.toEqual([
      { openId: "ou_mom", userId: "u_mom", userName: "妈妈" },
      { openId: "ou_dad", userId: undefined, userName: "爸爸" },
    ]);
    expect(get).toHaveBeenNthCalledWith(1, {
      path: { chat_id: "oc_family" },
      params: { member_id_type: "open_id" },
    });
    expect(get).toHaveBeenNthCalledWith(2, {
      path: { chat_id: "oc_family" },
      params: { member_id_type: "open_id", page_token: "next-page" },
    });
  });
});
