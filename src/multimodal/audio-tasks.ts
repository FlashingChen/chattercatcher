import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";
import type {
  AudioTranscriptionTaskRecord,
  AudioTranscriptionTaskStatus,
  EnqueueAudioTranscriptionTaskInput,
} from "./audio-types.js";

interface AudioTranscriptionTaskRow {
  id: string;
  source_message_id: string;
  platform_message_id: string;
  audio_key: string;
  stored_path: string;
  mime_type: string;
  status: AudioTranscriptionTaskStatus;
  attempts: number;
  last_error: string | null;
  derived_message_id: string | null;
  created_at: string;
  updated_at: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableId(sourceMessageId: string, audioKey: string): string {
  return crypto.createHash("sha256").update(`${sourceMessageId}${audioKey}`).digest("hex").slice(0, 32);
}

function mapRow(row: AudioTranscriptionTaskRow | undefined): AudioTranscriptionTaskRecord | undefined {
  if (!row) {
    return undefined;
  }

  return {
    id: row.id,
    sourceMessageId: row.source_message_id,
    platformMessageId: row.platform_message_id,
    audioKey: row.audio_key,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    status: row.status,
    attempts: row.attempts,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.derived_message_id ? { derivedMessageId: row.derived_message_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class AudioTranscriptionTaskRepository {
  constructor(private readonly database: SqliteDatabase) {}

  enqueue(input: EnqueueAudioTranscriptionTaskInput): AudioTranscriptionTaskRecord {
    const id = stableId(input.sourceMessageId, input.audioKey);
    const timestamp = nowIso();

    this.database
      .prepare(
        `
          INSERT INTO audio_transcription_tasks (
            id,
            source_message_id,
            platform_message_id,
            audio_key,
            stored_path,
            mime_type,
            status,
            attempts,
            created_at,
            updated_at
          )
          VALUES (
            @id,
            @sourceMessageId,
            @platformMessageId,
            @audioKey,
            @storedPath,
            @mimeType,
            'pending',
            0,
            @createdAt,
            @updatedAt
          )
          ON CONFLICT(source_message_id, audio_key)
          DO UPDATE SET
            platform_message_id = excluded.platform_message_id,
            stored_path = excluded.stored_path,
            mime_type = excluded.mime_type,
            status = 'pending',
            attempts = 0,
            last_error = NULL,
            derived_message_id = NULL,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        id,
        sourceMessageId: input.sourceMessageId,
        platformMessageId: input.platformMessageId,
        audioKey: input.audioKey,
        storedPath: input.storedPath,
        mimeType: input.mimeType,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    const record = this.getById(id);
    if (!record) {
      throw new Error(`语音转写任务写入失败：${id}`);
    }

    return record;
  }

  listPending(limit = 10): AudioTranscriptionTaskRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT
            id,
            source_message_id,
            platform_message_id,
            audio_key,
            stored_path,
            mime_type,
            status,
            attempts,
            last_error,
            derived_message_id,
            created_at,
            updated_at
          FROM audio_transcription_tasks
          WHERE status = 'pending'
          ORDER BY updated_at ASC
          LIMIT ?
        `,
      )
      .all(limit) as AudioTranscriptionTaskRow[];

    return rows.map((row) => mapRow(row)).filter((row): row is AudioTranscriptionTaskRecord => Boolean(row));
  }

  markRunning(id: string): AudioTranscriptionTaskRecord {
    const result = this.database
      .prepare(
        `
          UPDATE audio_transcription_tasks
          SET status = 'running',
              attempts = attempts + 1,
              last_error = NULL,
              updated_at = @updatedAt
          WHERE id = @id AND status = 'pending'
        `,
      )
      .run({ id, updatedAt: nowIso() });

    if (result.changes === 0) {
      throw new Error(`语音转写任务状态无法更新：${id}`);
    }

    return this.requireById(id);
  }

  markSucceeded(id: string, derivedMessageId: string): AudioTranscriptionTaskRecord {
    this.database
      .prepare(
        `
          UPDATE audio_transcription_tasks
          SET status = 'succeeded',
              last_error = NULL,
              derived_message_id = @derivedMessageId,
              updated_at = @updatedAt
          WHERE id = @id
        `,
      )
      .run({ id, derivedMessageId, updatedAt: nowIso() });

    return this.requireById(id);
  }

  markSkipped(id: string, reason: string): AudioTranscriptionTaskRecord {
    this.database
      .prepare(
        `
          UPDATE audio_transcription_tasks
          SET status = 'skipped',
              last_error = @reason,
              derived_message_id = NULL,
              updated_at = @updatedAt
          WHERE id = @id
        `,
      )
      .run({ id, reason, updatedAt: nowIso() });

    return this.requireById(id);
  }

  markFailed(id: string, error: string, finalFailure: boolean): AudioTranscriptionTaskRecord {
    this.database
      .prepare(
        `
          UPDATE audio_transcription_tasks
          SET status = @status,
              last_error = @error,
              derived_message_id = NULL,
              updated_at = @updatedAt
          WHERE id = @id
        `,
      )
      .run({ id, status: finalFailure ? "failed" : "pending", error, updatedAt: nowIso() });

    return this.requireById(id);
  }

  getById(id: string): AudioTranscriptionTaskRecord | undefined {
    const row = this.database
      .prepare(
        `
          SELECT
            id,
            source_message_id,
            platform_message_id,
            audio_key,
            stored_path,
            mime_type,
            status,
            attempts,
            last_error,
            derived_message_id,
            created_at,
            updated_at
          FROM audio_transcription_tasks
          WHERE id = ?
        `,
      )
      .get(id) as AudioTranscriptionTaskRow | undefined;

    return mapRow(row);
  }

  private requireById(id: string): AudioTranscriptionTaskRecord {
    const record = this.getById(id);
    if (!record) {
      throw new Error(`语音转写任务不存在：${id}`);
    }
    return record;
  }
}
