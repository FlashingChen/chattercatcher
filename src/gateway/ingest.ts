import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { SqliteDatabase } from "../db/database.js";
import type { FeishuMemberResolver } from "../feishu/members.js";
import {
  normalizeFeishuReceiveMessageEvent,
  type FeishuAttachmentMetadata,
  type FeishuReceiveMessageEvent,
} from "../feishu/normalize.js";
import type { FeishuDownloadedResource, FeishuResourceDownloader } from "../feishu/resource-downloader.js";
import { isSupportedTextFile, ingestLocalFile } from "../files/ingest.js";
import { FileJobRepository } from "../files/jobs.js";
import { MessageRepository } from "../messages/repository.js";
import type { IngestMessageInput } from "../messages/types.js";
import { ImageMultimodalTaskRepository } from "../multimodal/tasks.js";
import type { ImageMultimodalTaskRecord } from "../multimodal/types.js";
import type { ProfileRepository } from "../profiles/repository.js";

export interface GatewayIngestResult {
  accepted: boolean;
  messageId?: string;
  message?: IngestMessageInput;
  duplicate?: boolean;
  reason?: string;
}

export interface GatewayAttachmentIngestResult {
  downloaded?: FeishuDownloadedResource;
  indexedMessageId?: string;
  vectorIndexed?: {
    chunks: number;
    vectors: number;
  };
  imageTask?: ImageMultimodalTaskRecord;
  skippedReason?: string;
}

export interface GatewayIngestAndDownloadResult extends GatewayIngestResult {
  attachment?: GatewayAttachmentIngestResult;
}

export interface GatewayIngestorOptions {
  profiles?: ProfileRepository;
}

function extractFeishuSenderOpenId(message: IngestMessageInput): string | undefined {
  const raw = message.rawPayload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const sender = (raw as { sender?: unknown }).sender;
  if (!sender || typeof sender !== "object" || Array.isArray(sender)) return undefined;
  const openId = (sender as { openId?: unknown }).openId;
  return typeof openId === "string" && openId.trim() ? openId.trim() : undefined;
}

function extractAttachment(message: IngestMessageInput): FeishuAttachmentMetadata | undefined {
  const raw = message.rawPayload;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const attachment = (raw as { attachment?: unknown }).attachment;
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) {
    return undefined;
  }

  const candidate = attachment as Partial<FeishuAttachmentMetadata>;
  if (candidate.platform !== "feishu" || !candidate.kind || !candidate.fileKey) {
    return undefined;
  }

  return candidate as FeishuAttachmentMetadata;
}

function isMultimodalReady(config: AppConfig, secrets: AppSecrets): boolean {
  return Boolean(config.multimodal.baseUrl && config.multimodal.model && secrets.multimodal.apiKey);
}

export class GatewayIngestor {
  private readonly messages: MessageRepository;
  private readonly jobs: FileJobRepository;
  private readonly imageTasks: ImageMultimodalTaskRepository;

  constructor(
    public readonly database: SqliteDatabase,
    private readonly options: GatewayIngestorOptions = {},
  ) {
    this.messages = new MessageRepository(database);
    this.jobs = new FileJobRepository(database);
    this.imageTasks = new ImageMultimodalTaskRepository(database);
  }

  private enrichWithPerson(input: IngestMessageInput): IngestMessageInput {
    const person = this.options.profiles?.resolvePersonForSender({
      platform: input.platform,
      platformChatId: input.platformChatId,
      senderId: input.senderId,
      senderName: input.senderName,
      source: "message",
      observedAt: input.sentAt,
    });

    return {
      ...input,
      personId: person?.id,
    };
  }

  ingestFeishuEvent(payload: FeishuReceiveMessageEvent): GatewayIngestResult {
    const normalized = normalizeFeishuReceiveMessageEvent(payload);
    if (!normalized) {
      return {
        accepted: false,
        reason: "事件不是可入库的飞书消息。",
      };
    }

    const enriched = this.enrichWithPerson(normalized);
    const duplicate = this.messages.hasPlatformMessage(enriched.platform, enriched.platformMessageId);
    const messageId = this.messages.ingest(enriched);
    return {
      accepted: true,
      messageId,
      message: enriched,
      duplicate,
    };
  }

  async ingestFeishuEventWithMembers(input: {
    payload: FeishuReceiveMessageEvent;
    memberResolver: Pick<FeishuMemberResolver, "resolveOpenIdName">;
  }): Promise<GatewayIngestResult> {
    const normalized = normalizeFeishuReceiveMessageEvent(input.payload);
    if (!normalized) {
      return {
        accepted: false,
        reason: "事件不是可入库的飞书消息。",
      };
    }

    const openId = extractFeishuSenderOpenId(normalized);
    const senderName = openId
      ? await input.memberResolver.resolveOpenIdName(normalized.platformChatId, openId)
      : normalized.senderName;
    const enriched = this.enrichWithPerson({ ...normalized, senderName });
    const duplicate = this.messages.hasPlatformMessage(enriched.platform, enriched.platformMessageId);
    const messageId = this.messages.ingest(enriched);
    return {
      accepted: true,
      messageId,
      message: enriched,
      duplicate,
    };
  }

  async ingestFeishuEventAndDownloadAttachments(input: {
    payload: FeishuReceiveMessageEvent;
    downloader: FeishuResourceDownloader;
    config: AppConfig;
    secrets: AppSecrets;
    vectorIndexMessage?: (messageId: string) => Promise<{ chunks: number; vectors: number }>;
    memberResolver?: Pick<FeishuMemberResolver, "resolveOpenIdName">;
  }): Promise<GatewayIngestAndDownloadResult> {
    const result = input.memberResolver
      ? await this.ingestFeishuEventWithMembers({ payload: input.payload, memberResolver: input.memberResolver })
      : this.ingestFeishuEvent(input.payload);
    if (!result.accepted || !result.messageId || !result.message || result.duplicate) {
      return result;
    }

    const attachment = extractAttachment(result.message);
    if (!attachment) {
      return result;
    }

    const downloaded = await input.downloader.download({
      messageId: result.message.platformMessageId,
      attachment,
    });

    if (attachment.kind === "image") {
      const imageTask = isMultimodalReady(input.config, input.secrets)
        ? this.imageTasks.enqueue({
            sourceMessageId: result.messageId,
            platformMessageId: result.message.platformMessageId,
            imageKey: attachment.fileKey,
            storedPath: downloaded.storedPath,
            mimeType: attachment.mimeType || "image/jpeg",
          })
        : undefined;

      return {
        ...result,
        attachment: {
          downloaded,
          ...(imageTask ? { imageTask } : {}),
          skippedReason: imageTask ? "图片已下载，等待多模态后台处理。" : "图片已下载，但多模态未配置。",
        },
      };
    }

    if (!isSupportedTextFile(downloaded.storedPath)) {
      return {
        ...result,
        attachment: {
          downloaded,
          skippedReason: "附件已下载，但当前文件类型暂不支持解析。",
        },
      };
    }

    const indexedMessageId = await ingestLocalFile({
      config: input.config,
      messages: this.messages,
      jobs: this.jobs,
      filePath: downloaded.storedPath,
    }).then((file) => file.messageId);
    const vectorIndexed = input.vectorIndexMessage ? await input.vectorIndexMessage(indexedMessageId) : undefined;

    return {
      ...result,
      attachment: {
        downloaded,
        indexedMessageId,
        vectorIndexed,
      },
    };
  }
}
