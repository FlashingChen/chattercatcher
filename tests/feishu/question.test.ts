import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { FeishuMemberRepository } from "../../src/feishu/members.js";
import { FeishuQuestionHandler, getFeishuQuestionDecision } from "../../src/feishu/question.js";
import type { MessageSender } from "../../src/feishu/sender.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { QaLogRepository } from "../../src/rag/qa-logs.js";
import type { ChatModel, ToolChatResult } from "../../src/rag/types.js";

let testDir: string;

function createCompleteWithToolsMock(
  sequence: Array<
    ToolChatResult | ((messages: Parameters<NonNullable<ChatModel["completeWithTools"]>>[0]) => Promise<ToolChatResult>)
  >,
) {
  return vi.fn(async (messages: Parameters<NonNullable<ChatModel["completeWithTools"]>>[0]) => {
    const next = sequence.shift();
    if (!next) {
      throw new Error("Missing completeWithTools mock response");
    }

    return typeof next === "function" ? next(messages) : next;
  });
}

describe("getFeishuQuestionDecision", () => {
  it("默认必须 @ 才回答", () => {
    const config = createDefaultConfig();
    const decision = getFeishuQuestionDecision(
      {
        event: {
          message: {
            message_id: "om_1",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "端午活动什么时候？" }),
          },
        },
      },
      config,
    );

    expect(decision.shouldAnswer).toBe(false);
  });

  it("普通文本包含产品名但没有飞书 mention 时不回答", () => {
    const config = createDefaultConfig();
    const decision = getFeishuQuestionDecision(
      {
        event: {
          message: {
            message_id: "om_1",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "OK了 ChatterCatcher 复活了" }),
          },
        },
      },
      config,
    );

    expect(decision.shouldAnswer).toBe(false);
  });

  it("没有配置机器人 open_id 时不响应任意 @", () => {
    const config = createDefaultConfig();
    const decision = getFeishuQuestionDecision(
      {
        event: {
          message: {
            message_id: "om_1",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 test" }),
            mentions: [{ name: "川哥", key: "@_user_1", id: { open_id: "ou_chuan" } }],
          },
        },
      },
      config,
    );

    expect(decision.shouldAnswer).toBe(false);
  });

  it("@ 其他人时不回答", () => {
    const config = createDefaultConfig();
    config.feishu.botOpenId = "ou_bot";
    const decision = getFeishuQuestionDecision(
      {
        event: {
          message: {
            message_id: "om_1",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 test" }),
            mentions: [{ name: "川哥", key: "@_user_1", id: { open_id: "ou_chuan" } }],
          },
        },
      },
      config,
    );

    expect(decision.shouldAnswer).toBe(false);
  });

  it("提取 @ 后的问题文本", () => {
    const config = createDefaultConfig();
    config.feishu.botOpenId = "ou_bot";
    const decision = getFeishuQuestionDecision(
      {
        event: {
          message: {
            message_id: "om_1",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 端午活动什么时候？" }),
            mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
          },
        },
      },
      config,
    );

    expect(decision).toMatchObject({
      shouldAnswer: true,
      question: "端午活动什么时候？",
      chatId: "oc_family",
    });
  });
});

