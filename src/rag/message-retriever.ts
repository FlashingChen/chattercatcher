import { MessageRepository } from "../messages/repository.js";
import type { MessageSearchResult } from "../messages/types.js";
import type { EvidenceBlock } from "./types.js";
import type { Retriever, RetrievalScope } from "./retriever.js";

function toEvidenceSource(result: MessageSearchResult): EvidenceBlock["source"] {
  const source: EvidenceBlock["source"] = {
    type: result.messageType === "file" ? "file" : "message",
    label: result.messageType === "file" ? result.senderName : result.chatName,
    timestamp: result.sentAt,
  };

  if (result.messageType !== "file") {
    source.sender = result.senderName;
  }
  source.senderId = result.senderId;
  source.profileAvailable = Boolean(result.personId);

  if (result.personId) {
    source.personId = result.personId;
  }

  return source;
}

export class MessageFtsRetriever implements Retriever {
  constructor(
    private readonly messages: MessageRepository,
    private readonly options: { excludeMessageIds?: string[] } = {},
  ) {}

  async retrieve(question: string, scope?: RetrievalScope): Promise<EvidenceBlock[]> {
    const results = this.messages.searchMessages(question, 8, {
      excludeMessageIds: this.options.excludeMessageIds,
      scope,
    });

    return results.map((result) => ({
      id: result.chunkId,
      text: result.text,
      score: result.score,
      source: toEvidenceSource(result),
    }));
  }
}
