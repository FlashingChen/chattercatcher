import * as lark from "@larksuiteoapi/node-sdk";
import fs from "node:fs/promises";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import { buildFeishuPostContent, formatTextWithMentions } from "./markdown-post.js";
import type { SendTextOptions } from "./markdown-post.js";

export type { FeishuTextMention, SendTextOptions } from "./markdown-post.js";

export interface MessageSender {
  sendTextToChat(chatId: string, text: string, options?: SendTextOptions): Promise<void>;
  sendImageToChat?(chatId: string, imagePath: string): Promise<void>;
  replyTextToMessage?(messageId: string, text: string): Promise<void>;
  addReactionToMessage?(messageId: string, emojiType: string): Promise<void>;
}

interface FeishuClientLike {
  im: {
    v1?: {
      message: {
        create(payload: {
          data: {
            receive_id: string;
            msg_type: string;
            content: string;
          };
          params: {
            receive_id_type: "chat_id";
          };
        }): Promise<unknown>;
        reply?: (payload: {
          path: {
            message_id: string;
          };
          data: {
            msg_type: string;
            content: string;
          };
        }) => Promise<unknown>;
      };
      image?: {
        create(payload: {
          data: {
            image_type: "message";
            image: Buffer;
          };
        }): Promise<unknown>;
      };
      messageReaction?: {
        create(payload: {
          path: {
            message_id: string;
          };
          data: {
            reaction_type: {
              emoji_type: string;
            };
          };
        }): Promise<unknown>;
      };
    };
    message?: {
      create(payload: {
        data: {
          receive_id: string;
          msg_type: string;
          content: string;
        };
        params: {
          receive_id_type: "chat_id";
        };
      }): Promise<unknown>;
      reply?: (payload: {
        path: {
          message_id: string;
        };
        data: {
          msg_type: string;
          content: string;
        };
      }) => Promise<unknown>;
    };
  };
}

export function mapDomain(domain: AppConfig["feishu"]["domain"]): lark.Domain {
  return domain === "lark" ? lark.Domain.Lark : lark.Domain.Feishu;
}

function extractImageKey(response: unknown): string {
  const data = response && typeof response === "object" ? (response as Record<string, unknown>) : {};
  const direct = data.image_key;
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const nested = data.data && typeof data.data === "object" ? (data.data as Record<string, unknown>).image_key : undefined;
  if (typeof nested === "string" && nested.trim()) {
    return nested.trim();
  }

  throw new Error("飞书图片上传响应缺少 image_key。");
}

function collectErrorFields(error: unknown): unknown[] {
  const fields: unknown[] = [];
  const seen = new Set<unknown>();

  function visit(value: unknown): void {
    if (value === undefined || value === null || seen.has(value)) {
      return;
    }

    fields.push(value);

    if (typeof value !== "object") {
      return;
    }

    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    visit(record.code);
    visit(record.errorCode);
    visit(record.msg);
    visit(record.message);
    visit(record.error);
    visit(record.response);
    visit(record.data);
  }

  visit(error);
  return fields;
}

function isRichTextCompatibilityError(error: unknown): boolean {
  return collectErrorFields(error).some((field) => {
    if (field === 230001) return true;
    if (typeof field === "string") {
      return /post|msg_type|content|unsupported|invalid/i.test(field);
    }
    return false;
  });
}

async function sendWithTextFallback(input: {
  sendPost: () => Promise<unknown>;
  sendText: () => Promise<unknown>;
}): Promise<void> {
  try {
    await input.sendPost();
  } catch (error) {
    if (!isRichTextCompatibilityError(error)) {
      throw error;
    }
    await input.sendText();
  }
}

export class FeishuMessageSender implements MessageSender {
  constructor(private readonly client: FeishuClientLike) {}

  static fromConfig(config: AppConfig, secrets: AppSecrets): FeishuMessageSender {
    const client = new lark.Client({
      appId: config.feishu.appId,
      appSecret: secrets.feishu.appSecret,
      domain: mapDomain(config.feishu.domain),
    }) as FeishuClientLike;

    return new FeishuMessageSender(client);
  }

  async sendTextToChat(chatId: string, text: string, options?: SendTextOptions): Promise<void> {
    const postPayload = {
      data: {
        receive_id: chatId,
        msg_type: "post",
        content: JSON.stringify(buildFeishuPostContent(text, options)),
      },
      params: {
        receive_id_type: "chat_id" as const,
      },
    };
    const textPayload = {
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text: formatTextWithMentions(text, options) }),
      },
      params: {
        receive_id_type: "chat_id" as const,
      },
    };

    if (this.client.im.v1?.message.create) {
      await sendWithTextFallback({
        sendPost: () => this.client.im.v1!.message.create(postPayload),
        sendText: () => this.client.im.v1!.message.create(textPayload),
      });
      return;
    }

    if (this.client.im.message?.create) {
      await sendWithTextFallback({
        sendPost: () => this.client.im.message!.create(postPayload),
        sendText: () => this.client.im.message!.create(textPayload),
      });
      return;
    }

    throw new Error("当前飞书 SDK 不支持消息发送接口。");
  }

  async sendImageToChat(chatId: string, imagePath: string): Promise<void> {
    const imageCreate = this.client.im.v1?.image?.create;
    if (!imageCreate) {
      throw new Error("当前飞书 SDK 不支持图片上传接口。");
    }

    const image = await fs.readFile(imagePath);
    const uploaded = await imageCreate({
      data: {
        image_type: "message",
        image,
      },
    });
    const imageKey = extractImageKey(uploaded);
    const payload = {
      data: {
        receive_id: chatId,
        msg_type: "image",
        content: JSON.stringify({ image_key: imageKey }),
      },
      params: {
        receive_id_type: "chat_id" as const,
      },
    };

    if (this.client.im.v1?.message.create) {
      await this.client.im.v1.message.create(payload);
      return;
    }

    if (this.client.im.message?.create) {
      await this.client.im.message.create(payload);
      return;
    }

    throw new Error("当前飞书 SDK 不支持消息发送接口。");
  }

  async replyTextToMessage(messageId: string, text: string): Promise<void> {
    const postPayload = {
      path: {
        message_id: messageId,
      },
      data: {
        msg_type: "post",
        content: JSON.stringify(buildFeishuPostContent(text)),
      },
    };
    const textPayload = {
      path: {
        message_id: messageId,
      },
      data: {
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
    };

    if (this.client.im.v1?.message.reply) {
      await sendWithTextFallback({
        sendPost: () => this.client.im.v1!.message.reply!(postPayload),
        sendText: () => this.client.im.v1!.message.reply!(textPayload),
      });
      return;
    }

    if (this.client.im.message?.reply) {
      await sendWithTextFallback({
        sendPost: () => this.client.im.message!.reply!(postPayload),
        sendText: () => this.client.im.message!.reply!(textPayload),
      });
      return;
    }

    throw new Error("当前飞书 SDK 不支持消息回复接口。");
  }

  async addReactionToMessage(messageId: string, emojiType: string): Promise<void> {
    if (!this.client.im.v1?.messageReaction?.create) {
      throw new Error("当前飞书 SDK 不支持消息表情回复接口。");
    }

    await this.client.im.v1.messageReaction.create({
      path: {
        message_id: messageId,
      },
      data: {
        reaction_type: {
          emoji_type: emojiType,
        },
      },
    });
  }
}
