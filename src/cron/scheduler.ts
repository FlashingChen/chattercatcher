import type { SendTextOptions } from "../feishu/sender.js";
import type { CronJobRecord, CronJobRepository } from "./jobs.js";

export interface CronJobScheduler {
  start(): void;
  stop(): void;
  runDueNow(): Promise<void>;
}

interface CreateCronJobSchedulerOptions {
  repository: Pick<CronJobRepository, "listDue" | "markSuccess" | "markFailure">;
  generateMessage: (job: CronJobRecord, now: Date) => Promise<string>;
  sendTextToChat: (chatId: string, text: string, options?: SendTextOptions) => Promise<void>;
  sendImageToChat?: (chatId: string, imageFileName: string) => Promise<void>;
  now?: () => Date;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  logger?: Pick<Console, "error">;
}

export function createCronJobScheduler(options: CreateCronJobSchedulerOptions): CronJobScheduler {
  const now = options.now ?? (() => new Date());
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const logger = options.logger ?? console;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  const runDueNow = async (): Promise<void> => {
    if (running) {
      return;
    }

    running = true;
    const startedAt = now();
    try {
      const jobs = options.repository.listDue(startedAt);
      for (const job of jobs) {
        try {
          const text = await options.generateMessage(job, startedAt);
          const sendOptions = job.mentionOpenId && job.mentionTargetName
            ? { mentions: [{ openId: job.mentionOpenId, name: job.mentionTargetName }] }
            : undefined;
          if (sendOptions) {
            await options.sendTextToChat(job.chatId, text, sendOptions);
          } else {
            await options.sendTextToChat(job.chatId, text);
          }
          if (job.imageFileName) {
            if (!options.sendImageToChat) {
              throw new Error("当前定时任务运行环境不支持发送图片。");
            }
            await options.sendImageToChat(job.chatId, job.imageFileName);
          }
          options.repository.markSuccess(job.id, startedAt);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          options.repository.markFailure(job.id, message, startedAt);
          logger.error(`CRONJob 执行失败：${job.id} ${message}`);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    start() {
      if (timer) {
        return;
      }

      void runDueNow();
      timer = setIntervalFn(() => {
        void runDueNow();
      }, 60_000);
    },
    stop() {
      if (!timer) {
        return;
      }

      clearIntervalFn(timer);
      timer = undefined;
    },
    runDueNow,
  };
}
