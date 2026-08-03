import crypto from "node:crypto";
import path from "node:path";
import type { SqliteDatabase } from "../db/database.js";

export type FileJobStatus = "processing" | "indexed" | "failed";

export interface FileJobRecord {
  id: string;
  sourcePath: string;
  storedPath?: string;
  fileName: string;
  status: FileJobStatus;
  parser?: string;
  messageId?: string;
  bytes?: number;
  characters?: number;
  warnings: string[];
  error?: string;
  contentSha256?: string;
  platformFileKey?: string;
  createdAt: string;
  updatedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableJobId(sourcePath: string): string {
  return crypto.createHash("sha256").update(path.resolve(sourcePath)).digest("hex").slice(0, 32);
}

function parseWarnings(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export class FileJobRepository {
  constructor(private readonly database: SqliteDatabase) {}

  start(input: { sourcePath: string; fileName?: string; platformFileKey?: string }): string {
    const id = stableJobId(input.sourcePath);
    const now = nowIso();
    this.database
      .prepare(
        `
        INSERT INTO file_jobs (
          id, source_path, file_name, status, warnings_json, created_at, updated_at, platform_file_key
        )
        VALUES (@id, @sourcePath, @fileName, 'processing', '[]', @createdAt, @updatedAt, @platformFileKey)
        ON CONFLICT(id) DO UPDATE SET
          source_path = excluded.source_path,
          file_name = excluded.file_name,
          status = 'processing',
          parser = NULL,
          message_id = NULL,
          bytes = NULL,
          characters = NULL,
          warnings_json = '[]',
          error = NULL,
          platform_file_key = excluded.platform_file_key,
          updated_at = excluded.updated_at
      `,
      )
      .run({
        id,
        sourcePath: path.resolve(input.sourcePath),
        fileName: input.fileName ?? path.basename(input.sourcePath),
        createdAt: now,
        updatedAt: now,
        platformFileKey: input.platformFileKey ?? null,
      });
    return id;
  }

  complete(input: {
    id: string;
    storedPath: string;
    parser: string;
    messageId: string;
    bytes: number;
    characters: number;
    warnings: string[];
    contentSha256?: string;
  }): void {
    this.database
      .prepare(
        `
        UPDATE file_jobs
        SET
          stored_path = @storedPath,
          status = 'indexed',
          parser = @parser,
          message_id = @messageId,
          bytes = @bytes,
          characters = @characters,
          warnings_json = @warningsJson,
          content_sha256 = @contentSha256,
          error = NULL,
          updated_at = @updatedAt
        WHERE id = @id
      `,
      )
      .run({
        id: input.id,
        storedPath: input.storedPath,
        parser: input.parser,
        messageId: input.messageId,
        bytes: input.bytes,
        characters: input.characters,
        warningsJson: JSON.stringify(input.warnings),
        contentSha256: input.contentSha256 ?? null,
        updatedAt: nowIso(),
      });
  }

  fail(input: { id: string; error: string }): void {
    this.database
      .prepare(
        `
        UPDATE file_jobs
        SET status = 'failed', error = @error, updated_at = @updatedAt
        WHERE id = @id
      `,
      )
      .run({
        id: input.id,
        error: input.error,
        updatedAt: nowIso(),
      });
  }

  get(id: string): FileJobRecord | null {
    return this.listByWhere("WHERE id = ?", [id], 1)[0] ?? null;
  }

  list(limit = 50, options: { status?: FileJobStatus } = {}): FileJobRecord[] {
    return options.status ? this.listByWhere("WHERE status = ?", [options.status], limit) : this.listByWhere("", [], limit);
  }

  private listByWhere(whereSql: string, params: unknown[], limit: number): FileJobRecord[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          id,
          source_path AS sourcePath,
          stored_path AS storedPath,
          file_name AS fileName,
          status,
          parser,
          message_id AS messageId,
          bytes,
          characters,
          warnings_json AS warningsJson,
          error,
          content_sha256 AS contentSha256,
          platform_file_key AS platformFileKey,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM file_jobs
        ${whereSql}
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      )
      .all(...params, limit) as Array<{
      id: string;
      sourcePath: string;
      storedPath: string | null;
      fileName: string;
      status: FileJobStatus;
      parser: string | null;
      messageId: string | null;
      bytes: number | null;
      characters: number | null;
      warningsJson: string;
      error: string | null;
      contentSha256: string | null;
      platformFileKey: string | null;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      sourcePath: row.sourcePath,
      storedPath: row.storedPath ?? undefined,
      fileName: row.fileName,
      status: row.status,
      parser: row.parser ?? undefined,
      messageId: row.messageId ?? undefined,
      bytes: row.bytes ?? undefined,
      characters: row.characters ?? undefined,
      warnings: parseWarnings(row.warningsJson),
      error: row.error ?? undefined,
      contentSha256: row.contentSha256 ?? undefined,
      platformFileKey: row.platformFileKey ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
