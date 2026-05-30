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
      person_id TEXT REFERENCES persons(id) ON DELETE SET NULL,
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

    CREATE TABLE IF NOT EXISTS persons (
      id TEXT PRIMARY KEY,
      primary_name TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS person_identities (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      platform_chat_id TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      external_open_id TEXT,
      external_union_id TEXT,
      external_user_id_raw TEXT,
      display_name TEXT NOT NULL,
      alias TEXT,
      source TEXT NOT NULL CHECK(source IN ('message','feishu_member','manual','inferred')),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      UNIQUE(platform, platform_chat_id, external_user_id)
    );

    CREATE INDEX IF NOT EXISTS person_identities_person_idx ON person_identities(person_id);
    CREATE INDEX IF NOT EXISTS person_identities_lookup_idx ON person_identities(platform, platform_chat_id, external_user_id);
    CREATE INDEX IF NOT EXISTS person_identities_name_idx ON person_identities(display_name, alias);

    CREATE TABLE IF NOT EXISTS person_profile_entries (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      entry_type TEXT NOT NULL CHECK(entry_type IN ('fact','inferred')),
      confidence REAL NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','superseded','deleted')),
      source TEXT NOT NULL CHECK(source IN ('dream','explicit_user_request','manual')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_observed_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS person_profile_entries_person_status_idx ON person_profile_entries(person_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS person_profile_evidence (
      entry_id TEXT NOT NULL REFERENCES person_profile_entries(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      quote TEXT NOT NULL,
      reason TEXT NOT NULL,
      PRIMARY KEY (entry_id, message_id, quote)
    );

    CREATE TABLE IF NOT EXISTS profile_dream_state (
      platform TEXT NOT NULL,
      platform_chat_id TEXT NOT NULL,
      last_message_id TEXT,
      last_message_sent_at TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (platform, platform_chat_id)
    );

    CREATE TABLE IF NOT EXISTS profile_dream_runs (
      id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      platform_chat_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('succeeded','failed','skipped')),
      processed_message_count INTEGER NOT NULL,
      generated_entry_count INTEGER NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL
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
      trace_json TEXT NOT NULL DEFAULT '{}',
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

    CREATE TABLE IF NOT EXISTS feishu_chat_members (
      chat_id TEXT NOT NULL,
      open_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, open_id)
    );

    CREATE INDEX IF NOT EXISTS feishu_chat_members_chat_name_idx
    ON feishu_chat_members(chat_id, user_name);

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
      updated_at TEXT NOT NULL,
      image_file_name TEXT
    );

    CREATE INDEX IF NOT EXISTS cron_jobs_chat_status_idx ON cron_jobs(chat_id, status, updated_at);
    CREATE INDEX IF NOT EXISTS cron_jobs_due_idx ON cron_jobs(status, next_run_at);

    CREATE TABLE IF NOT EXISTS feishu_chat_members (
      chat_id TEXT NOT NULL,
      open_id TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, open_id)
    );

    CREATE INDEX IF NOT EXISTS feishu_chat_members_chat_name_idx
    ON feishu_chat_members(chat_id, user_name);
  `);

  const messageColumns = database.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  if (!messageColumns.some((column) => column.name === "person_id")) {
    database.prepare("ALTER TABLE messages ADD COLUMN person_id TEXT REFERENCES persons(id) ON DELETE SET NULL").run();
  }
  database.prepare("CREATE INDEX IF NOT EXISTS messages_person_idx ON messages(person_id, sent_at)").run();

  const cronJobColumns = database.prepare("PRAGMA table_info(cron_jobs)").all() as Array<{ name: string }>;
  const ensureCronJobColumn = (name: string, definition: string): void => {
    if (!cronJobColumns.some((column) => column.name === name)) {
      database.prepare(`ALTER TABLE cron_jobs ADD COLUMN ${definition}`).run();
    }
  };

  ensureCronJobColumn("image_file_name", "image_file_name TEXT");
  ensureCronJobColumn("mention_target_name", "mention_target_name TEXT");
  ensureCronJobColumn("mention_open_id", "mention_open_id TEXT");
  ensureCronJobColumn("mention_user_id", "mention_user_id TEXT");

  const qaLogColumns = database.prepare("PRAGMA table_info(qa_logs)").all() as Array<{ name: string }>;
  if (!qaLogColumns.some((column) => column.name === "trace_json")) {
    database.prepare("ALTER TABLE qa_logs ADD COLUMN trace_json TEXT NOT NULL DEFAULT '{}'").run();
  }
}
