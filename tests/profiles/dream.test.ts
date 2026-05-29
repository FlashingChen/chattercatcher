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
});
