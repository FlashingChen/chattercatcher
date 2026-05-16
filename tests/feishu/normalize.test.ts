import { describe, expect, it } from "vitest";
import { extractFeishuAttachment, normalizeFeishuReceiveMessageEvent } from "../../src/feishu/normalize.js";

describe("normalizeFeishuReceiveMessageEvent", () => {
  it("归一化飞书文本消息", () => {
    const result = normalizeFeishuReceiveMessageEvent({
      event: {
        sender: {
          sender_id: {
            open_id: "ou_mom",
          },
        },
        message: {
          message_id: "om_1",
          chat_id: "oc_family",
          create_time: "1777111200000",
          message_type: "text",
          content: JSON.stringify({ text: "端午活动改到 2026/6/30，以这个为准。" }),
        },
      },
    });

    expect(result).toMatchObject({
      platform: "feishu",
      platformChatId: "oc_family",
      platformMessageId: "om_1",
      senderId: "ou_mom",
      senderName: "ou_mom",
      messageType: "text",
      text: "端午活动改到 2026/6/30，以这个为准。",
      rawPayload: {
        sender: {
          openId: "ou_mom",
        },
      },
    });
    expect(result?.sentAt).toBe("2026-04-25T10:00:00.000Z");
  });

  it("从富文本 post 中提取可检索文本", () => {
    const result = normalizeFeishuReceiveMessageEvent({
      event: {
        sender: { sender_id: { open_id: "ou_mom" } },
        message: {
          message_id: "om_2",
          chat_id: "oc_family",
          message_type: "post",
          content: JSON.stringify({
            post: {
              zh_cn: {
                title: "活动通知",
                content: [[{ tag: "text", text: "集合地点改到南门。" }]],
              },
            },
          }),
        },
      },
    });

    expect(result?.text).toBe("活动通知 集合地点改到南门。");
  });

  it("文件消息会生成可索引占位文本和附件元数据", () => {
    const result = normalizeFeishuReceiveMessageEvent({
      event: {
        sender: { sender_id: { open_id: "ou_mom" } },
        message: {
          message_id: "om_3",
          chat_id: "oc_family",
          message_type: "file",
          content: JSON.stringify({
            file_key: "file_v2_xxx",
            file_name: "报名表.pdf",
            file_size: "2048",
            mime_type: "application/pdf",
          }),
        },
      },
    });

    expect(result?.text).toBe("[文件] 报名表.pdf");
    expect(result?.rawPayload).toMatchObject({
      attachment: {
        platform: "feishu",
        kind: "file",
        fileKey: "file_v2_xxx",
        fileName: "报名表.pdf",
        mimeType: "application/pdf",
        size: 2048,
      },
    });
  });

  it("可以提取图片、语音和媒体附件元数据", () => {
    expect(extractFeishuAttachment("image", { image_key: "img_x" })).toMatchObject({
      kind: "image",
      fileKey: "img_x",
    });
    expect(extractFeishuAttachment("audio", { file_key: "audio_x" })).toMatchObject({
      kind: "audio",
      fileKey: "audio_x",
    });
    expect(extractFeishuAttachment("media", { file_key: "media_x", file_name: "视频.mp4" })).toMatchObject({
      kind: "media",
      fileKey: "media_x",
      fileName: "视频.mp4",
    });
  });

  it("无效事件返回 null", () => {
    expect(normalizeFeishuReceiveMessageEvent({ event: {} })).toBeNull();
  });
});
