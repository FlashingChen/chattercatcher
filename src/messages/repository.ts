import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";
import { chunkText } from "./chunker.js";
import type {
  ChatRecord,
  CreateImageSummaryMessageInput,
  FileRecord,
  IngestMessageInput,
  MessageSearchResult,
  MessageSearchScope,
} from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function stableId(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
}

function escapeFtsQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/"/g, "\"\""))
    .filter(Boolean);

  if (terms.length === 0) {
    return "\"\"";
  }

  return terms.map((term) => `"${term}"`).join(" OR ");
}

function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function buildSearchTerms(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const terms = trimmed.split(/\s+/).filter(Boolean);
  if (terms.length > 1) {
    return terms;
  }

  if (/[\u3400-\u9fff]/.test(trimmed) && trimmed.length > 2) {
    const cjkTerms = new Set<string>([trimmed]);
    for (let index = 0; index < trimmed.length - 1; index += 1) {
      cjkTerms.add(trimmed.slice(index, index + 2));
    }

    return [...cjkTerms];
  }

  return [trimmed];
}

function buildScopeWhere(scope?: MessageSearchScope): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (scope?.platform) {
    clauses.push("m.platform = ?");
    params.push(scope.platform);
  }
  if (scope?.platformChatId) {
    clauses.push("c.platform_chat_id = ?");
    params.push(scope.platformChatId);
  }
  if (scope?.personId) {
    clauses.push("m.person_id = ?");
    params.push(scope.personId);
  }

  return {
    where: clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "",
    params,
  };
}

function parseRawPayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class MessageRepository {
  constructor(private readonly database: SqliteDatabase) {}

  ingest(input: IngestMessageInput): string {
    const createdAt = nowIso();
    const chatId = stableId([input.platform, input.platformChatId]);
    const messageId = stableId([input.platform, input.platformMessageId]);
    const rawPayloadJson = JSON.stringify(input.rawPayload ?? {});
    const chunks = chunkText(input.text);

    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `
          INSERT INTO chats (id, platform, platform_chat_id, name, created_at, updated_at)
          VALUES (@id, @platform, @platformChatId, @name, @createdAt, @updatedAt)
          ON CONFLICT(platform, platform_chat_id)
          DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
        `,
        )
        .run({
          id: chatId,
          platform: input.platform,
          platformChatId: input.platformChatId,
          name: input.chatName,
          createdAt,
          updatedAt: createdAt,
        });

      this.database
        .prepare(
          `
          INSERT INTO messages (
            id, platform, platform_message_id, chat_id, sender_id, sender_name,
            person_id, message_type, text, raw_payload_json, sent_at, received_at, created_at
          )
          VALUES (
            @id, @platform, @platformMessageId, @chatId, @senderId, @senderName,
            @personId, @messageType, @text, @rawPayloadJson, @sentAt, @receivedAt, @createdAt
          )
          ON CONFLICT(platform, platform_message_id)
          DO UPDATE SET
            person_id = COALESCE(excluded.person_id, messages.person_id),
            message_type = excluded.message_type,
            text = excluded.text,
            raw_payload_json = excluded.raw_payload_json,
            received_at = excluded.received_at
        `,
        )
        .run({
          id: messageId,
          platform: input.platform,
          platformMessageId: input.platformMessageId,
          chatId,
          senderId: input.senderId,
          senderName: input.senderName,
          personId: input.personId ?? null,
          messageType: input.messageType,
          text: input.text,
          rawPayloadJson,
          sentAt: input.sentAt,
          receivedAt: createdAt,
          createdAt,
        });

      this.database.prepare("DELETE FROM message_chunks_fts WHERE message_id = ?").run(messageId);
      this.database.prepare("DELETE FROM message_chunks WHERE message_id = ?").run(messageId);

      const insertChunk = this.database.prepare(`
        INSERT INTO message_chunks (id, message_id, chunk_index, text, metadata_json, created_at)
        VALUES (@id, @messageId, @chunkIndex, @text, @metadataJson, @createdAt)
      `);
      const insertFts = this.database.prepare(`
        INSERT INTO message_chunks_fts (text, chunk_id, message_id)
        VALUES (@text, @chunkId, @messageId)
      `);

      for (const chunk of chunks) {
        const chunkId = stableId([messageId, String(chunk.index)]);
        insertChunk.run({
          id: chunkId,
          messageId,
          chunkIndex: chunk.index,
          text: chunk.text,
          metadataJson: JSON.stringify({ sourceType: "message" }),
          createdAt,
        });
        insertFts.run({ text: chunk.text, chunkId, messageId });
      }
    });

    transaction();
    return messageId;
  }

  createImageSummaryMessage(input: CreateImageSummaryMessageInput): string {
    const source = this.database
      .prepare(
        `
        SELECT
          m.platform AS platform,
          m.platform_message_id AS platformMessageId,
          m.chat_id AS chatId,
          m.sender_id AS senderId,
          m.sender_name AS senderName,
          m.person_id AS personId,
          m.sent_at AS sentAt,
          c.platform_chat_id AS platformChatId,
          c.name AS chatName
        FROM messages m
        JOIN chats c ON c.id = m.chat_id
        WHERE m.id = ?
      `,
      )
      .get(input.sourceMessageId) as
      | {
          platform: string;
          platformMessageId: string;
          chatId: string;
          senderId: string;
          senderName: string;
          personId: string | null;
          sentAt: string;
          platformChatId: string;
          chatName: string;
        }
      | undefined;

    if (!source) {
      throw new Error("原始图片消息不存在。");
    }

    const derivedPlatformMessageId = `${source.platformMessageId}:image-summary:${input.imageKey}`;
    const imageFileName = input.imageFileName?.trim();
    const summaryText = imageFileName
      ? `[图片转述] 文件名：${imageFileName}\n${input.summary.trim()}`
      : `[图片转述] ${input.summary.trim()}`;
    return this.ingest({
      platform: source.platform,
      platformChatId: source.platformChatId,
      chatName: source.chatName,
      platformMessageId: derivedPlatformMessageId,
      senderId: source.senderId,
      senderName: source.senderName,
      personId: source.personId ?? undefined,
      messageType: "image_summary",
      text: summaryText,
      sentAt: source.sentAt,
      rawPayload: {
        derivedFromMessageId: input.sourceMessageId,
        sourceAttachmentKind: "image",
        sourceResourceKey: input.imageKey,
        ...(imageFileName ? { imageFileName } : {}),
        multimodalModel: input.multimodalModel,
        isMeaningful: true,
        ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
        generatedAt: input.generatedAt,
      },
    });
  }

  listRecentMessages(limit = 20): MessageSearchResult[] {
    return this.database
      .prepare(
        `
        SELECT
          mc.id AS chunkId,
          m.id AS messageId,
          m.platform AS platform,
          mc.text AS text,
          1.0 AS score,
          m.message_type AS messageType,
          c.name AS chatName,
          m.sender_id AS senderId,
          m.sender_name AS senderName,
          m.person_id AS personId,
          m.sent_at AS sentAt
        FROM message_chunks mc
        JOIN messages m ON m.id = mc.message_id
        JOIN chats c ON c.id = m.chat_id
        ORDER BY m.sent_at DESC
        LIMIT ?
      `,
      )
      .all(limit) as MessageSearchResult[];
  }

  listAllMessageChunks(limit = 10000): MessageSearchResult[] {
    return this.database
      .prepare(
        `
        SELECT
          mc.id AS chunkId,
          m.id AS messageId,
          m.platform AS platform,
          mc.text AS text,
          1.0 AS score,
          m.message_type AS messageType,
          c.name AS chatName,
          m.sender_id AS senderId,
          m.sender_name AS senderName,
          m.person_id AS personId,
          m.sent_at AS sentAt
        FROM message_chunks mc
        JOIN messages m ON m.id = mc.message_id
        JOIN chats c ON c.id = m.chat_id
        ORDER BY m.sent_at DESC, mc.chunk_index ASC
        LIMIT ?
      `,
      )
      .all(limit) as MessageSearchResult[];
  }

  listMessageChunksByMessageIds(messageIds: string[], limit = 10000): MessageSearchResult[] {
    if (messageIds.length === 0) {
      return [];
    }

    return this.database
      .prepare(
        `
        SELECT
          mc.id AS chunkId,
          m.id AS messageId,
          m.platform AS platform,
          mc.text AS text,
          1.0 AS score,
          m.message_type AS messageType,
          c.name AS chatName,
          m.sender_id AS senderId,
          m.sender_name AS senderName,
          m.person_id AS personId,
          m.sent_at AS sentAt
        FROM message_chunks mc
        JOIN messages m ON m.id = mc.message_id
        JOIN chats c ON c.id = m.chat_id
        WHERE m.id IN (${messageIds.map(() => "?").join(", ")})
        ORDER BY m.sent_at DESC, mc.chunk_index ASC
        LIMIT ?
      `,
      )
      .all(...messageIds, limit) as MessageSearchResult[];
  }

  searchMessages(query: string, limit = 8, options: { excludeMessageIds?: string[]; scope?: MessageSearchScope } = {}): MessageSearchResult[] {
    const ftsQuery = escapeFtsQuery(query);
    const excludedIds = options.excludeMessageIds ?? [];
    const excludedWhere = excludedIds.length > 0 ? `AND fts.message_id NOT IN (${excludedIds.map(() => "?").join(", ")})` : "";
    const scope = buildScopeWhere(options.scope);
    const ftsResults = this.database
      .prepare(
        `
        SELECT
          *
        FROM (
          SELECT
            fts.chunk_id AS chunkId,
            fts.message_id AS messageId,
            m.platform AS platform,
            mc.text AS text,
            1.0 AS score,
            m.message_type AS messageType,
            c.name AS chatName,
            m.sender_id AS senderId,
            m.sender_name AS senderName,
            m.person_id AS personId,
            m.sent_at AS sentAt,
            ROW_NUMBER() OVER (PARTITION BY fts.message_id ORDER BY mc.chunk_index ASC) AS rowNumber
          FROM message_chunks_fts fts
          JOIN message_chunks mc ON mc.id = fts.chunk_id
          JOIN messages m ON m.id = fts.message_id
          JOIN chats c ON c.id = m.chat_id
          WHERE message_chunks_fts MATCH ?
          ${excludedWhere}
          ${scope.where}
        ) ranked
        WHERE rowNumber = 1
        ORDER BY sentAt DESC
        LIMIT ?
      `,
      )
      .all(ftsQuery, ...excludedIds, ...scope.params, limit) as MessageSearchResult[];

    if (ftsResults.length > 0) {
      return ftsResults;
    }

    const terms = buildSearchTerms(query);
    if (terms.length === 0) {
      return [];
    }

    const where = terms.map(() => "mc.text LIKE ? ESCAPE '\\'").join(" OR ");
    const params = terms.map((term) => `%${escapeLikeTerm(term)}%`);
    const likeExcludedWhere =
      excludedIds.length > 0 ? `AND m.id NOT IN (${excludedIds.map(() => "?").join(", ")})` : "";

    return this.database
      .prepare(
        `
        SELECT
          mc.id AS chunkId,
          m.id AS messageId,
          m.platform AS platform,
          mc.text AS text,
          0.1 AS score,
          m.message_type AS messageType,
          c.name AS chatName,
          m.sender_id AS senderId,
          m.sender_name AS senderName,
          m.person_id AS personId,
          m.sent_at AS sentAt
        FROM message_chunks mc
        JOIN messages m ON m.id = mc.message_id
        JOIN chats c ON c.id = m.chat_id
        WHERE (${where})
        ${likeExcludedWhere}
        ${scope.where}
        ORDER BY m.sent_at DESC
        LIMIT ?
      `,
      )
      .all(...params, ...excludedIds, ...scope.params, limit) as MessageSearchResult[];
  }

  getChatCount(): number {
    return (this.database.prepare("SELECT COUNT(*) AS count FROM chats").get() as { count: number }).count;
  }

  getMessageCount(): number {
    return (this.database.prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number }).count;
  }

  hasPlatformMessage(platform: string, platformMessageId: string): boolean {
    const row = this.database
      .prepare("SELECT 1 AS existsFlag FROM messages WHERE platform = ? AND platform_message_id = ? LIMIT 1")
      .get(platform, platformMessageId) as { existsFlag: number } | undefined;
    return Boolean(row);
  }

  listChats(): ChatRecord[] {
    return this.database
      .prepare(
        `
        SELECT
          id,
          platform,
          platform_chat_id AS platformChatId,
          name,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM chats
        ORDER BY updated_at DESC
      `,
      )
      .all() as ChatRecord[];
  }

  listFiles(limit = 50): FileRecord[] {
    const rows = this.database
      .prepare(
        `
        SELECT
          id AS messageId,
          sender_name AS fileName,
          raw_payload_json AS rawPayloadJson,
          length(text) AS characters,
          created_at AS importedAt
        FROM messages
        WHERE message_type = 'file'
        ORDER BY created_at DESC
        LIMIT ?
      `,
      )
      .all(limit) as Array<{
      messageId: string;
      fileName: string;
      rawPayloadJson: string;
      characters: number;
      importedAt: string;
    }>;

    return rows.map((row) => {
      const payload = parseRawPayload(row.rawPayloadJson);
      return {
        messageId: row.messageId,
        fileName: row.fileName,
        sourcePath: typeof payload.sourcePath === "string" ? payload.sourcePath : undefined,
        storedPath: typeof payload.storedPath === "string" ? payload.storedPath : undefined,
        bytes: typeof payload.bytes === "number" ? payload.bytes : undefined,
        characters: row.characters,
        parser: typeof payload.parser === "string" ? payload.parser : undefined,
        parserWarnings: Array.isArray(payload.parserWarnings)
          ? payload.parserWarnings.filter((item): item is string => typeof item === "string")
          : undefined,
        importedAt: row.importedAt,
      };
    });
  }
}
