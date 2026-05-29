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
  test("migrateDatabase can run repeatedly without changing person tables", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    migrateDatabase(db);
    migrateDatabase(db);

    const personTables = db
      .prepare(
        `
          SELECT name
          FROM sqlite_master
          WHERE type = 'table' AND name IN ('persons', 'person_identities', 'person_profile_entries', 'person_profile_evidence', 'profile_dream_state', 'profile_dream_runs')
          ORDER BY name ASC
        `,
      )
      .all() as Array<{ name: string }>;

    expect(personTables.map((row) => row.name)).toEqual([
      "person_identities",
      "person_profile_entries",
      "person_profile_evidence",
      "persons",
      "profile_dream_runs",
      "profile_dream_state",
    ]);
  });

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

  test("re-resolving the same sender never throws and always returns the same person", () => {
    const db = createDb();
    const profiles = new ProfileRepository(db);

    const first = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "ou_123",
      senderName: "小王",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });

    expect(() =>
      profiles.resolvePersonForSender({
        platform: "feishu",
        platformChatId: "chat-a",
        senderId: "ou_123",
        senderName: "小王",
        source: "message",
        observedAt: "2026-05-29T00:00:00.000Z",
      }),
    ).not.toThrow();

    const second = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "ou_123",
      senderName: "小王",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });

    const counts = db
      .prepare(
        `
          SELECT
            (SELECT COUNT(*) FROM persons) AS personCount,
            (SELECT COUNT(*) FROM person_identities) AS identityCount
        `,
      )
      .get() as { personCount: number; identityCount: number };

    expect(second.id).toBe(first.id);
    expect(counts).toEqual({ personCount: 1, identityCount: 1 });
  });

  test("returns identities in person profile and reflects latest display name", () => {
    const profiles = new ProfileRepository(createDb());

    const person = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "ou_123",
      senderName: "小王",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });
    profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "ou_123",
      senderName: "王医生",
      source: "feishu_member",
      observedAt: "2026-05-29T00:01:00.000Z",
    });

    const profile = profiles.getPersonProfile(person.id, { includeEvidence: true, includeInferred: true });

    expect(profile?.identities).toEqual([
      expect.objectContaining({
        platform: "feishu",
        platformChatId: "chat-a",
        externalUserId: "ou_123",
        displayName: "王医生",
        source: "feishu_member",
        firstSeenAt: "2026-05-29T00:00:00.000Z",
        lastSeenAt: "2026-05-29T00:01:00.000Z",
      }),
    ]);
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

  test("backfill respects limit and processes oldest messages first", () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);

    const firstMessageId = messages.ingest({
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
    const secondMessageId = messages.ingest({
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
    const rows = db
      .prepare("SELECT id, person_id AS personId FROM messages ORDER BY sent_at ASC")
      .all() as Array<{ id: string; personId: string | null }>;
    expect(result.updatedMessages).toBe(1);
    expect(rows).toEqual([
      { id: firstMessageId, personId: expect.stringMatching(/^person_/) },
      { id: secondMessageId, personId: null },
    ]);
  });

  test("backfill uses one transaction per batch to avoid partial commits", () => {
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

    const originalUpdate = db.prepare("UPDATE messages SET person_id = ? WHERE id = ?");
    let updateCount = 0;
    const failingUpdate = {
      run(personId: string, messageId: string) {
        updateCount += 1;
        if (updateCount === 2) {
          throw new Error("boom");
        }
        return originalUpdate.run(personId, messageId);
      },
    };

    const originalPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      if (sql === "UPDATE messages SET person_id = ? WHERE id = ?") {
        return failingUpdate as never;
      }
      return originalPrepare(sql);
    }) as typeof db.prepare;

    expect(() => profiles.backfillMessagePersons({ limit: 2 })).toThrow("boom");

    const rows = db
      .prepare("SELECT person_id AS personId FROM messages ORDER BY sent_at ASC")
      .all() as Array<{ personId: string | null }>;
    expect(rows).toEqual([{ personId: null }, { personId: null }]);
  });
});
