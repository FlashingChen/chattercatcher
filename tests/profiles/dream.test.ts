import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrateDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { ProfileDreamProcessor } from "../../src/profiles/dream.js";
import { ProfileRepository } from "../../src/profiles/repository.js";
import type { ChatModel } from "../../src/rag/types.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);
  return db;
}

describe("ProfileDreamProcessor", () => {
  test("processes only messages after the dream cursor and advances it on success", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);
    const person = profiles.resolvePersonForSender({ platform: "feishu", platformChatId: "chat-a", senderId: "ou_1", senderName: "小王", source: "message", observedAt: "2026-05-29T00:00:00.000Z" });
    const messageId = messages.ingest({ platform: "feishu", platformChatId: "chat-a", chatName: "家庭群", platformMessageId: "msg-1", senderId: "ou_1", senderName: "小王", personId: person.id, messageType: "text", text: "我今天医院值夜班", sentAt: "2026-05-29T00:01:00.000Z" });
    const model: ChatModel = { complete: async () => JSON.stringify({ updates: [{ personId: person.id, category: "职业", entryType: "fact", content: "小王在医院工作。", confidence: 0.91, evidence: [{ messageId, quote: "医院值夜班", reason: "说话者自述工作场景" }] }] }) };

    const result = await new ProfileDreamProcessor({ profiles, model }).processChat({ platform: "feishu", platformChatId: "chat-a", limit: 50 });

    expect(result).toMatchObject({ status: "succeeded", processedMessageCount: 1, generatedEntryCount: 1 });
    expect(profiles.getDreamState("feishu", "chat-a")?.lastMessageId).toBe(messageId);
    expect(profiles.getPersonProfile(person.id, { includeEvidence: true, includeInferred: true })?.entries[0]?.content).toBe("小王在医院工作。");
  });

  test("rejects inferred updates without evidence and does not advance cursor", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);
    const person = profiles.resolvePersonForSender({ platform: "feishu", platformChatId: "chat-a", senderId: "ou_1", senderName: "小王", source: "message", observedAt: "2026-05-29T00:00:00.000Z" });
    messages.ingest({ platform: "feishu", platformChatId: "chat-a", chatName: "家庭群", platformMessageId: "msg-1", senderId: "ou_1", senderName: "小王", personId: person.id, messageType: "text", text: "我想再确认一下", sentAt: "2026-05-29T00:01:00.000Z" });
    const model: ChatModel = { complete: async () => JSON.stringify({ updates: [{ personId: person.id, category: "性格", entryType: "inferred", content: "小王可能比较谨慎。", confidence: 0.6, evidence: [] }] }) };

    const result = await new ProfileDreamProcessor({ profiles, model }).processChat({ platform: "feishu", platformChatId: "chat-a", limit: 50 });

    expect(result.status).toBe("failed");
    expect(profiles.getDreamState("feishu", "chat-a")?.lastMessageId).toBeUndefined();
    expect(profiles.getPersonProfile(person.id, { includeEvidence: true, includeInferred: true })?.entries).toEqual([]);
  });

  test("records a clean validation error for malformed evidence fields", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);
    const person = profiles.resolvePersonForSender({ platform: "feishu", platformChatId: "chat-a", senderId: "ou_1", senderName: "小王", source: "message", observedAt: "2026-05-29T00:00:00.000Z" });
    const messageId = messages.ingest({ platform: "feishu", platformChatId: "chat-a", chatName: "家庭群", platformMessageId: "msg-1", senderId: "ou_1", senderName: "小王", personId: person.id, messageType: "text", text: "我想再确认一下", sentAt: "2026-05-29T00:01:00.000Z" });
    const model: ChatModel = { complete: async () => JSON.stringify({ updates: [{ personId: person.id, category: "性格", entryType: "inferred", content: "小王可能比较谨慎。", confidence: 0.6, evidence: [{ messageId, quote: null, reason: "缺少 quote" }] }] }) };

    const result = await new ProfileDreamProcessor({ profiles, model }).processChat({ platform: "feishu", platformChatId: "chat-a", limit: 50 });

    expect(result.status).toBe("failed");
    expect(result.error).toContain("quote");
    expect(result.error).not.toContain("trim");
    expect(profiles.getDreamState("feishu", "chat-a")?.lastMessageId).toBeUndefined();
  });

  test("does not duplicate the same profile entry when dream runs observe the same fact again", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);
    const person = profiles.resolvePersonForSender({ platform: "feishu", platformChatId: "chat-a", senderId: "ou_1", senderName: "小王", source: "message", observedAt: "2026-05-29T00:00:00.000Z" });
    const firstMessageId = messages.ingest({ platform: "feishu", platformChatId: "chat-a", chatName: "家庭群", platformMessageId: "msg-1", senderId: "ou_1", senderName: "小王", personId: person.id, messageType: "text", text: "我今天医院值夜班", sentAt: "2026-05-29T00:01:00.000Z" });
    const secondMessageId = messages.ingest({ platform: "feishu", platformChatId: "chat-a", chatName: "家庭群", platformMessageId: "msg-2", senderId: "ou_1", senderName: "小王", personId: person.id, messageType: "text", text: "医院又要值夜班", sentAt: "2026-05-29T00:02:00.000Z" });
    const model: ChatModel = { complete: async (messagesInput) => {
      const raw = messagesInput[1]?.content ?? "";
      const evidenceMessageId = raw.includes(secondMessageId) ? secondMessageId : firstMessageId;
      return JSON.stringify({ updates: [{ personId: person.id, category: "职业", entryType: "fact", content: "小王在医院工作。", confidence: 0.91, evidence: [{ messageId: evidenceMessageId, quote: "医院", reason: "说话者自述工作场景" }] }] });
    } };
    const processor = new ProfileDreamProcessor({ profiles, model });

    await processor.processChat({ platform: "feishu", platformChatId: "chat-a", limit: 1 });
    await processor.processChat({ platform: "feishu", platformChatId: "chat-a", limit: 1 });

    const profile = profiles.getPersonProfile(person.id, { includeEvidence: true, includeInferred: true });
    expect(profile?.entries).toHaveLength(1);
    expect(profile?.entries[0]?.evidence).toHaveLength(2);
  });
});
