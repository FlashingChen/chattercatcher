import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrateDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { ProfileRepository } from "../../src/profiles/repository.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);
  return db;
}

describe("ProfileRepository", () => {
  test("resolves the same chat sender to one stable person and updates primary name", () => {
    const profiles = new ProfileRepository(createDb());

    const first = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "ou_123",
      senderName: "小王",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });
    const second = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "ou_123",
      senderName: "王医生",
      source: "feishu_member",
      observedAt: "2026-05-29T00:01:00.000Z",
    });

    expect(second.id).toBe(first.id);
    expect(second.primaryName).toBe("王医生");
    expect(profiles.listPersons()[0]).toMatchObject({ id: first.id, primaryName: "王医生" });
  });

  test("stores profile entries with evidence and supports includeEvidence/includeInferred", () => {
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
      evidence: [{ messageId, quote: "医院值夜班", reason: "说话者自述工作场景" }],
      observedAt: "2026-05-29T00:02:00.000Z",
    });
    profiles.upsertProfileEntry({
      personId: person.id,
      category: "作息",
      content: "可能常值夜班。",
      entryType: "inferred",
      confidence: 0.5,
      source: "manual",
      evidence: [{ messageId, quote: "医院值夜班", reason: "从夜班推测作息" }],
      observedAt: "2026-05-29T00:02:00.000Z",
    });

    const withoutInferred = profiles.getPersonProfile(person.id, { includeEvidence: false, includeInferred: false });
    expect(withoutInferred?.entries).toHaveLength(1);
    expect(withoutInferred?.entries[0]?.evidence).toBeUndefined();

    const withEvidence = profiles.getPersonProfile(person.id, { includeEvidence: true, includeInferred: true });
    expect(withEvidence?.entries).toHaveLength(2);
    expect(withEvidence?.entries[0]?.evidence?.[0]).toMatchObject({ messageId, quote: "医院值夜班" });
  });

  test("backfills old messages without rewriting sender_name", () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);
    const messageId = messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-1",
      senderId: "ou_123",
      senderName: "旧昵称",
      messageType: "text",
      text: "大家好",
      sentAt: "2026-05-29T00:02:00.000Z",
    });

    const result = profiles.backfillMessagePersons({ limit: 100 });

    const row = db.prepare("SELECT sender_name AS senderName, person_id AS personId FROM messages WHERE id = ?").get(messageId) as { senderName: string; personId: string | null };
    expect(result.updatedMessages).toBe(1);
    expect(row.senderName).toBe("旧昵称");
    expect(row.personId).toMatch(/^person_/);
  });

  test("stores dream state by chat", () => {
    const profiles = new ProfileRepository(createDb());
    expect(profiles.getDreamState("feishu", "chat-a")?.lastMessageSentAt).toBeUndefined();

    profiles.updateDreamState({
      platform: "feishu",
      platformChatId: "chat-a",
      lastMessageId: "msg-1",
      lastMessageSentAt: "2026-05-29T00:02:00.000Z",
      updatedAt: "2026-05-29T00:03:00.000Z",
    });

    expect(profiles.getDreamState("feishu", "chat-a")).toMatchObject({
      platform: "feishu",
      platformChatId: "chat-a",
      lastMessageId: "msg-1",
      lastMessageSentAt: "2026-05-29T00:02:00.000Z",
    });
  });

  test("backfill respects limit", () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);

    messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-1",
      senderId: "ou_123",
      senderName: "小王",
      messageType: "text",
      text: "第一条",
      sentAt: "2026-05-29T00:01:00.000Z",
    });
    messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-2",
      senderId: "ou_124",
      senderName: "小李",
      messageType: "text",
      text: "第二条",
      sentAt: "2026-05-29T00:02:00.000Z",
    });

    const result = profiles.backfillMessagePersons({ limit: 1 });
    const count = (db.prepare("SELECT COUNT(*) AS count FROM messages WHERE person_id IS NOT NULL").get() as { count: number }).count;
    expect(result.updatedMessages).toBe(1);
    expect(count).toBe(1);
  });
});
