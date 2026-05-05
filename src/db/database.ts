import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "../config/schema.js";
import { resolveHomePath } from "../config/paths.js";

export type SqliteDatabase = Database.Database;

export function getDatabasePath(config: AppConfig): string {
  return path.join(resolveHomePath(config.storage.dataDir), "chattercatcher.db");
}

export function openDatabase(config: AppConfig): SqliteDatabase {
  const databasePath = getDatabasePath(config);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  migrateDatabase(database);
  return database;
}

export function migrateDatabase(database: SqliteDatabase): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_chat_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(platform, platform_chat_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_message_id TEXT NOT NULL,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      message_type TEXT NOT NULL,
      text TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(platform, platform_message_id)
    );

    CREATE TABLE IF NOT EXISTS message_chunks (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(message_id, chunk_index)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS message_chunks_fts USING fts5(
      text,
      chunk_id UNINDEXED,
      message_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS memory_episodes (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(chat_id, started_at, ended_at)
    );

    CREATE TABLE IF NOT EXISTS memory_episode_messages (
      episode_id TEXT NOT NULL REFERENCES memory_episodes(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      PRIMARY KEY (episode_id, message_id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_episodes_fts USING fts5(
      summary,
      episode_id UNINDEXED,
      tokenize = 'unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS memory_episodes_delete_fts
    AFTER DELETE ON memory_episodes
    BEGIN
      DELETE FROM memory_episodes_fts WHERE episode_id = old.id;
    END;

    CREATE INDEX IF NOT EXISTS memory_episode_messages_message_idx
    ON memory_episode_messages(message_id);

    CREATE TABLE IF NOT EXISTS message_chunk_embeddings (
      chunk_id TEXT NOT NULL REFERENCES message_chunks(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      embedding_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (chunk_id, model)
    );

    CREATE INDEX IF NOT EXISTS message_chunk_embeddings_model_idx
    ON message_chunk_embeddings(model, dimension);

    CREATE TABLE IF NOT EXISTS qa_logs (
      id TEXT PRIMARY KEY,
      chat_id TEXT,
      question_message_id TEXT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      citations_json TEXT NOT NULL,
      retrieval_debug_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('answered','failed')),
      error TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS qa_logs_created_at_idx ON qa_logs(created_at);
    CREATE INDEX IF NOT EXISTS qa_logs_chat_idx ON qa_logs(chat_id, created_at);

    CREATE TABLE IF NOT EXISTS file_jobs (
      id TEXT PRIMARY KEY,
      source_path TEXT NOT NULL,
      stored_path TEXT,
      file_name TEXT NOT NULL,
      status TEXT NOT NULL,
      parser TEXT,
      message_id TEXT,
      bytes INTEGER,
      characters INTEGER,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS image_multimodal_tasks (
      id TEXT PRIMARY KEY,
      source_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      platform_message_id TEXT NOT NULL,
      image_key TEXT NOT NULL,
      stored_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','skipped','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      derived_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(source_message_id, image_key)
    );

    CREATE INDEX IF NOT EXISTS image_multimodal_tasks_status_idx ON image_multimodal_tasks(status, updated_at);

    CREATE TABLE IF NOT EXISTS cron_jobs (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      created_by_open_id TEXT,
      schedule TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','deleted')),
      last_run_at TEXT,
      next_run_at TEXT NOT NULL,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS cron_jobs_chat_status_idx ON cron_jobs(chat_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS cron_jobs_due_idx ON cron_jobs(status, next_run_at);
  `);
}
