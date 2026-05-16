import { describe, expect, it, vi } from "vitest";
import { generateCronJobMessage } from "../../src/cron/generator.js";
import type { RagSearchTool } from "../../src/rag/search-tools.js";
import type { ChatMessage, ChatModel, ChatTool, ToolChatResult } from "../../src/rag/types.js";

class ModelWithSearch implements ChatModel {
  async complete(messages: ChatMessage[]): Promise<string> {
    expect(messages.at(-1)?.content).toContain("证据：");
    return "昨天群里确认端午活动改到 6 月 30 日。";
  }

  async completeWithTools(messages: ChatMessage[], tools: ChatTool[]): Promise<ToolChatResult> {
    const hasToolResult = messages.some((message) => message.role === "tool");
    if (hasToolResult) {
      return { content: "证据已足够。", toolCalls: [] };
    }
    expect(tools.map((tool) => tool.name)).toContain("hybrid_search");
    return { content: "", toolCalls: [{ id: "call-1", name: "hybrid_search", input: { query: "昨天 群聊 总结", limit: 3 } }] };
  }
}

describe("generateCronJobMessage", () => {
  it("uses RAG tools and returns final sendable text", async () => {
    const tool: RagSearchTool = {
      name: "hybrid_search",
      description: "Search evidence.",
      inputSchema: { type: "object" },
      execute: async () => [
        {
          id: "evidence-1",
          text: "端午活动改到 2026/6/30。",
          score: 1,
          source: { type: "message", label: "家庭群" },
        },
      ],
    };

    await expect(
      generateCronJobMessage({
        prompt: "总结昨天群聊",
        model: new ModelWithSearch(),
        tools: [tool],
        now: new Date("2026-05-05T09:00:00.000Z"),
      }),
    ).resolves.toBe("昨天群里确认端午活动改到 6 月 30 日。");
  });

  it("injects member mapping into cron generation prompts", async () => {
    const captured: ChatMessage[][] = [];
    const model: ChatModel = {
      async completeWithTools(messages) {
        captured.push(messages);
        return { content: "定时消息", toolCalls: [] };
      },
      async complete() {
        return "定时消息";
      },
    };

    await generateCronJobMessage({
      prompt: "提醒妈妈带水杯",
      model,
      tools: [],
      now: new Date("2026-05-05T09:00:00.000Z"),
      memberPrompt: "当前群聊成员 ID 与群昵称映射：\nou_mom = 妈妈",
    });

    expect(captured[0]?.[0]?.content).toContain("当前群聊成员 ID 与群昵称映射：\nou_mom = 妈妈");
    expect(captured[0]?.[0]?.content).toContain("生成消息时遇到上述 ID 时优先使用对应群昵称");
  });

  it("throws when the model cannot call tools", async () => {
    const model: ChatModel = {
      async complete() {
        return "不会执行";
      },
    };

    await expect(
      generateCronJobMessage({ prompt: "总结", model, tools: [], now: new Date("2026-05-05T09:00:00.000Z") }),
    ).rejects.toThrow("当前 LLM 客户端不支持工具调用。");
  });

  it("feeds tool errors back to the model before final generation", async () => {
    const tool: RagSearchTool = {
      name: "hybrid_search",
      description: "Search evidence.",
      inputSchema: { type: "object" },
      async execute() {
        throw new Error("检索失败");
      },
    };
    const completeWithTools = vi.fn(async (messages: ChatMessage[]): Promise<ToolChatResult> => {
      if (messages.some((message) => message.role === "tool")) {
        expect(messages.at(-1)?.content).toContain("检索失败");
        return { content: "继续生成", toolCalls: [] };
      }

      return { content: "", toolCalls: [{ id: "call-1", name: "hybrid_search", input: { query: "总结" } }] };
    });
    const model: ChatModel = {
      completeWithTools,
      async complete(messages) {
        expect(messages.at(-1)?.content).toContain("无检索证据。");
        return "没有找到可用证据。";
      },
    };

    await expect(
      generateCronJobMessage({ prompt: "总结", model, tools: [tool], now: new Date("2026-05-05T09:00:00.000Z") }),
    ).resolves.toBe("没有找到可用证据。");
    expect(completeWithTools).toHaveBeenCalledTimes(2);
  });

  it("stops collecting evidence at the model turn limit", async () => {
    const tool: RagSearchTool = {
      name: "hybrid_search",
      description: "Search evidence.",
      inputSchema: { type: "object" },
      execute: async () => [{ id: "evidence-1", text: "第一条证据", score: 1, source: { type: "message", label: "群聊" } }],
    };
    const completeWithTools = vi.fn(async (): Promise<ToolChatResult> => ({
      content: "继续查",
      toolCalls: [{ id: "call-1", name: "hybrid_search", input: { query: "总结" } }],
    }));
    const model: ChatModel = {
      completeWithTools,
      async complete(messages) {
        expect(messages.at(-1)?.content).toContain("第一条证据");
        return "基于已找到的证据生成。";
      },
    };

    await expect(
      generateCronJobMessage({
        prompt: "总结",
        model,
        tools: [tool],
        now: new Date("2026-05-05T09:00:00.000Z"),
        maxModelTurns: 2,
      }),
    ).resolves.toBe("基于已找到的证据生成。");
    expect(completeWithTools).toHaveBeenCalledTimes(2);
  });

  it("stops collecting evidence at the tool call limit", async () => {
    const tool: RagSearchTool = {
      name: "hybrid_search",
      description: "Search evidence.",
      inputSchema: { type: "object" },
      execute: async () => [{ id: "evidence-1", text: "第一条证据", score: 1, source: { type: "message", label: "群聊" } }],
    };
    const completeWithTools = vi.fn(async (): Promise<ToolChatResult> => ({
      content: "继续查",
      toolCalls: [
        { id: "call-1", name: "hybrid_search", input: { query: "总结" } },
        { id: "call-2", name: "hybrid_search", input: { query: "总结" } },
      ],
    }));
    const model: ChatModel = {
      completeWithTools,
      async complete(messages) {
        expect(messages.at(-1)?.content).toContain("第一条证据");
        return "工具次数用尽后生成。";
      },
    };

    await expect(
      generateCronJobMessage({
        prompt: "总结",
        model,
        tools: [tool],
        now: new Date("2026-05-05T09:00:00.000Z"),
        maxToolCalls: 1,
      }),
    ).resolves.toBe("工具次数用尽后生成。");
    expect(completeWithTools).toHaveBeenCalledTimes(1);
  });
});
