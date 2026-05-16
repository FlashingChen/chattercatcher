import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";
import { getNextCronRun, isValidCronSchedule } from "./schedule.js";

export type CronJobStatus = "active" | "deleted";

export interface CronJobRecord {
  id: string;
  chatId: string;
  createdByOpenId?: string;
  schedule: string;
  prompt: string;
  imageFileName?: string;
  mentionTargetName?: string;
  mentionOpenId?: string;
  mentionUserId?: string;
  status: CronJobStatus;
  lastRunAt?: string;
  nextRunAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

interface CronJobRepositoryOptions {
  now?: () => Date;
}

interface CronJobRow {
  id: string;
  chatId: string;
  createdByOpenId: string | null;
  schedule: string;
  prompt: string;
  imageFileName: string | null;
  mentionTargetName: string | null;
  mentionOpenId: string | null;
  mentionUserId: string | null;
  status: CronJobStatus;
  lastRunAt: string | null;
  nextRunAt: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export class CronJobRepository {
  private readonly now: () => Date;

  constructor(
    private readonly database: SqliteDatabase,
    options: CronJobRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  create(input: {
    chatId: string;
    createdByOpenId?: string;
    schedule: string;
    prompt: string;
    imageFileName?: string;
    mentionTargetName?: string;
    mentionOpenId?: string;
    mentionUserId?: string;
  }): CronJobRecord {
    const schedule = input.schedule.trim();
    const prompt = input.prompt.trim();
    const imageFileName = input.imageFileName?.trim();
    const mentionTargetName = input.mentionTargetName?.trim();
    const mentionOpenId = input.mentionOpenId?.trim();
    const mentionUserId = input.mentionUserId?.trim();
    if (!isValidCronSchedule(schedule)) {
      throw new Error("cron 表达式无效。");
    }
    if (!prompt) {
      throw new Error("定时任务 prompt 不能为空。");
    }

    const now = this.now();
    const nextRunAt = getNextCronRun(schedule, now);
    if (!nextRunAt) {
      throw new Error("无法计算下一次执行时间。");
    }

    const record: CronJobRecord = {
      id: crypto.randomUUID(),
      chatId: input.chatId,
      createdByOpenId: input.createdByOpenId,
      schedule,
      prompt,
      ...(imageFileName ? { imageFileName } : {}),
      ...(mentionTargetName ? { mentionTargetName } : {}),
      ...(mentionOpenId ? { mentionOpenId } : {}),
      ...(mentionUserId ? { mentionUserId } : {}),
      status: "active",
      nextRunAt: nextRunAt.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    this.database
      .prepare(
        `
        INSERT INTO cron_jobs (
          id, chat_id, created_by_open_id, schedule, prompt, image_file_name,
          mention_target_name, mention_open_id, mention_user_id, status,
          last_run_at, next_run_at, last_error, created_at, updated_at
        )
        VALUES (
          @id, @chatId, @createdByOpenId, @schedule, @prompt, @imageFileName,
          @mentionTargetName, @mentionOpenId, @mentionUserId, @status,
          NULL, @nextRunAt, NULL, @createdAt, @updatedAt
        )
      `,
      )
      .run({
        ...record,
        imageFileName: record.imageFileName ?? null,
        mentionTargetName: record.mentionTargetName ?? null,
        mentionOpenId: record.mentionOpenId ?? null,
        mentionUserId: record.mentionUserId ?? null,
      });

    return record;
  }

  get(id: string): CronJobRecord | null {
    return this.listByWhere("WHERE id = ?", [id], 1)[0] ?? null;
  }

  list(limit = 100): CronJobRecord[] {
    return this.listByWhere("", [], limit);
  }

  listByChat(chatId: string, limit = 50): CronJobRecord[] {
    return this.listByWhere(
      "WHERE chat_id = ? AND status = 'active'",
      [chatId],
      limit,
    );
  }

  listDue(now: Date, limit = 20): CronJobRecord[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          id,
          chat_id AS chatId,
          created_by_open_id AS createdByOpenId,
          schedule,
          prompt,
          image_file_name AS imageFileName,
          mention_target_name AS mentionTargetName,
          mention_open_id AS mentionOpenId,
          mention_user_id AS mentionUserId,
          status,
          last_run_at AS lastRunAt,
          next_run_at AS nextRunAt,
          last_error AS lastError,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM cron_jobs
        WHERE status = 'active' AND next_run_at <= ?
        ORDER BY next_run_at ASC, updated_at ASC
        LIMIT ?
      `,
      )
      .all(now.toISOString(), limit) as CronJobRow[];

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chatId,
      createdByOpenId: row.createdByOpenId ?? undefined,
      schedule: row.schedule,
      prompt: row.prompt,
      imageFileName: row.imageFileName ?? undefined,
      mentionTargetName: row.mentionTargetName ?? undefined,
      mentionOpenId: row.mentionOpenId ?? undefined,
      mentionUserId: row.mentionUserId ?? undefined,
      status: row.status,
      lastRunAt: row.lastRunAt ?? undefined,
      nextRunAt: row.nextRunAt,
      lastError: row.lastError ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  deleteByChat(id: string, chatId: string): boolean {
    const now = this.now().toISOString();
    const result = this.database
      .prepare(
        `
        UPDATE cron_jobs
        SET status = 'deleted', updated_at = @updatedAt
        WHERE id = @id AND chat_id = @chatId AND status = 'active'
      `,
      )
      .run({ id, chatId, updatedAt: now });
    return result.changes > 0;
  }

  markSuccess(id: string, ranAt: Date): void {
    const job = this.get(id);
    if (!job) {
      return;
    }

    const nextRunAt = getNextCronRun(job.schedule, ranAt);
    if (!nextRunAt) {
      throw new Error("无法计算下一次执行时间。");
    }

    this.database
      .prepare(
        `
        UPDATE cron_jobs
        SET last_run_at = @lastRunAt, next_run_at = @nextRunAt, last_error = NULL, updated_at = @updatedAt
        WHERE id = @id AND status = 'active'
      `,
      )
      .run({
        id,
        lastRunAt: ranAt.toISOString(),
        nextRunAt: nextRunAt.toISOString(),
        updatedAt: ranAt.toISOString(),
      });
  }

  markFailure(id: string, error: string, failedAt: Date): void {
    const job = this.get(id);
    if (!job) {
      return;
    }

    const nextRunAt = getNextCronRun(job.schedule, failedAt);
    if (!nextRunAt) {
      throw new Error("无法计算下一次执行时间。");
    }

    this.database
      .prepare(
        `
        UPDATE cron_jobs
        SET last_run_at = @lastRunAt, last_error = @lastError, next_run_at = @nextRunAt, updated_at = @updatedAt
        WHERE id = @id AND status = 'active'
      `,
      )
      .run({
        id,
        lastRunAt: failedAt.toISOString(),
        lastError: error,
        nextRunAt: nextRunAt.toISOString(),
        updatedAt: failedAt.toISOString(),
      });
  }

  private listByWhere(
    whereSql: string,
    params: unknown[],
    limit: number,
  ): CronJobRecord[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          id,
          chat_id AS chatId,
          created_by_open_id AS createdByOpenId,
          schedule,
          prompt,
          image_file_name AS imageFileName,
          mention_target_name AS mentionTargetName,
          mention_open_id AS mentionOpenId,
          mention_user_id AS mentionUserId,
          status,
          last_run_at AS lastRunAt,
          next_run_at AS nextRunAt,
          last_error AS lastError,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM cron_jobs
        ${whereSql}
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      )
      .all(...params, limit) as CronJobRow[];

    return rows.map((row) => ({
      id: row.id,
      chatId: row.chatId,
      createdByOpenId: row.createdByOpenId ?? undefined,
      schedule: row.schedule,
      prompt: row.prompt,
      imageFileName: row.imageFileName ?? undefined,
      mentionTargetName: row.mentionTargetName ?? undefined,
      mentionOpenId: row.mentionOpenId ?? undefined,
      mentionUserId: row.mentionUserId ?? undefined,
      status: row.status,
      lastRunAt: row.lastRunAt ?? undefined,
      nextRunAt: row.nextRunAt,
      lastError: row.lastError ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
