import * as lark from "@larksuiteoapi/node-sdk";
import path from "node:path";
import type { AppConfig, AppSecrets } from "../config/schema.js";
import { CronJobRepository } from "../cron/jobs.js";
import { generateCronJobMessage } from "../cron/generator.js";
import type { CronJobScheduler } from "../cron/scheduler.js";
import { createCronJobScheduler } from "../cron/scheduler.js";
import { processEpisodesNow } from "../episodes/manual-process.js";
import type { GatewayIngestAndDownloadResult, GatewayIngestor } from "../gateway/ingest.js";
import type { IndexingScheduler } from "../gateway/indexing-scheduler.js";
import { createIndexingScheduler } from "../gateway/indexing-scheduler.js";
import { MessageRepository } from "../messages/repository.js";
import { createPersonProfileTools } from "../profiles/rag-tools.js";
import { ProfileRepository } from "../profiles/repository.js";
import { createAgenticRagSearchTools } from "../rag/factory.js";
import { processMessagesNow } from "../rag/manual-index.js";
import type { ChatModel } from "../rag/types.js";
import type { SqliteDatabase } from "../db/database.js";
import { resolveHomePath } from "../config/paths.js";
import type { FeishuReceiveMessageEvent } from "./normalize.js";
import { ImageMultimodalTaskRepository } from "../multimodal/tasks.js";
import type { MultimodalModel } from "../multimodal/types.js";
import { ImageMultimodalWorker } from "../multimodal/worker.js";
import { createFeishuChatMembersClient, FeishuMemberRepository, FeishuMemberResolver, formatFeishuMemberPrompt } from "./members.js";
import { getFeishuQuestionDecision, isFeishuMessageAddressedToBot } from "./question.js";
import type { FeishuQuestionHandler } from "./question.js";
import { FeishuResourceDownloader } from "./resource-downloader.js";
import type { MessageSender } from "./sender.js";
import { mapDomain } from "./sender.js";

export interface FeishuGatewayRuntime {
  start(): Promise<void>;
  stop(): void;
}

interface WsClientLike {
  start(params: { eventDispatcher: lark.EventDispatcher }): Promise<void>;
  close(params?: { force?: boolean }): void;
}

export interface FeishuGatewayOptions {
  config: AppConfig;
  secrets: AppSecrets;
  ingestor: GatewayIngestor;
  questionHandler?: FeishuQuestionHandler;
  resourceDownloader?: FeishuResourceDownloader;
  attachmentVectorIndexer?: (messageId: string) => Promise<{ chunks: number; vectors: number }>;
  episodeProcessor?: { database: SqliteDatabase; model: ChatModel; now?: () => Date };
  imageMultimodalProcessor?: { database: SqliteDatabase; model: MultimodalModel };
  indexingProcessor?: { database: SqliteDatabase };
  indexingScheduler?: IndexingScheduler;
  cronJobProcessor?: { database: SqliteDatabase; model: ChatModel; sender: Pick<MessageSender, "sendTextToChat" | "sendImageToChat"> };
  cronJobScheduler?: CronJobScheduler;
  wsClientFactory?: (params: {
    appId: string;
    appSecret: string;
    domain: lark.Domain;
    onReady: () => void;
    onError: (error: Error) => void;
    onReconnecting: () => void;
    onReconnected: () => void;
  }) => WsClientLike;
}

function assertFeishuConfig(config: AppConfig, secrets: AppSecrets): void {
  if (!config.feishu.appId || !secrets.feishu.appSecret) {
    throw new Error("飞书配置不完整。请先运行 chattercatcher setup 或 chattercatcher settings。");
  }
}

function formatGatewayStartError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("PingInterval") || message.includes("system busy") || message.includes("1000040345")) {
    return new Error(`飞书长连接启动失败，请检查 App ID / App Secret 是否正确；原始错误：${message}`);
  }

  return error instanceof Error ? error : new Error(message);
}

