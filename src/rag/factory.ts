import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { SqliteDatabase } from "../db/database.js";
import { EpisodeRepository } from "../episodes/repository.js";
import type { MessageRepository } from "../messages/repository.js";
import type { MessageSearchScope } from "../messages/types.js";
import { createEmbeddingModel } from "../llm/openai-compatible.js";
import { EpisodeFtsRetriever } from "./episode-retriever.js";
import { HybridRetriever } from "./hybrid-retriever.js";
import { MessageFtsRetriever } from "./message-retriever.js";
import type { Retriever } from "./retriever.js";
import { createRagSearchTools, type RagSearchTool } from "./search-tools.js";
import { SqliteVectorStore } from "./sqlite-vector-store.js";
import { VectorRetriever } from "./vector-retriever.js";

export function hasEmbeddingConfig(config: AppConfig, secrets: AppSecrets): boolean {
  return Boolean((config.embedding.baseUrl || config.llm.baseUrl) && config.embedding.model && (secrets.embedding.apiKey || secrets.llm.apiKey));
}

export async function createHybridRetriever(input: {
  config: AppConfig;
  secrets: AppSecrets;
  database: SqliteDatabase;
  messages: MessageRepository;
  excludeMessageIds?: string[];
  scope?: MessageSearchScope;
}): Promise<{ retriever: Retriever; close: () => void }> {
  const retrievers: Retriever[] = [
    new EpisodeFtsRetriever(new EpisodeRepository(input.database)),
    new MessageFtsRetriever(input.messages, { excludeMessageIds: input.excludeMessageIds }),
  ];
  const closers: Array<() => void> = [];

  if (hasEmbeddingConfig(input.config, input.secrets)) {
    const vectorStore = new SqliteVectorStore(input.database, {
      model: input.config.embedding.model,
    });
    retrievers.push(new VectorRetriever(createEmbeddingModel(input.config, input.secrets), vectorStore));
  }

  return {
    retriever: new HybridRetriever(retrievers, { scope: input.scope }),
    close: () => {
      for (const closer of closers) {
        closer();
      }
    },
  };
}

export async function createAgenticRagSearchTools(input: {
  config: AppConfig;
  secrets: AppSecrets;
  database: SqliteDatabase;
  messages: MessageRepository;
  excludeMessageIds?: string[];
  scope?: MessageSearchScope;
  profileTools?: RagSearchTool[];
}): Promise<{ tools: RagSearchTool[]; close: () => void }> {
  const episodes = new EpisodeFtsRetriever(new EpisodeRepository(input.database));
  const messages = new MessageFtsRetriever(input.messages, { excludeMessageIds: input.excludeMessageIds });
  const semantic = hasEmbeddingConfig(input.config, input.secrets)
    ? new VectorRetriever(
        createEmbeddingModel(input.config, input.secrets),
        new SqliteVectorStore(input.database, { model: input.config.embedding.model }),
      )
    : undefined;
  const hybrid = new HybridRetriever(semantic ? [episodes, messages, semantic] : [episodes, messages]);

  const tools = createRagSearchTools({ hybrid, messages, episodes, semantic, scope: input.scope });

  if (input.profileTools && input.profileTools.length > 0) {
    tools.push(...input.profileTools);
  }

  return {
    tools,
    close: () => {},
  };
}
