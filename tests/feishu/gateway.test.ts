import type * as lark from "@larksuiteoapi/node-sdk";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { createFeishuGateway } from "../../src/feishu/gateway.js";
import { GatewayIngestor } from "../../src/gateway/ingest.js";
import { MessageRepository } from "../../src/messages/repository.js";

let testDir: string;

describe("createFeishuGateway", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-feishu-gateway-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("配置不完整时拒绝创建真实 Gateway", () => {
    const config = createDefaultConfig();
    const secrets = createDefaultSecrets();

    expect(() =>
      createFeishuGateway({
        config,
        secrets,
        ingestor: {} as GatewayIngestor,
      }),
    ).toThrow("飞书配置不完整");
  });

  it("长连接鉴权异常时提示检查 App ID 和 App Secret", async () => {
    const config = createDefaultConfig();
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "wrong_secret";

    const runtime = createFeishuGateway({
      config,
      secrets,
      ingestor: {} as GatewayIngestor,
      wsClientFactory: () => ({
        async start() {
          throw new TypeError("Cannot read properties of undefined (reading 'PingInterval')");
        },
        close() {},
      }),
    });

    await expect(runtime.start()).rejects.toThrow("飞书长连接启动失败，请检查 App ID / App Secret");
  });

  it("长连接 system busy 异常时提示检查 App ID 和 App Secret", async () => {
    const config = createDefaultConfig();
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "wrong_secret";

    const runtime = createFeishuGateway({
      config,
      secrets,
      ingestor: {} as GatewayIngestor,
      wsClientFactory: () => ({
        async start() {
          throw new Error("code: 1000040345, system busy");
        },
        close() {},
      }),
    });

    await expect(runtime.start()).rejects.toThrow("飞书长连接启动失败，请检查 App ID / App Secret");
  });

  it("Gateway 启动成功后启动索引调度器，停止时关闭调度器", async () => {
    const config = createDefaultConfig();
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const indexingScheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      runDueNow: vi.fn(async () => undefined),
    };

    const runtime = createFeishuGateway({
      config,
      secrets,
      ingestor: {} as GatewayIngestor,
      indexingScheduler,
      wsClientFactory: () => ({
        async start() {},
        close() {},
      }),
    });

    await runtime.start();
    runtime.stop();

    expect(indexingScheduler.start).toHaveBeenCalledTimes(1);
    expect(indexingScheduler.stop).toHaveBeenCalledTimes(1);
  });

  it("Gateway 启动成功后启动定时任务调度器，停止时关闭调度器", async () => {
    const config = createDefaultConfig();
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const cronJobScheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      runDueNow: vi.fn(async () => undefined),
    };

    const runtime = createFeishuGateway({
      config,
      secrets,
      ingestor: {} as GatewayIngestor,
      cronJobScheduler,
      wsClientFactory: () => ({
        async start() {},
        close() {},
      }),
    });

    await runtime.start();
    runtime.stop();

    expect(cronJobScheduler.start).toHaveBeenCalledTimes(1);
    expect(cronJobScheduler.stop).toHaveBeenCalledTimes(1);
  });

  it("长连接启动失败时关闭索引调度器", async () => {
    const config = createDefaultConfig();
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const indexingScheduler = {
      start: vi.fn(),
      stop: vi.fn(),
      runDueNow: vi.fn(async () => undefined),
    };

    const runtime = createFeishuGateway({
      config,
      secrets,
      ingestor: {} as GatewayIngestor,
      indexingScheduler,
      wsClientFactory: () => ({
        async start() {
          throw new Error("code: 1000040345, system busy");
        },
        close() {},
      }),
    });

    await expect(runtime.start()).rejects.toThrow("飞书长连接启动失败，请检查 App ID / App Secret");
    expect(indexingScheduler.start).not.toHaveBeenCalled();
    expect(indexingScheduler.stop).toHaveBeenCalledTimes(1);
  });

  it("长连接事件在最小 Gateway 配置下仍携带成员解析器", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const ingestor = new GatewayIngestor(database);
    const ingestFeishuEventWithMembers = vi.spyOn(ingestor, "ingestFeishuEventWithMembers").mockResolvedValue({
      accepted: true,
      messageId: "msg_1",
      message: {
        platform: "feishu",
        chatName: "oc_family",
        platformChatId: "oc_family",
        platformMessageId: "om_1",
        senderId: "ou_mom",
        senderName: "妈妈",
        messageType: "text",
        text: "端午活动改到 2026/6/30，以这个为准。",
        sentAt: "2026-05-16T10:00:00.000Z",
      },
      duplicate: false,
    });

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            expect(handler).toBeDefined();
            await handler?.({
              sender: { sender_id: { open_id: "ou_mom" } },
              message: {
                message_id: "om_1",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "端午活动改到 2026/6/30，以这个为准。" }),
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      expect(ingestFeishuEventWithMembers).toHaveBeenCalledTimes(1);
      expect(ingestFeishuEventWithMembers.mock.calls[0]?.[0].memberResolver).toBeDefined();
    } finally {
      ingestFeishuEventWithMembers.mockRestore();
      database.close();
    }
  });

  it("附件下载路径同样使用成员解析器入库", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const ingestor = new GatewayIngestor(database);
    const ingestFeishuEventAndDownloadAttachments = vi
      .spyOn(ingestor, "ingestFeishuEventAndDownloadAttachments")
      .mockResolvedValue({
        accepted: true,
        messageId: "msg_file",
        message: {
          platform: "feishu",
          chatName: "oc_family",
          platformMessageId: "om_file",
          platformChatId: "oc_family",
          senderId: "ou_mom",
          senderName: "妈妈",
          text: "活动安排.md",
          messageType: "file",
          sentAt: "2026-05-16T10:00:00.000Z",
        },
        duplicate: false,
      });

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor,
        resourceDownloader: {} as never,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_mom" } },
              message: {
                message_id: "om_file",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "file",
                content: JSON.stringify({ file_key: "file_v2_xxx", file_name: "活动安排.md" }),
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      expect(ingestFeishuEventAndDownloadAttachments).toHaveBeenCalledTimes(1);
      expect(ingestFeishuEventAndDownloadAttachments.mock.calls[0]?.[0].memberResolver).toBeDefined();
    } finally {
      ingestFeishuEventAndDownloadAttachments.mockRestore();
      database.close();
    }
  });

  it("普通文本包含产品名但没有飞书 mention 时仍然入库且不回答", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    config.feishu.requireMention = true;
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const handled: unknown[] = [];

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        questionHandler: {
          async handle(payload: unknown) {
            handled.push(payload);
            return { shouldAnswer: false, reason: "群聊配置为必须 @ 后回答。" };
          },
        } as never,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "om_product_text",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "OK了 ChatterCatcher 复活了" }),
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      const messages = new MessageRepository(database);
      expect(messages.getMessageCount()).toBe(1);
      expect(messages.searchMessages("复活")[0]?.text).toContain("ChatterCatcher");
      expect(handled).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("没有配置机器人 open_id 时 @ 任何人都仍然入库且不回答", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    config.feishu.requireMention = true;
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const handled: unknown[] = [];

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        questionHandler: {
          async handle(payload: unknown) {
            handled.push(payload);
            return { shouldAnswer: false, reason: "群聊配置为必须 @ 机器人后回答。" };
          },
        } as never,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "om_mention_without_bot_id",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "@_user_1 test" }),
                mentions: [{ name: "川哥", key: "@_user_1", id: { open_id: "ou_chuan" } }],
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      const messages = new MessageRepository(database);
      expect(messages.getMessageCount()).toBe(1);
      expect(messages.searchMessages("test")[0]?.text).toContain("test");
      expect(handled).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("@ 其他人时仍然入库且不回答", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    config.feishu.requireMention = true;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const handled: unknown[] = [];

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        questionHandler: {
          async handle(payload: unknown) {
            handled.push(payload);
            return { shouldAnswer: false, reason: "群聊配置为必须 @ 机器人后回答。" };
          },
        } as never,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "om_mention_other",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "@_user_1 test" }),
                mentions: [{ name: "川哥", key: "@_user_1", id: { open_id: "ou_chuan" } }],
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      const messages = new MessageRepository(database);
      expect(messages.getMessageCount()).toBe(1);
      expect(messages.searchMessages("test")[0]?.text).toContain("test");
      expect(handled).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("@ 机器人提问会直接回答，不写入消息库", async () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    config.feishu.appId = "cli_app_id";
    config.feishu.requireMention = true;
    config.feishu.botOpenId = "ou_bot";
    const secrets = createDefaultSecrets();
    secrets.feishu.appSecret = "app_secret";
    const database = openDatabase(config);
    const handled: unknown[] = [];

    try {
      const runtime = createFeishuGateway({
        config,
        secrets,
        ingestor: new GatewayIngestor(database),
        questionHandler: {
          async handle(payload: unknown) {
            handled.push(payload);
            return { shouldAnswer: true, question: "端午活动什么时候", chatId: "oc_family" };
          },
        } as never,
        wsClientFactory: () => ({
          async start(params: { eventDispatcher: lark.EventDispatcher }) {
            const handler = params.eventDispatcher.handles.get("im.message.receive_v1");
            await handler?.({
              sender: { sender_id: { open_id: "ou_user" } },
              message: {
                message_id: "om_question",
                chat_id: "oc_family",
                create_time: "1777111200000",
                message_type: "text",
                content: JSON.stringify({ text: "@_user_1 端午活动什么时候？" }),
                mentions: [{ name: "小陈", key: "@_user_1", id: { open_id: "ou_bot" } }],
              },
            });
          },
          close() {},
        }),
      });

      await runtime.start();

      expect(handled).toHaveLength(1);
      expect(new MessageRepository(database).getMessageCount()).toBe(0);
    } finally {
      database.close();
    }
  });
});