export function createFeishuEventDispatcher(options: {
  config: AppConfig;
  secrets: AppSecrets;
  ingestor: GatewayIngestor;
  memberResolver?: FeishuMemberResolver;
  questionHandler?: FeishuQuestionHandler;
  resourceDownloader?: FeishuResourceDownloader;
  attachmentVectorIndexer?: (messageId: string) => Promise<{ chunks: number; vectors: number }>;
  episodeProcessor?: { database: SqliteDatabase; model: ChatModel; now?: () => Date };
  imageMultimodalProcessor?: { database: SqliteDatabase; model: MultimodalModel };
}): lark.EventDispatcher {
  const answeredMessageIds = new Set<string>();

  return new lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: FeishuReceiveMessageEvent["event"]) => {
      const payload = { event: data };

      if (options.questionHandler && isFeishuMessageAddressedToBot(payload, options.config)) {
        const platformMessageId = data?.message?.message_id;
        if (platformMessageId && answeredMessageIds.has(platformMessageId)) {
          console.log("飞书提问重复投递：已跳过回答。");
          return;
        }

        const decision = getFeishuQuestionDecision(payload, options.config);
        if (decision.shouldAnswer) {
          if (platformMessageId) {
            answeredMessageIds.add(platformMessageId);
          }
          await options.questionHandler.handle(payload);
          console.log("飞书提问已回答：跳过知识库入库。");
          return;
        }
      }

      let result: GatewayIngestAndDownloadResult;
      if (options.resourceDownloader) {
        result = await options.ingestor.ingestFeishuEventAndDownloadAttachments({
          payload,
          downloader: options.resourceDownloader,
          config: options.config,
          secrets: options.secrets,
          vectorIndexMessage: options.attachmentVectorIndexer,
          memberResolver: options.memberResolver,
        });
      } else if (options.memberResolver) {
        result = await options.ingestor.ingestFeishuEventWithMembers({
          payload,
          memberResolver: options.memberResolver,
        });
      } else {
        result = options.ingestor.ingestFeishuEvent(payload);
      }

      if (!result.accepted) {
        console.log(`飞书消息未入库：${result.reason}`);
        return;
      }

      console.log(`飞书消息已入库：${result.messageId}`);
      if (result.duplicate) {
        console.log("飞书消息重复投递：已跳过附件处理和回答。");
        return;
      }

      if (options.episodeProcessor) {
        const episodeResult = await processEpisodesNow({
          config: options.config,
          secrets: options.secrets,
          database: options.episodeProcessor.database,
          model: options.episodeProcessor.model,
          now: options.episodeProcessor.now?.(),
        });
        if (episodeResult.created > 0) {
          console.log(`飞书会话记忆已生成：${episodeResult.created}`);
        }
      }

      if (result.attachment?.downloaded) {
        console.log(`飞书附件已下载：${result.attachment.downloaded.storedPath}`);
        if (options.imageMultimodalProcessor && result.attachment.imageTask) {
          void new ImageMultimodalWorker({
            config: options.config,
            messages: new MessageRepository(options.imageMultimodalProcessor.database),
            tasks: new ImageMultimodalTaskRepository(options.imageMultimodalProcessor.database),
            model: options.imageMultimodalProcessor.model,
            multimodalModelName: options.config.multimodal.model,
            vectorIndexMessage: options.attachmentVectorIndexer,
          }).processPending().then((imageResult) => {
            console.log(
              `飞书图片多模态处理完成：processed=${imageResult.processed}, succeeded=${imageResult.succeeded}, skipped=${imageResult.skipped}, failed=${imageResult.failed}`,
            );
          }).catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(`飞书图片多模态处理失败：${message}`);
          });
        }
        if (result.attachment.indexedMessageId) {
          console.log(`飞书附件已进入 RAG：${result.attachment.indexedMessageId}`);
          if (result.attachment.vectorIndexed) {
            console.log(
              `飞书附件向量索引完成：chunks=${result.attachment.vectorIndexed.chunks}, vectors=${result.attachment.vectorIndexed.vectors}`,
            );
          }
        } else if (result.attachment.skippedReason) {
          console.log(`飞书附件暂未进入 RAG：${result.attachment.skippedReason}`);
        }
      }

      if (options.questionHandler) {
        const decision = await options.questionHandler.handle(payload, {
          excludeMessageIds: result.messageId ? [result.messageId] : [],
        });
        if (!decision.shouldAnswer) {
          console.log(`飞书消息不触发回答：${decision.reason}`);
        }
      }
    },
  });
}

function resolveFeishuImagePath(config: AppConfig, imageFileName: string): string {
  const fileName = path.basename(imageFileName.trim());
  if (!fileName || fileName !== imageFileName.trim()) {
    throw new Error("图片文件名无效。");
  }
  return path.join(resolveHomePath(config.storage.dataDir), "files", "feishu", fileName);
}

