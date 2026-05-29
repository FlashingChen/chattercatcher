import type { EvidenceBlock } from "../rag/types.js";
import type { RagSearchTool } from "../rag/search-tools.js";
import type { ProfileRepository } from "./repository.js";

const getProfileInputSchema = {
  type: "object",
  properties: {
    personId: { type: "string", description: "The stable person identifier to fetch profile entries for." },
  },
  required: ["personId"],
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
      "Retrieve stored profile entries (facts and inferences) for a specific person by their stable identifier. Use this when the question is about a particular person's traits, habits, preferences, or other stored knowledge.",
    inputSchema: getProfileInputSchema,
    execute: async (input: unknown): Promise<EvidenceBlock[]> => {
      const personId = parsePersonId(input);
      const profile = profiles.getPersonProfile(personId);

      if (!profile) {
        return [];
      }

      return profile.entries.map((entry) => ({
        id: entry.id,
        text: entry.content,
        score: entry.confidence,
        source: {
          type: "person_profile" as const,
          label: profile.person.primaryName,
          personId: profile.person.id,
          timestamp: entry.lastObservedAt,
        },
      }));
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
      const personId = parsePersonId(input);
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
          timestamp: result.sentAt,
          personId: result.personId ?? undefined,
        },
      }));
    },
  };
}

export function createPersonProfileTools({ profiles }: { profiles: ProfileRepository }): RagSearchTool[] {
  return [createGetPersonProfileTool(profiles), createSearchPersonMessagesTool(profiles)];
}
