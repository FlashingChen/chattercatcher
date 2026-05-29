import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";
import type {
  DreamStateRecord,
  DreamMessageRecord,
  DreamRunRecord,
  DreamChatRecord,
  PersonRecord,
  ProfileEntryRecord,
  ProfileEvidenceRecord,
  PersonIdentityRecord,
  ResolvePersonInput,
  UpsertProfileEntryInput,
} from "./types.js";
import type { MessageSearchResult } from "../messages/types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string, parts: string[]): string {
  return `${prefix}_${crypto.createHash("sha256").update(parts.join("")).digest("hex").slice(0, 24)}`;
}

function mapPerson(row: {
  id: string;
  primaryName: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}): PersonRecord {
  return {
    id: row.id,
    primaryName: row.primaryName,
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ProfileRepository {
  constructor(private readonly database: SqliteDatabase) {}

  resolvePersonForSender(input: ResolvePersonInput): PersonRecord {
    const observedAt = input.observedAt ?? nowIso();
    const personId = createId("person", [input.platform, input.platformChatId, input.senderId]);
    const identityId = createId("identity", [input.platform, input.platformChatId, input.senderId]);
    const findPerson = this.database.prepare(
      `
        SELECT id, primary_name AS primaryName, notes, created_at AS createdAt, updated_at AS updatedAt
        FROM persons
        WHERE id = ?
      `,
    );

    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `
          INSERT INTO persons (id, primary_name, notes, created_at, updated_at)
          VALUES (?, ?, NULL, ?, ?)
          ON CONFLICT(id) DO NOTHING
        `,
        )
        .run(personId, input.senderName, observedAt, observedAt);

      this.database
        .prepare(
          `
          INSERT INTO person_identities (
            id, person_id, platform, platform_chat_id, external_user_id, external_open_id,
            external_union_id, external_user_id_raw, display_name, alias, source, first_seen_at, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, ?, ?, ?)
          ON CONFLICT(platform, platform_chat_id, external_user_id)
          DO UPDATE SET
            display_name = excluded.display_name,
            source = excluded.source,
            last_seen_at = excluded.last_seen_at
        `,
        )
        .run(identityId, personId, input.platform, input.platformChatId, input.senderId, input.senderId, input.senderName, input.source, observedAt, observedAt);

      this.database
        .prepare(
          `
          UPDATE persons
          SET primary_name = ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(input.senderName, observedAt, personId);

      return findPerson.get(personId) as PersonRecord;
    });

    return transaction();
  }

  listPersons(): PersonRecord[] {
    const rows = this.database
      .prepare(
        `
        SELECT id, primary_name AS primaryName, notes, created_at AS createdAt, updated_at AS updatedAt
        FROM persons
        ORDER BY updated_at DESC, created_at DESC
      `,
      )
      .all() as Array<{ id: string; primaryName: string; notes: string | null; createdAt: string; updatedAt: string }>;
    return rows.map(mapPerson);
  }

  getPersonProfile(personId: string, options: { includeEvidence?: boolean; includeInferred?: boolean } = {}) {
    const personRow = this.database
      .prepare(
        `
        SELECT id, primary_name AS primaryName, notes, created_at AS createdAt, updated_at AS updatedAt
        FROM persons
        WHERE id = ?
      `,
      )
      .get(personId) as { id: string; primaryName: string; notes: string | null; createdAt: string; updatedAt: string } | undefined;

    if (!personRow) {
      return undefined;
    }

    const includeInferred = options.includeInferred ?? true;
    const entryRows = this.database
      .prepare(
        `
        SELECT
          id,
          person_id AS personId,
          category,
          content,
          entry_type AS entryType,
          confidence,
          status,
          source,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_observed_at AS lastObservedAt
        FROM person_profile_entries
        WHERE person_id = ?
          AND status = 'active'
          ${includeInferred ? "" : "AND entry_type = 'fact'"}
        ORDER BY updated_at DESC, created_at DESC
      `,
      )
      .all(personId) as ProfileEntryRecord[];

    const entries = options.includeEvidence
      ? entryRows.map((entry) => ({ ...entry, evidence: this.getEvidence(entry.id) }))
      : entryRows;

    const identities = this.database
      .prepare(
        `
        SELECT
          platform,
          platform_chat_id AS platformChatId,
          external_user_id AS externalUserId,
          display_name AS displayName,
          alias,
          source,
          first_seen_at AS firstSeenAt,
          last_seen_at AS lastSeenAt
        FROM person_identities
        WHERE person_id = ?
        ORDER BY last_seen_at DESC, first_seen_at DESC
      `,
      )
      .all(personId) as PersonIdentityRecord[];

    return {
      person: mapPerson(personRow),
      identities,
      entries,
    };
  }

  upsertProfileEntry(input: UpsertProfileEntryInput): string {
    if (input.evidence.length === 0) {
      throw new Error("Profile entry evidence is required.");
    }

    const timestamp = input.observedAt ?? nowIso();
    const entryId = createId("profile_entry", [input.personId, input.category, input.content]);
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `
          INSERT INTO person_profile_entries (
            id, person_id, category, content, entry_type, confidence, status, source, created_at, updated_at, last_observed_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            confidence = MAX(person_profile_entries.confidence, excluded.confidence),
            status = 'active',
            source = excluded.source,
            updated_at = excluded.updated_at,
            last_observed_at = excluded.last_observed_at
        `,
        )
        .run(entryId, input.personId, input.category, input.content, input.entryType, input.confidence, input.source, timestamp, timestamp, timestamp);

      const insertEvidence = this.database.prepare(
        `
        INSERT INTO person_profile_evidence (entry_id, message_id, quote, reason)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entry_id, message_id, quote) DO UPDATE SET reason = excluded.reason
      `,
      );
      for (const evidence of input.evidence) {
        insertEvidence.run(entryId, evidence.messageId, evidence.quote, evidence.reason);
      }
    });
    transaction();

    return entryId;
  }

  backfillMessagePersons({ limit }: { limit: number }): { updatedMessages: number } {
    const rows = this.database
      .prepare(
        `
        SELECT
          m.id AS id,
          m.platform AS platform,
          c.platform_chat_id AS platformChatId,
          m.sender_id AS senderId,
          m.sender_name AS senderName,
          m.sent_at AS sentAt
        FROM messages m
        JOIN chats c ON c.id = m.chat_id
        WHERE m.person_id IS NULL
        ORDER BY m.sent_at ASC
        LIMIT ?
      `,
      )
      .all(limit) as Array<{ id: string; platform: string; platformChatId: string; senderId: string; senderName: string; sentAt: string }>;

    const update = this.database.prepare("UPDATE messages SET person_id = ? WHERE id = ?");
    const transaction = this.database.transaction(() => {
      for (const row of rows) {
        const person = this.resolvePersonForSender({
          platform: row.platform,
          platformChatId: row.platformChatId,
          senderId: row.senderId,
          senderName: row.senderName,
          source: "inferred",
          observedAt: row.sentAt,
        });
        update.run(person.id, row.id);
      }
    });

    transaction();
    return { updatedMessages: rows.length };
  }

  getDreamState(platform: string, platformChatId: string): DreamStateRecord | undefined {
    return this.database
      .prepare(
        `
        SELECT
          platform,
          platform_chat_id AS platformChatId,
          last_message_id AS lastMessageId,
          last_message_sent_at AS lastMessageSentAt,
          updated_at AS updatedAt
        FROM profile_dream_state
        WHERE platform = ? AND platform_chat_id = ?
      `,
      )
      .get(platform, platformChatId) as DreamStateRecord | undefined;
  }

  updateDreamState(input: {
    platform: string;
    platformChatId: string;
    lastMessageId?: string;
    lastMessageSentAt?: string;
    updatedAt: string;
  }): void {
    this.database
      .prepare(
        `
        INSERT INTO profile_dream_state (platform, platform_chat_id, last_message_id, last_message_sent_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(platform, platform_chat_id)
        DO UPDATE SET
          last_message_id = excluded.last_message_id,
          last_message_sent_at = excluded.last_message_sent_at,
          updated_at = excluded.updated_at
      `,
      )
      .run(input.platform, input.platformChatId, input.lastMessageId ?? null, input.lastMessageSentAt ?? null, input.updatedAt);
  }

  listMessagesForDream(input: { platform: string; platformChatId: string; afterSentAt?: string; limit: number }): DreamMessageRecord[] {
    const afterWhere = input.afterSentAt ? "AND m.sent_at > ?" : "";
    const params = input.afterSentAt
      ? [input.platform, input.platformChatId, input.afterSentAt, input.limit]
      : [input.platform, input.platformChatId, input.limit];
    return this.database
      .prepare(
        `
        SELECT
          m.id AS messageId,
          m.person_id AS personId,
          m.sender_name AS senderName,
          m.sent_at AS sentAt,
          m.text AS text
        FROM messages m
        JOIN chats c ON c.id = m.chat_id
        WHERE m.platform = ?
          AND c.platform_chat_id = ?
          AND m.person_id IS NOT NULL
          ${afterWhere}
        ORDER BY m.sent_at ASC, m.created_at ASC
        LIMIT ?
      `,
      )
      .all(...params) as DreamMessageRecord[];
  }

  listChatsWithPendingDreamMessages(): DreamChatRecord[] {
    return this.database
      .prepare(
        `
        SELECT DISTINCT m.platform AS platform, c.platform_chat_id AS platformChatId
        FROM messages m
        JOIN chats c ON c.id = m.chat_id
        LEFT JOIN profile_dream_state pds ON pds.platform = m.platform AND pds.platform_chat_id = c.platform_chat_id
        WHERE m.person_id IS NOT NULL
          AND (pds.last_message_sent_at IS NULL OR m.sent_at > pds.last_message_sent_at)
        ORDER BY c.platform_chat_id ASC
      `,
      )
      .all() as DreamChatRecord[];
  }

  recordDreamRun(input: Omit<DreamRunRecord, "id"> & { id?: string }): string {
    const id = input.id ?? createId("profile_dream_run", [input.platform, input.platformChatId, input.status, input.startedAt, input.finishedAt, crypto.randomUUID()]);
    this.database
      .prepare(
        `
        INSERT INTO profile_dream_runs (
          id, platform, platform_chat_id, status, processed_message_count, generated_entry_count, error, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        id,
        input.platform,
        input.platformChatId,
        input.status,
        input.processedMessageCount,
        input.generatedEntryCount,
        input.error ?? null,
        input.startedAt,
        input.finishedAt,
      );
    return id;
  }


  resolvePersonIdForSender(input: { senderId: string; platformChatId: string; platform?: string }): string | undefined {
    const platform = input.platform ?? "feishu";
    const row = this.database
      .prepare(
        `
        SELECT person_id AS personId
        FROM person_identities
        WHERE platform = ? AND platform_chat_id = ? AND external_user_id = ?
        LIMIT 1
      `,
      )
      .get(platform, input.platformChatId, input.senderId) as { personId: string } | undefined;
    return row?.personId;
  }

  searchPersonMessages(personId: string, query: string, limit: number, options: { excludeMessageIds?: string[] } = {}): MessageSearchResult[] {
    const cleaned = query
      .trim()
      .split(/\s+/)
      .map((term) => term.replace(/"/g, '""'))
      .filter(Boolean);
    const wrapped = cleaned.map((term) => `"${term}"`).join(" ");
    if (!wrapped) {
      return [];
    }

    const excludedIds = options.excludeMessageIds ?? [];
    const excludedWhere = excludedIds.length > 0 ? `AND fts.message_id NOT IN (${excludedIds.map(() => "?").join(", ")})` : "";
    const rows = this.database
      .prepare(
        `
        SELECT
          fts.chunk_id AS chunkId,
          fts.message_id AS messageId,
          m.platform AS platform,
          mc.text AS text,
          bm25(message_chunks_fts) * -1 AS score,
          m.message_type AS messageType,
          c.name AS chatName,
          m.sender_id AS senderId,
          m.sender_name AS senderName,
          m.person_id AS personId,
          m.sent_at AS sentAt,
          mc.chunk_index AS chunkIndex
        FROM message_chunks_fts fts
        JOIN message_chunks mc ON mc.id = fts.chunk_id
        JOIN messages m ON m.id = fts.message_id
        JOIN chats c ON c.id = m.chat_id
        WHERE message_chunks_fts MATCH ?
        ${excludedWhere}
        AND m.person_id = ?
        ORDER BY bm25(message_chunks_fts), m.sent_at DESC, mc.chunk_index ASC
        LIMIT ?
      `,
      )
      .all(wrapped, ...excludedIds, personId, Math.max(limit * 8, limit)) as Array<MessageSearchResult & { chunkIndex: number }>;

    const results: MessageSearchResult[] = [];
    const seenMessageIds = new Set<string>();
    for (const row of rows) {
      if (seenMessageIds.has(row.messageId)) {
        continue;
      }
      seenMessageIds.add(row.messageId);
      const { chunkIndex: _chunkIndex, ...result } = row;
      results.push(result);
      if (results.length >= limit) {
        break;
      }
    }

    if (results.length > 0) {
      return results;
    }

    const terms = query
      .split(/[ 　]+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 0);
    if (terms.length === 0) {
      return [];
    }

    const where = terms.map(() => "mc.text LIKE ? ESCAPE '\\'").join(" OR ");
    const params = terms.map((term) => `%${term.replace(/[%_]/g, "\\$&")}%`);
    const likeExcludedWhere =
      excludedIds.length > 0 ? `AND m.id NOT IN (${excludedIds.map(() => "?").join(", ")})` : "";

    return this.database
      .prepare(
        `
        SELECT
          *
        FROM (
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
            m.sent_at AS sentAt,
            ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY mc.chunk_index ASC) AS rowNumber
          FROM message_chunks mc
          JOIN messages m ON m.id = mc.message_id
          JOIN chats c ON c.id = m.chat_id
          WHERE (${where})
          ${likeExcludedWhere}
          AND m.person_id = ?
        ) ranked
        WHERE rowNumber = 1
        ORDER BY sentAt DESC
        LIMIT ?
      `,
      )
      .all(...params, ...excludedIds, personId, limit) as MessageSearchResult[];
  }

  getProfileEntry(entryId: string): ProfileEntryRecord | undefined {
    const row = this.database
      .prepare(
        `
        SELECT
          id,
          person_id AS personId,
          category,
          content,
          entry_type AS entryType,
          confidence,
          status,
          source,
          created_at AS createdAt,
          updated_at AS updatedAt,
          last_observed_at AS lastObservedAt
        FROM person_profile_entries
        WHERE id = ?
      `,
      )
      .get(entryId) as ProfileEntryRecord | undefined;

    if (!row) {
      return undefined;
    }

    return { ...row, evidence: this.getEvidence(entryId) };
  }

  replaceProfileEntry(input: { supersedeEntryId: string; input: UpsertProfileEntryInput }): string {
    if (input.input.evidence.length === 0) {
      throw new Error("Profile entry evidence is required.");
    }

    const timestamp = input.input.observedAt ?? nowIso();
    const newEntryId = createId("profile_entry", [input.input.personId, input.input.category, input.input.content]);
    const transaction = this.database.transaction(() => {
      // Create the new entry
      this.database
        .prepare(
          `
          INSERT INTO person_profile_entries (
            id, person_id, category, content, entry_type, confidence, status, source, created_at, updated_at, last_observed_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
        `,
        )
        .run(newEntryId, input.input.personId, input.input.category, input.input.content, input.input.entryType, input.input.confidence, input.input.source, timestamp, timestamp, timestamp);

      // Mark old entry as superseded
      this.database
        .prepare(
          `
          UPDATE person_profile_entries
          SET status = 'superseded', updated_at = ?
          WHERE id = ? AND status = 'active'
        `,
        )
        .run(timestamp, input.supersedeEntryId);

      // Insert evidence for the new entry
      const insertEvidence = this.database.prepare(
        `
        INSERT INTO person_profile_evidence (entry_id, message_id, quote, reason)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entry_id, message_id, quote) DO UPDATE SET reason = excluded.reason
      `,
      );
      for (const evidence of input.input.evidence) {
        insertEvidence.run(newEntryId, evidence.messageId, evidence.quote, evidence.reason);
      }
    });
    transaction();

    return newEntryId;
  }

  markProfileEntryDeleted(entryId: string): void {
    const timestamp = nowIso();
    this.database
      .prepare("UPDATE person_profile_entries SET status = 'deleted', updated_at = ? WHERE id = ?")
      .run(timestamp, entryId);
  }

  personExists(personId: string): boolean {
    const row = this.database.prepare("SELECT 1 AS existsFlag FROM persons WHERE id = ? LIMIT 1").get(personId) as { existsFlag: number } | undefined;
    return Boolean(row);
  }

  private getEvidence(entryId: string): ProfileEvidenceRecord[] {
    return this.database
      .prepare(
        `
        SELECT entry_id AS entryId, message_id AS messageId, quote, reason
        FROM person_profile_evidence
        WHERE entry_id = ?
        ORDER BY message_id ASC, quote ASC
      `,
      )
      .all(entryId) as ProfileEvidenceRecord[];
  }
}
