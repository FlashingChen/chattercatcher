import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateDatabase } from "../../src/db/database.js";
import { QaLogRepository } from "../../src/rag/qa-logs.js";

describe("QaLogRepository", () => {
  it("creates logs and lists the most recent ones first", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const repository = new QaLogRepository(database);

      const older = repository.create({
        chatId: "chat-1",
        questionMessageId: "msg-1",
        question: "第一个问题",
        answer: "第一个回答",
        citations: [{ source: "older" }],
        retrievalDebug: { query: "older", count: 1 },
        status: "answered",
        createdAt: "2026-05-01T10:00:00.000Z",
      });
      const newer = repository.create({
        question: "第二个问题",
        answer: "第二个回答",
        citations: [{ source: "newer" }],
        retrievalDebug: { query: "newer", count: 2 },
        status: "failed",
        error: "timeout",
        createdAt: "2026-05-01T11:00:00.000Z",
      });

      const recent = repository.listRecent(10);

      expect(repository.getCount()).toBe(2);
      expect(recent).toHaveLength(2);
      expect(recent.map((log) => log.id)).toEqual([newer.id, older.id]);
      expect(recent[0]).toMatchObject({
        question: "第二个问题",
        answer: "第二个回答",
        citations: [{ source: "newer" }],
        retrievalDebug: { query: "newer", count: 2 },
        status: "failed",
        error: "timeout",
        chatId: null,
        questionMessageId: null,
        createdAt: "2026-05-01T11:00:00.000Z",
      });
      expect(recent[1]).toMatchObject({
        chatId: "chat-1",
        questionMessageId: "msg-1",
        citations: [{ source: "older" }],
        retrievalDebug: { query: "older", count: 1 },
        status: "answered",
        error: null,
        createdAt: "2026-05-01T10:00:00.000Z",
      });
      expect(older.id).toMatch(/^qa_/);
      expect(newer.id).toMatch(/^qa_/);
      expect(recent[0].trace).toEqual({});
      expect(recent[0].hasTrace).toBe(false);
    } finally {
      database.close();
    }
  });

  it("clamps listRecent limits to the supported range", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const repository = new QaLogRepository(database);

      for (let index = 0; index < 205; index += 1) {
        repository.create({
          question: `问题 ${index}`,
          answer: `回答 ${index}`,
          citations: [],
          retrievalDebug: { index },
          status: "answered",
          createdAt: new Date(Date.UTC(2026, 4, 1, 0, 0, index)).toISOString(),
        });
      }

      expect(repository.listRecent(0)).toHaveLength(1);
      expect(repository.listRecent(999)).toHaveLength(200);
    } finally {
      database.close();
    }
  });

  it("persists trace data and gets logs by id", () => {
    const database = new Database(":memory:");
    migrateDatabase(database);

    try {
      const repository = new QaLogRepository(database);
      const record = repository.create({
        chatId: "family",
        questionMessageId: "question-1",
        question: "今天要带什么？",
        answer: "带水杯。",
        citations: [],
        retrievalDebug: {},
        status: "answered",
        createdAt: "2026-05-17T10:00:00.000Z",
        trace: {
          startedAt: "2026-05-17T10:00:00.000Z",
          completedAt: "2026-05-17T10:00:01.000Z",
          durationMs: 1000,
          status: "answered",
          finalAnswer: "带水杯。",
          modelTurns: [
            {
              index: 0,
              content: "我来查一下。",
              reasoningContent: "需要先搜索本地消息。",
              toolCalls: [{ id: "call-1", name: "search_messages", input: { query: "水杯" } }],
              createdAt: "2026-05-17T10:00:00.100Z",
            },
          ],
          toolResults: [
            {
              toolCallId: "call-1",
              name: "search_messages",
              input: { query: "水杯" },
              content: "[证据1] 妈妈: 记得带水杯",
              createdAt: "2026-05-17T10:00:00.200Z",
            },
          ],
          fallbacks: [],
        },
      });

      expect(record.hasTrace).toBe(true);
      expect(record.trace.modelTurns?.[0]?.reasoningContent).toBe("需要先搜索本地消息。");

      const listed = repository.listRecent(10);
      expect(listed[0]).toMatchObject({ id: record.id, hasTrace: true });
      expect(listed[0].trace.toolResults?.[0]).toMatchObject({ name: "search_messages" });

      const detail = repository.getById(record.id);
      expect(detail).toMatchObject({ id: record.id, hasTrace: true });
      expect(detail?.trace.finalAnswer).toBe("带水杯。");
      expect(repository.getById("missing")).toBeNull();
    } finally {
      database.close();
    }
  });
});
