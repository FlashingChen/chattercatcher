import type { EvidenceBlock } from "../rag/types.js";
import type { RagSearchTool } from "../rag/search-tools.js";
import type { ProfileRepository } from "./repository.js";

type GetProfileInput = {
  personId?: unknown;
  senderId?: unknown;
  platformChatId?: unknown;
  includeEvidence?: unknown;
  includeInferred?: unknown;
};

const getProfileInputSchema = {
  type: "object",
  properties: {
    personId: { type: "string", description: "Stable person identifier from retrieved evidence." },
    senderId: { type: "string", description: "Message sender id when personId is unavailable." },
    platformChatId: { type: "string", description: "Chat id paired with senderId for profile lookup." },
    includeEvidence: { type: "boolean", description: "Whether to include evidence snippets in the profile text." },
    includeInferred: { type: "boolean", description: "Whether to include inferred profile entries." },
  },
  additionalProperties: false,
};

const searchMessagesInputSchema = {
  type: "object",
  properties: {
    personId: { type: "string", description: "The stable person identifier whose messages to search." },
    query: { type: "string", description: "Search query written by the model." },
    limit: { type: "number", description: "Maximum number of evidence blocks to return." },
  },
  required: ["personId", "query"],
  additionalProperties: false,
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolvePersonId(profiles: ProfileRepository, input: unknown): string {
  const raw = (typeof input === "object" && input !== null ? input : {}) as GetProfileInput;
  const personId = readString(raw.personId);
  if (personId) return personId;

  const senderId = readString(raw.senderId);
  const platformChatId = readString(raw.platformChatId);
  if (senderId && platformChatId) {
    const resolved = profiles.resolvePersonIdForSender({ senderId, platformChatId });
    if (resolved) return resolved;
  }

  throw new Error("personId 或 senderId + platformChatId 必须提供。");
}

function parseBoolean(input: unknown, key: "includeEvidence" | "includeInferred", defaultValue: boolean): boolean {
  const value = typeof input === "object" && input !== null ? (input as Record<string, unknown>)[key] : undefined;
  return typeof value === "boolean" ? value : defaultValue;
}

function parsePersonId(input: unknown): string {
  const raw =
    typeof input === "object" && input !== null && "personId" in input
      ? (input as { personId?: unknown }).personId
      : undefined;

  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("personId 必须是非空字符串。");
  }

  return raw.trim();
}

function parseQuery(input: unknown): string {
  const rawQuery =
    typeof input === "object" && input !== null && "query" in input
      ? (input as { query?: unknown }).query
      : undefined;

  if (typeof rawQuery !== "string") {
    throw new Error("搜索 query 必须是非空字符串。");
  }

  const query = rawQuery.trim();
  if (!query) {
    throw new Error("搜索 query 必须是非空字符串。");
  }

  return query;
}

function parseLimit(input: unknown): number {
  const rawLimit =
    typeof input === "object" && input !== null && "limit" in input
      ? (input as { limit?: unknown }).limit
      : undefined;
  const numericLimit = typeof rawLimit === "number" && Number.isFinite(rawLimit) ? rawLimit : 5;
  return Math.min(12, Math.max(1, Math.floor(numericLimit)));
}

function createGetPersonProfileTool(profiles: ProfileRepository): RagSearchTool {
  return {
    name: "get_person_profile",
    description:
      "Retrieve an evidence-backed profile for a person. Use this when the question depends on who someone is, their role, preferences, personality, relationships, or recent state.",
    inputSchema: getProfileInputSchema,
    execute: async (input: unknown): Promise<EvidenceBlock[]> => {
      const personId = resolvePersonId(profiles, input);
      const includeEvidence = parseBoolean(input, "includeEvidence", false);
      const includeInferred = parseBoolean(input, "includeInferred", true);
      const profile = profiles.getPersonProfile(personId, { includeEvidence, includeInferred });

      if (!profile) {
        return [];
      }

      const aliases = profile.identities.map((identity) => identity.displayName).filter(Boolean).join("、");
      const entries = profile.entries.map((entry) => {
        const evidence = includeEvidence && entry.evidence?.length
          ? `\n  证据：${entry.evidence.map((item) => `${item.quote}（${item.reason}）`).join("；")}`
          : "";
        return `- [${entry.entryType}] ${entry.category}：${entry.content}（置信度 ${entry.confidence}，来源 ${entry.source}）${evidence}`;
      });

      return [{
        id: `person_profile:${profile.person.id}`,
        text: [`人物：${profile.person.primaryName}`, aliases ? `身份/昵称：${aliases}` : undefined, ...entries].filter(Boolean).join("\n"),
        score: 1,
        source: {
          type: "person_profile",
          label: profile.person.primaryName,
          personId: profile.person.id,
          profileAvailable: true,
        },
      }];
    },
  };
}

function createSearchPersonMessagesTool(profiles: ProfileRepository): RagSearchTool {
  return {
    name: "search_person_messages",
    description:
      "Search chat messages sent by a specific person only. Use this when the question is explicitly about what a particular person said, or when you need to find messages from a specific person.",
    inputSchema: searchMessagesInputSchema,
    execute: async (input: unknown): Promise<EvidenceBlock[]> => {
      const personId = resolvePersonId(profiles, input);
      const query = parseQuery(input);
      const limit = parseLimit(input);

      const results = profiles.searchPersonMessages(personId, query, limit);

      return results.map((result) => ({
        id: result.chunkId,
        text: result.text,
        score: result.score,
        source: {
          type: result.messageType === "file" ? ("file" as const) : ("message" as const),
          label: result.chatName,
          sender: result.senderName,
          senderId: result.senderId,
          timestamp: result.sentAt,
          personId: result.personId ?? undefined,
          profileAvailable: Boolean(result.personId),
        },
      }));
    },
  };
}

export function createPersonProfileTools({ profiles }: { profiles: ProfileRepository }): RagSearchTool[] {
  return [createGetPersonProfileTool(profiles), createSearchPersonMessagesTool(profiles)];
}
