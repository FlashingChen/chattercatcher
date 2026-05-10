import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";
import type { MessageSearchResult, MessageSearchScope } from "../messages/types.js";
import { sanitizeEpisodeSummary } from "./sanitizer.js";

export interface EpisodeMessage {
  id: string;
  chatId: string;
  chatName: string;
  senderName: string;
  text: string;
  sentAt: string;
}

export interface EpisodeWindow {
  chatId: string;
  chatName: string;
  startedAt: string;
  endedAt: string;
  messages: EpisodeMessage[];
}

export interface EpisodeSummaryRecord {
  id: string;
  chatId: string;
  chatName: string;
  text: string;
  startedAt: string;
  endedAt: string;
  messageIds: string[];
}

export interface EpisodeSearchResult extends MessageSearchResult {
  sourceMessageIds: string[];
  startedAt: string;
  endedAt: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableId(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("")).digest("hex").slice(0, 32);
}

function escapeFtsQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/[^\p{L}\p{N}_-]+/gu, " ").trim())
    .flatMap((term) => term.split(/\s+/))
    .filter(Boolean);

  if (terms.length === 0) {
    return "\"\"";
  }

  return terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(" OR ");
}

function toMillis(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function buildScopeWhere(scope?: MessageSearchScope): { where: string; params: string[] } {
  const clauses: string[] = [];
  const params: string[] = [];
  if (scope?.platform) {
    clauses.push("c.platform = ?");
    params.push(scope.platform);
  }
  if (scope?.platformChatId) {
    clauses.push("c.platform_chat_id = ?");
    params.push(scope.platformChatId);
  }

  return {
    where: clauses.length > 0 ? `AND ${clauses.join(" AND ")}` : "",
    params,
  };
}

export interface EpisodeListItem {
  id: string;
  chatId: string;
  chatName: string;
  summary: string;
  messageCount: number;
  startedAt: string;
  endedAt: string;
  createdAt: string;
}

export class EpisodeRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async summarizeReadyWindows(input: {
    now: Date;
    quietMs: number;
    windowMs: number;
    summarize: (window: EpisodeWindow, now: Date) => Promise<string>;
  }): Promise<EpisodeSummaryRecord[]> {
    const rows = this.database
      .prepare(
        `
          SELECT
            m.id,
            m.chat_id AS chatId,
            c.name AS chatName,
            m.sender_name AS senderName,
            m.text,
            m.sent_at AS sentAt
          FROM messages m
          JOIN chats c ON c.id = m.chat_id
          WHERE NOT EXISTS (
            SELECT 1 FROM memory_episode_messages mem WHERE mem.message_id = m.id
          )
          ORDER BY m.chat_id ASC, m.sent_at ASC
        `,
      )
      .all() as EpisodeMessage[];

    const byChat = new Map<string, EpisodeMessage[]>();
    for (const row of rows) {
      byChat.set(row.chatId, [...(byChat.get(row.chatId) ?? []), row]);
    }

    const created: EpisodeSummaryRecord[] = [];
    const nowMs = input.now.getTime();
    for (const messages of byChat.values()) {
      const windows: EpisodeMessage[][] = [];
      let current: EpisodeMessage[] = [];
      for (const message of messages) {
        const first = current[0];
        if (first && toMillis(message.sentAt) - toMillis(first.sentAt) > input.windowMs) {
          windows.push(current);
          current = [];
        }
        current.push(message);
      }
      if (current.length > 0) {
        windows.push(current);
      }

      for (const windowMessages of windows) {
        const last = windowMessages.at(-1);
        if (!last || nowMs - toMillis(last.sentAt) < input.quietMs) {
          continue;
        }

        const first = windowMessages[0]!;
        const window: EpisodeWindow = {
          chatId: first.chatId,
          chatName: first.chatName,
          startedAt: first.sentAt,
          endedAt: last.sentAt,
          messages: windowMessages,
        };
        const summary = await input.summarize(window, input.now);
        created.push(this.insertEpisode(window, summary));
      }
    }

    return created;
  }

  private insertEpisode(window: EpisodeWindow, summary: string): EpisodeSummaryRecord {
    const safeSummary = sanitizeEpisodeSummary(summary);
    const createdAt = nowIso();
    const id = stableId([window.chatId, window.startedAt, window.endedAt]);
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `
            INSERT INTO memory_episodes (id, chat_id, summary, message_count, started_at, ended_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(chat_id, started_at, ended_at)
            DO UPDATE SET summary = excluded.summary, message_count = excluded.message_count
          `,
        )
        .run(id, window.chatId, safeSummary, window.messages.length, window.startedAt, window.endedAt, createdAt);
      this.database.prepare("DELETE FROM memory_episode_messages WHERE episode_id = ?").run(id);
      this.database.prepare("DELETE FROM memory_episodes_fts WHERE episode_id = ?").run(id);

      const insertMessage = this.database.prepare(
        "INSERT INTO memory_episode_messages (episode_id, message_id, position) VALUES (?, ?, ?)",
      );
      for (const [index, message] of window.messages.entries()) {
        insertMessage.run(id, message.id, index);
      }
      this.database.prepare("INSERT INTO memory_episodes_fts (summary, episode_id) VALUES (?, ?)").run(safeSummary, id);
    });

    transaction();
    return {
      id,
      chatId: window.chatId,
      chatName: window.chatName,
      text: safeSummary,
      startedAt: window.startedAt,
      endedAt: window.endedAt,
      messageIds: window.messages.map((message) => message.id),
    };
  }

  async refreshWindowForMessage(input: {
    messageId: string;
    windowMs: number;
    summarize: (window: EpisodeWindow) => Promise<string>;
  }): Promise<EpisodeSummaryRecord | undefined> {
    const target = this.database
      .prepare(
        `
          SELECT chat_id AS chatId, sent_at AS sentAt
          FROM messages
          WHERE id = ?
        `,
      )
      .get(input.messageId) as { chatId: string; sentAt: string } | undefined;

    if (!target) {
      return undefined;
    }

    const existingWindow = this.database
      .prepare(
        `
          SELECT e.started_at AS startedAt, e.ended_at AS endedAt
          FROM messages target
          JOIN messages source
            ON source.id = json_extract(target.raw_payload_json, '$.derivedFromMessageId')
          JOIN memory_episode_messages mem ON mem.message_id = source.id
          JOIN memory_episodes e ON e.id = mem.episode_id
          WHERE target.id = ?
          LIMIT 1
        `,
      )
      .get(input.messageId) as { startedAt: string; endedAt: string } | undefined;
    if (!existingWindow) {
      return undefined;
    }

    const messageTime = toMillis(target.sentAt);
    const windowStart = toMillis(existingWindow.startedAt);
    const windowEnd = Math.max(toMillis(existingWindow.endedAt), messageTime);

    const rows = this.database
      .prepare(
        `
          SELECT
            m.id,
            m.chat_id AS chatId,
            c.name AS chatName,
            m.sender_name AS senderName,
            m.text,
            m.sent_at AS sentAt
          FROM messages m
          JOIN chats c ON c.id = m.chat_id
          WHERE m.chat_id = ?
          ORDER BY m.sent_at ASC
        `,
      )
      .all(target.chatId) as EpisodeMessage[];

    const windowMessages = rows.filter((message) => {
      const time = toMillis(message.sentAt);
      return time >= windowStart && time <= windowEnd;
    });
    const first = windowMessages[0];
    const last = windowMessages.at(-1);
    if (!first || !last) {
      return undefined;
    }

    const window: EpisodeWindow = {
      chatId: first.chatId,
      chatName: first.chatName,
      startedAt: first.sentAt,
      endedAt: last.sentAt,
      messages: windowMessages,
    };
    const summary = await input.summarize(window);
    return this.insertEpisode(window, summary);
  }

  getEpisodeCount(): number {
    const row = this.database.prepare("SELECT count(*) AS count FROM memory_episodes").get() as { count: number };
    return row.count;
  }

  listRecentEpisodes(limit = 20): EpisodeListItem[] {
    return this.database
      .prepare(
        `
          SELECT
            e.id,
            e.chat_id AS chatId,
            c.name AS chatName,
            e.summary,
            e.message_count AS messageCount,
            e.started_at AS startedAt,
            e.ended_at AS endedAt,
            e.created_at AS createdAt
          FROM memory_episodes e
          JOIN chats c ON c.id = e.chat_id
          ORDER BY e.ended_at DESC
          LIMIT ?
        `,
      )
      .all(limit) as EpisodeListItem[];
  }

  searchEpisodes(query: string, limit = 8, scope?: MessageSearchScope): EpisodeSearchResult[] {
    const ftsQuery = escapeFtsQuery(query);
    const scopeWhere = buildScopeWhere(scope);
    return this.database
      .prepare(
        `
          SELECT
            e.id AS chunkId,
            e.id AS messageId,
            'episode' AS platform,
            e.summary AS text,
            1.0 AS score,
            'episode' AS messageType,
            c.name AS chatName,
            '会话记忆' AS senderName,
            e.ended_at AS sentAt,
            e.started_at AS startedAt,
            e.ended_at AS endedAt,
            (
              SELECT json_group_array(message_id)
              FROM (
                SELECT message_id
                FROM memory_episode_messages
                WHERE episode_id = e.id
                ORDER BY position ASC
              )
            ) AS sourceMessageIdsJson
          FROM memory_episodes_fts fts
          JOIN memory_episodes e ON e.id = fts.episode_id
          JOIN chats c ON c.id = e.chat_id
          WHERE memory_episodes_fts MATCH ?
          ${scopeWhere.where}
          GROUP BY e.id
          ORDER BY e.ended_at DESC
          LIMIT ?
        `,
      )
      .all(ftsQuery, ...scopeWhere.params, limit)
      .map((row) => {
        const item = row as MessageSearchResult & {
          startedAt: string;
          endedAt: string;
          sourceMessageIdsJson: string;
        };
        return {
          ...item,
          sourceMessageIds: JSON.parse(item.sourceMessageIdsJson) as string[],
        };
      });
  }
}
