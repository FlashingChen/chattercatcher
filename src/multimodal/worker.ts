import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import type { EpisodeRepository, EpisodeWindow } from "../episodes/repository.js";
import type { MessageRepository } from "../messages/repository.js";
import type { ImageMultimodalTaskRepository } from "./tasks.js";
import type { ImageMultimodalTaskRecord, MultimodalModel } from "./types.js";

export interface ImageMultimodalWorkerResult {
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

export interface ImageMultimodalWorkerOptions {
  config: AppConfig;
  messages: MessageRepository;
  tasks: ImageMultimodalTaskRepository;
  model: MultimodalModel;
  multimodalModelName: string;
  episodes?: EpisodeRepository;
  vectorIndexMessage?: (messageId: string) => Promise<{ chunks: number; vectors: number }>;
  summarizeEpisode?: (window: EpisodeWindow) => Promise<string>;
}

export class ImageMultimodalWorker {
  constructor(private readonly options: ImageMultimodalWorkerOptions) {}

  async processPending(limit = 10): Promise<ImageMultimodalWorkerResult> {
    const result: ImageMultimodalWorkerResult = { processed: 0, succeeded: 0, skipped: 0, failed: 0 };
    const pending = this.options.tasks.listPending(limit);

    for (const task of pending) {
      result.processed += 1;
      await this.processTask(task, result);
    }

    return result;
  }

  private async processTask(task: ImageMultimodalTaskRecord, result: ImageMultimodalWorkerResult): Promise<void> {
    let running: ImageMultimodalTaskRecord;
    try {
      running = this.options.tasks.markRunning(task.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("图片多模态任务状态无法更新：")) {
        return;
      }
      throw error;
    }

    try {
      const imageFileName = path.basename(running.storedPath);
      const described = await this.options.model.describeImage({
        imagePath: running.storedPath,
        mimeType: running.mimeType,
        context: `图片文件名：${imageFileName}`,
      });

      if (!described.isMeaningful) {
        this.options.tasks.markSkipped(running.id, described.reason || "多模态模型判定图片无意义。");
        result.skipped += 1;
        return;
      }

      const derivedMessageId = this.options.messages.createImageSummaryMessage({
        sourceMessageId: running.sourceMessageId,
        imageKey: running.imageKey,
        imageFileName,
        summary: described.summary,
        reason: described.reason,
        multimodalModel: this.options.multimodalModelName,
        generatedAt: new Date().toISOString(),
      });

      if (this.options.vectorIndexMessage) {
        await this.options.vectorIndexMessage(derivedMessageId);
      }
      if (this.options.episodes && this.options.summarizeEpisode) {
        await this.options.episodes.refreshWindowForMessage({
          messageId: derivedMessageId,
          windowMs: this.options.config.episodes.windowMinutes * 60 * 1000,
          summarize: this.options.summarizeEpisode,
        });
      }

      this.options.tasks.markSucceeded(running.id, derivedMessageId);
      result.succeeded += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.options.tasks.markFailed(running.id, message, running.attempts >= 3);
      result.failed += 1;
    }
  }
}
