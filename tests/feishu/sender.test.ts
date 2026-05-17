import { describe, expect, it } from "vitest";
import { FeishuMessageSender } from "../../src/feishu/sender.js";

describe("FeishuMessageSender", () => {
  it("通过飞书 im.v1.message.create 发送 Markdown 富文本消息", async () => {
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

    await sender.sendTextToChat("oc_family", "# 回答\n\n请看 **重点**");

    expect(calls).toEqual([
      {
        data: {
          receive_id: "oc_family",
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [
                  [{ tag: "text", text: "回答" }],
                  [{ tag: "text", text: "请看 重点" }],
                ],
              },
            },
          }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });

  it("sends rich text messages with explicit Feishu mentions", async () => {
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
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [
                  [{ tag: "text", text: "@妈妈 记得带水杯" }],
                ],
              },
            },
          }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });

  it("falls back to plain text when rich text sending fails", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
              if ((payload as { data: { msg_type: string } }).data.msg_type === "post") {
                throw new Error("post unsupported");
              }
            },
          },
        },
      },
    });

    await sender.sendTextToChat("oc_family", "**回答**", {
      mentions: [{ openId: "ou_mom", name: "妈妈" }],
    });

    expect(calls).toEqual([
      {
        data: {
          receive_id: "oc_family",
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [
                  [{ tag: "text", text: "@妈妈 回答" }],
                ],
              },
            },
          }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
      {
        data: {
          receive_id: "oc_family",
          msg_type: "text",
          content: JSON.stringify({ text: '<at user_id="ou_mom">妈妈</at> **回答**' }),
        },
        params: {
          receive_id_type: "chat_id",
        },
      },
    ]);
  });

  it("falls back to plain text when Feishu reports invalid rich text content", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
              if ((payload as { data: { msg_type: string } }).data.msg_type === "post") {
                const error = new Error("Request failed with status code 400");
                (error as unknown as { response: { data: { code: number; msg: string } } }).response = {
                  data: {
                    code: 230001,
                    msg: "Your request contains an invalid request parameter, ext=invalid message content.",
                  },
                };
                throw error;
              }
            },
          },
        },
      },
    });

    await sender.sendTextToChat("oc_family", "**回答**");

    expect(calls).toHaveLength(2);
    expect((calls[0] as { data: { msg_type: string } }).data.msg_type).toBe("post");
    expect((calls[1] as { data: { msg_type: string } }).data.msg_type).toBe("text");
  });

  it("does not fall back when rich text sending fails for non-format errors", async () => {
    const calls: unknown[] = [];
    const sender = new FeishuMessageSender({
      im: {
        v1: {
          message: {
            async create(payload) {
              calls.push(payload);
              throw new Error("network timeout");
            },
          },
        },
      },
    });

    await expect(sender.sendTextToChat("oc_family", "**回答**")).rejects.toThrow("network timeout");
    expect(calls).toHaveLength(1);
    expect((calls[0] as { data: { msg_type: string } }).data.msg_type).toBe("post");
  });

  it("优先支持用富文本回复指定飞书消息", async () => {
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

    await sender.replyTextToMessage("om_question", "# 回答");

    expect(calls).toEqual([
      {
        path: {
          message_id: "om_question",
        },
        data: {
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [[{ tag: "text", text: "回答" }]],
              },
            },
          }),
        },
      },
    ]);
  });

  it("回复富文本失败时降级为纯文本回复", async () => {
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
              if ((payload as { data: { msg_type: string } }).data.msg_type === "post") {
                throw new Error("post unsupported");
              }
            },
          },
        },
      },
    });

    await sender.replyTextToMessage("om_question", "**回答**");

    expect(calls).toEqual([
      {
        path: {
          message_id: "om_question",
        },
        data: {
          msg_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "",
                content: [[{ tag: "text", text: "回答" }]],
              },
            },
          }),
        },
      },
      {
        path: {
          message_id: "om_question",
        },
        data: {
          msg_type: "text",
          content: JSON.stringify({ text: "**回答**" }),
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
