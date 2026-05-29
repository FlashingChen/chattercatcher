import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrateDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { ProfileRepository } from "../../src/profiles/repository.js";
import { MessageFtsRetriever } from "../../src/rag/message-retriever.js";

function createDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);
  return db;
}

describe("MessageFtsRetriever", () => {
  test("includes personId in evidence source when message has a person link", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    const profiles = new ProfileRepository(db);

    // First create a person so the FK constraint is satisfied
    const person = profiles.resolvePersonForSender({
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
      personId: person.id,
      messageType: "text",
      text: "我明天要出差去上海",
      sentAt: "2026-05-29T00:01:00.000Z",
    });

    const retriever = new MessageFtsRetriever(messages);
    const results = await retriever.retrieve("出差");

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.source).toMatchObject({
      type: "message",
      label: "家庭群",
      sender: "Alice",
      senderId: "alice",
      personId: person.id,
      profileAvailable: true,
    });
  });

  test("does not include personId in evidence source when personId is null", async () => {
    const db = createDb();
    const messages = new MessageRepository(db);
    messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-1",
      senderId: "alice",
      senderName: "Alice",
      messageType: "text",
      text: "我明天要出差去上海",
      sentAt: "2026-05-29T00:01:00.000Z",
    });

    const retriever = new MessageFtsRetriever(messages);
    const results = await retriever.retrieve("出差");

    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.source).toMatchObject({
      type: "message",
      label: "家庭群",
      sender: "Alice",
      senderId: "alice",
      profileAvailable: false,
    });
    expect(results[0]?.source).not.toHaveProperty("personId");
  });
});
