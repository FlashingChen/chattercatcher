import { describe, expect, it } from "vitest";
import { FeishuMessageSender } from "../../src/feishu/sender.js";

describe("FeishuMessageSender", () => {
  it("通过飞书 im.v1.message.create 发送文本消息", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
            },
          },
        },
      },
    });

    await sender.sendTextToChat("oc_family", "回答");

    expect(calls).toEqual([
      {
        data: {
          receive_id: "oc_family",
          msg_type: "text",
          content: JSON.stringify({ text: "回答" }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });

  it("sends text messages with explicit Feishu mentions", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
            },
          },
        },
      },
    });

    await sender.sendTextToChat("oc_family", "记得带水杯", {
      mentions: [{ openId: "ou_mom", name: "妈妈" }],
    });

    expect(calls).toEqual([
      {
        data: {
          receive_id: "oc_family",
          msg_type: "text",
          content: JSON.stringify({ text: '<at user_id="ou_mom">妈妈</at> 记得带水杯' }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });

  it("优先支持回复指定飞书消息", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        message: {
          async create() {
            throw new Error("should not call create");
          },
          async reply(payload) {
            calls.push(payload);
          },
        },
      },
    });

    await sender.replyTextToMessage("om_question", "回答");

    expect(calls).toEqual([
      {
        path: {
          message_id: "om_question",
        },
        data: {
          msg_type: "text",
          content: JSON.stringify({ text: "回答" }),
        },
      },
    ]);
  });

  it("支持通过飞书 im.v1.message.reply 回复指定消息", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create() {
              throw new Error("should not call create");
            },
            async reply(payload) {
              calls.push(payload);
            },
          },
        },
      },
    });

    await sender.replyTextToMessage("om_question", "回答");

    expect(calls).toEqual([
      {
        path: {
          message_id: "om_question",
        },
        data: {
          msg_type: "text",
          content: JSON.stringify({ text: "回答" }),
        },
      },
    ]);
  });

  it("可以给指定消息添加表情回复", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create() {
              throw new Error("should not call create");
            },
          },
          messageReaction: {
            async create(payload) {
              calls.push(payload);
            },
          },
        },
      },
    });

    await sender.addReactionToMessage("om_question", "OK");

    expect(calls).toEqual([
      {
        path: {
          message_id: "om_question",
        },
        data: {
          reaction_type: {
            emoji_type: "OK",
          },
        },
      },
    ]);
  });
});
