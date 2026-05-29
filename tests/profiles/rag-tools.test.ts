import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrateDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { ProfileRepository } from "../../src/profiles/repository.js";
import { createPersonProfileTools } from "../../src/profiles/rag-tools.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);
  return db;
}

describe("createPersonProfileTools", () => {
  test("returns exact tool names get_person_profile and search_person_messages", () => {
    const db = createDb();
    const profiles = new ProfileRepository(db);
    const tools = createPersonProfileTools({ profiles });

    expect(tools.map((t) => t.name)).toEqual(["get_person_profile", "search_person_messages"]);
  });

  test("each tool has inputSchema with required fields", () => {
    const db = createDb();
    const profiles = new ProfileRepository(db);
    const tools = createPersonProfileTools({ profiles });

    const getProfile = tools.find((t) => t.name === "get_person_profile");
    const searchMessages = tools.find((t) => t.name === "search_person_messages");

    expect(getProfile?.inputSchema).toEqual({
      type: "object",
      properties: {
        personId: { type: "string", description: expect.any(String) },
      },
      required: ["personId"],
      additionalProperties: false,
    });

    expect(searchMessages?.inputSchema).toEqual({
      type: "object",
      properties: {
        personId: { type: "string", description: expect.any(String) },
        query: { type: "string", description: expect.any(String) },
        limit: { type: "number", description: expect.any(String) },
      },
      required: ["personId", "query"],
      additionalProperties: false,
    });
  });

  test("get_person_profile returns profile entries as EvidenceBlocks for a known person", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);

    const person = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "ou_123",
      senderName: "小王",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });
    const messageId = messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-1",
      senderId: "ou_123",
      senderName: "小王",
      personId: person.id,
      messageType: "text",
      text: "我今天医院值夜班",
      sentAt: "2026-05-29T00:02:00.000Z",
    });
    profiles.upsertProfileEntry({
      personId: person.id,
      category: "职业",
      content: "小王在医院工作。",
      entryType: "fact",
      confidence: 0.9,
      source: "dream",
      evidence: [{ messageId, quote: "我今天医院值夜班", reason: "提到值夜班，推断在医院工作" }],
      observedAt: "2026-05-29T00:03:00.000Z",
    });

    const tools = createPersonProfileTools({ profiles });
    const getProfile = tools.find((t) => t.name === "get_person_profile")!;

    const results = await getProfile.execute({ personId: person.id });

    expect(results).toHaveLength(1);
    expect(results[0]?.id).toMatch(/^profile_entry_/);
    expect(results[0]?.text).toContain("小王在医院工作");
    expect(results[0]?.source).toMatchObject({
      type: "person_profile",
      label: "小王",
      personId: person.id,
    });
  });

  test("get_person_profile returns empty array for unknown person", async () => {
    const db = createDb();
    const profiles = new ProfileRepository(db);
    const tools = createPersonProfileTools({ profiles });
    const getProfile = tools.find((t) => t.name === "get_person_profile")!;

    const results = await getProfile.execute({ personId: "person_nonexistent" });

    expect(results).toEqual([]);
  });

  test("get_person_profile rejects when personId is missing or empty", async () => {
    const db = createDb();
    const profiles = new ProfileRepository(db);
    const tools = createPersonProfileTools({ profiles });
    const getProfile = tools.find((t) => t.name === "get_person_profile")!;

    await expect(getProfile.execute({})).rejects.toThrow("personId 必须是非空字符串。");
    await expect(getProfile.execute({ personId: "   " })).rejects.toThrow("personId 必须是非空字符串。");
  });

  test("search_person_messages searches messages for a specific person", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);

    const alice = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "alice",
      senderName: "Alice",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });
    const bob = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "bob",
      senderName: "Bob",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });
    messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-1",
      senderId: "alice",
      senderName: "Alice",
      personId: alice.id,
      messageType: "text",
      text: "我明天要出差去上海",
      sentAt: "2026-05-29T00:01:00.000Z",
    });
    messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-2",
      senderId: "bob",
      senderName: "Bob",
      personId: bob.id,
      messageType: "text",
      text: "今天晚饭我包了",
      sentAt: "2026-05-29T00:02:00.000Z",
    });

    const tools = createPersonProfileTools({ profiles });
    const searchMessages = tools.find((t) => t.name === "search_person_messages")!;

    const results = await searchMessages.execute({ personId: alice.id, query: "出差" });

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.text).toContain("出差");
    expect(results[0]?.source).toMatchObject({
      type: "message",
      sender: "Alice",
      personId: alice.id,
    });
    // Should not include Bob's message
    const texts = results.map((r) => r.text);
    expect(texts.some((t) => t.includes("晚饭"))).toBe(false);
  });

  test("search_person_messages returns empty array when no matching messages found", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);

    const alice = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "alice",
      senderName: "Alice",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });
    messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-1",
      senderId: "alice",
      senderName: "Alice",
      personId: alice.id,
      messageType: "text",
      text: "今天天气不错",
      sentAt: "2026-05-29T00:01:00.000Z",
    });

    const tools = createPersonProfileTools({ profiles });
    const searchMessages = tools.find((t) => t.name === "search_person_messages")!;

    const results = await searchMessages.execute({ personId: alice.id, query: "完全无关的搜索词" });

    expect(results).toEqual([]);
  });

  test("search_person_messages rejects when personId is missing", async () => {
    const db = createDb();
    const profiles = new ProfileRepository(db);
    const tools = createPersonProfileTools({ profiles });
    const searchMessages = tools.find((t) => t.name === "search_person_messages")!;

    await expect(searchMessages.execute({ query: "出差" })).rejects.toThrow("personId 必须是非空字符串。");
    await expect(searchMessages.execute({ personId: "   ", query: "出差" })).rejects.toThrow("personId 必须是非空字符串。");
  });

  test("search_person_messages rejects when query is missing or empty", async () => {
    const db = createDb();
    const profiles = new ProfileRepository(db);
    const tools = createPersonProfileTools({ profiles });
    const searchMessages = tools.find((t) => t.name === "search_person_messages")!;

    await expect(searchMessages.execute({ personId: "person_a" })).rejects.toThrow("搜索 query 必须是非空字符串。");
    await expect(searchMessages.execute({ personId: "person_a", query: "   " })).rejects.toThrow("搜索 query 必须是非空字符串。");
  });

  test("respects limit parameter in search_person_messages", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);

    const alice = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "alice",
      senderName: "Alice",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });
    messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-1",
      senderId: "alice",
      senderName: "Alice",
      personId: alice.id,
      messageType: "text",
      text: "活动安排在周一",
      sentAt: "2026-05-29T00:01:00.000Z",
    });
    messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-2",
      senderId: "alice",
      senderName: "Alice",
      personId: alice.id,
      messageType: "text",
      text: "周二再确认活动细节",
      sentAt: "2026-05-29T00:02:00.000Z",
    });

    const tools = createPersonProfileTools({ profiles });
    const searchMessages = tools.find((t) => t.name === "search_person_messages")!;

    const results = await searchMessages.execute({ personId: alice.id, query: "活动", limit: 1 });

    expect(results).toHaveLength(1);
  });
});
