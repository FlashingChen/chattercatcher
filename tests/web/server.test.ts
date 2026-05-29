import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { CronJobRepository } from "../../src/cron/jobs.js";
import { openDatabase } from "../../src/db/database.js";
import { ingestLocalFile } from "../../src/files/ingest.js";
import { FileJobRepository } from "../../src/files/jobs.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { EpisodeRepository } from "../../src/episodes/repository.js";
import { QaLogRepository } from "../../src/rag/qa-logs.js";
import { ProfileRepository } from "../../src/profiles/repository.js";
import { createWebApp } from "../../src/web/server.js";

let testDir: string;

describe("web server", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-web-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("提供状态、群聊、最近消息和文件 API", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const filePath = path.join(testDir, "activity.md");
    await fs.writeFile(filePath, "端午活动改到 2026/6/30。", "utf8");
    let qaLogId = "";

    const database = openDatabase(config);
    try {
      const repository = new MessageRepository(database);
      repository.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "message-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });
      await ingestLocalFile({ config, messages: repository, jobs: new FileJobRepository(database), filePath });
      await new EpisodeRepository(database).summarizeReadyWindows({
        now: new Date("2026-04-25T08:10:00.000Z"),
        quietMs: 2 * 60 * 1000,
        windowMs: 10 * 60 * 1000,
        summarize: async () => "端午活动改到 2026/6/30，这是来自家庭群的会话记忆。",
      });
      const qaLog = new QaLogRepository(database).create({
        chatId: "family",
        questionMessageId: "question-1",
        question: "端午活动改到哪天？",
        answer: "端午活动改到 2026/6/30。",
        citations: [{ sourceId: "message-1", snippet: "端午活动改到 2026/6/30。" }],
        retrievalDebug: { keywordHits: 1, vectorHits: 0 },
        trace: {
          startedAt: "2026-04-25T08:10:59.000Z",
          completedAt: "2026-04-25T08:11:00.000Z",
          durationMs: 1000,
          status: "answered",
          finalAnswer: "端午活动改到 2026/6/30。",
          modelTurns: [
            {
              index: 0,
              content: "我来查证据。",
              reasoningContent: "需要搜索端午活动。",
              toolCalls: [{ id: "call-1", name: "search_messages", input: { query: "端午活动" } }],
              createdAt: "2026-04-25T08:10:59.100Z",
            },
          ],
          toolResults: [
            {
              toolCallId: "call-1",
              name: "search_messages",
              input: { query: "端午活动" },
              content: "端午活动改到 2026/6/30。",
              createdAt: "2026-04-25T08:10:59.200Z",
            },
          ],
          fallbacks: [],
        },
        status: "answered",
        createdAt: "2026-04-25T08:11:00.000Z",
      });
      qaLogId = qaLog.id;
      new CronJobRepository(database, { now: () => new Date(2026, 4, 5, 8, 58, 0) }).create({
        chatId: "family",
        createdByOpenId: "mom",
        schedule: "0 9 * * *",
        prompt: "总结昨天群聊",
      });
      new CronJobRepository(database, { now: () => new Date(2026, 4, 5, 8, 58, 0) }).create({
        chatId: "family",
        createdByOpenId: "dad",
        schedule: "0 10 * * *",
        prompt: "提醒喝水",
      });
    } finally {
      database.close();
    }

    const app = createWebApp(config, { version: "0.1.test" });
    try {
      const status = await app.inject({ method: "GET", url: "/api/status" });
      expect(status.statusCode).toBe(200);
      const statusJson = status.json();
      expect(statusJson).toMatchObject({
        app: "ChatterCatcher",
        version: "0.1.test",
        data: { chats: 2, messages: 2, files: 1, episodes: 1, qaLogs: 1, cronJobs: 2 },
        rag: {
          mode: "required",
          retrieval: {
            keyword: "SQLite FTS5",
            vector: "SQLite embedding",
          },
        },
      });
      expect(statusJson.data).toHaveProperty("qaLogs");
      expect(statusJson.web).not.toHaveProperty("actionToken");
      const homePage = await app.inject({ method: "GET", url: "/" });
      expect(homePage.statusCode).toBe(200);
      const setCookie = homePage.headers["set-cookie"];
      const webActionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      expect(webActionCookie).toContain("chattercatcher_web_token=");
      expect(homePage.body).not.toContain("chattercatcher_web_token=");

      const chats = await app.inject({ method: "GET", url: "/api/chats" });
      expect(chats.json().items.map((item: { name: string }) => item.name)).toContain("家庭群");

      const recent = await app.inject({ method: "GET", url: "/api/messages/recent?limit=1" });
      expect(recent.json().items[0]).toMatchObject({
        text: "端午活动改到 2026/6/30。",
      });

      const episodes = await app.inject({ method: "GET", url: "/api/episodes?limit=1" });
      expect(episodes.statusCode).toBe(200);
      expect(episodes.json().items[0]).toMatchObject({
        chatName: "家庭群",
        summary: "端午活动改到 2026/6/30，这是来自家庭群的会话记忆。",
        messageCount: 1,
        startedAt: "2026-04-25T08:00:00.000Z",
        endedAt: "2026-04-25T08:00:00.000Z",
      });

      const qaLogs = await app.inject({ method: "GET", url: "/api/qa-logs?limit=5" });
      expect(qaLogs.statusCode).toBe(200);
      expect(qaLogs.json()).not.toHaveProperty("total");
      expect(qaLogs.json()).toMatchObject({
        items: [
          {
            question: "端午活动改到哪天？",
            answer: "端午活动改到 2026/6/30。",
            status: "answered",
            hasTrace: true,
            citations: [{ sourceId: "message-1", snippet: "端午活动改到 2026/6/30。" }],
            retrievalDebug: { keywordHits: 1, vectorHits: 0 },
            createdAt: "2026-04-25T08:11:00.000Z",
          },
        ],
      });
      expect(qaLogs.json().items[0]).not.toHaveProperty("trace");

      const qaLogDetail = await app.inject({ method: "GET", url: `/api/qa-logs/${qaLogId}` });
      expect(qaLogDetail.statusCode).toBe(200);
      expect(qaLogDetail.json()).toMatchObject({
        id: qaLogId,
        question: "端午活动改到哪天？",
        hasTrace: true,
        trace: {
          finalAnswer: "端午活动改到 2026/6/30。",
          modelTurns: [
            {
              content: "我来查证据。",
              reasoningContent: "需要搜索端午活动。",
            },
          ],
          toolResults: [
            {
              toolCallId: "call-1",
              name: "search_messages",
              content: "端午活动改到 2026/6/30。",
            },
          ],
        },
      });

      const missingQaLogDetail = await app.inject({ method: "GET", url: "/api/qa-logs/missing" });
      expect(missingQaLogDetail.statusCode).toBe(404);
      expect(missingQaLogDetail.json()).toMatchObject({ ok: false, message: "没有找到问答日志。" });

      const files = await app.inject({ method: "GET", url: "/api/files" });
      expect(files.json().items[0]).toMatchObject({
        fileName: "activity.md",
        parser: "text",
      });
      expect(files.json().items[0].characters).toBeGreaterThan(0);

      const jobs = await app.inject({ method: "GET", url: "/api/file-jobs?status=indexed" });
      expect(jobs.json().items[0]).toMatchObject({
        fileName: "activity.md",
        status: "indexed",
      });

      const cronJobs = await app.inject({ method: "GET", url: "/api/cron-jobs?limit=1" });
      expect(cronJobs.statusCode).toBe(200);
      expect(cronJobs.json().items).toHaveLength(1);
      expect(cronJobs.json().items[0]).toMatchObject({
        chatId: "family",
        schedule: "0 9 * * *",
        prompt: "总结昨天群聊",
        status: "active",
      });

      const allCronJobs = await app.inject({ method: "GET", url: "/api/cron-jobs" });
      expect(allCronJobs.json().items).toHaveLength(2);
      const targetJob = allCronJobs.json().items.find((item: { prompt: string }) => item.prompt === "总结昨天群聊");
      const unauthorizedDelete = await app.inject({ method: "DELETE", url: `/api/cron-jobs/${targetJob.id}` });
      expect(unauthorizedDelete.statusCode).toBe(403);
      expect(unauthorizedDelete.json()).toMatchObject({ ok: false, message: "Web 操作未授权。" });
      const deleteResponse = await app.inject({
        method: "DELETE",
        url: `/api/cron-jobs/${targetJob.id}`,
        headers: { cookie: webActionCookie! },
      });
      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json()).toMatchObject({ ok: true });
      expect((await app.inject({ method: "GET", url: "/api/cron-jobs" })).json().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: targetJob.id, status: "deleted" }),
          expect.objectContaining({ prompt: "提醒喝水", status: "active" }),
        ]),
      );

      const missingDelete = await app.inject({
        method: "DELETE",
        url: "/api/cron-jobs/missing-job",
        headers: { cookie: webActionCookie! },
      });
      expect(missingDelete.statusCode).toBe(404);
      expect(missingDelete.json()).toMatchObject({ ok: false, message: "没有找到定时任务。" });
    } finally {
      await app.close();
    }
  });

  it("首页使用中文文案并声明 RAG 约束", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const app = createWebApp(config, { version: "0.1.test" });
    try {
      const response = await app.inject({ method: "GET", url: "/" });
      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toContain("text/html");
      expect(response.body).toContain("本地优先的家庭群知识库");
      expect(response.body).toContain("不堆叠全量上下文");
      expect(response.body).toContain("会话记忆");
      expect(response.body).toContain("问答日志");
      expect(response.body).toContain('id="qa-logs-list"');
      expect(response.body).toContain("data-view-qa-log");
      expect(response.body).toContain("/api/qa-logs/");
      expect(response.body).toContain("Reasoning");
      expect(response.body).toContain("toolResults");
      expect(response.body).not.toContain("innerHTML = item");
      expect(response.body).toContain("定时任务");
      expect(response.body).toContain('id="cron-jobs-list"');
      expect(response.body).toContain("/api/cron-jobs");
      expect(response.body).toContain("data-delete-cron-job");
      expect(response.body).toContain("正在删除定时任务");
      expect(response.body).not.toContain("x-chattercatcher-web-token");
      expect(response.body).toContain("当前运行版本");
      expect(response.body).toContain("加载失败");
      expect(response.body).toContain("chattercatcher files add");
      expect(response.body).toContain("立即处理");
      expect(response.body).toContain("setInterval");
      expect(() => new Function(response.body.match(/<script>([\s\S]*)<\/script>/)?.[1] ?? "")).not.toThrow();
      expect(response.body).not.toContain('"  <div class="message-body"');
      expect(response.body).not.toContain('join("\n")');
      expect(response.body).not.toContain("id=\"refresh\"");
      expect(response.body).not.toContain(">刷新<");
    } finally {
      await app.close();
    }
  });

  it("提供立即处理消息索引 API", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const app = createWebApp(config);
    try {
      const homePage = await app.inject({ method: "GET", url: "/" });
      const setCookie = homePage.headers["set-cookie"];
      const webActionCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      const response = await app.inject({
        method: "POST",
        url: "/api/process/messages",
        headers: { cookie: webActionCookie! },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "skipped",
        chunks: 0,
        vectors: 0,
      });
      expect(response.json().reason).toContain("Embedding 配置不完整");
    } finally {
      await app.close();
    }
  });

  it("提供个人档案 API", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = path.join(testDir, "data");
    const database = openDatabase(config);
    let momPersonId = "";
    let dadPersonId = "";
    let momMessageId = "";
    let dadMessageId = "";

    try {
      const repository = new MessageRepository(database);
      const profiles = new ProfileRepository(database);

      momMessageId = repository.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "profile-1",
        senderId: "mom",
        senderName: "老妈",
        messageType: "text",
        text: "爸爸的生日是 5 月 12 日。",
        sentAt: "2026-04-20T10:00:00.000Z",
      });

      momPersonId = profiles.resolvePersonForSender({
        platform: "dev",
        platformChatId: "family",
        senderId: "mom",
        senderName: "老妈",
        source: "message",
        observedAt: "2026-04-20T10:00:00.000Z",
      }).id;

      dadMessageId = repository.ingest({
        platform: "dev",
        platformChatId: "family",
        chatName: "家庭群",
        platformMessageId: "profile-2",
        senderId: "dad",
        senderName: "老爸",
        messageType: "text",
        text: "我换工作了，在新公司做后端开发。",
        sentAt: "2026-04-21T14:00:00.000Z",
      });

      dadPersonId = profiles.resolvePersonForSender({
        platform: "dev",
        platformChatId: "family",
        senderId: "dad",
        senderName: "老爸",
        source: "message",
        observedAt: "2026-04-21T14:00:00.000Z",
      }).id;

      profiles.upsertProfileEntry({
        personId: momPersonId,
        category: "家庭角色",
        content: "妈妈",
        entryType: "fact",
        confidence: 0.9,
        source: "dream",
        evidence: [
          { messageId: momMessageId, quote: "爸爸的生日是 5 月 12 日。", reason: "老妈发消息称爸爸生日" },
        ],
        observedAt: "2026-04-20T10:00:00.000Z",
      });

      profiles.upsertProfileEntry({
        personId: dadPersonId,
        category: "工作",
        content: "后端开发工程师",
        entryType: "inferred",
        confidence: 0.7,
        source: "dream",
        evidence: [
          { messageId: dadMessageId, quote: "我换工作了，在新公司做后端开发。", reason: "老爸自己说换工作了" },
        ],
        observedAt: "2026-04-21T14:00:00.000Z",
      });

      profiles.backfillMessagePersons({ limit: 100 });
    } finally {
      database.close();
    }

    const app = createWebApp(config, { version: "0.1.test" });
    try {
      const personsList = await app.inject({ method: "GET", url: "/api/persons" });
      expect(personsList.statusCode).toBe(200);
      expect(personsList.json().items).toHaveLength(2);
      expect(personsList.json().items[0]).toMatchObject({
        id: expect.any(String),
        primaryName: expect.any(String),
        profileEntryCount: expect.any(Number),
        messageCount: expect.any(Number),
      });

      const momProfile = await app.inject({ method: "GET", url: `/api/persons/${momPersonId}/profile` });
      expect(momProfile.statusCode).toBe(200);
      expect(momProfile.json()).toMatchObject({
        person: { id: momPersonId, primaryName: "老妈" },
        identities: expect.any(Array),
        entries: expect.arrayContaining([
          expect.objectContaining({
            category: "家庭角色",
            content: "妈妈",
            entryType: "fact",
            evidence: expect.arrayContaining([
              expect.objectContaining({ messageId: momMessageId, quote: "爸爸的生日是 5 月 12 日。" }),
            ]),
          }),
        ]),
      });
      expect(momProfile.json().identities).toHaveLength(1);
      expect(momProfile.json().identities[0]).toMatchObject({
        platform: "dev",
        platformChatId: "family",
        externalUserId: "mom",
        displayName: "老妈",
      });

      const dadProfile = await app.inject({ method: "GET", url: `/api/persons/${dadPersonId}/profile` });
      expect(dadProfile.statusCode).toBe(200);
      expect(dadProfile.json().entries[0]).toMatchObject({
        category: "工作",
        content: "后端开发工程师",
        entryType: "inferred",
        evidence: expect.arrayContaining([
          expect.objectContaining({ messageId: dadMessageId }),
        ]),
      });

      const missingProfile = await app.inject({ method: "GET", url: "/api/persons/missing_person/profile" });
      expect(missingProfile.statusCode).toBe(404);
      expect(missingProfile.json()).toMatchObject({ ok: false, message: "没有找到该成员。" });

      const momMessages = await app.inject({ method: "GET", url: `/api/persons/${momPersonId}/messages` });
      expect(momMessages.statusCode).toBe(200);
      expect(momMessages.json().items).toHaveLength(1);
      expect(momMessages.json().items[0]).toMatchObject({
        text: "爸爸的生日是 5 月 12 日。",
        senderName: "老妈",
      });

      const dadMessages = await app.inject({ method: "GET", url: `/api/persons/${dadPersonId}/messages?limit=5` });
      expect(dadMessages.statusCode).toBe(200);
      expect(dadMessages.json().items).toHaveLength(1);
      expect(dadMessages.json().items[0]).toMatchObject({
        text: "我换工作了，在新公司做后端开发。",
        senderName: "老爸",
      });

      const emptyMessages = await app.inject({ method: "GET", url: "/api/persons/missing_person/messages" });
      expect(emptyMessages.statusCode).toBe(200);
      expect(emptyMessages.json().items).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("拒绝未授权的 Web 写操作", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const app = createWebApp(config);
    try {
      const response = await app.inject({ method: "POST", url: "/api/process/messages" });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ status: "failed", message: "Web 操作未授权。" });
    } finally {
      await app.close();
    }
  });
});
