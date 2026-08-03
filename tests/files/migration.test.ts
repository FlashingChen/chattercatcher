import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "../../src/db/database.js";

let testDir: string;

describe("file_jobs 迁移与存量 backfill", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-file-migration-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("旧库补列后行数与 ID 不变，stored_path 存在补写 sha256，文件缺失留空不编造", async () => {
    const existingFile = path.join(testDir, "existing.txt");
    await fs.writeFile(existingFile, "旧文件内容", "utf8");
    const missingFile = path.join(testDir, "missing.txt");

    const database = new Database(path.join(testDir, "legacy.db"));
    database.exec(`
      CREATE TABLE file_jobs (
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
      INSERT INTO file_jobs (id, source_path, stored_path, file_name, status, created_at, updated_at)
      VALUES
        ('legacy_a', '/old/a.md', '${existingFile}', 'a.md', 'indexed', '2026-01-01', '2026-01-01'),
        ('legacy_b', '/old/b.md', '${missingFile}', 'b.md', 'indexed', '2026-01-01', '2026-01-01'),
        ('legacy_c', '/old/c.md', NULL, 'c.md', 'indexed', '2026-01-01', '2026-01-01');
    `);

    try {
      migrateDatabase(database);

      const rows = database
        .prepare("SELECT id, content_sha256 AS sha, platform_file_key AS fileKey FROM file_jobs ORDER BY id")
        .all() as Array<{ id: string; sha: string | null; fileKey: string | null }>;

      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({
        id: "legacy_a",
        sha: crypto.createHash("sha256").update("旧文件内容").digest("hex"),
        fileKey: null,
      });
      expect(rows[1]).toEqual({ id: "legacy_b", sha: null, fileKey: null });
      expect(rows[2]).toEqual({ id: "legacy_c", sha: null, fileKey: null });
    } finally {
      database.close();
    }
  });
});
