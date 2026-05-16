import type { SqliteDatabase } from "../db/database.js";

export interface FeishuChatMemberRecord {
  chatId: string;
  openId: string;
  userId?: string;
  userName: string;
  updatedAt: string;
}

export interface FeishuChatMemberApiRecord {
  openId: string;
  userId?: string;
  userName: string;
}

export interface FeishuChatMembersClient {
  listChatMembers(payload: { chatId: string; memberIdType: "open_id" }): Promise<FeishuChatMemberApiRecord[]>;
}

interface FeishuChatMembersSdkPageRecord {
  member_id?: string;
  name?: string;
  user_id?: string;
}

interface FeishuChatMembersSdkResponse {
  data?: {
    items?: FeishuChatMembersSdkPageRecord[];
    page_token?: string;
    has_more?: boolean;
  };
}

interface FeishuChatMembersSdkClientLike {
  im: {
    v1?: {
      chatMembers?: {
        get(payload: {
          params: { member_id_type: "open_id"; page_token?: string };
          path: { chat_id: string };
        }): Promise<FeishuChatMembersSdkResponse>;
      };
    };
  };
}

export interface FeishuMemberResolverOptions {
  repository: FeishuMemberRepository;
  client: FeishuChatMembersClient;
  logger?: Pick<Console, "warn">;
  now?: () => Date;
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000;

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

export class FeishuMemberResolver {
  private readonly now: () => Date;
  private readonly ttlMs: number;
  private readonly logger?: Pick<Console, "warn">;

  constructor(private readonly options: FeishuMemberResolverOptions) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.logger = options.logger;
  }

  async resolveOpenIdName(chatId: string, openId: string): Promise<string> {
    const cached = this.options.repository.get(chatId, openId);

    if (!cached || this.isExpired(cached.updatedAt)) {
      try {
        await this.refreshChatMembers(chatId);
      } catch (error) {
        this.logger?.warn("Failed to refresh Feishu chat members for open id resolution", {
          chatId,
          openId,
          error,
        });
        return cached?.userName ?? openId;
      }
    }

    return this.options.repository.get(chatId, openId)?.userName ?? openId;
  }

  async resolveUniqueName(chatId: string, userName: string): Promise<FeishuChatMemberRecord | null> {
    const cached = this.options.repository.findUniqueByName(chatId, userName);
    if (cached && !this.isExpired(cached.updatedAt)) {
      return cached;
    }

    try {
      await this.refreshChatMembers(chatId);
    } catch (error) {
      this.logger?.warn("Failed to refresh Feishu chat members for unique name resolution", {
        chatId,
        userName,
        error,
      });
      return cached ?? null;
    }

    return this.options.repository.findUniqueByName(chatId, userName);
  }

  private isExpired(updatedAt: string): boolean {
    const updatedAtMs = Date.parse(updatedAt);
    if (Number.isNaN(updatedAtMs)) {
      return true;
    }

    return this.now().getTime() - updatedAtMs >= this.ttlMs;
  }

  private async refreshChatMembers(chatId: string): Promise<void> {
    const members = await this.options.client.listChatMembers({ chatId, memberIdType: "open_id" });
    const updatedAt = this.now().toISOString();

    for (const member of members) {
      this.options.repository.upsert({
        chatId,
        openId: member.openId,
        userId: member.userId,
        userName: member.userName,
        updatedAt,
      });
    }
  }
}

export function formatFeishuMemberPrompt(members: FeishuChatMemberRecord[], limit = 80): string {
  const lines = members
    .filter((member) => member.userName)
    .slice(0, limit)
    .map((member) => `${member.openId} = ${member.userName}`);
  return lines.length ? `当前群聊成员 ID 与群昵称映射：\n${lines.join("\n")}` : "";
}

export function createFeishuChatMembersClient(client: FeishuChatMembersSdkClientLike): FeishuChatMembersClient {
  return {
    async listChatMembers(payload) {
      const api = client.im.v1?.chatMembers?.get;
      if (!api) {
        throw new Error("当前飞书 SDK 不支持 chatMembers.get，无法获取群成员。");
      }

      const members: FeishuChatMemberApiRecord[] = [];
      let pageToken: string | undefined;

      do {
        const response = await api({
          path: { chat_id: payload.chatId },
          params: {
            member_id_type: payload.memberIdType,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
        });
        const items = response.data?.items ?? [];

        for (const item of items) {
          if (!item.member_id || !item.name) {
            continue;
          }

          members.push({
            openId: item.member_id,
            userId: item.user_id,
            userName: item.name,
          });
        }

        pageToken = response.data?.has_more ? response.data.page_token : undefined;
      } while (pageToken);

      return members;
    },
  };
}