export function createFeishuGateway(options: FeishuGatewayOptions): FeishuGatewayRuntime {
  assertFeishuConfig(options.config, options.secrets);

  const wsClient =
    options.wsClientFactory?.({
      appId: options.config.feishu.appId,
      appSecret: options.secrets.feishu.appSecret,
      domain: mapDomain(options.config.feishu.domain),
      onReady: () => console.log("飞书长连接已建立。"),
      onError: (error) => console.error(`飞书长连接错误：${error.message}`),
      onReconnecting: () => console.log("飞书长连接正在重连。"),
      onReconnected: () => console.log("飞书长连接已重连。"),
    }) ??
    new lark.WSClient({
      appId: options.config.feishu.appId,
      appSecret: options.secrets.feishu.appSecret,
      domain: mapDomain(options.config.feishu.domain),
      loggerLevel: lark.LoggerLevel.info,
      source: "chattercatcher",
      onReady: () => console.log("飞书长连接已建立。"),
      onError: (error) => console.error(`飞书长连接错误：${error.message}`),
      onReconnecting: () => console.log("飞书长连接正在重连。"),
      onReconnected: () => console.log("飞书长连接已重连。"),
    });

  const memberResolver = new FeishuMemberResolver({
    repository: new FeishuMemberRepository(options.ingestor.database),
    client: createFeishuChatMembersClient(new lark.Client({
      appId: options.config.feishu.appId,
      appSecret: options.secrets.feishu.appSecret,
      domain: mapDomain(options.config.feishu.domain),
    }) as Parameters<typeof createFeishuChatMembersClient>[0]),
  });
  options.questionHandler?.setMemberResolver?.(memberResolver);

  const eventDispatcher = createFeishuEventDispatcher({
    config: options.config,
    secrets: options.secrets,
    ingestor: options.ingestor,
    memberResolver,
    questionHandler: options.questionHandler,
    resourceDownloader: options.resourceDownloader,
    attachmentVectorIndexer: options.attachmentVectorIndexer,
    episodeProcessor: options.episodeProcessor,
    imageMultimodalProcessor: options.imageMultimodalProcessor,
  });

  const indexingScheduler = options.indexingScheduler ?? (
    options.indexingProcessor
      ? createIndexingScheduler({
          schedule: options.config.schedules.indexing,
          work: async () => {
            await processMessagesNow({
              config: options.config,
              secrets: options.secrets,
              database: options.indexingProcessor!.database,
              limit: 10_000,
            });
          },
        })
      : undefined
  );

  const cronJobScheduler = options.cronJobScheduler ?? (
    options.cronJobProcessor
      ? createCronJobScheduler({
          repository: new CronJobRepository(options.cronJobProcessor.database),
          sendTextToChat: (chatId, text, sendOptions) => options.cronJobProcessor!.sender.sendTextToChat(chatId, text, sendOptions),
          sendImageToChat: options.cronJobProcessor.sender.sendImageToChat
            ? (chatId, imageFileName) => options.cronJobProcessor!.sender.sendImageToChat!(
                chatId,
                resolveFeishuImagePath(options.config, imageFileName),
              )
            : undefined,
          generateMessage: async (job, now) => {
            const { tools, close } = await createAgenticRagSearchTools({
              config: options.config,
              secrets: options.secrets,
              database: options.cronJobProcessor!.database,
              messages: new MessageRepository(options.cronJobProcessor!.database),
              scope: { platform: "feishu", platformChatId: job.chatId },
              profileTools: createPersonProfileTools({ profiles: new ProfileRepository(options.cronJobProcessor!.database) }),
            });
            try {
              const memberPrompt = formatFeishuMemberPrompt(
                new FeishuMemberRepository(options.cronJobProcessor!.database).listByChat(job.chatId),
              );
              return await generateCronJobMessage({
                prompt: job.prompt,
                model: options.cronJobProcessor!.model,
                tools,
                now,
                memberPrompt,
              });
            } finally {
              close();
            }
          },
        })
      : undefined
  );

  return {
    async start() {
      try {
        await wsClient.start({ eventDispatcher });
        indexingScheduler?.start();
        cronJobScheduler?.start();
      } catch (error) {
        indexingScheduler?.stop();
        cronJobScheduler?.stop();
        throw formatGatewayStartError(error);
      }
    },
    stop() {
      indexingScheduler?.stop();
      cronJobScheduler?.stop();
      wsClient.close({ force: true });
    },
  };
}
