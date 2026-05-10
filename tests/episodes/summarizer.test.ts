import { describe, expect, it } from "vitest";
import { summarizeEpisodeWindow } from "../../src/episodes/summarizer.js";
import type { EpisodeWindow } from "../../src/episodes/repository.js";
import type { ChatModel } from "../../src/rag/types.js";

describe("summarizeEpisodeWindow", () => {
  it("要求模型把碎片消息总结成可检索事实", async () => {
    const now = new Date("2026-05-10T08:00:00.000Z");
    const window: EpisodeWindow = {
      chatId: "chat_1",
      chatName: "家庭群",
      startedAt: "2026-05-01T10:00:00.000Z",
      endedAt: "2026-05-01T10:01:00.000Z",
      messages: [
        {
          id: "m1",
          chatId: "chat_1",
          chatName: "家庭群",
          senderName: "我",
          text: "我要发一个 API key 出来。",
          sentAt: "2026-05-01T10:00:00.000Z",
        },
        {
          id: "m2",
          chatId: "chat_1",
          chatName: "家庭群",
          senderName: "我",
          text: "sk-live-abc123",
          sentAt: "2026-05-01T10:01:00.000Z",
        },
      ],
    };
    const model: ChatModel = {
      async complete(messages) {
        expect(messages[0]?.content).toContain("碎片化闲聊");
        expect(messages[0]?.content).toContain("相对时间表述");
        expect(messages[0]?.content).toContain("基于每条消息前的发送时间戳推导为具体日期");
        expect(messages[1]?.content).toContain("当前时间：2026-05-10T08:00:00.000Z");
        expect(messages[1]?.content).toContain("我要发一个 API key 出来");
        expect(messages[1]?.content).toContain("sk-live-abc123");
        return "用户先说明要发送一个 API key，随后发送 sk-live-abc123，因此 sk-live-abc123 是该 API key。";
      },
    };

    await expect(summarizeEpisodeWindow(window, model, now)).resolves.toContain("[REDACTED_SECRET] 是该 API key");
  });
});
