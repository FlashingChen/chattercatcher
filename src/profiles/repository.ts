import crypto from "node:crypto";
import type { SqliteDatabase } from "../db/database.js";
import type {
  DreamStateRecord,
  PersonRecord,
  ProfileEntryRecord,
  ProfileEvidenceRecord,
  PersonIdentityRecord,
  ResolvePersonInput,
  UpsertProfileEntryInput,
} from "./types.js";

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
    const entryId = createId("profile_entry", [input.personId, input.category, input.content, timestamp]);
    const transaction = this.database.transaction(() => {
      this.database
        .prepare(
          `
          INSERT INTO person_profile_entries (
            id, person_id, category, content, entry_type, confidence, status, source, created_at, updated_at, last_observed_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
        `,
        )
        .run(entryId, input.personId, input.category, input.content, input.entryType, input.confidence, input.source, timestamp, timestamp, timestamp);

      const insertEvidence = this.database.prepare(
        `
        INSERT INTO person_profile_evidence (entry_id, message_id, quote, reason)
        VALUES (?, ?, ?, ?)
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
