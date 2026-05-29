import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import type { FeishuMemberResolver } from "../../src/feishu/members.js";
import { FeishuResourceDownloader } from "../../src/feishu/resource-downloader.js";
import { GatewayIngestor } from "../../src/gateway/ingest.js";
import { MessageRepository } from "../../src/messages/repository.js";

import { ProfileRepository } from "../../src/profiles/repository.js";
import { ImageMultimodalTaskRepository } from "../../src/multimodal/tasks.js";
import { MessageFtsRetriever } from "../../src/rag/message-retriever.js";

let testDir: string;

describe("GatewayIngestor", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-gateway-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("把飞书事件写入消息库并可作为 RAG 证据检索", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const result = new GatewayIngestor(database).ingestFeishuEvent({
        event: {
          sender: { sender_id: { open_id: "ou_mom" } },
          message: {
            message_id: "om_1",
            chat_id: "oc_family",
            create_time: "1777111200000",
            message_type: "text",
            content: JSON.stringify({ text: "端午活动改到 2026/6/30，以这个为准。" }),
          },
        },
      });

      const messages = new MessageRepository(database);
      const retriever = new MessageFtsRetriever(messages);
      const evidence = await retriever.retrieve("端午活动什么时候");

      expect(result.accepted).toBe(true);
      expect(messages.getMessageCount()).toBe(1);
      expect(evidence[0]?.text).toContain("2026/6/30");
      expect(evidence[0]?.source).toMatchObject({
        type: "message",
        label: "oc_family",
        sender: "ou_mom",
      });
    } finally {
      database.close();
    }
  });

  it("重复飞书事件会标记 duplicate，避免重复触发回答", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const ingestor = new GatewayIngestor(database);
      const payload = {
        event: {
          sender: { sender_id: { open_id: "ou_mom" } },
          message: {
            message_id: "om_duplicate",
            chat_id: "oc_family",
            create_time: "1777111200000",
            message_type: "text",
            content: JSON.stringify({ text: "@小陈 编程课什么时候" }),
          },
        },
      };

      const first = ingestor.ingestFeishuEvent(payload);
      const second = ingestor.ingestFeishuEvent(payload);

      expect(first).toMatchObject({ accepted: true, duplicate: false });
      expect(second).toMatchObject({ accepted: true, duplicate: true, messageId: first.messageId });
      expect(new MessageRepository(database).getMessageCount()).toBe(1);
    } finally {
      database.close();
    }
  });

  it("ingests Feishu messages with a stable person id", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const profiles = new ProfileRepository(database);
      const ingestor = new GatewayIngestor(database, { profiles });

      const result = ingestor.ingestFeishuEvent({
        event: {
          sender: { sender_id: { open_id: "ou_123" } },
          message: {
            message_id: "om_msg",
            chat_id: "oc_chat",
            create_time: "1777111200000",
            message_type: "text",
            content: JSON.stringify({ text: "我今天医院值夜班" }),
          },
        },
      });

      const row = database
        .prepare("SELECT person_id AS personId FROM messages WHERE id = ?")
        .get(result.messageId) as { personId: string | null } | undefined;

      expect(result.accepted).toBe(true);
      expect(row?.personId).toMatch(/^person_/);
      expect(profiles.getPersonProfile(row!.personId!)?.person.primaryName).toBe("ou_123");
    } finally {
      database.close();
    }
  });

  it("resolves Feishu sender name before storing new messages", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const ingestor = new GatewayIngestor(database);
      const resolveOpenIdName = vi.fn(async (chatId: string, openId: string) => {
        expect(chatId).toBe("oc_family");
        expect(openId).toBe("ou_mom");
        return "妈妈";
      });
      const resolver = {
        resolveOpenIdName,
      } as Pick<FeishuMemberResolver, "resolveOpenIdName">;

      const result = await ingestor.ingestFeishuEventWithMembers({
        payload: {
          event: {
            sender: { sender_id: { open_id: "ou_mom" } },
            message: {
              message_id: "om_1",
              chat_id: "oc_family",
              message_type: "text",
              content: JSON.stringify({ text: "今晚记得带水杯" }),
            },
          },
        },
        memberResolver: resolver,
      });

      const stored = database
        .prepare(
          `
            SELECT sender_id AS senderId, sender_name AS senderName
            FROM messages
            WHERE platform = ? AND platform_message_id = ?
          `,
        )
        .get("feishu", "om_1") as { senderId: string; senderName: string } | undefined;

      expect(result.message).toMatchObject({ senderId: "ou_mom", senderName: "妈妈" });
      expect(stored).toMatchObject({ senderId: "ou_mom", senderName: "妈妈" });
      expect(resolveOpenIdName).toHaveBeenCalledTimes(1);
    } finally {
      database.close();
    }
  });

  it("falls back without resolver when sender open_id is missing", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const ingestor = new GatewayIngestor(database);
      const resolveOpenIdName = vi.fn(async () => "should-not-be-used");
      const resolver = {
        resolveOpenIdName,
      } as Pick<FeishuMemberResolver, "resolveOpenIdName">;

      const result = await ingestor.ingestFeishuEventWithMembers({
        payload: {
          event: {
            sender: { sender_id: { union_id: "on_union_only" } },
            message: {
              message_id: "om_no_open_id",
              chat_id: "oc_family",
              message_type: "text",
              content: JSON.stringify({ text: "没有 open_id 也能入库" }),
            },
          },
        },
        memberResolver: resolver,
      });

      expect(result.message).toMatchObject({
        senderId: "on_union_only",
        senderName: "on_union_only",
      });
      expect(resolveOpenIdName).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("does not resolve sender nickname for user_id-only events", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);

    try {
      const ingestor = new GatewayIngestor(database);
      const resolveOpenIdName = vi.fn(async () => "should-not-be-used");
      const resolver = {
        resolveOpenIdName,
      } as Pick<FeishuMemberResolver, "resolveOpenIdName">;

      const result = await ingestor.ingestFeishuEventWithMembers({
        payload: {
          event: {
            sender: { sender_id: { user_id: "u_only_sender" } },
            message: {
              message_id: "om_user_only",
              chat_id: "oc_family",
              message_type: "text",
              content: JSON.stringify({ text: "只有 user_id 的事件" }),
            },
          },
        },
        memberResolver: resolver,
      });

      expect(result.message).toMatchObject({
        senderId: "u_only_sender",
        senderName: "u_only_sender",
      });
      expect(resolveOpenIdName).not.toHaveBeenCalled();
    } finally {
      database.close();
    }
  });

  it("飞书文本类附件下载后会进入 RAG 文件库", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const downloader = new FeishuResourceDownloader(
      {
        im: {
          messageResource: {
            async get() {
              return {
                async writeFile(filePath: string) {
                  await fs.writeFile(filePath, "附件里写着端午活动改到 2026/6/30。", "utf8");
                },
              };
            },
          },
        },
      },
      testDir,
    );

    try {
      const result = await new GatewayIngestor(database).ingestFeishuEventAndDownloadAttachments({
        config,
        secrets: createDefaultSecrets(),
        downloader,
        payload: {
          event: {
            sender: { sender_id: { open_id: "ou_mom" } },
            message: {
              message_id: "om_file",
              chat_id: "oc_family",
              create_time: "1777111200000",
              message_type: "file",
              content: JSON.stringify({ file_key: "file_v2_xxx", file_name: "活动安排.md" }),
            },
          },
        },
      });

      const messages = new MessageRepository(database);
      const evidence = await new MessageFtsRetriever(messages).retrieve("附件端午活动");

      expect(result.accepted).toBe(true);
      expect(result.attachment?.downloaded?.fileName).toBe("om_file-活动安排.md");
      expect(result.attachment?.indexedMessageId).toBeTruthy();
      expect(evidence.some((item) => item.source.type === "file" && item.text.includes("2026/6/30"))).toBe(true);
    } finally {
      database.close();
    }
  });

  it("飞书图片附件下载后会创建多模态后台任务", async () => {
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();
    secrets.multimodal.apiKey = "vision-key";
    config.storage.dataDir = testDir;
    config.multimodal.baseUrl = "https://vision.test/v1";
    config.multimodal.model = "vision";
    const database = openDatabase(config);
    const downloader = new FeishuResourceDownloader(
      {
        im: {
          messageResource: {
            async get() {
              return {
                async writeFile(filePath: string) {
                  await fs.writeFile(filePath, Buffer.from([1, 2, 3]));
                },
              };
            },
          },
        },
      },
      testDir,
    );

    try {
      const result = await new GatewayIngestor(database).ingestFeishuEventAndDownloadAttachments({
        config,
        secrets,
        downloader,
        payload: {
          event: {
            sender: { sender_id: { open_id: "ou_mom" } },
            message: {
              message_id: "om_image",
              chat_id: "oc_family",
              create_time: "1777111200000",
              message_type: "image",
              content: JSON.stringify({ image_key: "img_v2_xxx" }),
            },
          },
        },
      });

      const tasks = new ImageMultimodalTaskRepository(database).listPending();

      expect(result.accepted).toBe(true);
      expect(result.attachment?.downloaded?.fileName).toBe("om_image-img_v2_xxx.jpg");
      expect(result.attachment?.imageTask).toMatchObject({ imageKey: "img_v2_xxx", status: "pending" });
      expect(result.attachment?.skippedReason).toBe("图片已下载，等待多模态后台处理。");
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({
        sourceMessageId: result.messageId,
        platformMessageId: "om_image",
        imageKey: "img_v2_xxx",
        mimeType: "image/jpeg",
        status: "pending",
      });
    } finally {
      database.close();
    }
  });

  it("多模态缺少 apiKey 时图片只下载不创建任务", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.multimodal.baseUrl = "https://vision.test/v1";
    config.multimodal.model = "vision";
    const database = openDatabase(config);
    const downloader = new FeishuResourceDownloader(
      {
        im: {
          messageResource: {
            async get() {
              return {
                async writeFile(filePath: string) {
                  await fs.writeFile(filePath, Buffer.from([1, 2, 3]));
                },
              };
            },
          },
        },
      },
      testDir,
    );

    try {
      const result = await new GatewayIngestor(database).ingestFeishuEventAndDownloadAttachments({
        config,
        secrets: createDefaultSecrets(),
        downloader,
        payload: {
          event: {
            sender: { sender_id: { open_id: "ou_mom" } },
            message: {
              message_id: "om_partial_image",
              chat_id: "oc_family",
              create_time: "1777111200000",
              message_type: "image",
              content: JSON.stringify({ image_key: "img_v2_partial" }),
            },
          },
        },
      });

      expect(result.accepted).toBe(true);
      expect(result.attachment?.downloaded).toBeTruthy();
      expect(result.attachment?.imageTask).toBeUndefined();
      expect(result.attachment?.skippedReason).toBe("图片已下载，但多模态未配置。");
      expect(new ImageMultimodalTaskRepository(database).listPending()).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("未配置多模态时图片只下载不创建任务", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    const downloader = new FeishuResourceDownloader(
      {
        im: {
          messageResource: {
            async get() {
              return {
                async writeFile(filePath: string) {
                  await fs.writeFile(filePath, Buffer.from([1, 2, 3]));
                },
              };
            },
          },
        },
      },
      testDir,
    );

    try {
      const result = await new GatewayIngestor(database).ingestFeishuEventAndDownloadAttachments({
        config,
        secrets: createDefaultSecrets(),
        downloader,
        payload: {
          event: {
            sender: { sender_id: { open_id: "ou_mom" } },
            message: {
              message_id: "om_image",
              chat_id: "oc_family",
              create_time: "1777111200000",
              message_type: "image",
              content: JSON.stringify({ image_key: "img_v2_xxx" }),
            },
          },
        },
      });

      expect(result.accepted).toBe(true);
      expect(result.attachment?.downloaded).toBeTruthy();
      expect(result.attachment?.imageTask).toBeUndefined();
      expect(result.attachment?.skippedReason).toBe("图片已下载，但多模态未配置。");
      expect(new ImageMultimodalTaskRepository(database).listPending()).toHaveLength(0);
    } finally {
      database.close();
    }
  });
});
