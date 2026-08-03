import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig } from "../../src/config/schema.js";
import { openDatabase } from "../../src/db/database.js";
import { FileJobRepository } from "../../src/files/jobs.js";
let testDir: string;

describe("FileJobRepository", () => {
  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-file-jobs-"));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it("记录文件解析任务成功状态", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    try {
      const jobs = new FileJobRepository(database);
      const id = jobs.start({ sourcePath: path.join(testDir, "activity.md") });
      jobs.complete({
        id,
        storedPath: path.join(testDir, "data", "files", "activity.md"),
        parser: "text",
        messageId: "msg_1",
        bytes: 12,
        characters: 10,
        warnings: [],
      });

      expect(jobs.list()).toMatchObject([
        {
          id,
          status: "indexed",
          parser: "text",
          messageId: "msg_1",
        },
      ]);
      expect(jobs.get(id)).toMatchObject({ id, status: "indexed" });
    } finally {
      database.close();
    }
  });

  it("记录文件解析任务失败原因", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    try {
      const jobs = new FileJobRepository(database);
      const id = jobs.start({ sourcePath: path.join(testDir, "scan.exe") });
      jobs.fail({ id, error: "暂不支持该文件类型" });

      expect(jobs.list()[0]).toMatchObject({
        status: "failed",
        error: "暂不支持该文件类型",
      });
      expect(jobs.list(10, { status: "indexed" })).toHaveLength(0);
      expect(jobs.list(10, { status: "failed" })).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("记录文件内容 sha256 与平台 file_key 两列", () => {
    const config = createDefaultConfig();
    config.storage.dataDir = testDir;
    const database = openDatabase(config);
    try {
      const jobs = new FileJobRepository(database);
      const id = jobs.start({ sourcePath: path.join(testDir, "activity.md"), platformFileKey: "file_v2_abc" });
      jobs.complete({
        id,
        storedPath: path.join(testDir, "data", "files", "activity.md"),
        parser: "text",
        messageId: "msg_1",
        bytes: 12,
        characters: 10,
        warnings: [],
        contentSha256: "sha256_of_content",
      });

      expect(jobs.get(id)).toMatchObject({
        id,
        status: "indexed",
        contentSha256: "sha256_of_content",
        platformFileKey: "file_v2_abc",
      });
    } finally {
      database.close();
    }
  });
});
