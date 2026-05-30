import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createDefaultSecrets } from "../../src/config/schema.js";
import { getConfigPath, getSecretsPath } from "../../src/config/paths.js";
import { migrateDatabase } from "../../src/db/database.js";
import { MessageRepository } from "../../src/messages/repository.js";
import { ProfileRepository } from "../../src/profiles/repository.js";

async function runCli(homeDir: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "./src/cli.ts", ...args], {
      cwd: path.resolve(__dirname, "../.."),
      env: { ...process.env, CHATTERCATCHER_HOME: homeDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe("profiles CLI", () => {
  let homeDir: string;

  beforeEach(async () => {
    homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "chattercatcher-profiles-cli-"));
    process.env.CHATTERCATCHER_HOME = homeDir;
    const config = createDefaultConfig();
    config.storage.dataDir = homeDir;
    await fs.mkdir(path.dirname(getConfigPath()), { recursive: true });
    await fs.writeFile(getConfigPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await fs.writeFile(getSecretsPath(), `${JSON.stringify(createDefaultSecrets(), null, 2)}\n`, "utf8");
  });

  afterEach(async () => {
    delete process.env.CHATTERCATCHER_HOME;
    await fs.rm(homeDir, { recursive: true, force: true });
  });

  it("lists and shows profiles", async () => {
    const db = new Database(path.join(homeDir, "chattercatcher.db"));
    db.pragma("foreign_keys = ON");
    migrateDatabase(db);
    const profiles = new ProfileRepository(db);
    const person = profiles.resolvePersonForSender({
      platform: "feishu",
      platformChatId: "chat-a",
      senderId: "ou_123",
      senderName: "小王",
      source: "message",
      observedAt: "2026-05-29T00:00:00.000Z",
    });
    db.close();

    const list = await runCli(homeDir, ["profiles", "list"]);
    expect(list).toMatchObject({ code: 0, stderr: "" });
    expect(list.stdout).toContain(person.id);
    expect(list.stdout).toContain("小王");

    const show = await runCli(homeDir, ["profiles", "show", person.id]);
    expect(show).toMatchObject({ code: 0, stderr: "" });
    expect(JSON.parse(show.stdout)).toMatchObject({
      person: { id: person.id, primaryName: "小王" },
      identities: [expect.objectContaining({ externalUserId: "ou_123" })],
    });
  });

  it("backfills historical messages from the CLI", async () => {
    const db = new Database(path.join(homeDir, "chattercatcher.db"));
    db.pragma("foreign_keys = ON");
    migrateDatabase(db);
    const messages = new MessageRepository(db);
    messages.ingest({
      platform: "feishu",
      platformChatId: "chat-a",
      chatName: "家庭群",
      platformMessageId: "msg-1",
      senderId: "ou_123",
      senderName: "小王",
      messageType: "text",
      text: "大家好",
      sentAt: "2026-05-29T00:00:00.000Z",
    });
    db.close();

    const backfill = await runCli(homeDir, ["profiles", "backfill", "--limit", "10"]);
    expect(backfill).toMatchObject({ code: 0, stderr: "" });
    expect(backfill.stdout).toContain("已回填 1 条消息");

    const verifyDb = new Database(path.join(homeDir, "chattercatcher.db"));
    const row = verifyDb.prepare("SELECT person_id AS personId FROM messages LIMIT 1").get() as { personId: string | null };
    verifyDb.close();
    expect(row.personId).toMatch(/^person_/);
  });
});