describe("FeishuQuestionHandler", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-question-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("通过 RAG 生成答案并发送到原群", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-10T08:00:00.000Z"));

    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const sent: Array<{ chatId: string; text: string }> = [];
    const replies: Array<{ messageId: string; text: string }> = [];
    const reactions: Array<{ messageId: string; emojiType: string }> = [];
    const sender: MessageSender = {
      async sendTextToChat(chatId, text) {
        sent.push({ chatId, text });
      },
      async replyTextToMessage(messageId, text) {
        replies.push({ messageId, text });
      },
      async addReactionToMessage(messageId, emojiType) {
        reactions.push({ messageId, emojiType });
      },
    };
    const completeWithTools = createCompleteWithToolsMock([
      async (messages) => {
        const joinedPrompt = messages.map((message) => message.content ?? "").join("\n");
        expect(joinedPrompt).toContain("当前时间：2026-05-10T16:00:00+08:00（北京时间，UTC+8，Asia/Shanghai）");
        expect(joinedPrompt).toContain("相对时间表述");
        expect(joinedPrompt).toContain("证据中每条消息的时间戳推导为具体日期");

        return {
          content: "我先查一下相关消息。",
          toolCalls: [{ id: "call-1", name: "search_messages", input: { query: "端午活动什么时候" } }],
        };
      },
      {
        content: "端午活动目前是 2026/6/30。引用：老妈在 2026-04-25 16:00 说：端午活动改到 2026/6/30，以这个为准。",
        toolCalls: [],
      },
    ]);
    const model: ChatModel = {
      completeWithTools,
      async complete(messages) {
        expect(messages[1]?.content).toContain("端午活动什么时候？");
        throw new Error("complete should not be called");
      },
    };

    try {
      const messages = new MessageRepository(database);
      messages.ingest({
        platform: "feishu",
        platformChatId: "oc_family",
        chatName: "家庭群",
        platformMessageId: "om_fact",
        senderId: "ou_mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30，以这个为准。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const decision = await new FeishuQuestionHandler({
        config,
        secrets,
        database,
        model,
        sender,
        thinkingEmojiType: "OK",
      }).handle({
        event: {
          message: {
            message_id: "om_question",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 端午活动什么时候？" }),
            mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
          },
        },
      });

      expect(decision.shouldAnswer).toBe(true);
      expect(reactions).toEqual([{ messageId: "om_question", emojiType: "OK" }]);
      expect(sent).toHaveLength(0);
      expect(replies).toHaveLength(1);
      expect(replies[0]).toMatchObject({
        messageId: "om_question",
      });
      expect(replies[0]?.text).toContain("端午活动目前是 2026/6/30");
      expect(replies[0]?.text).toContain("引用");
      expect(replies[0]?.text).toContain("老妈在 2026-04-25 16:00 说");
      expect(replies[0]?.text).toContain("端午活动改到 2026/6/30，以这个为准。");

      const qaLogs = new QaLogRepository(database).listRecent(10);
      expect(qaLogs).toHaveLength(1);
      expect(qaLogs[0]).toMatchObject({
        chatId: "oc_family",
        questionMessageId: "om_question",
        question: "端午活动什么时候？",
        answer: "端午活动目前是 2026/6/30。引用：老妈在 2026-04-25 16:00 说：端午活动改到 2026/6/30，以这个为准。",
        citations: [],
        retrievalDebug: {},
        status: "answered",
        error: null,
      });
    } finally {
      database.close();
      vi.useRealTimers();
    }
  });

  it("把当前群聊成员映射注入问答系统提示词", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const capturedMessages: Parameters<NonNullable<ChatModel["completeWithTools"]>>[0][] = [];

    try {
      const memberRepository = new FeishuMemberRepository(database);
      memberRepository.upsert({
        chatId: "oc_family",
        openId: "ou_mom",
        userId: "u_mom",
        userName: "妈妈",
        updatedAt: "2026-05-16T00:00:00.000Z",
      });
      memberRepository.upsert({
        chatId: "oc_other",
        openId: "ou_other",
        userName: "其他群昵称",
        updatedAt: "2026-05-16T00:00:00.000Z",
      });

      await new FeishuQuestionHandler({
        config,
        secrets,
        database,
        memberRepository,
        model: {
          completeWithTools: vi.fn(async (messages) => {
            capturedMessages.push(messages);
            return { content: "已知妈妈说端午活动在 2026/6/30。", toolCalls: [] };
          }),
          async complete() {
            throw new Error("complete should not be called");
          },
        },
        sender: {
          async sendTextToChat() {},
        },
      }).handle({
        event: {
          message: {
            message_id: "om_question",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 端午活动谁说的？" }),
            mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
          },
        },
      });

      expect(capturedMessages[0]?.[0]?.content).toContain("当前群聊成员 ID 与群昵称映射：\nou_mom = 妈妈");
      expect(capturedMessages[0]?.[0]?.content).toContain("回答中遇到上述 ID 时优先使用对应群昵称");
      expect(capturedMessages[0]?.[0]?.content).not.toContain("ou_other");
    } finally {
      database.close();
    }
  });

  it("把当前群聊最近问答注入系统提示词", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const capturedMessages: Parameters<NonNullable<ChatModel["completeWithTools"]>>[0][] = [];

    try {
      const qaLogs = new QaLogRepository(database);
      qaLogs.create({
        chatId: "oc_family",
        questionMessageId: "om_old_1",
        question: "端午活动哪天？",
        answer: "端午活动在 2026/6/30。",
        citations: [],
        retrievalDebug: {},
        status: "answered",
        createdAt: "2026-05-16T08:00:00.000Z",
      });
      qaLogs.create({
        chatId: "oc_other",
        questionMessageId: "om_other",
        question: "其他群问题",
        answer: "其他群答案。",
        citations: [],
        retrievalDebug: {},
        status: "answered",
        createdAt: "2026-05-16T08:01:00.000Z",
      });
      qaLogs.create({
        chatId: "oc_family",
        questionMessageId: "om_failed",
        question: "失败的问题",
        answer: "暂时无法回答：失败",
        citations: [],
        retrievalDebug: {},
        status: "failed",
        error: "失败",
        createdAt: "2026-05-16T08:02:00.000Z",
      });

      await new FeishuQuestionHandler({
        config,
        secrets,
        database,
        model: {
          completeWithTools: vi.fn(async (messages) => {
            capturedMessages.push(messages);
            return { content: "它是在 2026/6/30。", toolCalls: [] };
          }),
          async complete() {
            throw new Error("complete should not be called");
          },
        },
        sender: {
          async sendTextToChat() {},
        },
      }).handle({
        event: {
          message: {
            message_id: "om_question",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 那是哪天？" }),
            mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
          },
        },
      });

      const systemPrompt = capturedMessages[0]?.[0]?.content ?? "";
      expect(systemPrompt).toContain("近期对话上下文：");
      expect(systemPrompt).toContain("用户：端午活动哪天？");
      expect(systemPrompt).toContain("助手：端午活动在 2026/6/30。");
      expect(systemPrompt).toContain("如果与检索证据冲突，以检索证据为准");
      expect(systemPrompt).not.toContain("其他群问题");
      expect(systemPrompt).not.toContain("失败的问题");
    } finally {
      database.close();
    }
  });

  it("回答生成失败时向群里说明原因", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const sent: Array<{ chatId: string; text: string }> = [];

    try {
      const messages = new MessageRepository(database);
      messages.ingest({
        platform: "feishu",
        platformChatId: "oc_family",
        chatName: "家庭群",
        platformMessageId: "om_fact",
        senderId: "ou_mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      await new FeishuQuestionHandler({
        config,
        secrets,
        database,
        model: {
          completeWithTools: vi.fn(async () => {
            throw new Error("模型未配置");
          }),
          async complete() {
            throw new Error("complete should not be called");
          },
        },
        sender: {
          async sendTextToChat(chatId, text) {
            sent.push({ chatId, text });
          },
        },
      }).handle({
        event: {
          message: {
            message_id: "om_question",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 端午活动什么时候？" }),
            mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
          },
        },
      });

      expect(sent[0]?.text).toBe("收到，正在查。");
      expect(sent[1]?.text).toContain("暂时无法回答：模型未配置");

      const qaLogs = new QaLogRepository(database).listRecent(10);
      expect(qaLogs).toHaveLength(1);
      expect(qaLogs[0]).toMatchObject({
        chatId: "oc_family",
        questionMessageId: "om_question",
        question: "端午活动什么时候？",
        answer: "暂时无法回答：模型未配置",
        citations: [],
        retrievalDebug: {},
        status: "failed",
        error: "模型未配置",
      });
    } finally {
      database.close();
    }
  });

  it("即时反馈失败不影响后续回答", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const sent: Array<{ chatId: string; text: string }> = [];
    const replies: Array<{ messageId: string; text: string }> = [];

    try {
      new MessageRepository(database).ingest({
        platform: "feishu",
        platformChatId: "oc_family",
        chatName: "家庭群",
        platformMessageId: "om_fact",
        senderId: "ou_mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const decision = await new FeishuQuestionHandler({
        config,
        secrets,
        database,
        model: {
          completeWithTools: createCompleteWithToolsMock([
            {
              content: "我先查一下相关消息。",
              toolCalls: [{ id: "call-1", name: "search_messages", input: { query: "端午活动什么时候" } }],
            },
            {
              content: "端午活动目前是 2026/6/30。",
              toolCalls: [],
            },
          ]),
          async complete() {
            throw new Error("complete should not be called");
          },
        },
        sender: {
          async addReactionToMessage() {
            throw new Error("reaction disabled");
          },
          async replyTextToMessage(messageId, text) {
            replies.push({ messageId, text });
          },
          async sendTextToChat(chatId, text) {
            sent.push({ chatId, text });
          },
        },
      }).handle({
        event: {
          message: {
            message_id: "om_question",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 端午活动什么时候？" }),
            mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
          },
        },
      });

      expect(decision.shouldAnswer).toBe(true);
      expect(replies[0]).toEqual({ messageId: "om_question", text: "收到，正在查。" });
      expect(replies[1]?.text).toContain("端午活动目前是 2026/6/30");
      expect(sent).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("工具循环耗尽时调用 complete 兜底生成答案", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const sent: Array<{ chatId: string; text: string }> = [];

    try {
      new MessageRepository(database).ingest({
        platform: "feishu",
        platformChatId: "oc_family",
        chatName: "家庭群",
        platformMessageId: "om_fact",
        senderId: "ou_mom",
        senderName: "老妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30。",
        sentAt: "2026-04-25T08:00:00.000Z",
      });

      const completeWithTools = createCompleteWithToolsMock([
        { content: "查一下。", toolCalls: [{ id: "c1", name: "search_messages", input: { query: "x" } }] },
        { content: "再查。", toolCalls: [{ id: "c2", name: "search_messages", input: { query: "y" } }] },
        { content: "继续。", toolCalls: [{ id: "c3", name: "search_messages", input: { query: "z" } }] },
        { content: "还查。", toolCalls: [{ id: "c4", name: "search_messages", input: { query: "w" } }] },
      ]);

      let completeCalled = false;

      await new FeishuQuestionHandler({
        config,
        secrets,
        database,
        model: {
          completeWithTools,
          async complete(messages) {
            completeCalled = true;
            const lastMessage = messages[messages.length - 1];
            expect(lastMessage?.role).toBe("system");
            expect(lastMessage?.content).toContain("直接给出最终答案");
            return "根据搜索到的信息，端午活动在 2026/6/30。";
          },
        },
        sender: {
          async sendTextToChat(chatId, text) {
            sent.push({ chatId, text });
          },
        },
      }).handle({
        event: {
          message: {
            message_id: "om_question",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 端午活动什么时候？" }),
            mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
          },
        },
      });

      expect(completeCalled).toBe(true);
      expect(sent[0]?.text).toBe("收到，正在查。");
      expect(sent[1]?.text).toContain("2026/6/30");
      expect(sent[1]?.text).not.toContain("定时任务操作已提交");
    } finally {
      database.close();
    }
  });

  it("模型返回原始工具标记时不直接发到群里", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    const database = openDatabase(config);
    const sent: Array<{ chatId: string; text: string }> = [];

    try {
      new MessageRepository(database).ingest({
        platform: "feishu",
        platformChatId: "oc_family",
        chatName: "家庭群",
        platformMessageId: "om_fact",
        senderId: "ou_mom",
        senderName: "老妈",
        messageType: "text",
        text: "npm publish 需要用户自己执行。",
        sentAt: "2026-05-10T08:00:00.000Z",
      });

      await new FeishuQuestionHandler({
        config,
        secrets,
        database,
        model: {
          completeWithTools: createCompleteWithToolsMock([
            {
              content:
                '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="search_messages">\n<｜｜DSML｜｜parameter name="limit" string="false">15</｜｜DSML｜｜parameter>\n<｜｜DSML｜｜parameter name="query" string="true">npm</｜｜DSML｜｜parameter>\n</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>',
              toolCalls: [],
            },
          ]),
          async complete(messages) {
            expect(messages.at(-1)?.content).toContain("直接给出最终答案");
            return "查到的信息是：npm publish 需要用户自己执行。";
          },
        },
        sender: {
          async sendTextToChat(chatId, text) {
            sent.push({ chatId, text });
          },
        },
      }).handle({
        event: {
          message: {
            message_id: "om_question",
            chat_id: "oc_family",
            message_type: "text",
            content: JSON.stringify({ text: "@_user_1 npm 怎么发布？" }),
            mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
          },
        },
      });

      expect(sent[0]?.text).toBe("收到，正在查。");
      expect(sent[1]?.text).toContain("npm publish 需要用户自己执行");
      expect(sent[1]?.text).not.toContain("DSML");
    } finally {
      database.close();
    }
  });
});
