import { describe, expect, it, vi } from "vitest";
import { askWithAgenticRag } from "../../src/rag/agentic-qa-service.js";
import type { RagSearchTool } from "../../src/rag/search-tools.js";
import type { ChatModel, EvidenceBlock, ToolChatResult } from "../../src/rag/types.js";

const evidenceA: EvidenceBlock = {
  id: "msg-1",
  text: "端午活动改到 2026/6/30，以这个为准。",
  score: 0.95,
  source: {
    type: "message",
    label: "家庭群消息",
    sender: "老妈",
    timestamp: "2026-04-25T08:00:00.000Z",
  },
};

const evidenceB: EvidenceBlock = {
  id: "episode-1",
  text: "预算上限维持 300 元。",
  score: 0.72,
  source: {
    type: "episode",
    label: "端午活动讨论",
    timestamp: "2026-04-24T08:00:00.000Z",
  },
};

function createSearchTool(name: string, execute: (input: unknown) => Promise<EvidenceBlock[]>): RagSearchTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
      additionalProperties: false,
    },
    execute,
  };
}

function createCompleteWithToolsMock(sequence: Array<ToolChatResult | ((messages: Parameters<NonNullable<ChatModel["completeWithTools"]>>[0]) => Promise<ToolChatResult>)>) {
  const mock = vi.fn(async (messages: Parameters<NonNullable<ChatModel["completeWithTools"]>>[0]) => {
    const next = sequence.shift();
    if (!next) {
      throw new Error("Missing completeWithTools mock response");
    }

    return typeof next === "function" ? next(messages) : next;
  });

  return mock;
}

describe("askWithAgenticRag", () => {
  it("runs a search tool and generates grounded answer from evidence", async () => {
    const now = new Date("2026-05-10T08:00:00.000Z");
    const tool = createSearchTool("hybrid_search", vi.fn(async () => [evidenceA]));
    const completeWithTools = createCompleteWithToolsMock([
      async (messages) => {
        const joinedMessages = messages.map((message) => message.content).join("\n\n");
        expect(joinedMessages).toContain("当前时间：2026-05-10T16:00:00+08:00（北京时间，UTC+8，Asia/Shanghai）");
        expect(joinedMessages).toContain("相对时间表述");
        return {
          content: "我先查一下。",
          toolCalls: [{ id: "call-1", name: "hybrid_search", input: { query: "端午活动什么时候" } }],
        };
      },
      {
        content: "检索完成。",
        toolCalls: [],
      },
    ]);

    const model: ChatModel = {
      completeWithTools,
      async complete(messages) {
        const joinedPrompt = messages.map((message) => message.content).join("\n\n");
        expect(joinedPrompt).toContain("检索证据");
        expect(joinedPrompt).toContain("[S1]");
        expect(joinedPrompt).toContain("当前时间：2026-05-10T16:00:00+08:00（北京时间，UTC+8，Asia/Shanghai）");
        return "端午活动目前是 2026/6/30。[S1]";
      },
    };

    const result = await askWithAgenticRag({
      question: "端午活动什么时候？",
      tools: [tool],
      model,
      now,
    });

    expect(tool.execute).toHaveBeenCalledWith({ query: "端午活动什么时候" });
    expect(result.answer).toBe("端午活动目前是 2026/6/30。[S1]");
    expect(result.citations).toHaveLength(1);
    expect(completeWithTools).toHaveBeenCalledTimes(2);
  });

  it("supports multiple searches and deduplicates evidence", async () => {
    const hybridSearch = createSearchTool("hybrid_search", vi.fn(async () => [evidenceA, evidenceB]));
    const searchMessages = createSearchTool("search_messages", vi.fn(async () => [evidenceA]));
    const completeWithTools = createCompleteWithToolsMock([
      {
        content: "先搜混合索引。",
        toolCalls: [{ id: "call-1", name: "hybrid_search", input: { query: "端午活动" } }],
      },
      {
        content: "再查消息。",
        toolCalls: [{ id: "call-2", name: "search_messages", input: { query: "活动日期" } }],
      },
      {
        content: "够了。",
        toolCalls: [],
      },
    ]);

    const model: ChatModel = {
      completeWithTools,
      async complete(_messages) {
        return "端午活动改到 2026/6/30，预算上限 300 元。[S1][S2]";
      },
    };

    const result = await askWithAgenticRag({
      question: "端午活动的日期和预算？",
      tools: [hybridSearch, searchMessages],
      model,
    });

    expect(result.answer).toContain("2026/6/30");
    expect(result.citations.map((item) => item.evidenceId)).toEqual(["msg-1", "episode-1"]);
  });

  it("returns no-evidence answer when model never searches", async () => {
    const model: ChatModel = {
      async complete() {
        return "不应该调用";
      },
      async completeWithTools() {
        return {
          content: "我直接回答。",
          toolCalls: [],
        };
      },
    };

    const result = await askWithAgenticRag({
      question: "端午活动什么时候？",
      tools: [],
      model,
    });

    expect(result).toEqual({
      answer: "不知道。当前本地知识库没有检索到足够证据。",
      citations: [],
    });
  });

  it("returns tool errors to the loop without throwing", async () => {
    const tool = createSearchTool("hybrid_search", vi.fn(async () => {
      throw new Error("检索服务暂时不可用");
    }));
    const completeWithTools = createCompleteWithToolsMock([
      {
        content: "先检索。",
        toolCalls: [{ id: "call-1", name: "hybrid_search", input: { query: "端午活动" } }],
      },
      async (messages) => {
        expect(messages[messages.length - 1]?.role).toBe("tool");
        expect(messages[messages.length - 1]?.content).toContain("检索服务暂时不可用");
        return {
          content: "那我先停止。",
          toolCalls: [],
        };
      },
    ]);

    const model: ChatModel = {
      completeWithTools,
      async complete() {
        return "不应该调用";
      },
    };

    const result = await askWithAgenticRag({
      question: "端午活动什么时候？",
      tools: [tool],
      model,
    });

    expect(result.answer).toContain("不知道");
    expect(result.citations).toEqual([]);
  });

  it("throws when model does not support tool calls", async () => {
    const model: ChatModel = {
      async complete() {
        return "不支持";
      },
    };

    await expect(
      askWithAgenticRag({
        question: "端午活动什么时候？",
        tools: [],
        model,
      }),
    ).rejects.toThrow("当前 LLM 客户端不支持工具调用。");
  });
});
