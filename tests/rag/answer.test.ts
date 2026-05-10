import { describe, expect, it } from "vitest";
import { buildEvidencePrompt, generateGroundedAnswer, rankEvidenceForPrompt } from "../../src/rag/answer.js";
import type { ChatModel, EvidenceBlock } from "../../src/rag/types.js";

const now = new Date("2026-05-10T08:00:00.000Z");

const evidence: EvidenceBlock[] = [
  {
    id: "msg-1",
    text: "端午活动改到 2026/6/30，以这个为准。",
    score: 0.95,
    source: {
      type: "message",
      label: "家庭群消息",
      sender: "老妈",
      timestamp: "2026-04-25T08:00:00.000Z",
    },
  },
];

describe("RAG answer boundary", () => {
  it("没有检索证据时拒绝生成答案", () => {
    expect(() => buildEvidencePrompt({ question: "端午活动什么时候？", evidence: [], now })).toThrow(
      "RAG evidence is required",
    );
  });

  it("只把检索证据放入答案 prompt，并生成引用映射", () => {
    const prompt = buildEvidencePrompt({ question: "端午活动什么时候？", evidence, now });

    expect(prompt.citations).toEqual([
      {
        marker: "S1",
        evidenceId: "msg-1",
        source: evidence[0]?.source,
        text: "端午活动改到 2026/6/30，以这个为准。",
      },
    ]);
    expect(prompt.messages[0]?.content).toContain("证据互相矛盾");
    expect(prompt.messages[0]?.content).toContain("相对时间表述");
    expect(prompt.messages[0]?.content).toContain("证据中每条消息标注了发送时间");
    expect(prompt.messages[1]?.content).toContain("当前时间：2026-05-10T08:00:00.000Z");
    expect(prompt.messages[1]?.content).toContain("检索证据");
    expect(prompt.messages[1]?.content).toContain("[S1]");
    expect(prompt.messages[1]?.content).toContain("端午活动改到 2026/6/30");
  });

  it("冲突证据分数接近时优先较新的明确来源", () => {
    const ranked = rankEvidenceForPrompt([
      {
        id: "old",
        text: "端午活动是 2026/5/30。",
        score: 0.9,
        source: { type: "message", label: "家庭群", timestamp: "2026-04-24T08:00:00.000Z" },
      },
      {
        id: "new",
        text: "端午活动改到 2026/6/30，以这个为准。",
        score: 0.82,
        source: { type: "message", label: "家庭群", timestamp: "2026-04-25T08:00:00.000Z" },
      },
    ]);

    expect(ranked.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("分数差距明显时仍保留相关性优先", () => {
    const ranked = rankEvidenceForPrompt([
      {
        id: "old-relevant",
        text: "端午活动改到 2026/6/30。",
        score: 0.95,
        source: { type: "message", label: "家庭群", timestamp: "2026-04-24T08:00:00.000Z" },
      },
      {
        id: "new-weak",
        text: "大家晚点再看。",
        score: 0.5,
        source: { type: "message", label: "家庭群", timestamp: "2026-04-25T08:00:00.000Z" },
      },
    ]);

    expect(ranked.map((item) => item.id)).toEqual(["old-relevant", "new-weak"]);
  });

  it("答案生成器返回模型答案和证据引用", async () => {
    const model: ChatModel = {
      async complete(messages) {
        expect(messages.map((message) => message.content).join("\n")).toContain("[S1]");
        expect(messages.map((message) => message.content).join("\n")).toContain(
          "当前时间：2026-05-10T08:00:00.000Z",
        );
        return "端午活动目前是 2026/6/30。[S1]";
      },
    };

    const result = await generateGroundedAnswer({
      question: "端午活动什么时候？",
      evidence,
      model,
      now,
    });

    expect(result.answer).toBe("端午活动目前是 2026/6/30。[S1]");
    expect(result.citations).toHaveLength(1);
  });
});
