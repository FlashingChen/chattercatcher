import type { SqliteDatabase } from "../db/database.js";

export interface FeishuChatMemberRecord {
  chatId: string;
  openId: string;
  userId?: string;
  userName: string;
  updatedAt: string;
}

export class FeishuMemberRepository {
  constructor(private readonly database: SqliteDatabase) {}

  upsert(record: FeishuChatMemberRecord): void {
    this.database
      .prepare(
        `
          INSERT INTO feishu_chat_members (chat_id, open_id, user_id, user_name, updated_at)
          VALUES (@chatId, @openId, @userId, @userName, @updatedAt)
          ON CONFLICT(chat_id, open_id)
          DO UPDATE SET
            user_id = excluded.user_id,
            user_name = excluded.user_name,
            updated_at = excluded.updated_at
        `,
      )
      .run({
        chatId: record.chatId,
        openId: record.openId,
        userId: record.userId ?? null,
        userName: record.userName,
        updatedAt: record.updatedAt,
      });
  }

  get(chatId: string, openId: string): FeishuChatMemberRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT
            chat_id AS chatId,
            open_id AS openId,
            user_id AS userId,
            user_name AS userName,
            updated_at AS updatedAt
          FROM feishu_chat_members
          WHERE chat_id = ? AND open_id = ?
        `,
      )
      .get(chatId, openId) as FeishuChatMemberRecord | undefined;

    return row ?? null;
  }

  listByChat(chatId: string): FeishuChatMemberRecord[] {
    return this.database
      .prepare(
        `
          SELECT
            chat_id AS chatId,
            open_id AS openId,
            user_id AS userId,
            user_name AS userName,
            updated_at AS updatedAt
          FROM feishu_chat_members
          WHERE chat_id = ?
          ORDER BY user_name ASC, open_id ASC
        `,
      )
      .all(chatId) as FeishuChatMemberRecord[];
  }

  findUniqueByName(chatId: string, userName: string): FeishuChatMemberRecord | null {
    const rows = this.database
      .prepare(
        `
          SELECT
            chat_id AS chatId,
            open_id AS openId,
            user_id AS userId,
            user_name AS userName,
            updated_at AS updatedAt
          FROM feishu_chat_members
          WHERE chat_id = ? AND user_name = ?
          ORDER BY open_id ASC
          LIMIT 2
        `,
      )
      .all(chatId, userName) as FeishuChatMemberRecord[];

    return rows.length === 1 ? rows[0]! : null;
  }
}
