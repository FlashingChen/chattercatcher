import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import type { EpisodeRepository, EpisodeWindow } from "../episodes/repository.js";
import type { MessageRepository } from "../messages/repository.js";
import type { AudioTranscriptionTaskRecord, TranscriptionModel } from "./audio-types.js";
import type { AudioTranscriptionTaskRepository } from "./audio-tasks.js";

export interface AudioTranscriptionWorkerResult {
  processed: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

export interface AudioTranscriptionWorkerOptions {
  config: AppConfig;
  messages: MessageRepository;
  tasks: AudioTranscriptionTaskRepository;
  model: TranscriptionModel;
  transcriptionModelName: string;
  episodes?: EpisodeRepository;
  vectorIndexMessage?: (messageId: string) => Promise<{ chunks: number; vectors: number }>;
  summarizeEpisode?: (window: EpisodeWindow) => Promise<string>;
}

export class AudioTranscriptionWorker {
  constructor(private readonly options: AudioTranscriptionWorkerOptions) {}

  async processPending(limit = 10): Promise<AudioTranscriptionWorkerResult> {
    const result: AudioTranscriptionWorkerResult = { processed: 0, succeeded: 0, skipped: 0, failed: 0 };
    const pending = this.options.tasks.listPending(limit);

    for (const task of pending) {
      result.processed += 1;
      await this.processTask(task, result);
    }

    return result;
  }

  private async processTask(task: AudioTranscriptionTaskRecord, result: AudioTranscriptionWorkerResult): Promise<void> {
    let running: AudioTranscriptionTaskRecord;
    try {
      running = this.options.tasks.markRunning(task.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("语音转写任务状态无法更新：")) {
        return;
      }
      throw error;
    }

    try {
      const transcribed = await this.options.model.transcribe({
        audioPath: running.storedPath,
        mimeType: running.mimeType,
      });

      const audioFileName = path.basename(running.storedPath);
      const derivedMessageId = this.options.messages.createAudioTranscriptMessage({
        sourceMessageId: running.sourceMessageId,
        audioKey: running.audioKey,
        audioFileName,
        transcript: transcribed.text,
        transcriptionModel: this.options.transcriptionModelName,
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
