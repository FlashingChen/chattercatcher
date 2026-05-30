import type { SqliteDatabase } from "../db/database.js";
import type { MessageSearchScope } from "../messages/types.js";
import { cosineSimilarity } from "./embedding.js";
import type { EvidenceSource } from "./types.js";
import type { VectorRecord, VectorSearchResult, VectorStore } from "./vector-store.js";

interface SearchRow {
  chunkId: string;
  text: string;
  chatName: string;
  senderId: string;
  senderName: string;
  personId?: string;
  sentAt: string;
  embeddingJson: string;
}

function parseEmbeddingJson(value: string): number[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "number") ? parsed : [];
  } catch {
    return [];
  }
}

function toEvidenceSource(row: SearchRow): EvidenceSource {
  return {
    type: "message",
    label: row.chatName,
    sender: row.senderName,
    senderId: row.senderId,
    personId: row.personId,
    profileAvailable: Boolean(row.personId),
    timestamp: row.sentAt,
  };
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

export class SqliteVectorStore implements VectorStore {
  constructor(
    private readonly database: SqliteDatabase,
    private readonly options: { model: string },
  ) {}

  async upsert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const updatedAt = new Date().toISOString();
    const statement = this.database.prepare(`
      INSERT INTO message_chunk_embeddings (chunk_id, model, dimension, embedding_json, updated_at)
      VALUES (@chunkId, @model, @dimension, @embeddingJson, @updatedAt)
      ON CONFLICT(chunk_id, model)
      DO UPDATE SET
        dimension = excluded.dimension,
        embedding_json = excluded.embedding_json,
        updated_at = excluded.updated_at
    `);

    const transaction = this.database.transaction((input: VectorRecord[]) => {
      for (const record of input) {
        statement.run({
          chunkId: record.id,
          model: this.options.model,
          dimension: record.vector.length,
          embeddingJson: JSON.stringify(record.vector),
          updatedAt,
        });
      }
    });

    transaction(records);
  }

  async search(vector: number[], limit: number, scope?: MessageSearchScope): Promise<VectorSearchResult[]> {
    if (limit <= 0) {
      return [];
    }

    const scopeWhere = buildScopeWhere(scope);
    const rows = this.database
      .prepare(
        `
        SELECT
          mc.id AS chunkId,
          mc.text AS text,
          c.name AS chatName,
          m.sender_id AS senderId,
          m.sender_name AS senderName,
          m.person_id AS personId,
          m.sent_at AS sentAt,
          e.embedding_json AS embeddingJson
        FROM message_chunk_embeddings e
        JOIN message_chunks mc ON mc.id = e.chunk_id
        JOIN messages m ON m.id = mc.message_id
        JOIN chats c ON c.id = m.chat_id
        WHERE e.model = ?
        ${scopeWhere.where}
      `,
      )
      .all(this.options.model, ...scopeWhere.params) as SearchRow[];

    return rows
      .flatMap((row) => {
        const storedVector = parseEmbeddingJson(row.embeddingJson);
        if (storedVector.length === 0) {
          return [];
        }

        const vectorScore = cosineSimilarity(vector, storedVector);
        return {
          id: row.chunkId,
          text: row.text,
          score: vectorScore,
          vectorScore,
          source: toEvidenceSource(row),
        };
      })
      .sort((left, right) => right.vectorScore - left.vectorScore)
      .slice(0, limit);
  }

  count(): number {
    const row = this.database
      .prepare("SELECT COUNT(*) AS count FROM message_chunk_embeddings WHERE model = ?")
      .get(this.options.model) as { count: number };

    return row.count;
  }
}
