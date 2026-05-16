import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { CronJobRepository } from "../../src/cron/jobs.js";
import { openDatabase } from "../../src/db/database.js";
import { FeishuQuestionHandler } from "../../src/feishu/question.js";
import type { MessageSender } from "../../src/feishu/sender.js";
import type { ChatMessage, ChatModel, ChatTool, ToolChatResult } from "../../src/rag/types.js";

let testDir: string;

function createToolLoopModel(sequence: Array<ToolChatResult | ((messages: ChatMessage[], tools: ChatTool[]) => Promise<ToolChatResult>)>): ChatModel {
  const completeWithTools = vi.fn(async (messages: ChatMessage[], tools: ChatTool[]) => {
    const next = sequence.shift();
    if (!next) {
      throw new Error("Missing completeWithTools mock response");
    }

    return typeof next === "function" ? next(messages, tools) : next;
  });

  return {
    completeWithTools,
    async complete() {
      throw new Error("complete should not be called in tool loop tests");
    },
  };
}

describe("FeishuQuestionHandler cron tools", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-feishu-cron-tools-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("creates cron jobs in the current chat with sender open id", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "bot-open-id";
    const database = openDatabase(config);
    const secrets = createDefaultSecrets();
    const sent: string[] = [];
    const sender: MessageSender = {
      async sendTextToChat(_chatId, text) {
        sent.push(text);
      },
      async replyTextToMessage(_messageId, text) {
        sent.push(text);
      },
    };
    const resolveUniqueName = vi.fn(async (chatId: string, userName: string) => {
      expect(chatId).toBe("chat-a");
      expect(userName).toBe("妈妈");
      return {
        chatId,
        openId: "ou_mom",
        userId: "u_mom",
        userName,
        updatedAt: "2026-05-16T00:00:00.000Z",
      };
    });
    const model = createToolLoopModel([
      async (_messages, tools) => {
        expect(tools.map((tool) => tool.name)).toEqual(
          expect.arrayContaining(["search_messages", "search_episodes", "create_cron_job", "list_cron_jobs", "delete_cron_job"]),
        );
        return {
          content: "我来创建定时任务。",
          toolCalls: [
            {
              id: "call-1",
              name: "create_cron_job",
              input: { schedule: "0 9 * * *", prompt: "总结昨天群聊", mentionTargetName: "妈妈" },
            },
          ],
        };
      },
      async (messages) => {
        const toolMessage = messages.at(-1);
        expect(toolMessage).toMatchObject({ role: "tool", toolCallId: "call-1" });
        expect(toolMessage?.content).toContain('"ok":true');
        expect(toolMessage?.content).toContain('"chatId":"chat-a"');
        return { content: "定时任务操作完成。", toolCalls: [] };
      },
    ]);

    try {
      const handler = new FeishuQuestionHandler({ config, secrets, database, model, sender, memberResolver: { resolveUniqueName } });
      await handler.handle({
        event: {
          sender: {
            sender_id: {
              open_id: "user-a",
            },
          },
          message: {
            chat_id: "chat-a",
            message_id: "message-a",
            message_type: "text",
            content: JSON.stringify({ text: "@bot 每天 9 点总结昨天群聊" }),
            mentions: [{ key: "@bot", name: "bot", id: { open_id: "bot-open-id" } }],
          },
        },
      });

      const jobs = new CronJobRepository(database).listByChat("chat-a");
      const qaLogs = database.prepare("SELECT answer, status, error FROM qa_logs ORDER BY created_at DESC LIMIT 1").all() as Array<{ answer: string; status: string; error: string | null }>;
      expect(qaLogs).toHaveLength(1);
      expect(qaLogs[0]).toMatchObject({ status: "answered", error: null, answer: "定时任务操作完成。" });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        chatId: "chat-a",
        createdByOpenId: "user-a",
        schedule: "0 9 * * *",
        prompt: "总结昨天群聊",
        mentionTargetName: "妈妈",
        mentionOpenId: "ou_mom",
        mentionUserId: "u_mom",
      });
      expect(sent).toContain("定时任务操作完成。");
    } finally {
      database.close();
    }
  });

  it("deletes jobs only within the current chat", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "bot-open-id";
    const database = openDatabase(config);
    const secrets = createDefaultSecrets();
    const sent: string[] = [];
    const sender: MessageSender = {
      async sendTextToChat(_chatId, text) {
        sent.push(text);
      },
      async replyTextToMessage(_messageId, text) {
        sent.push(text);
      },
    };
    const model = createToolLoopModel([
      {
        content: "我来删除定时任务。",
        toolCalls: [{ id: "call-1", name: "delete_cron_job", input: { id: "job-to-delete" } }],
      },
      async (messages) => {
        const toolMessage = messages.at(-1);
        expect(toolMessage).toMatchObject({ role: "tool", toolCallId: "call-1" });
        expect(toolMessage?.content).toContain('"ok":false');
        return { content: "定时任务操作完成。", toolCalls: [] };
      },
    ]);

    try {
      const repository = new CronJobRepository(database);
      const otherJob = repository.create({ chatId: "chat-b", createdByOpenId: "user-b", schedule: "0 9 * * *", prompt: "总结 chat-b" });
      database.prepare("UPDATE cron_jobs SET id = ? WHERE id = ?").run("job-to-delete", otherJob.id);

      const handler = new FeishuQuestionHandler({ config, secrets, database, model, sender });
      await handler.handle({
        event: {
          sender: {
            sender_id: {
              open_id: "user-a",
            },
          },
          message: {
            chat_id: "chat-a",
            message_id: "message-a",
            message_type: "text",
            content: JSON.stringify({ text: "@bot 删除 job-to-delete" }),
            mentions: [{ key: "@bot", name: "bot", id: { open_id: "bot-open-id" } }],
          },
        },
      });

      expect(new CronJobRepository(database).listByChat("chat-b")).toEqual([
        expect.objectContaining({ id: "job-to-delete", chatId: "chat-b", status: "active" }),
      ]);
      expect(sent).toContain("定时任务操作完成。");
    } finally {
      database.close();
    }
  });

  it("lists cron jobs only from the current chat through Feishu tool loop", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "bot-open-id";
    const database = openDatabase(config);
    const secrets = createDefaultSecrets();
    const sent: string[] = [];
    const sender: MessageSender = {
      async sendTextToChat(_chatId, text) {
        sent.push(text);
      },
      async replyTextToMessage(_messageId, text) {
        sent.push(text);
      },
    };
    const model = createToolLoopModel([
      {
        content: "我来查看定时任务。",
        toolCalls: [{ id: "call-1", name: "list_cron_jobs", input: {} }],
      },
      async (messages) => {
        const toolMessage = messages.at(-1);
        expect(toolMessage).toMatchObject({ role: "tool", toolCallId: "call-1" });
        expect(toolMessage?.content).toContain('\"prompt\":\"总结 chat-a\"');
        expect(toolMessage?.content).not.toContain("总结 chat-b");
        return { content: "当前群有 1 个定时任务。", toolCalls: [] };
      },
    ]);

    try {
      const repository = new CronJobRepository(database);
      repository.create({ chatId: "chat-a", schedule: "0 9 * * *", prompt: "总结 chat-a" });
      repository.create({ chatId: "chat-b", schedule: "0 10 * * *", prompt: "总结 chat-b" });

      const handler = new FeishuQuestionHandler({ config, secrets, database, model, sender });
      await handler.handle({
        event: {
          sender: {
            sender_id: {
              open_id: "user-a",
            },
          },
          message: {
            chat_id: "chat-a",
            message_id: "message-a",
            message_type: "text",
            content: JSON.stringify({ text: "@bot 查看定时任务" }),
            mentions: [{ key: "@bot", name: "bot", id: { open_id: "bot-open-id" } }],
          },
        },
      });

      expect(sent).toContain("当前群有 1 个定时任务。");
    } finally {
      database.close();
    }
  });

  it("passes unknown tool errors back into the Feishu tool loop", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "bot-open-id";
    const database = openDatabase(config);
    const secrets = createDefaultSecrets();
    const sent: string[] = [];
    const sender: MessageSender = {
      async sendTextToChat(_chatId, text) {
        sent.push(text);
      },
      async replyTextToMessage(_messageId, text) {
        sent.push(text);
      },
    };
    const model = createToolLoopModel([
      {
        content: "我来调用工具。",
        toolCalls: [{ id: "call-1", name: "unknown_tool", input: {} }],
      },
      async (messages) => {
        const toolMessage = messages.at(-1);
        expect(toolMessage).toMatchObject({ role: "tool", toolCallId: "call-1" });
        expect(toolMessage?.content).toContain("未知工具：unknown_tool");
        return { content: "工具不存在，无法完成。", toolCalls: [] };
      },
    ]);

    try {
      const handler = new FeishuQuestionHandler({ config, secrets, database, model, sender });
      await handler.handle({
        event: {
          sender: {
            sender_id: {
              open_id: "user-a",
            },
          },
          message: {
            chat_id: "chat-a",
            message_id: "message-a",
            message_type: "text",
            content: JSON.stringify({ text: "@bot 调用未知工具" }),
            mentions: [{ key: "@bot", name: "bot", id: { open_id: "bot-open-id" } }],
          },
        },
      });

      expect(sent).toContain("工具不存在，无法完成。");
    } finally {
      database.close();
    }
  });

  it("stops cleanly when the Feishu tool loop reaches its model turn limit", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "bot-open-id";
    const database = openDatabase(config);
    const secrets = createDefaultSecrets();
    const sent: string[] = [];
    const sender: MessageSender = {
      async sendTextToChat(_chatId, text) {
        sent.push(text);
      },
      async replyTextToMessage(_messageId, text) {
        sent.push(text);
      },
    };
    const model = createToolLoopModel([
      ...Array.from({ length: 4 }, (_item, index) => ({
        content: "继续查看定时任务。",
        toolCalls: [{ id: `call-${index + 1}`, name: "list_cron_jobs", input: {} }],
      })),
      {
        content: "不应该继续调用模型。",
        toolCalls: [],
      },
    ]);
    // Override complete() to support the salvage step
    model.complete = vi.fn(async () => "抱歉，回答生成失败，请稍后重试。");

    try {
      const handler = new FeishuQuestionHandler({ config, secrets, database, model, sender });
      await handler.handle({
        event: {
          sender: {
            sender_id: {
              open_id: "user-a",
            },
          },
          message: {
            chat_id: "chat-a",
            message_id: "message-a",
            message_type: "text",
            content: JSON.stringify({ text: "@bot 一直查看定时任务" }),
            mentions: [{ key: "@bot", name: "bot", id: { open_id: "bot-open-id" } }],
          },
        },
      });

      expect(sent).toContain("抱歉，回答生成失败，请稍后重试。");
    } finally {
      database.close();
    }
  });

  it("stops cleanly when the Feishu tool loop reaches its tool call limit", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.botOpenId = "bot-open-id";
    const database = openDatabase(config);
    const secrets = createDefaultSecrets();
    const sent: string[] = [];
    const sender: MessageSender = {
      async sendTextToChat(_chatId, text) {
        sent.push(text);
      },
      async replyTextToMessage(_messageId, text) {
        sent.push(text);
      },
    };
    const model = createToolLoopModel([
      {
        content: "继续查看定时任务。",
        toolCalls: Array.from({ length: 9 }, (_item, index) => ({
          id: `call-${index + 1}`,
          name: "list_cron_jobs",
          input: {},
        })),
      },
      {
        content: "不应该继续调用模型。",
        toolCalls: [],
      },
    ]);

    try {
      const handler = new FeishuQuestionHandler({ config, secrets, database, model, sender });
      await handler.handle({
        event: {
          sender: {
            sender_id: {
              open_id: "user-a",
            },
          },
          message: {
            chat_id: "chat-a",
            message_id: "message-a",
            message_type: "text",
            content: JSON.stringify({ text: "@bot 连续查看很多次定时任务" }),
            mentions: [{ key: "@bot", name: "bot", id: { open_id: "bot-open-id" } }],
          },
        },
      });

      expect(sent).toContain("工具调用次数已达到上限，请缩小请求后重试。");
    } finally {
      database.close();
    }
  });
});
