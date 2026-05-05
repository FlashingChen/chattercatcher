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
              input: { schedule: "0 9 * * *", prompt: "总结昨天群聊" },
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
});
