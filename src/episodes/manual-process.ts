import type { AppConfig, AppSecrets } from "../config/schema.js";
import type { SqliteDatabase } from "../db/database.js";
import type { ChatModel } from "../rag/types.js";
import { EpisodeRepository } from "./repository.js";
import { summarizeEpisodeWindow } from "./summarizer.js";

export interface ProcessEpisodesResult {
  created: number;
}

export async function processEpisodesNow(input: {
  config: AppConfig;
  secrets: AppSecrets;
  database: SqliteDatabase;
  model: ChatModel;
  now?: Date;
}): Promise<ProcessEpisodesResult> {
  const episodes = new EpisodeRepository(input.database);
  const created = await episodes.summarizeReadyWindows({
    now: input.now ?? new Date(),
    quietMs: input.config.episodes.quietMinutes * 60 * 1000,
    windowMs: input.config.episodes.windowMinutes * 60 * 1000,
    summarize: (window, now) => summarizeEpisodeWindow(window, input.model, now),
  });

  return { created: created.length };
}
